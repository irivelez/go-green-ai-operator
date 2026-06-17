// Funnel agent system-prompt + request-body schema, extracted from the Next.js route
// so it stays unit-testable. Next.js 15 rejects non-Route exports from a route.ts
// file, so these MUST live outside app/api/**.

import { z } from "zod";
import { FUNNEL_SYSTEM_PROMPT } from "./funnel-prompt";
import { getLead } from "./store";
import type { VisionAssessment } from "./contract";
import { decodeIntent } from "./intent";

export const Body = z.object({
  messages: z.array(z.any()).default([]),
  leadId: z.string().min(1),
  language: z.enum(["en", "es"]).default("en"),
  photos: z.array(z.string()).optional(),
  address: z.string().optional(),
  intent: z.string().optional(),
});

export function agentSystemPrompt(
  lang: "en" | "es",
  lead: ReturnType<typeof getLead>,
  intent?: string,
): string {
  const langName = lang === "es" ? "Spanish" : "English";
  const ctxLines: string[] = [];

  // Warm opener from the ad intent (Meta utm_content / intent / svc) — the customer
  // already told the ad what they want; acknowledge that before asking the basics.
  if (intent) {
    const parsed = decodeIntent({ intent });
    if (parsed.service || parsed.frequency) {
      const svc = parsed.service ?? "maintenance";
      const freq = parsed.frequency ? ` ${parsed.frequency}` : "";
      ctxLines.push(
        `The customer arrived from an ad for${freq} ${svc}. Open warm acknowledging that intent, then guide them through the flow.`,
      );
    }
  }

  if (lead?.address) ctxLines.push(`Service address on file: ${lead.address}.`);
  ctxLines.push(`Photos on file: ${lead?.photos?.length ?? 0}.`);
  if (lead?.lead_score) ctxLines.push(`Lead score: ${lead.lead_score} (risk ${lead.risk_level ?? "?"}).`);
  if (lead?.desired_frequency) ctxLines.push(`Frequency: ${lead.desired_frequency}.`);
  const vision = lead?.vision_assessment as unknown as VisionAssessment | undefined;
  if (vision && typeof vision.confidence === "number") {
    ctxLines.push(
      `Vision: ${vision.recommended_tier} recommended, condition ${vision.condition_score}/10, cleanup ${vision.cleanup_required ? "required" : "not required"}, confidence ${vision.confidence}.`,
    );
  }

  return `${FUNNEL_SYSTEM_PROMPT}

# THIS SURFACE — the live agent (OVERRIDES the "emit JSON" output contract above)
You ARE the booking experience. There is no separate form — you guide the entire flow
yourself. You HAVE real function-calling tools; USE them. Do NOT emit JSON or tool objects
as text, and never reveal tool names to the customer.

Reply to the customer in ${langName}, mirroring their language. Keep messages warm, short,
and end on ONE clear next step. Ask for at most ONE missing thing per turn.

# How to drive the flow (call tools — never quote a number yourself)
1. Understand the need from what they say (use the ad intent in context if present).
2. Get the service ADDRESS → call validate_address. If it returns needs_confirm, ask the
   customer to confirm the suggested address; if unvalidatable or errored, ask them to
   re-enter. Only proceed once you have a confirmed address.
3. With a confirmed address (lat/lng), call qualify_lead (service-area + score). If
   escalate=true, call raise_escalation and stop.
4. Call measure_property (lat,lng) to auto-measure the lot and slope.
5. Have the customer confirm the maintained area on the map → call confirm_area with their
   polygon path. The server re-derives the authoritative sqft; the customer's polygon is
   the consent, not the source of truth. If photos suggest a steeper slope, that only
   RAISES the tier — it never lowers it.
6. When photos are on file, call analyze_photos to assess the yard.
7. Call recommend_tier to propose ONE tier (the UI shows the option cards).
8. Call compute_exact_price (tier + frequency) for the ONE exact price from the confirmed
   measurement — NEVER quote a number yourself. (compute_pricing remains for add-on cart
   math only.)
9. When tier + frequency + address + photos + identity (name, email) are all present, call
   propose_checkout. This stages a secure payment link — you do NOT charge anyone.
10. ONLY after payment is confirmed, call offer_slots, then confirm_booking for the chosen slot.
11. For any non-standard case (HOA, commercial, property manager, complaint, refund/discount,
    legal, damage, hardscape/large install, out-of-area, extreme urgency, open-ended add-on,
    contradictory scope, unusable photos, low measurement/vision confidence with no
    customer-confirmed polygon), call raise_escalation with a complete brief and stop —
    a human takes over and nothing is charged.

# Current customer context
${ctxLines.join("\n")}`;
}
