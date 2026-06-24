// Record store (spec §16). Pluggable backend, same public API as before, all async:
//   - memory (DEFAULT, tests)  : disposable, seeded from seed.ts, per-process MemoryBackend.
//                                resetStore() swaps to a fresh instance — hermetic tests.
//   - json   (local dev)       : file-backed; STORE_BACKEND=json or LEADS_DB_PATH selects it.
//                                Per-lead read-modify-write of the same JSON file. Single-writer
//                                (one dev process) only — never use on multi-process serverless.
//   - kv     (Vercel prod)     : Upstash Redis. STORE_BACKEND=kv selects it.
//
// ─────────────────────────────────────────────────────────────────────────────
// V1-platform atomicity model (todo 1 — supersedes the JSON-blob lead body):
//   Each lead is a Redis HASH `lead:{id}`, ONE field per Lead property. A write
//   touches ONLY the fields it provides via a single HSET — so two concurrent
//   writers touching DIFFERENT fields (e.g. a Stripe webhook flipping `status`
//   while the chat writes `confirmed_sqft`) BOTH survive. No JSON-merge, no
//   custom Lua, no last-writer-wins-on-the-whole-lead race (old AGENTS.md gap §4
//   is closed). Nested values (vision_assessment, work_order, photos, price_range)
//   are JSON-encoded per field and decoded on read.
//   `_actions` (idempotency ledger) moves OFF the lead body into its own Redis
//   SET `actions:{id}`; `actionSeen` = `SADD actions:{id} hash` (returns 0/1,
//   atomic, additive). `events` move to a List `events:{id}` (todo 3).
//   The slot ledger moves to a Redis Hash `slots:{date}` with an atomic
//   `HSETNX` claim (todo 1 — closes the double-book race; see scheduler.ts).
//
// Status enum (todo 1, LOCKED): the loose 10-value union collapses to a
// canonical 7-value enum. Each WRITER chooses the canonical value that matches
// its intent (Oracle-resolved): only stripe.ts writes PAID; the legacy operator's
// slots-offered state is ACTIVE + a `slots_offered_at` marker. A lenient reader
// (LEGACY_STATUS_MAP) migrates any old persisted literal on load so a stale
// json/kv store never hydrates an invalid status.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { SEED_LEADS } from "./seed";

// Canonical V1-platform status enum (todo 1, LOCKED).
export type LeadStatus =
  | "ACTIVE"
  | "PAUSED"
  | "ESCALATED"
  | "PAID"
  | "BOOKED"
  | "ABANDONED"
  | "DEAD";

// Lenient migration of any old persisted literal → canonical (todo 1 landmine:
// stale json/kv blobs hold the old 10-value union). Applied on every read so a
// pre-existing store never surfaces an invalid status. New code never writes the
// old literals; this map only protects legacy data.
const LEGACY_STATUS_MAP: Record<string, LeadStatus> = {
  "New Lead": "ACTIVE",
  "Waiting for Info": "ACTIVE",
  "Info Received": "ACTIVE",
  "AI Qualified": "ACTIVE",
  "Needs Human Review": "ESCALATED",
  "Ready to Schedule": "PAID",
  Scheduled: "BOOKED",
  "Work Order Created": "BOOKED",
  "Not a Fit": "DEAD",
  "Lost / No Response": "ABANDONED",
};

const CANONICAL_STATUSES = new Set<LeadStatus>([
  "ACTIVE",
  "PAUSED",
  "ESCALATED",
  "PAID",
  "BOOKED",
  "ABANDONED",
  "DEAD",
]);

function normalizeStatus(raw: unknown): LeadStatus {
  if (typeof raw === "string") {
    if (CANONICAL_STATUSES.has(raw as LeadStatus)) return raw as LeadStatus;
    const mapped = LEGACY_STATUS_MAP[raw];
    if (mapped) return mapped;
  }
  return "ACTIVE";
}

export interface LeadEvent {
  ts: string;
  actor: "agent" | "owner" | "system";
  action: string;
  reason_code?: string;
  corrected_value?: unknown;
  agent_decision?: unknown;
  inputs?: unknown;
}

