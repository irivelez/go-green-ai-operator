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
import { priceCart, pricePerVisit } from "./pricing";
import { analyzeYardPhotos, isAllowedPhoto } from "./vision";
import { availableSlots, bookSlot } from "./scheduler";
import { createSubscriptionCheckout } from "./stripe";
import { upsertLead, getLead } from "./store";
import {
  validateAddress,
  autoMeasureRoofBbox,
  estimateLotSqft,
  slopeGradeTier,
  computePolygonSqft,
} from "./geo";
import { createCrewEvent } from "./calendar";
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
  // Measured area×slope per-visit USD when the lead has been measured. Forwarded
  // to createSubscriptionCheckout so Stripe charges THIS number (review blocker
  // A) — the same one shown on ExactPriceCard. Undefined → legacy flat path.
  measuredPerVisit?: number;
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
  // Fire-and-forget crew handoff (spec §A.5). Calendar failure MUST NOT fail the booking;
  // createCrewEvent never throws, but we wrap in .catch as a belt-and-suspenders guard.
  void createCrewEvent({
    lead_id: ctx.leadId,
    address: lead.address ?? "",
    sqft: lead.confirmed_sqft ?? lead.estimated_sqft ?? 0,
    slope_tier: lead.slope_tier ?? "flat",
    tier_name: lead.suggested_package ?? "Maintenance",
    start_iso: result.slot.startTime,
    end_iso: result.slot.endTime,
    paid: true,
  })
    .then((r) => {
      if (r.eventId) {
        const fresh = getLead(ctx.leadId);
        upsertLead({
          lead_id: ctx.leadId,
          channel: lead.channel,
          work_order: { ...(fresh?.work_order ?? {}), calendar_event_id: r.eventId },
        });
      }
    })
    .catch(() => {});
  return { status: "booked", slot: result.slot };
}

// ─────────────────────────────────────────────────────────────────────────────
// validate_address — Google Address Validation pipeline, key-guarded
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidateAddressToolResult {
  status: "validated" | "needs_confirm" | "unvalidatable" | "error";
  standardized?: string;
  lat?: number;
  lng?: number;
  didYouMean?: string;
  original?: string;
  reason?: string;
}

export async function runValidateAddress(
  ctx: ToolContext,
  args: { addressLines: string[]; locality: string; adminArea: string; postalCode: string },
): Promise<ValidateAddressToolResult> {
  const res = await validateAddress(args);
  if (!res.ok) return { status: "error", reason: res.reason };
  const original = [args.addressLines.join(" "), args.locality, args.adminArea, args.postalCode]
    .filter(Boolean)
    .join(", ");
  if (res.verdict === "VALIDATED") {
    const existing = getLead(ctx.leadId);
    upsertLead({
      lead_id: ctx.leadId,
      channel: existing?.channel ?? "form",
      address: res.standardized.formattedAddress,
    });
    return {
      status: "validated",
      standardized: res.standardized.formattedAddress,
      lat: res.standardized.lat,
      lng: res.standardized.lng,
    };
  }
  if (res.verdict === "CORRECTED") {
    return {
      status: "needs_confirm",
      didYouMean: res.didYouMean ?? res.standardized.formattedAddress,
      original,
    };
  }
  return { status: "unvalidatable" };
}

// ─────────────────────────────────────────────────────────────────────────────
// measure_property — Solar roof bbox → lot estimate + Elevation slope tier
// ─────────────────────────────────────────────────────────────────────────────

export interface MeasurePropertyResult {
  estimated_sqft: number;
  area_confidence: number;
  roof_bbox: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null;
  slope_tier: "flat" | "moderate" | "steep";
  max_grade_pct: number | null;
}

