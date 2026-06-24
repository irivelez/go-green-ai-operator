// Agent tool layer — the deterministic engine exposed as LLM-callable tools.
//
// THE REBUILD'S LOAD-BEARING IDEA (Oracle-validated): the LLM orchestrates the
// conversation, but every number and every irreversible decision is RE-DERIVED here,
// server-side, from the canonical contract. The model proposes; these gates dispose.
//
//   - prices come from PRICE_BOOK / priceCart — never from the model's arguments
//   - propose_checkout NEVER charges a card (it stages a Stripe URL; the human clicks)
//   - confirm_booking refuses until the lead is actually paid
//   - open-ended add-ons can never reach Stripe (priceCart + stripe.ts both refuse)
//   - escalation marks the lead and blocks auto-charge
//
// Two exports:
//   - pure run* handlers (sync where possible) → unit-tested without an LLM or network
//   - buildTools(ctx) → wraps them as Vercel AI SDK v4 tools for the streaming route
//
// This file is the BARREL: the run* handlers, their result interfaces, and their
// lifted *ArgsSchema Zod consts now live in per-stage modules under ./agent-tools/.
// Everything is re-exported here so external importers keep their existing
// `from "./agent-tools"` / `from "@/src/agent-tools"` imports unchanged.

import { tool } from "ai";
import { createSubscriptionCheckout } from "./stripe";

import { type ToolContext } from "./agent-tools/shared";
import { runQualify, QualifyArgsSchema } from "./agent-tools/qualify";
import { runRecommendTier, RecommendTierArgsSchema, runComputeExactPrice, ComputeExactPriceArgsSchema } from "./agent-tools/price";
import {
  runValidateAddress,
  ValidateAddressArgsSchema,
  runMeasureProperty,
  MeasurePropertyArgsSchema,
  runConfirmArea,
  ConfirmAreaArgsSchema,
} from "./agent-tools/measure";
import { runProposeCheckout, ProposeCheckoutArgsSchema, type ProposeCheckoutResult } from "./agent-tools/checkout";
import { runOfferSlots, OfferSlotsArgsSchema, runConfirmBooking, ConfirmBookingArgsSchema } from "./agent-tools/schedule";
import { runRaiseEscalation, RaiseEscalationArgsSchema } from "./agent-tools/escalate";
import { runAnalyzePhotos, AnalyzePhotosArgsSchema } from "./agent-tools/photos";

export * from "./agent-tools/shared";
export * from "./agent-tools/qualify";
export * from "./agent-tools/price";
export * from "./agent-tools/measure";
export * from "./agent-tools/checkout";
export * from "./agent-tools/schedule";
export * from "./agent-tools/escalate";
export * from "./agent-tools/photos";

// ─────────────────────────────────────────────────────────────────────────────
// buildTools — wrap the handlers as Vercel AI SDK v4 tools for the streaming route
// ─────────────────────────────────────────────────────────────────────────────