export interface Lead {
  lead_id: string;
  // Tenant isolation key (AGENTS.md §1 KNOWN GAP). Optional today; never read by
  // the current backends. Added now so the future migration needs no backfill.
  owner_id?: string;
  name?: string;
  channel: "telegram" | "email" | "whatsapp" | "form";
  language?: "en" | "es";
  address?: string;
  address_number?: string;
  street_name?: string;
  street_type?: string;
  lat?: number;
  lng?: number;
  zone?: string | null;
  property_type?: string;
  desired_frequency?: string;
  photos: string[];
  vision_assessment?: Record<string, unknown>;
  lead_score?: "A" | "B" | "C";
  risk_level?: string;
  ai_recommendation?: string;
  suggested_package?: string;
  price_range?: { low: number; high: number };
  status: LeadStatus;
  escalation_reason?: string;
  visit_at?: string;
  work_order?: Record<string, unknown>;
  internal_notes?: string;
  created_at: string;
  first_response_at?: string;
  // Customer linkage (todo 2). Canonical email is the Customer PK.
  customer_email?: string;
  // Staged checkout coordinates (todo 16) — the re-engagement worker retrieves
  // this session and re-stages a fresh Checkout if it expired.
  staged_session_id?: string;
  staged_tier?: string;
  staged_frequency?: string;
  // Real Stripe subscription id, written by the paid webhook (todo 23). The Job
  // is keyed off THIS (sub_…), not the Checkout session id, so the lifecycle
  // webhooks find the right Job (Oracle B2).
  stripe_subscription_id?: string;
  // Operational stage markers (todo 1). Additive timestamps — NOT a parallel
  // status field; they let the legacy V1 dashboard split BOOKED into
  // scheduled/work-order and detect "slots offered" without a second status
  // source of truth (Oracle-resolved).
  slots_offered_at?: string;
  work_order_created_at?: string;
  // Escalation board lifecycle (todo 9): when the lead entered ESCALATED and
  // whether the owner has acknowledged it (sweep skips acked/PAUSED).
  escalated_at?: string;
  escalation_acked?: boolean;
  // Area + slope measurement (spec §A.6) — populated as the funnel learns.
  estimated_sqft?: number;
  confirmed_sqft?: number;
  area_source?: "auto" | "customer_draw";
  area_confidence?: number;
  area_confirmed_by_customer?: boolean;
  slope_tier?: "flat" | "moderate" | "steep";
  slope_source?: "elevation" | "photo_raised";
  // Measured-area × slope priced numbers (spec §A.4).
  per_visit_price?: number;
  monthly_price?: number;
  intent?: string;
  // Pointer to the most recent event in the first-class stream (todo 3). The
  // events themselves live in the Redis List `events:{id}`, off the lead body.
  lastEventTs?: string;
}

// Fields stored JSON-encoded in the Hash (nested objects/arrays). Everything
// else is a scalar stored as a plain string/number. On read, Upstash HGETALL
// auto-JSON-parses every field, so these decode for free; scalars that happen
// to look like JSON are re-coerced to their declared type below.
const JSON_FIELDS = new Set<keyof Lead>([
  "vision_assessment",
  "work_order",
  "price_range",
  "photos",
]);