export async function runMeasureProperty(
  ctx: ToolContext,
  args: { lat: number; lng: number },
): Promise<MeasurePropertyResult> {
  const roof = await autoMeasureRoofBbox(args.lat, args.lng);
  let estimated_sqft = 0;
  let area_confidence = 0.4;
  let roof_bbox: MeasurePropertyResult["roof_bbox"] = null;
  if (roof.ok) {
    const est = estimateLotSqft(roof.roof_area_m2);
    estimated_sqft = est.estimated_sqft;
    area_confidence = est.area_confidence;
    roof_bbox = roof.roof_bbox;
  }

  const slope = await slopeGradeTier(args.lat, args.lng);
  const slope_tier: "flat" | "moderate" | "steep" = slope.ok ? slope.slope_tier : "flat";
  const max_grade_pct = slope.ok ? slope.max_grade_pct : null;

  const existing = getLead(ctx.leadId);
  const prevVision = (existing?.vision_assessment ?? {}) as Record<string, unknown>;
  upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    estimated_sqft,
    area_confidence,
    slope_tier,
    slope_source: "elevation",
    vision_assessment: { ...prevVision, roof_bbox },
  });

  return { estimated_sqft, area_confidence, roof_bbox, slope_tier, max_grade_pct };
}

// ─────────────────────────────────────────────────────────────────────────────
// confirm_area — server re-derives sqft from polygon path; raises slope on photo hint
// ─────────────────────────────────────────────────────────────────────────────

// Plausibility ceiling for a residential lot in SF — 60000 sqft ≈ 1.4 acres,
// well above any single-family parcel. Above this the polygon is either a
// drawing mistake or an attempt to trick a downstream area×price calc into a
// huge subscription. Below or equal to 0 is a degenerate ring. Either case →
// refuse to persist, ask the customer to redraw. The deterministic engine
// (priceCart / pricePerVisit) never sees the bad number.
const MAX_RESIDENTIAL_SQFT = 60000;

export type ConfirmAreaResult =
  | {
      status: "confirmed";
      confirmed_sqft: number;
      area_source: "auto" | "customer_draw";
      slope_tier: "flat" | "moderate" | "steep";
      slope_source: "elevation" | "photo_raised";
    }
  | {
      status: "area_out_of_range";
      confirmed_sqft: number;
      message: string;
    };

const SLOPE_RAISE: Record<"flat" | "moderate", "moderate" | "steep"> = {
  flat: "moderate",
  moderate: "steep",
};

export function runConfirmArea(
  ctx: ToolContext,
  args: { path: { lat: number; lng: number }[] },
): ConfirmAreaResult {
  const confirmed_sqft = computePolygonSqft(args.path);
  const existing = getLead(ctx.leadId);

  if (confirmed_sqft <= 0 || confirmed_sqft > MAX_RESIDENTIAL_SQFT) {
    return {
      status: "area_out_of_range",
      confirmed_sqft,
      message:
        confirmed_sqft <= 0
          ? "The polygon you drew is empty — please re-draw the maintained area."
          : `The polygon you drew is ${confirmed_sqft.toLocaleString()} sqft, which is well above any SF residential lot. Please re-draw just the maintained area.`,
    };
  }

  const area_source: "auto" | "customer_draw" = args.path.length > 5 ? "customer_draw" : "auto";

  let slope_tier: "flat" | "moderate" | "steep" = existing?.slope_tier ?? "flat";
  let slope_source: "elevation" | "photo_raised" = existing?.slope_source ?? "elevation";

  const vision = (existing?.vision_assessment ?? {}) as {
    slope_signals?: { steepness_hint?: string };
  };
  const hint = vision.slope_signals?.steepness_hint;
  const alreadyRaised = slope_source === "photo_raised";
  if (hint === "steep" && !alreadyRaised && (slope_tier === "flat" || slope_tier === "moderate")) {
    slope_tier = SLOPE_RAISE[slope_tier];
    slope_source = "photo_raised";
  }

  upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    confirmed_sqft,
    area_source,
    area_confirmed_by_customer: true,
    slope_tier,
    slope_source,
    // A re-draw changes the measured area → any previously computed price is now
    // stale. Clear it so the agent must re-run compute_exact_price before checkout
    // and the customer can never pay against an outdated quote.
    per_visit_price: undefined,
    monthly_price: undefined,
  });

  return { status: "confirmed", confirmed_sqft, area_source, slope_tier, slope_source };
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