export function buildTools(ctx: ToolContext) {
  return {
    qualify_lead: tool({
      description:
        "Qualify the lead: check the service address is in the San Francisco service area and score the lead (A/B/C). Call this once you have an address.",
      parameters: QualifyArgsSchema,
      execute: async (args) => runQualify(ctx, args),
    }),

    analyze_photos: tool({
      description:
        "Analyze the customer's yard photo(s) with vision to assess size, condition, whether a one-time cleanup is required, and the recommended care tier. Call this when photos are on file (you don't need to pass the URLs — they're read from the lead).",
      parameters: AnalyzePhotosArgsSchema,
      execute: async (args) => runAnalyzePhotos(ctx, args),
    }),

    recommend_tier: tool({
      description:
        "Recommend ONE care tier (essential/signature/estate) for the customer to confirm, with a short reason. Returns the authoritative pricing and all three options to display as cards.",
      parameters: RecommendTierArgsSchema,
      execute: async (args) => runRecommendTier(ctx, args),
    }),

    validate_address: tool({
      description:
        "Validate and standardize the service address via Google Address Validation. Returns VALIDATED (persisted), needs_confirm (corrected — ask the customer to confirm the suggested standardization), or unvalidatable. Without a Google key returns a graceful error — never throws.",
      parameters: ValidateAddressArgsSchema,
      execute: async (args) => runValidateAddress(ctx, args),
    }),

    measure_property: tool({
      description:
        "Measure the property from the SF parcel map (DataSF): the real lot polygon for one-tap confirm, plus Elevation API slope tier. The validated address parts are read from the lead automatically — just pass lat/lng (they drive slope). Returns shared_multi_unit=true for a stacked condo (ambiguous ownership — you MUST raise_escalation, do NOT price). Falls back to a Solar+heuristic estimate when the address has no parcel match (single-family); the customer still confirms on the map. Persists estimated_sqft + slope on the lead.",
      parameters: MeasurePropertyArgsSchema,
      execute: async (args) => runMeasureProperty(ctx, args),
    }),

    confirm_area: tool({
      description:
        "Server re-derives the maintained area (sqft) from the customer's polygon — never trust a client-supplied number. If vision photos hinted at steep terrain and slope_tier is flat or moderate, the tier is raised one step (photo_raised). Persists confirmed_sqft + area_source + slope on the lead.",
      parameters: ConfirmAreaArgsSchema,
      execute: async (args) => runConfirmArea(ctx, args),
    }),

    compute_exact_price: tool({
      description:
        "Exact per-visit + monthly price from confirmed_sqft × slope_tier (area buckets + slope multiplier). Requires confirm_area to have run — otherwise returns missing_measurement. Final price is still confirmed on the first on-site visit.",
      parameters: ComputeExactPriceArgsSchema,
      execute: async (args) => runComputeExactPrice(ctx, args),
    }),

    propose_checkout: tool({
      description:
        "Stage checkout for the customer to pay (first month now to lock the booking). Price derives from the lead's confirmed_sqft + slope (compute_exact_price), not the model. Requires a confirmed address and photos on file. This NEVER charges — it returns a secure Stripe Checkout link the customer clicks themselves.",
      parameters: ProposeCheckoutArgsSchema,
      execute: async (args): Promise<ProposeCheckoutResult> => {
        const decision = await runProposeCheckout(ctx, args);
        if (decision.status !== "ready" || !process.env.STRIPE_SECRET_KEY) return decision;
        try {
          const session = await createSubscriptionCheckout({
            tier: args.tier,
            frequency: args.frequency,
            selectedAddOnIds: decision.fixedAddOnIds ?? [],
            measuredPerVisit: decision.measuredPerVisit,
            customer: {
              name: args.name,
              email: args.email,
              phone: args.phone,
              address: args.address,
            },
            leadId: ctx.leadId,
          });
          return { ...decision, url: session.url, sessionId: session.sessionId };
        } catch (e) {
          return { status: "error", message: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    offer_slots: tool({
      description:
        "Offer the available evaluation/first-service slots (4 windows/day, from Thursday, 14-day window). Call after payment is confirmed.",
      parameters: OfferSlotsArgsSchema,
      execute: async () => runOfferSlots(ctx),
    }),

    confirm_booking: tool({
      description:
        "Book a specific slot for the customer. Only succeeds after payment is confirmed. Idempotent — safe to retry.",
      parameters: ConfirmBookingArgsSchema,
      execute: async (args) => runConfirmBooking(ctx, args),
    }),

    raise_escalation: tool({
      description:
        "Route this case to a human and block any auto-charge. Use for: HOA, property manager, commercial, complaint, refund/discount, legal/warranty, damage, hardscape/large install, out-of-area, extreme urgency, open-ended add-on, low photo confidence, contradictory scope, or unusable photos.",
      parameters: RaiseEscalationArgsSchema,
      execute: async (args) => runRaiseEscalation(ctx, args),
    }),
  };
}
