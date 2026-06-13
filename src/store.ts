// Record store — Airtable stand-in for the live demo (spec §16).
// JSON-file persistence with idempotent action keys (§5). Swap to Airtable post-event.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

const DB_PATH = process.env.LEADS_DB_PATH ?? "data/leads.json";

export type LeadStatus =
  | "New Lead" | "Waiting for Info" | "Info Received" | "AI Qualified"
  | "Ready to Schedule" | "Scheduled" | "Work Order Created"
  | "Needs Human Review" | "Not a Fit" | "Lost / No Response";

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
  _actions: string[]; // idempotency ledger of (action_hash)
}

interface DB { leads: Record<string, Lead>; }

function load(): DB {
  if (!existsSync(DB_PATH)) return { leads: {} };
  return JSON.parse(readFileSync(DB_PATH, "utf8"));
}
function save(db: DB) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function upsertLead(fields: Partial<Lead> & { lead_id: string; channel: Lead["channel"] }): Lead {
  const db = load();
  const existing = db.leads[fields.lead_id];
  const lead: Lead = {
    photos: [], status: "New Lead", created_at: new Date().toISOString(), _actions: [],
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
