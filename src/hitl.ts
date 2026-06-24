// HITL learning loop (spec §A.6). Owner interventions are captured as STRUCTURED
// events on the lead's timeline BEFORE any status flip, so the agent can learn
// from corrections later. Pure handlers, importable from tests + the API routes.
//
// Three actions:
//   handleApprove  — owner green-lights an escalated lead (status flips per
//                    existing route: Ready to Schedule → books; else → Ready to Schedule)
//   handleReject   — owner declines (status → Not a Fit)
//   handleOverride — pure correction; NO status change, only an event
//
// Body schema across all three:
//   { reason_code?: string, corrected_value?: unknown }
// For override, additionally:
//   { field: "area"|"slope"|"address"|"price"|"decision" }

import { z } from "zod";
import { getLead, upsertLead, appendEvent, type Lead, type LeadEvent } from "./store";
import { tool_book_evaluation, tool_create_work_order } from "./tools";
import { nextSlots } from "./operator";

export interface OwnerActionBody {
  reason_code?: string;
  corrected_value?: unknown;
}

export interface OverrideBody {
  field: "area" | "slope" | "address" | "price" | "decision";
  corrected_value?: unknown;
  reason_code: string;
}

// Bounded zod schemas for the unauthenticated /api/leads/* routes. The
// handlers below stay loose (corrected_value: unknown) so internal/agent
// callers keep working, but at the HTTP boundary an attacker-supplied body
// MUST round-trip through these schemas — otherwise an oversized reason_code
// or corrected_value blows up lead.events into an OOM. Tenant isolation is
// still the documented KNOWN GAP (AGENTS.md §1); the input cap is the
// stopgap that makes the gap survivable.
// Bounded-input caps (the OOM stopgap described above). REASON_CODE_MAX is applied
// to the same field in both schemas below — keep them sharing this one constant.
const REASON_CODE_MAX = 200;
const CORRECTED_VALUE_MAX = 2000;
const correctedValueSchema = z
  .union([z.string().max(CORRECTED_VALUE_MAX), z.number(), z.boolean(), z.null()])
  .optional();

export const OwnerActionSchema = z
  .object({
    reason_code: z.string().max(REASON_CODE_MAX).optional(),
    corrected_value: correctedValueSchema,
  })
  .strict();

export const OverrideSchema = z
  .object({
    field: z.enum(["area", "slope", "address", "price", "decision"]),
    reason_code: z.string().max(REASON_CODE_MAX),
    corrected_value: correctedValueSchema,
  })
  .strict();

export interface HandlerResult {
  ok: boolean;
  lead?: Lead;
  error?: string;
}

export interface OverrideResult {
  ok: boolean;
  event?: LeadEvent;
  error?: string;
}

const OVERRIDE_FIELDS = new Set(["area", "slope", "address", "price", "decision"]);

// Snapshot what the agent decided + what it saw — so the event is a self-contained
// learning record (no need to time-travel the lead later to reconstruct context).
function snapshot(lead: Lead) {
  return {
    agent_decision: {
      ai_recommendation: lead.ai_recommendation,
      lead_score: lead.lead_score,
      price_range: lead.price_range,
    },
    inputs: {
      address: lead.address,
      confirmed_sqft: lead.confirmed_sqft,
      slope_tier: lead.slope_tier,
    },
  };
}

export async function handleApprove(id: string, body: OwnerActionBody): Promise<HandlerResult> {
  const lead = await getLead(id);
  if (!lead) return { ok: false, error: "not found" };

  // 1) Capture the structured event BEFORE the status flip (§A.6 ordering).
  const snap = snapshot(lead);
  await appendEvent(id, {
    actor: "owner",
    action: "approve",
    reason_code: body.reason_code,
    corrected_value: body.corrected_value,
    agent_decision: snap.agent_decision,
    inputs: snap.inputs,
  });

  // 2) Preserve existing approve-route behavior (status flip / booking).
  const stamp = `[human] approved ${new Date().toISOString()}`;

  if (lead.status === "Ready to Schedule" && lead.address) {
    const slot = nextSlots()[0]!;
    const booked = await tool_book_evaluation({ ...lead, address: lead.address }, slot);
    if (booked.ok) {
      const workOrder = await tool_create_work_order(id);
      const updated = "lead_id" in workOrder ? (workOrder as Lead) : lead;
      const after = await upsertLead({
        lead_id: id,
        channel: updated.channel,
        internal_notes: `${lead.internal_notes ?? ""}\n${stamp} — booked.`,
      });
      return { ok: true, lead: after };
    }
  }

  const updated = await upsertLead({
    lead_id: id,
    channel: lead.channel,
    status: "Ready to Schedule",
    internal_notes: `${lead.internal_notes ?? ""}\n${stamp} — agent resumes.`,
  });
  return { ok: true, lead: updated };
}

export async function handleReject(id: string, body: OwnerActionBody): Promise<HandlerResult> {
  const lead = await getLead(id);
  if (!lead) return { ok: false, error: "not found" };

  const snap = snapshot(lead);
  await appendEvent(id, {
    actor: "owner",
    action: "reject",
    reason_code: body.reason_code,
    corrected_value: body.corrected_value,
    agent_decision: snap.agent_decision,
    inputs: snap.inputs,
  });

  const updated = await upsertLead({
    lead_id: id,
    channel: lead.channel,
    status: "Not a Fit",
    internal_notes: `${lead.internal_notes ?? ""}\n[human] declined ${new Date().toISOString()}.`,
  });
  return { ok: true, lead: updated };
}

export async function handleOverride(id: string, body: OverrideBody): Promise<OverrideResult> {
  if (!body || !OVERRIDE_FIELDS.has(body.field)) {
    return { ok: false, error: `invalid field: ${String(body?.field)}` };
  }
  const lead = await getLead(id);
  if (!lead) return { ok: false, error: "not found" };

  const snap = snapshot(lead);
  const event = await appendEvent(id, {
    actor: "owner",
    action: `override_${body.field}`,
    reason_code: body.reason_code,
    corrected_value: body.corrected_value,
    agent_decision: snap.agent_decision,
    inputs: snap.inputs,
  });

  // Pure correction capture — DOES NOT change status (§A.6).
  return { ok: true, event };
}
