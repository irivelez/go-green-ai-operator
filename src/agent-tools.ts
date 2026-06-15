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

import { tool } from "ai";
import { z } from "zod";
import { geoQualify, scoreLead } from "./qualify";
import { priceCart } from "./pricing";
import { analyzeYardPhotos } from "./vision";
import { availableSlots, bookSlot } from "./scheduler";
import { createSubscriptionCheckout } from "./stripe";
import { upsertLead, getLead } from "./store";
import {
  PRICE_BOOK,
  monthlyFromVisit,
  addOnById,
  type Tier,
  type Frequency,
  type PricingResult,
  type VisionAssessment,
  type SlotOffer,
} from "./contract";

export interface ToolContext {
  leadId: string;
  language: "en" | "es";
}

const TIER_ORDER: Tier[] = ["essential", "signature", "estate"];
const TierEnum = z.enum(["essential", "signature", "estate"]);
const FrequencyEnum = z.enum(["weekly", "biweekly", "monthly"]);

// Lead is "paid" once the Stripe webhook (stripe.ts) advances it past qualification.
const PAID_STATES = new Set(["Ready to Schedule", "Scheduled", "Work Order Created"]);

// ─────────────────────────────────────────────────────────────────────────────
// qualify_lead
// ─────────────────────────────────────────────────────────────────────────────

export interface QualifyResult {
  inArea: boolean;
  zone: string | null;
  score: "A" | "B" | "C";
  risk: string;
  reasons: string[];
  escalate: boolean;
}

export function runQualify(
  ctx: ToolContext,
  args: { address?: string; frequency?: string; hasPhotos?: boolean },
): QualifyResult {
  const geo = geoQualify({ address: args.address });
  const score = scoreLead(
    {
      address: args.address,
      property_type: "residential",
      has_photos: args.hasPhotos,
      desired_frequency: args.frequency,
    },
    geo,
  );
  const escalate = !geo.in_area || score.score === "C";

  const existing = getLead(ctx.leadId);
  upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    address: args.address ?? existing?.address,
    zone: geo.zone,
    desired_frequency: args.frequency ?? existing?.desired_frequency,
    lead_score: score.score,
    risk_level: score.risk,
    status: escalate ? existing?.status ?? "New Lead" : "AI Qualified",
  });

  return {
    inArea: geo.in_area,
    zone: geo.zone,
    score: score.score,
    risk: score.risk,
    reasons: [geo.reason, ...score.reasons],
    escalate,
  };
}

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

