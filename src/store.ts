// Record store (spec §16). Pluggable backend, same public API as before:
//   - memory (DEFAULT) : serverless-safe, seeded from seed.ts. Used by the Vercel dashboard.
//   - json   : local file persistence for the long-running Telegram/Agent-SDK runtime.
//              enabled by STORE_BACKEND=json or LEADS_DB_PATH.
// Airtable is the production swap (spec §4.1) — kept as a documented adapter, not on the
// serverless hot path. Idempotent action keys (§5) enforced here via (lead_id, action_hash).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { SEED_LEADS } from "./seed";

export type LeadStatus =
  | "New Lead" | "Waiting for Info" | "Info Received" | "AI Qualified"
  | "Ready to Schedule" | "Scheduled" | "Work Order Created"
  | "Needs Human Review" | "Not a Fit" | "Lost / No Response";

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
  name?: string;
  channel: "telegram" | "email" | "whatsapp" | "form";
  language?: "en" | "es";
  address?: string;
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
  // Area + slope measurement (spec §A.6) — all optional, populated as the funnel learns.
  estimated_sqft?: number;
  confirmed_sqft?: number;
  area_source?: "auto" | "customer_draw";
  area_confidence?: number;
  area_confirmed_by_customer?: boolean;
  slope_tier?: "flat" | "moderate" | "steep";
  slope_source?: "elevation" | "photo_raised";
  intent?: string;
  _actions: string[]; // idempotency ledger of (action_hash)
  events?: LeadEvent[]; // HITL learning loop — owner corrections + agent decisions
}

interface DB { leads: Record<string, Lead>; }

interface Backend {
  load(): DB;
  save(db: DB): void;
}

class MemoryBackend implements Backend {
  private db: DB;
  constructor(seed: Lead[] = []) {
    this.db = { leads: {} };
    for (const l of seed) this.db.leads[l.lead_id] = structuredClone(l);
  }
  load(): DB { return this.db; }
  save(db: DB): void { this.db = db; }
}

class JsonBackend implements Backend {
  constructor(private path: string) {}
  load(): DB {
    if (!existsSync(this.path)) return { leads: {} };
    return JSON.parse(readFileSync(this.path, "utf8")) as DB;
  }
  save(db: DB): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(db, null, 2));
  }
}

function pickBackend(): Backend {
  const mode = process.env.STORE_BACKEND ?? (process.env.LEADS_DB_PATH ? "json" : "memory");
  if (mode === "json") return new JsonBackend(process.env.LEADS_DB_PATH ?? "data/leads.json");
  return new MemoryBackend(SEED_LEADS);
}

let backend: Backend = pickBackend();

// Test/seed hook — start from a clean, explicit dataset (hermetic tests).
export function resetStore(seed: Lead[] = []): void {
  backend = new MemoryBackend(seed);
}

function load(): DB { return backend.load(); }
function save(db: DB): void { backend.save(db); }

export function upsertLead(
  fields: Partial<Lead> & { lead_id: string; channel: Lead["channel"] }
): Lead {
  const db = load();
  const existing = db.leads[fields.lead_id];
  const lead: Lead = {
    photos: [], status: "New Lead", created_at: new Date().toISOString(), _actions: [], events: [],
    ...existing, ...fields,
  } as Lead;
  db.leads[lead.lead_id] = lead;
  save(db);
  return lead;
}

export function getLead(lead_id: string): Lead | undefined {
  return load().leads[lead_id];
}

export function allLeads(): Lead[] {
  return Object.values(load().leads).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// HITL learning loop (spec §A.6): append a structured event to a lead's timeline.
// Owner corrections, agent decisions, system notes — durable on the same store as the lead.
export function appendEvent(
  lead_id: string,
  event: Omit<LeadEvent, "ts"> & { ts?: string }
): LeadEvent {
  const stored: LeadEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
  const db = load();
  const lead = db.leads[lead_id];
  if (!lead) return stored; // no-op when lead absent — mirror actionSeen's defensive shape
  if (!lead.events) lead.events = [];
  lead.events.push(stored);
  save(db);
  return stored;
}

export function listEvents(lead_id: string): LeadEvent[] {
  return load().leads[lead_id]?.events ?? [];
}

// Idempotency: returns true if this action already fired for this lead (§5).
export function actionSeen(lead_id: string, action: string, payload: unknown): boolean {
  const hash = createHash("sha256").update(action + JSON.stringify(payload)).digest("hex").slice(0, 16);
  const db = load();
  const lead = db.leads[lead_id];
  if (!lead) return false;
  if (lead._actions.includes(hash)) return true;
  lead._actions.push(hash);
  save(db);
  return false;
}
