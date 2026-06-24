// Record store (spec §16). Pluggable backend, same public 7-fn API as before, all async:
//   - memory (DEFAULT, tests)  : disposable, seeded from seed.ts, per-process MemoryBackend.
//                                resetStore() swaps to a fresh instance — hermetic tests.
//   - json   (local dev)       : file-backed; STORE_BACKEND=json or LEADS_DB_PATH selects it.
//                                Per-lead read-modify-write of the same JSON file. Single-writer
//                                (one dev process) only — never use on multi-process serverless.
//   - kv     (Vercel prod)     : Upstash Redis. STORE_BACKEND=kv selects it. Per-lead key
//                                `lead:{id}` + sorted-set `leads:index` (score = Date.parse
//                                created_at) → one atomic multi() write per upsert, O(1) writes,
//                                no whole-DB blob race, naturally race-safe across distinct leads.
//
// Why per-lead async ops (not load/save whole-DB):
//   The old whole-DB interface forced load() → mutate → save() per call. On Upstash that's an
//   O(n) blob read + write per upsert AND a lost-write race when two requests touch different
//   leads concurrently. The async per-lead shape (getLead/putLead/allLeads/appendEvent/listEvents/
//   actionSeen) maps 1:1 to Redis primitives and is the SAME shape an Airtable/Postgres backend
//   would want — so the §1 tenant-isolation migration later is additive, not rewriting.
//
// Closes AGENTS.md §2 (cross-route store coherence): every Next.js route handler on Vercel reads
// the same Upstash key, so measure→confirm→price is one source of truth across invocations.
//
// Idempotent action keys (§4) enforced here via (lead_id, action_hash) on lead._actions. The
// read-modify-write race for the same lead under parallel webhooks (Stripe + Telegram retries on
// one lead at the same instant) is a documented Lua/WATCH follow-up — acceptable today because
// the funnel is sequential per customer.
//
// Owner/scope key (§1 tenant isolation, STAGED — not enforced this PR):
//   Lead.owner_id is optional now so the future row-level-security migration ships without a
//   backfill. No backend filters on it yet; enforcement lives at the DB role, not here.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { SEED_LEADS } from "./seed";

export type LeadStatus =
  | "New Lead"
  | "Waiting for Info"
  | "Info Received"
  | "AI Qualified"
  | "Ready to Schedule"
  | "Scheduled"
  | "Work Order Created"
  | "Needs Human Review"
  | "Not a Fit"
  | "Lost / No Response";

// Crew/booking handoff payload persisted on Lead.work_order. All keys OPTIONAL —
// this is the union of every write site (confirm_booking, calendar handoff,
// tools.ts work-order creation, seed fixtures) and each writes only its subset.
export interface WorkOrder {
  slotId?: string;
  date?: string;
  window?: string;
  crewSize?: number;
  calendar_event_id?: string;
  address?: string;
  zone?: string | null;
  frequency?: string;
  package?: string;
  price_range?: { low: number; high: number };
  visit_at?: string;
  notes?: string;
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
  // Tenant isolation key (AGENTS.md §1 KNOWN GAP). Optional today; required once the
  // store leaves memory/JSON for a real DB with row-level security. Added now so the
  // future migration needs no backfill — never read by the current backends.
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
  work_order?: WorkOrder;
  internal_notes?: string;
  created_at: string;
  first_response_at?: string;
  // Area + slope measurement (spec §A.6) — all optional, populated as the funnel learns.
  estimated_sqft?: number;
  confirmed_sqft?: number;
  area_source?: "auto" | "customer_draw";
  area_confidence?: number;
  area_confirmed_by_customer?: boolean;
  slope_tier?: "flat" | "moderate" | "steep";
  slope_source?: "elevation" | "photo_raised";
  // Measured-area × slope priced numbers (spec §A.4) — persisted by
  // compute_exact_price so propose_checkout + Stripe + dashboard agree on ONE
  // source of truth. Stripe charges per_visit_price × FREQUENCY_MULTIPLIER, NOT
  // the flat PRICE_BOOK[tier].perVisit (review blocker A).
  per_visit_price?: number;
  monthly_price?: number;
  // PROOF OF PAYMENT (not just status). Set ONLY by handleStripeEvent (stripe.ts)
  // when a Stripe checkout.session.completed fires — an ISO timestamp of the
  // confirmed first charge. confirm_booking gates on this, NOT on status alone:
  // operator.ts / hitl.ts also set status "Ready to Schedule" for the dashboard
  // view without any charge, so the status string is not proof a card was charged.
  paid_at?: string;
  intent?: string;
  _actions: string[]; // idempotency ledger of (action_hash)
  events?: LeadEvent[]; // HITL learning loop — owner corrections + agent decisions
}

