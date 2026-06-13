// Escalation flags (§12.2) + hard-rule gate (§12.1).
// These map onto the Agent SDK canUseTool + PreToolUse layer; pure + testable here.

export interface CaseState {
  inbound_text: string;
  address?: string;
  property_type?: string;
  vision_confidence?: number;
  price_is_final?: boolean; // a tool attempting a binding/final price
  pricing_covered?: boolean; // pricing engine returned covered=false → escalate
}

// §12.2 — any one → raise_escalation → human queue
const FLAG_PATTERNS: Array<[RegExp, string]> = [
  [/\bHOA\b|homeowners? association/i, "HOA"],
  [/property manager|propert(y|ies) management/i, "property manager"],
  [/commercial|office building|retail|multifamily|apartment complex/i, "commercial property"],
  [/refund|discount|comp( |ed)|credit me/i, "refund/discount request"],
  [/lawsuit|legal|attorney|liabilit|warrant/i, "legal/warranty mention"],
  [/damage|broke|destroyed|killed my/i, "damage report"],
  [/complaint|terrible|awful|furious|unacceptable/i, "upset/complaint"],
  [/hardscape|retaining wall|pergola|drainage|french drain|paver|patio install/i, "large install/hardscape"],
  [/urgent|emergency|asap|today only|right now/i, "extreme urgency"],
  [/manager and|my partner and|we both need to|multiple owners/i, "multiple decision-makers"],
];

export interface EscalationCheck {
  escalate: boolean;
  reasons: string[];
}

export function checkEscalation(c: CaseState): EscalationCheck {
  const reasons: string[] = [];
  for (const [re, label] of FLAG_PATTERNS) {
    if (re.test(c.inbound_text)) reasons.push(label);
  }
  if (c.property_type && !["residential", "unknown"].includes(c.property_type)) {
    reasons.push(`non-residential: ${c.property_type}`);
  }
  if (typeof c.vision_confidence === "number" && c.vision_confidence < 0.5) {
    reasons.push("low vision confidence on photos");
  }
  if (c.pricing_covered === false) reasons.push("pricing outside rubric coverage");
  return { escalate: reasons.length > 0, reasons };
}

// §12.1 hard rules — deny BEFORE a tool runs. Returns null = allow, string = deny reason.
export function hardRuleDeny(
  tool: string,
  input: Record<string, unknown>,
  c: CaseState
): string | null {
  if (tool === "book_evaluation" && !c.address) {
    return "HARD RULE: no scheduling without a confirmed address";
  }
  if (tool === "send_message" && c.price_is_final) {
    return "HARD RULE: range-only — no final/binding price sent autonomously";
  }
  // Idempotency is enforced at the store layer via (lead_id, action_hash).
  return null;
}
