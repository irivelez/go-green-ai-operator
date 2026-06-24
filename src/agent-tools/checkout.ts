// propose_checkout — moved verbatim from src/agent-tools.ts during the mechanical
// split. The handler computes the authoritative amount and NEVER charges; the
// Stripe Checkout URL is staged in buildTools (the barrel) via createSubscriptionCheckout.

import { z } from "zod";
import { priceCart, pricePerVisit } from "../pricing";
import { getLead } from "../store";
import { addOnById, type PricingResult } from "../contract";
import { type ToolContext, TierEnum, FrequencyEnum } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// propose_checkout — address + photos gates; computes the authoritative amount;
// NEVER charges. With a Stripe key the tool's execute() stages a Checkout URL.
// ─────────────────────────────────────────────────────────────────────────────

export type ProposeCheckoutResult =
  | { status: "missing_address"; message: string }
  | { status: "missing_photos"; message: string }
  | { status: "error"; message: string }
  | {
      status: "checkout_unavailable_dev" | "ready";
      amount: number; // first charge (monthly recurring + fixed add-ons)
      monthlyRecurring: number;
      currency: "USD";
      fixedAddOnIds: string[];
      // Measured area×slope per-visit USD when the lead has been measured.
      // Forwarded to createSubscriptionCheckout so Stripe charges THIS number
      // (review blocker A) — the same one shown on ExactPriceCard. Undefined →
      // legacy flat path.
      measuredPerVisit?: number;
      url?: string; // Stripe Checkout URL — only when a key is configured
      sessionId?: string;
    };

export const ProposeCheckoutArgsSchema = z.object({
  tier: TierEnum,
  frequency: FrequencyEnum,
  addOnIds: z.array(z.string()).default([]),
  name: z.string(),
  email: z.string(),
  phone: z.string().default(""),
  address: z.string(),
});

export async function runProposeCheckout(
  ctx: ToolContext,
  args: z.infer<typeof ProposeCheckoutArgsSchema>,
): Promise<ProposeCheckoutResult> {
  if (!args.address || !args.address.trim()) {
    return { status: "missing_address", message: "No scheduling without a confirmed address." };
  }
  const lead = await getLead(ctx.leadId);
  if (!lead || lead.photos.length === 0) {
    return { status: "missing_photos", message: "Photos are required before autonomous checkout." };
  }

  // priceCart is still used for the add-on resolution (fixed vs open-ended,
  // catalog lookup, validation) — only the recurring side switches to the
  // measured number when the lead has been measured. Open-ended add-ons stay
  // out of the charged total in either path.
  let pricing: PricingResult;
  try {
    pricing = priceCart({ tier: args.tier, frequency: args.frequency, addOnIds: args.addOnIds });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }

  // REVIEW BLOCKER A — charge MUST match the quote. When the lead has been
  // measured (confirm_area ran), the recurring price is the same area×slope
  // pricePerVisit number ExactPriceCard shows the customer; otherwise fall back
  // to the legacy flat PRICE_BOOK path so operator.ts + non-measured flows stay
  // intact.
  let measuredPerVisit: number | undefined;
  let monthlyRecurring = pricing.monthlyRecurring;
  if (lead.confirmed_sqft && lead.confirmed_sqft > 0 && lead.slope_tier) {
    const measured = pricePerVisit({
      measured_area_sqft: lead.confirmed_sqft,
      slope_tier: lead.slope_tier,
      frequency: args.frequency,
    });
    measuredPerVisit = measured.perVisit;
    monthlyRecurring = measured.monthly;
  }

  const fixedAddOnIds = args.addOnIds.filter((id) => addOnById(id)?.kind === "fixed");
  const fixedSum = pricing.fixedAddOnLineItems.reduce((s, x) => s + x.amount, 0);
  const amount = Math.round((monthlyRecurring + fixedSum) * 100) / 100;

  const base: ProposeCheckoutResult = {
    status: "ready",
    amount,
    monthlyRecurring,
    currency: "USD",
    fixedAddOnIds,
    measuredPerVisit,
  };

  // No Stripe key (local/dev) → expose the authoritative amount but make clear we
  // cannot stage a real Checkout. We NEVER fabricate a "paid" state.
  if (!process.env.STRIPE_SECRET_KEY) {
    return { ...base, status: "checkout_unavailable_dev" };
  }
  return base; // tool execute() attaches the real Stripe URL asynchronously
}
