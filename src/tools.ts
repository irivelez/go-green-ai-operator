// Tool handlers — the agent's callable capabilities (spec §7).
// Plain async functions = the real business logic (fully testable, no key needed).
// agent.ts registers these with the Claude Agent SDK as MCP tools behind canUseTool.

import { quoteRange, type PricingCase } from "./pricing";
import { geoQualify, scoreLead, type LeadSignals } from "./qualify";
import { checkEscalation, hardRuleDeny, type CaseState } from "./escalation";
import { upsertLead, getLead, actionSeen, type Lead } from "./store";

export interface YardAssessment {
  condition_score: number;
  overgrowth: "low" | "med" | "high";
  cleanup_required: boolean;
  detected_extras: string[];
  yard_size_estimate: "small" | "medium" | "large";
  confidence: number;
}

// In the live loop Claude reads photos natively and fills this. For the no-key
// demo, vision is injected (test) or defaulted.
export function visionFallback(): YardAssessment {
  return {
    condition_score: 6, overgrowth: "med", cleanup_required: false,
    detected_extras: [], yard_size_estimate: "medium", confidence: 0.8,
  };
}

export function tool_geo_qualify(input: { address?: string; zip?: string }) {
  return geoQualify(input);
}

export function tool_score_lead(signals: LeadSignals) {
  const geo = geoQualify({ address: signals.address, zip: signals.zip });
  return { ...scoreLead(signals, geo), geo };
}

export function tool_quote_range(c: PricingCase) {
  return quoteRange(c);
}

export function tool_book_evaluation(lead: Lead, slotISO: string): { ok: boolean; reason?: string; lead?: Lead } {
  const deny = hardRuleDeny("book_evaluation", { slot: slotISO }, {
    inbound_text: "", address: lead.address,
  } as CaseState);
  if (deny) return { ok: false, reason: deny };
  if (actionSeen(lead.lead_id, "book", slotISO)) {
    return { ok: false, reason: "idempotent: already booked this slot" };
  }
  const updated = upsertLead({
    lead_id: lead.lead_id, channel: lead.channel, status: "Scheduled", visit_at: slotISO,
  });
  return { ok: true, lead: updated };
}

export function tool_create_work_order(lead_id: string): Lead | { error: string } {
  const lead = getLead(lead_id);
  if (!lead) return { error: "lead not found" };
  if (!lead.visit_at) return { error: "no booked visit — cannot create work order" };
  return upsertLead({
    lead_id, channel: lead.channel, status: "Work Order Created",
    work_order: {
      address: lead.address, zone: lead.zone, frequency: lead.desired_frequency,
      package: lead.suggested_package, price_range: lead.price_range,
      visit_at: lead.visit_at, notes: "Standard residential maintenance evaluation.",
    },
  });
}

export function tool_raise_escalation(lead_id: string, channel: Lead["channel"], reason: string, brief: string): Lead {
  return upsertLead({
    lead_id, channel, status: "Needs Human Review",
    escalation_reason: reason, internal_notes: brief,
  });
}

export { checkEscalation };