export function runRecommendTier(
  ctx: ToolContext,
  args: { tier: Tier; reason: string },
): RecommendTierResult {
  const spec = PRICE_BOOK[args.tier];
  const existing = getLead(ctx.leadId);
  upsertLead({
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
    includes: spec.includes.slice(0, 6),
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
// compute_pricing — all numbers from priceCart; unknown id → structured error
// ─────────────────────────────────────────────────────────────────────────────

export function runComputePricing(
  _ctx: ToolContext,
  args: { tier: Tier; frequency: Frequency; addOnIds: string[] },
): PricingResult | { error: string } {
  try {
    return priceCart({ tier: args.tier, frequency: args.frequency, addOnIds: args.addOnIds });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// propose_checkout — address + photos gates; computes the authoritative amount;
// NEVER charges. With a Stripe key the tool's execute() stages a Checkout URL.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProposeCheckoutResult {
  status:
    | "missing_address"
    | "missing_photos"
    | "error"
    | "checkout_unavailable_dev"
    | "ready";
  message?: string;
  amount?: number; // first charge (monthly recurring + fixed add-ons)
  monthlyRecurring?: number;
  currency?: "USD";
  url?: string; // Stripe Checkout URL — only when a key is configured
  sessionId?: string;
  fixedAddOnIds?: string[];
}

export function runProposeCheckout(
  ctx: ToolContext,
  args: {
    tier: Tier;
    frequency: Frequency;
    addOnIds: string[];
    name: string;
    email: string;
    phone: string;
    address: string;
  },
): ProposeCheckoutResult {
  if (!args.address || !args.address.trim()) {
    return { status: "missing_address", message: "No scheduling without a confirmed address." };
  }
  const lead = getLead(ctx.leadId);
  if (!lead || lead.photos.length === 0) {
    return { status: "missing_photos", message: "Photos are required before autonomous checkout." };
  }

  let pricing: PricingResult;
  try {
    pricing = priceCart({ tier: args.tier, frequency: args.frequency, addOnIds: args.addOnIds });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }

  const fixedAddOnIds = args.addOnIds.filter((id) => addOnById(id)?.kind === "fixed");
  const base: ProposeCheckoutResult = {
    status: "ready",
    amount: pricing.firstChargeTotal,
    monthlyRecurring: pricing.monthlyRecurring,
    currency: "USD",
    fixedAddOnIds,
  };

  // No Stripe key (local/dev) → expose the authoritative amount but make clear we
  // cannot stage a real Checkout. We NEVER fabricate a "paid" state.
  if (!process.env.STRIPE_SECRET_KEY) {
    return { ...base, status: "checkout_unavailable_dev" };
  }
  return base; // tool execute() attaches the real Stripe URL asynchronously
}

// ─────────────────────────────────────────────────────────────────────────────
// offer_slots
// ─────────────────────────────────────────────────────────────────────────────

export function runOfferSlots(ctx: ToolContext): SlotOffer[] {
  return availableSlots(ctx.leadId);
}

// ─────────────────────────────────────────────────────────────────────────────
// confirm_booking — refuses until the lead is paid; idempotent via scheduler
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmBookingResult {
  status: "payment_required" | "lead_missing" | "booked" | "taken" | "out_of_window";
  slot?: SlotOffer;
  message?: string;
}

export function runConfirmBooking(
  ctx: ToolContext,
  args: { slotId: string },
): ConfirmBookingResult {
  const lead = getLead(ctx.leadId);
  if (!lead) return { status: "lead_missing", message: "Lead not found." };
  if (!PAID_STATES.has(lead.status)) {
    return {
      status: "payment_required",
      message: "Booking is only available after the first payment is confirmed.",
    };
  }
  const result = bookSlot(ctx.leadId, args.slotId);
  if (!result.ok) {
    return { status: result.reason === "lead_missing" ? "lead_missing" : result.reason };
  }
  upsertLead({
    lead_id: ctx.leadId,
    channel: lead.channel,
    status: "Scheduled",
    visit_at: result.slot.startTime,
    work_order: {
      slotId: result.slot.slotId,
      date: result.slot.date,
      window: `${result.slot.startTime}–${result.slot.endTime}`,
      crewSize: result.slot.crewSize,
    },
  });
  return { status: "booked", slot: result.slot };
}

// ─────────────────────────────────────────────────────────────────────────────
// raise_escalation — marks the lead, blocks auto-charge
// ─────────────────────────────────────────────────────────────────────────────

export interface RaiseEscalationResult {
  escalated: true;
  autoChargeBlocked: true;
  primary: string;
  flags: string[];
  brief: string;
}

export function runRaiseEscalation(
  ctx: ToolContext,
  args: { primary: string; flags: string[]; brief: string },
): RaiseEscalationResult {
  const existing = getLead(ctx.leadId);
  upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    status: "Needs Human Review",
    escalation_reason: args.primary,
    internal_notes: [existing?.internal_notes, `ESCALATION (${args.primary}): ${args.brief}`]
      .filter(Boolean)
      .join("\n"),
  });
  return {
    escalated: true,
    autoChargeBlocked: true,
    primary: args.primary,
    flags: args.flags,
    brief: args.brief,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// analyze_photos — real Claude vision; persists the assessment to the lead
// ─────────────────────────────────────────────────────────────────────────────

export async function runAnalyzePhotos(
  ctx: ToolContext,
  args: { photoUrls?: string[] },
): Promise<VisionAssessment> {
  const existing = getLead(ctx.leadId);
  // Prefer explicit urls; otherwise assess the photos already on the lead (the
  // client seeds them on upload, so the model needn't pass huge data: URLs).
  const urls = args.photoUrls && args.photoUrls.length > 0 ? args.photoUrls : existing?.photos ?? [];
  const assessment = await analyzeYardPhotos(urls);
  upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    photos: urls,
    vision_assessment: assessment as unknown as Record<string, unknown>,
  });
  return assessment;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildTools — wrap the handlers as Vercel AI SDK v4 tools for the streaming route
// ─────────────────────────────────────────────────────────────────────────────

export function buildTools(ctx: ToolContext) {
  return {
    qualify_lead: tool({
      description:
        "Qualify the lead: check the service address is in the San Francisco service area and score the lead (A/B/C). Call this once you have an address.",
      parameters: z.object({
        address: z.string().optional().describe("Full service address including ZIP if known"),
        frequency: FrequencyEnum.optional().describe("Desired service frequency"),
        hasPhotos: z.boolean().optional().describe("Whether the customer has provided yard photos"),
      }),
      execute: async (args) => runQualify(ctx, args),
    }),

    analyze_photos: tool({
      description:
        "Analyze the customer's yard photo(s) with vision to assess size, condition, whether a one-time cleanup is required, and the recommended care tier. Call this when photos are on file (you don't need to pass the URLs — they're read from the lead).",
      parameters: z.object({
        photoUrls: z
          .array(z.string())
          .optional()
          .describe("Optional image URLs; omit to use the photos already on the lead"),
      }),
      execute: async (args) => runAnalyzePhotos(ctx, args),
    }),

    recommend_tier: tool({
      description:
        "Recommend ONE care tier (essential/signature/estate) for the customer to confirm, with a short reason. Returns the authoritative pricing and all three options to display as cards.",
      parameters: z.object({
        tier: TierEnum,
        reason: z.string().describe("Why this tier fits, one warm sentence"),
      }),
      execute: async (args) => runRecommendTier(ctx, args),
    }),

    compute_pricing: tool({
      description:
        "Compute the exact, authoritative price for a tier + frequency + selected add-ons. Open-ended add-ons are listed separately and never charged. Always use this before checkout — never quote a number yourself.",
      parameters: z.object({
        tier: TierEnum,
        frequency: FrequencyEnum,
        addOnIds: z.array(z.string()).default([]).describe("Add-on ids the customer selected"),
      }),
      execute: async (args) => runComputePricing(ctx, args),
    }),

    propose_checkout: tool({
      description:
        "Stage checkout for the customer to pay (first month now to lock the booking). Requires a confirmed address and photos on file. This NEVER charges — it returns a secure Stripe Checkout link the customer clicks themselves.",
      parameters: z.object({
        tier: TierEnum,
        frequency: FrequencyEnum,
        addOnIds: z.array(z.string()).default([]),
        name: z.string(),
        email: z.string(),
        phone: z.string().default(""),
        address: z.string(),
      }),
      execute: async (args): Promise<ProposeCheckoutResult> => {
        const decision = runProposeCheckout(ctx, args);
        if (decision.status !== "ready" || !process.env.STRIPE_SECRET_KEY) return decision;
        try {
          const session = await createSubscriptionCheckout({
            tier: args.tier,
            frequency: args.frequency,
            selectedAddOnIds: decision.fixedAddOnIds ?? [],
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
      parameters: z.object({}),
      execute: async () => runOfferSlots(ctx),
    }),

    confirm_booking: tool({
      description:
        "Book a specific slot for the customer. Only succeeds after payment is confirmed. Idempotent — safe to retry.",
      parameters: z.object({ slotId: z.string() }),
      execute: async (args) => runConfirmBooking(ctx, args),
    }),

    raise_escalation: tool({
      description:
        "Route this case to a human and block any auto-charge. Use for: HOA, property manager, commercial, complaint, refund/discount, legal/warranty, damage, hardscape/large install, out-of-area, extreme urgency, open-ended add-on, low photo confidence, contradictory scope, or unusable photos.",
      parameters: z.object({
        primary: z.string().describe("Primary escalation reason"),
        flags: z.array(z.string()).default([]),
        brief: z.string().describe("Complete, self-contained handoff brief for the human reviewer"),
      }),
      execute: async (args) => runRaiseEscalation(ctx, args),
    }),
  };
}
