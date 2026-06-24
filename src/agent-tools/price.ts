// recommend_tier + compute_exact_price — moved verbatim from src/agent-tools.ts
// during the mechanical split.

import { z } from "zod";
import { pricePerVisit } from "../pricing";
import { upsertLead, getLead } from "../store";
import { PRICE_BOOK, type Tier } from "../contract";
import { type ToolContext, TIER_ORDER, TierEnum, FrequencyEnum, MAX_TIER_INCLUDES } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// recommend_tier — re-derives the spec from PRICE_BOOK, ignores any model price
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendTierResult {
  tier: Tier;
  name: string;
  perVisit: number;
  blurb: string;
  includes: string[];
  options: Array<{ tier: Tier; name: string; perVisit: number; blurb: string }>;
  reason: string;
}

export const RecommendTierArgsSchema = z.object({
  tier: TierEnum,
  reason: z.string().describe("Why this tier fits, one warm sentence"),
});

export async function runRecommendTier(
  ctx: ToolContext,
  args: z.infer<typeof RecommendTierArgsSchema>,
): Promise<RecommendTierResult> {
  const spec = PRICE_BOOK[args.tier];
  const existing = await getLead(ctx.leadId);
  await upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    suggested_package: spec.name,
    ai_recommendation: args.reason,
  });
  return {
    tier: args.tier,
    name: spec.name,
    perVisit: spec.perVisit, // authoritative — from the contract, not the model
    blurb: spec.blurb,
    includes: spec.includes.slice(0, MAX_TIER_INCLUDES),
    options: TIER_ORDER.map((id) => ({
      tier: id,
      name: PRICE_BOOK[id].name,
      perVisit: PRICE_BOOK[id].perVisit,
      blurb: PRICE_BOOK[id].blurb,
    })),
    reason: args.reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// compute_exact_price — measured-area × slope deterministic price (spec §A.4)
// ─────────────────────────────────────────────────────────────────────────────

export type ComputeExactPriceResult =
  | { status: "missing_measurement"; message: string }
  | {
      status: "priced";
      perVisit: number;
      monthly: number;
      tier_name: string;
      tier_inclusions: string[];
      currency: "USD";
    };

export const ComputeExactPriceArgsSchema = z.object({ tier: TierEnum, frequency: FrequencyEnum });

export async function runComputeExactPrice(
  ctx: ToolContext,
  args: z.infer<typeof ComputeExactPriceArgsSchema>,
): Promise<ComputeExactPriceResult> {
  const lead = await getLead(ctx.leadId);
  const sqft = lead?.confirmed_sqft;
  if (!sqft || sqft <= 0) {
    return {
      status: "missing_measurement",
      message:
        "Confirm the maintained area on the map first — the price is derived from the measured sqft, not estimated.",
    };
  }
  const priced = pricePerVisit({
    measured_area_sqft: sqft,
    slope_tier: lead?.slope_tier ?? "flat",
    frequency: args.frequency,
  });
  const spec = PRICE_BOOK[args.tier];
  // Persist the priced numbers — propose_checkout / Stripe / dashboard now all
  // read the SAME source of truth (review blocker A).
  await upsertLead({
    lead_id: ctx.leadId,
    channel: lead?.channel ?? "form",
    per_visit_price: priced.perVisit,
    monthly_price: priced.monthly,
    suggested_package: spec.name,
    desired_frequency: args.frequency,
  });
  return {
    status: "priced",
    perVisit: priced.perVisit,
    monthly: priced.monthly,
    tier_name: spec.name,
    tier_inclusions: spec.includes.slice(0, MAX_TIER_INCLUDES),
    currency: "USD",
  };
}