// Per-lead async backend. putLead takes a PARTIAL write (only the provided
// fields are persisted, atomically per field). getFullLead returns the
// hydrated whole lead. The partial-write shape is what makes concurrent
// distinct-field writers race-free.
interface Backend {
  getLead(id: string): Promise<Lead | undefined>;
  putLead(id: string, fields: Partial<Lead>, createdAtFallback: string): Promise<void>;
  allLeads(): Promise<Lead[]>;
  // Idempotency ledger (Redis SET semantics): returns true if already present.
  addAction(id: string, hash: string): Promise<boolean>;
  // Read-only check (does NOT add). Used where the side effect can fail and we
  // must NOT mark-then-skip — e.g. GCal export (cross-model review S4).
  hasAction(id: string, hash: string): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MemoryBackend — disposable, used by tests + the default zero-config dev path.
// Per-field merge under the hood (single-writer in-process, so a plain merge is
// equivalent to the Hash's per-field atomicity). `_actions` is a Set.
// ─────────────────────────────────────────────────────────────────────────────

class MemoryBackend implements Backend {
  private leads = new Map<string, Lead>();
  private actions = new Map<string, Set<string>>();
  constructor(seed: Lead[] = []) {
    for (const l of seed) {
      this.leads.set(l.lead_id, { ...structuredClone(l), status: normalizeStatus(l.status) });
    }
  }
  async getLead(id: string): Promise<Lead | undefined> {
    const l = this.leads.get(id);
    return l ? structuredClone(l) : undefined;
  }
  async putLead(id: string, fields: Partial<Lead>, createdAtFallback: string): Promise<void> {
    const existing = this.leads.get(id);
    const merged: Lead = {
      photos: [],
      status: "ACTIVE",
      created_at: createdAtFallback,
      channel: "form",
      lead_id: id,
      ...(existing ?? {}),
      ...fields,
    } as Lead;
    merged.status = normalizeStatus(merged.status);
    this.leads.set(id, structuredClone(merged));
  }
  async allLeads(): Promise<Lead[]> {
    return [...this.leads.values()]
      .map((l) => structuredClone(l))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addAction(id: string, hash: string): Promise<boolean> {
    let set = this.actions.get(id);
    if (!set) {
      set = new Set();
      this.actions.set(id, set);
    }
    if (set.has(hash)) return true;
    set.add(hash);
    return false;
  }
  async hasAction(id: string, hash: string): Promise<boolean> {
    return this.actions.get(id)?.has(hash) ?? false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JsonBackend — local dev only. Per-lead read-modify-write on a single JSON file.
// Single-writer (one `next dev` process); never on Vercel. Mirrors the Hash's
// per-field merge so a partial putLead never clobbers untouched fields.
// ─────────────────────────────────────────────────────────────────────────────

interface JsonDB {
  leads: Record<string, Lead>;
  actions: Record<string, string[]>;
}

class JsonBackend implements Backend {
  constructor(private path: string) {}
  private load(): JsonDB {
    if (!existsSync(this.path)) return { leads: {}, actions: {} };
    try {
      const db = JSON.parse(readFileSync(this.path, "utf8")) as Partial<JsonDB>;
      return { leads: db.leads ?? {}, actions: db.actions ?? {} };
    } catch {
      return { leads: {}, actions: {} };
    }
  }
  private save(db: JsonDB): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(db, null, 2));
  }
  async getLead(id: string): Promise<Lead | undefined> {
    const lead = this.load().leads[id];
    if (!lead) return undefined;
    return { ...lead, status: normalizeStatus(lead.status) };
  }
  async putLead(id: string, fields: Partial<Lead>, createdAtFallback: string): Promise<void> {
    const db = this.load();
    const existing = db.leads[id];
    const merged: Lead = {
      photos: [],
      status: "ACTIVE",
      created_at: createdAtFallback,
      channel: "form",
      lead_id: id,
      ...(existing ?? {}),
      ...fields,
    } as Lead;
    merged.status = normalizeStatus(merged.status);
    db.leads[id] = merged;
    this.save(db);
  }
  async allLeads(): Promise<Lead[]> {
    const db = this.load();
    return Object.values(db.leads)
      .map((l) => ({ ...l, status: normalizeStatus(l.status) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async addAction(id: string, hash: string): Promise<boolean> {
    const db = this.load();
    const list = db.actions[id] ?? [];
    if (list.includes(hash)) return true;
    db.actions[id] = [...list, hash];
    this.save(db);
    return false;
  }
  async hasAction(id: string, hash: string): Promise<boolean> {
    return (this.load().actions[id] ?? []).includes(hash);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KvBackend — Upstash Redis. Per-lead HASH `lead:{id}` (one field per property),
// recency ZSET `leads:index`, idempotency SET `actions:{id}`.
//   putLead  = HSET lead:{id} <only the provided fields> + ZADD leads:index
//              (one pipeline; per-field atomicity means concurrent distinct-field
//               writers cannot collide).
//   getLead  = HGETALL + typed re-hydrate (decode JSON fields, coerce scalars).
//   allLeads = ZRANGE(rev) the index → pipeline HGETALL each.
//   addAction= SADD actions:{id} hash → returns 0/1 (atomic, additive).
// ─────────────────────────────────────────────────────────────────────────────

const LEAD_KEY = (id: string) => `lead:${id}`;
const ACTIONS_KEY = (id: string) => `actions:${id}`;
const LEADS_INDEX = "leads:index";
const LEADS_INDEX_PAGE = 500;

// Encode a single Lead field for HSET. Nested values → JSON string; scalars →
// raw (Upstash stores numbers/booleans coherently and HGETALL round-trips them).
function encodeField(key: keyof Lead, value: unknown): string | number | boolean {
  if (JSON_FIELDS.has(key)) return JSON.stringify(value);
  if (value === null) return "null";
  return value as string | number | boolean;
}

// Re-hydrate a HGETALL map into a typed Lead. Upstash auto-JSON-parses every
// field, so nested fields arrive decoded; we re-stringify scalar string fields
// that Upstash may have coerced (e.g. internal_notes="42" must stay the string
// "42" — todo 1 acceptance test). Known string fields are forced back to string.
const STRING_FIELDS = new Set<keyof Lead>([
  "lead_id",
  "owner_id",
  "name",
  "channel",
  "language",
  "address",
  "address_number",
  "street_name",
  "street_type",
  "zone",
  "property_type",
  "desired_frequency",
  "lead_score",
  "risk_level",
  "ai_recommendation",
  "suggested_package",
  "status",
  "escalation_reason",
  "visit_at",
  "internal_notes",
  "created_at",
  "first_response_at",
  "customer_email",
  "staged_session_id",
  "staged_tier",
  "staged_frequency",
  "stripe_subscription_id",
  "slots_offered_at",
  "work_order_created_at",
  "escalated_at",
  "area_source",
  "slope_tier",
  "slope_source",
  "intent",
  "lastEventTs",
]);

const NUMBER_FIELDS = new Set<keyof Lead>([
  "lat",
  "lng",
  "estimated_sqft",
  "confirmed_sqft",
  "area_confidence",
  "per_visit_price",
  "monthly_price",
]);

const BOOLEAN_FIELDS = new Set<keyof Lead>([
  "area_confirmed_by_customer",
  "escalation_acked",
]);

function hydrateLead(id: string, raw: Record<string, unknown>): Lead {
  const out: Record<string, unknown> = { lead_id: id };
  for (const [k, v] of Object.entries(raw)) {
    const key = k as keyof Lead;
    if (v === undefined || v === null) continue;
    if (STRING_FIELDS.has(key)) {
      // Force back to string — Upstash may have parsed "42"/"true" into a
      // number/boolean; the contract says these stay strings.
      out[k] = typeof v === "string" ? v : String(v);
    } else if (NUMBER_FIELDS.has(key)) {
      out[k] = typeof v === "number" ? v : Number(v);
    } else if (BOOLEAN_FIELDS.has(key)) {
      out[k] = typeof v === "boolean" ? v : v === "true" || v === true;
    } else if (JSON_FIELDS.has(key)) {
      out[k] = typeof v === "string" ? safeJson(v) : v;
    } else {
      out[k] = v;
    }
  }
  // Defaults + status normalization.
  if (!Array.isArray(out.photos)) out.photos = [];
  out.status = normalizeStatus(out.status);
  if (typeof out.created_at !== "string") out.created_at = new Date().toISOString();
  if (typeof out.channel !== "string") out.channel = "form";
  return out as unknown as Lead;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

class KvBackend implements Backend {
  constructor(private client: Redis) {}

  async getLead(id: string): Promise<Lead | undefined> {
    const raw = await this.client.hgetall<Record<string, unknown>>(LEAD_KEY(id));
    if (!raw || Object.keys(raw).length === 0) return undefined;
    return hydrateLead(id, raw);
  }

  async putLead(id: string, fields: Partial<Lead>, createdAtFallback: string): Promise<void> {
    // Build the HSET payload from the provided fields. A field EXPLICITLY set to
    // undefined is a CLEAR — emit an HDEL for it so KV matches the Memory/JSON
    // spread semantics (Oracle B1: skipping undefined left stale parcel parts on
    // Redis, so clearStaleGeo never cleared and measure_property read the wrong
    // lot). `lead_id`/`created_at`/`channel` are never cleared.
    const payload: Record<string, string | number | boolean> = {};
    const toClear: string[] = [];
    const NEVER_CLEAR = new Set(["lead_id", "created_at", "channel"]);
    for (const [k, v] of Object.entries(fields)) {
      if (k === "lead_id") continue;
      if (v === undefined) {
        if (!NEVER_CLEAR.has(k)) toClear.push(k);
        continue;
      }
      payload[k] = encodeField(k as keyof Lead, v);
    }
    const score = Date.parse(
      typeof fields.created_at === "string" ? fields.created_at : createdAtFallback,
    );
    const pipe = this.client.multi();
    if (Object.keys(payload).length > 0) {
      pipe.hset(LEAD_KEY(id), payload);
    }
    if (toClear.length > 0) {
      pipe.hdel(LEAD_KEY(id), ...toClear);
    }
    // created_at only if absent (HSETNX) — guarantees the recency score is stable.
    pipe.hsetnx(LEAD_KEY(id), "created_at", createdAtFallback);
    pipe.hsetnx(LEAD_KEY(id), "channel", fields.channel ?? "form");
    pipe.zadd(LEADS_INDEX, {
      score: Number.isFinite(score) ? score : Date.now(),
      member: id,
    });
    await pipe.exec();
  }

  async allLeads(): Promise<Lead[]> {
    const ids = await this.client.zrange<string[]>(LEADS_INDEX, 0, LEADS_INDEX_PAGE - 1, {
      rev: true,
    });
    if (!ids.length) return [];
    const pipe = this.client.multi();
    for (const id of ids) pipe.hgetall(LEAD_KEY(id));
    const results = (await pipe.exec()) as Array<Record<string, unknown> | null>;
    const leads: Lead[] = [];
    for (let i = 0; i < ids.length; i++) {
      const raw = results[i];
      if (raw && Object.keys(raw).length > 0) leads.push(hydrateLead(ids[i]!, raw));
    }
    return leads;
  }

  async addAction(id: string, hash: string): Promise<boolean> {
    // SADD returns the number of NEW members (1 = first time, 0 = already seen).
    const added = await this.client.sadd(ACTIONS_KEY(id), hash);
    return added === 0;
  }
  async hasAction(id: string, hash: string): Promise<boolean> {
    const member = await this.client.sismember(ACTIONS_KEY(id), hash);
    return member === 1;
  }
}

let kvClient: Redis | null = null;
function getKvClient(): Redis {
  if (!kvClient) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error(
        "STORE_BACKEND=kv requires UPSTASH_REDIS_REST_URL+_TOKEN (or legacy KV_REST_API_URL+_TOKEN). " +
          "Provision Upstash via the Vercel Marketplace, then `vercel env pull` to sync locally.",
      );
    }
    kvClient = new Redis({ url, token });
  }
  return kvClient;
}

// Exposed for sibling modules (scheduler slot Hash, spend meters, queue) that
// need the same shared Upstash client when STORE_BACKEND=kv. Returns null when
// not on the kv backend so callers fall back to their in-process dev path.
export function getSharedRedis(): Redis | null {
  const mode = process.env.STORE_BACKEND ?? (process.env.LEADS_DB_PATH ? "json" : "memory");
  if (mode !== "kv") return null;
  return getKvClient();
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend selection.
// ─────────────────────────────────────────────────────────────────────────────

function pickBackend(): Backend {
  const mode = process.env.STORE_BACKEND ?? (process.env.LEADS_DB_PATH ? "json" : "memory");
  if (mode === "kv") return new KvBackend(getKvClient());
  if (mode === "json") return new JsonBackend(process.env.LEADS_DB_PATH ?? "data/leads.json");
  return new MemoryBackend(SEED_LEADS);
}

let backend: Backend = pickBackend();

export function resetStore(seed: Lead[] = []): void {
  backend = new MemoryBackend(seed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API. All async. Consumers MUST await.
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertLead(
  fields: Partial<Lead> & { lead_id: string; channel: Lead["channel"] },
): Promise<Lead> {
  const createdAtFallback = new Date().toISOString();
  // Per-field atomic write: only the provided fields are persisted. We do NOT
  // read-then-merge-then-write the whole lead — that was the old RMW race.
  await backend.putLead(fields.lead_id, fields, createdAtFallback);
  // Return the hydrated current state for callers that use the result.
  const lead = await backend.getLead(fields.lead_id);
  return (
    lead ?? {
      photos: [],
      status: "ACTIVE",
      created_at: createdAtFallback,
      _actions: [],
      ...fields,
    } as unknown as Lead
  );
}

export async function getLead(lead_id: string): Promise<Lead | undefined> {
  return backend.getLead(lead_id);
}

export async function allLeads(): Promise<Lead[]> {
  return backend.allLeads();
}

// Idempotency: returns true if this action already fired for this lead (§4).
// Atomic per-key SADD — no read-modify-write, no lost-append race.
export async function actionSeen(
  lead_id: string,
  action: string,
  payload: unknown,
): Promise<boolean> {
  return backend.addAction(lead_id, actionHash(action, payload));
}

// Read-only idempotency check — does NOT mark the action seen. Use before a
// side effect that can fail, so a failure doesn't leave a "seen" marker that
// permanently skips the retry (cross-model review S4).
export async function actionAlreadySeen(
  lead_id: string,
  action: string,
  payload: unknown,
): Promise<boolean> {
  return backend.hasAction(lead_id, actionHash(action, payload));
}

function actionHash(action: string, payload: unknown): string {
  return createHash("sha256")
    .update(action + JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Event stream (todo 3). Re-exported from the dedicated module so existing
// `import { appendEvent, listEvents } from "./store"` consumers keep working.
// ─────────────────────────────────────────────────────────────────────────────
export { appendEvent, listEvents } from "./events";