export function runComputeExactPrice(
  ctx: ToolContext,
  args: { tier: Tier; frequency: Frequency },
): ComputeExactPriceResult {
  const lead = getLead(ctx.leadId);
  const sqft = lead?.confirmed_sqft;
  if (!sqft || sqft <= 0) {
    return {
      status: "missing_measurement",
      message:
        "Confirm the maintained area on the map first — the price is derived from the measured sqft, not estimated.",
    };
  }
  const r = pricePerVisit({
    measured_area_sqft: sqft,
    slope_tier: lead?.slope_tier ?? "flat",
    frequency: args.frequency,
  });
  const spec = PRICE_BOOK[args.tier];
  // Persist the priced numbers — propose_checkout / Stripe / dashboard now all
  // read the SAME source of truth (review blocker A).
  upsertLead({
    lead_id: ctx.leadId,
    channel: lead?.channel ?? "form",
    per_visit_price: r.perVisit,
    monthly_price: r.monthly,
    suggested_package: spec.name,
    desired_frequency: args.frequency,
  });
  return {
    status: "priced",
    perVisit: r.perVisit,
    monthly: r.monthly,
    tier_name: spec.name,
    tier_inclusions: spec.includes.slice(0, 6),
    currency: "USD",
  };
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
  // Filter through isAllowedPhoto so a prompt-injected http/file URL is neither
  // sent to the model NOR persisted onto the lead (where a future renderer would
  // fetch it) — closes the sibling exfil vector to the funnel-route photo filter.
  const raw = args.photoUrls && args.photoUrls.length > 0 ? args.photoUrls : existing?.photos ?? [];
  const urls = raw.filter(isAllowedPhoto);
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

    validate_address: tool({
      description:
        "Validate and standardize the service address via Google Address Validation. Returns VALIDATED (persisted), needs_confirm (corrected — ask the customer to confirm the suggested standardization), or unvalidatable. Without a Google key returns a graceful error — never throws.",
      parameters: z.object({
        addressLines: z.array(z.string()).describe("Street address line(s), e.g. ['123 Main St']"),
        locality: z.string().describe("City, e.g. 'San Francisco'"),
        adminArea: z.string().describe("State, e.g. 'CA'"),
        postalCode: z.string().describe("ZIP code, e.g. '94110'"),
      }),
      execute: async (args) => runValidateAddress(ctx, args),
    }),

    measure_property: tool({
      description:
        "Auto-measure the property: Solar API for roof bbox → maintainable lot sqft (heuristic), Elevation API for slope tier (flat/moderate/steep). Persists estimated_sqft + area_confidence + slope_tier on the lead. Key-guarded — without a Google key returns zero-confidence defaults.",
      parameters: z.object({
        lat: z.number().describe("Rooftop latitude from validate_address"),
        lng: z.number().describe("Rooftop longitude from validate_address"),
      }),
      execute: async (args) => runMeasureProperty(ctx, args),
    }),

    confirm_area: tool({
      description:
        "Server re-derives the maintained area (sqft) from the customer's polygon — never trust a client-supplied number. If vision photos hinted at steep terrain and slope_tier is flat or moderate, the tier is raised one step (photo_raised). Persists confirmed_sqft + area_source + slope on the lead.",
      parameters: z.object({
        path: z
          .array(z.object({ lat: z.number(), lng: z.number() }))
          .describe("Polygon ring (unclosed); >5 points → treated as customer_draw"),
      }),
      execute: async (args) => runConfirmArea(ctx, args),
    }),

    compute_exact_price: tool({
      description:
        "Exact per-visit + monthly price from confirmed_sqft × slope_tier (area buckets + slope multiplier). Requires confirm_area to have run — otherwise returns missing_measurement. Final price is still confirmed on the first on-site visit.",
      parameters: z.object({ tier: TierEnum, frequency: FrequencyEnum }),
      execute: async (args) => runComputeExactPrice(ctx, args),
    }),

    propose_checkout: tool({
      description:
        "Stage checkout for the customer to pay (first month now to lock the booking). Price derives from the lead's confirmed_sqft + slope (compute_exact_price), not the model. Requires a confirmed address and photos on file. This NEVER charges — it returns a secure Stripe Checkout link the customer clicks themselves.",
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