// Per-lead async backend. The whole-DB load/save shape is gone — every consumer
// goes through these methods so a Redis hop is one round trip, not "fetch
// everything → mutate → write everything back."
interface Backend {
  getLead(id: string): Promise<Lead | undefined>;
  putLead(lead: Lead): Promise<void>;
  allLeads(): Promise<Lead[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MemoryBackend — disposable, used by tests + the default zero-config dev path.
// Async surface matches Upstash; the work is sync under the hood so tests run with
// no I/O, no key, no setup. The seed mirrors a real boot snapshot for fixtures.
// ─────────────────────────────────────────────────────────────────────────────

class MemoryBackend implements Backend {
  private leads = new Map<string, Lead>();
  constructor(seed: Lead[] = []) {
    for (const l of seed) this.leads.set(l.lead_id, structuredClone(l));
  }
  async getLead(id: string): Promise<Lead | undefined> {
    const lead = this.leads.get(id);
    return lead ? structuredClone(lead) : undefined;
  }
  async putLead(lead: Lead): Promise<void> {
    this.leads.set(lead.lead_id, structuredClone(lead));
  }
  async allLeads(): Promise<Lead[]> {
    return [...this.leads.values()]
      .map((l) => structuredClone(l))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JsonBackend — local dev only. Per-lead read-modify-write on a single JSON file.
// Acceptable single-writer (one `next dev` process); never use on Vercel.
// ─────────────────────────────────────────────────────────────────────────────

interface JsonDB {
  leads: Record<string, Lead>;
}

class JsonBackend implements Backend {
  constructor(private path: string) {}
  private load(): JsonDB {
    if (!existsSync(this.path)) return { leads: {} };
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as JsonDB;
    } catch {
      // Corrupt file → start fresh rather than throwing on the hot path; dev
      // convenience only, the file is .gitignored.
      return { leads: {} };
    }
  }
  private save(db: JsonDB): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(db, null, 2));
  }
  async getLead(id: string): Promise<Lead | undefined> {
    return this.load().leads[id];
  }
  async putLead(lead: Lead): Promise<void> {
    const db = this.load();
    db.leads[lead.lead_id] = lead;
    this.save(db);
  }
  async allLeads(): Promise<Lead[]> {
    return Object.values(this.load().leads).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KvBackend — Upstash Redis. Per-lead key `lead:{id}` + sorted-set `leads:index`
// (score = Date.parse(created_at)) for recency. Each putLead is ONE atomic
// multi() round trip: SET the JSON + ZADD the index. allLeads pages the index
// (newest first) and MGETs the bodies — bounded, no whole-DB blob.
//
// Module-level client singleton lives in getKvBackend(); per Upstash docs that's
// the cold-start best practice on Vercel (HTTP keepalive across warm invocations).
// Env vars: UPSTASH_REDIS_REST_URL/_TOKEN (canonical) OR the legacy Vercel-KV
// names KV_REST_API_URL/_TOKEN — Vercel Marketplace sets both. Defensive
// fallback so KV-only projects (older Vercel KV installations) still work.
// ─────────────────────────────────────────────────────────────────────────────

const LEAD_KEY = (id: string) => `lead:${id}`;
const LEADS_INDEX = "leads:index";
const LEADS_INDEX_PAGE = 500; // soft cap on allLeads() — bumped if a tenant outgrows it

class KvBackend implements Backend {
  constructor(private client: Redis) {}

  async getLead(id: string): Promise<Lead | undefined> {
    // Upstash auto-parses JSON values written via .set(string). null is the
    // "absent" return for both missing keys AND a key whose value is JSON null.
    const raw = await this.client.get<Lead | null>(LEAD_KEY(id));
    return raw ?? undefined;
  }

  async putLead(lead: Lead): Promise<void> {
    // Atomic: write the body AND the recency index in one round trip. Without
    // multi() a crash between SET and ZADD would leave the lead invisible to
    // allLeads — exactly the "store is the SSOT" rule the Constitution §2
    // forbids.
    const score = Date.parse(lead.created_at);
    await this.client
      .multi()
      .set(LEAD_KEY(lead.lead_id), JSON.stringify(lead))
      .zadd(LEADS_INDEX, { score: Number.isFinite(score) ? score : Date.now(), member: lead.lead_id })
      .exec();
  }

  async allLeads(): Promise<Lead[]> {
    // Newest first. zrange(rev:true) returns member ids; mget hydrates the
    // bodies. We bound the page so a runaway tenant can't OOM a dashboard
    // request — the dashboard is the only "list everything" caller.
    const ids = await this.client.zrange<string[]>(LEADS_INDEX, 0, LEADS_INDEX_PAGE - 1, {
      rev: true,
    });
    if (!ids.length) return [];
    const keys = ids.map(LEAD_KEY);
    // mget<Lead[]> returns (Lead | null)[] — Upstash already JSON-parses each
    // entry. Filter null (deleted/missing) so the dashboard never crashes on a
    // dangling index entry.
    const values = await this.client.mget<(Lead | null)[]>(...keys);
    return values.filter((l): l is Lead => l !== null && l !== undefined);
  }
}

let kvClient: Redis | null = null;
function getKvBackend(): KvBackend {
  if (!kvClient) {
    // Both env-var name pairs supported. Marketplace-installed Upstash sets
    // both; an older KV-only project sets only the KV_ names; a hand-rolled
    // Upstash project sets only the UPSTASH_ names. Pick whichever is present.
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
  return new KvBackend(kvClient);
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend selection — explicit STORE_BACKEND wins; otherwise infer from env.
// kv: Vercel prod. json: long-running dev/Telegram host. memory: tests + zero-cfg.
// ─────────────────────────────────────────────────────────────────────────────

// Production-store safety. On Vercel every serverless invocation is its own
// process, so the memory/json backends are per-instance — a Stripe webhook's
// paid_at write would land in an instance the chat tab never reads, and booking
// would never unlock. Only the shared KV backend is correct there. Returns an
// error string when the (env-derived) config is unsafe, else null. Keyed on
// VERCEL, NOT NODE_ENV, so `next build` locally and in CI (neither sets VERCEL)
// is unaffected, while a real Vercel deploy fails loud instead of losing data.
type StoreEnv = Record<string, string | undefined>; // reads VERCEL / STORE_BACKEND / LEADS_DB_PATH
export function prodStoreBackendError(env: StoreEnv = process.env): string | null {
  if (!env.VERCEL) return null;
  const mode = env.STORE_BACKEND ?? (env.LEADS_DB_PATH ? "json" : "memory");
  if (mode === "kv") return null;
  return (
    `On Vercel, STORE_BACKEND must be "kv" (got "${mode}"). memory/json are per-instance and lose ` +
    `cross-request state — set STORE_BACKEND=kv and provision Upstash. See docs/runbooks/deploy-to-vercel.md.`
  );
}

function pickBackend(): Backend {
  const configError = prodStoreBackendError();
  if (configError) throw new Error(configError);
  const mode = process.env.STORE_BACKEND ?? (process.env.LEADS_DB_PATH ? "json" : "memory");
  if (mode === "kv") return getKvBackend();
  if (mode === "json") return new JsonBackend(process.env.LEADS_DB_PATH ?? "data/leads.json");
  return new MemoryBackend(SEED_LEADS);
}

let backend: Backend = pickBackend();

// Test/seed hook — start from a clean, explicit dataset (hermetic tests). Sync
// because it ONLY swaps the in-memory backend; tests never need to await it,
// keeping the existing top-level-fixture pattern (`resetStore([])` at the top
// of the file) untouched.
export function resetStore(seed: Lead[] = []): void {
  backend = new MemoryBackend(seed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API (7 functions). All async. Consumers MUST await.
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertLead(fields: Partial<Lead> & { lead_id: string; channel: Lead["channel"] }): Promise<Lead> {
  const existing = await backend.getLead(fields.lead_id);
  const lead: Lead = {
    photos: [],
    status: "New Lead",
    created_at: new Date().toISOString(),
    _actions: [],
    events: [],
    ...existing,
    ...fields,
  } as Lead;
  await backend.putLead(lead);
  return lead;
}

export async function getLead(lead_id: string): Promise<Lead | undefined> {
  return backend.getLead(lead_id);
}

export async function allLeads(): Promise<Lead[]> {
  return backend.allLeads();
}

// HITL learning loop (spec §A.6): append a structured event to a lead's timeline.
// Owner corrections, agent decisions, system notes — durable on the same store as the lead.
export async function appendEvent(lead_id: string, event: Omit<LeadEvent, "ts"> & { ts?: string }): Promise<LeadEvent> {
  const stored: LeadEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
  const lead = await backend.getLead(lead_id);
  if (!lead) return stored; // no-op when lead absent — mirror actionSeen's defensive shape
  const events = lead.events ? [...lead.events, stored] : [stored];
  await backend.putLead({ ...lead, events });
  return stored;
}

export async function listEvents(lead_id: string): Promise<LeadEvent[]> {
  const lead = await backend.getLead(lead_id);
  return lead?.events ?? [];
}

// Idempotency: returns true if this action already fired for this lead (§4).
//
// NOTE: this is the SHARED read-modify-write pattern across THREE store ops on
// the same lead key (see AGENTS.md known-gaps §4 follow-up):
//   - actionSeen   — append to lead._actions
//   - appendEvent  — append to lead.events  (HITL learning loop)
//   - upsertLead   — merge { ...existing, ...fields } and re-PUT the whole lead
// Each does GET → mutate-in-memory → PUT. Two concurrent writers on the SAME
// lead can lose the loser's field/append (last-writer-wins on the whole-lead
// SET). Distinct leads are safe (different Redis keys, no contention).
//
// Triggerable today: Stripe webhook (handleStripeEvent → upsertLead status flip)
// landing on a lead while the customer's funnel chat is mid-upsert (e.g.
// runConfirmArea writing confirmed_sqft) → one field wipes the other.
//
// Acceptable for now (low concurrent-write rate per lead); the right fix is a
// Lua script or per-field HSET model so writes diff-merge atomically. Tracked
// in AGENTS.md known-gaps §4.
export async function actionSeen(lead_id: string, action: string, payload: unknown): Promise<boolean> {
  const hash = createHash("sha256")
    .update(action + JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);
  const lead = await backend.getLead(lead_id);
  if (!lead) return false;
  if (lead._actions.includes(hash)) return true;
  await backend.putLead({ ...lead, _actions: [...lead._actions, hash] });
  return false;
}
