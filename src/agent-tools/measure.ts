// validate_address + measure_property + confirm_area — moved verbatim from
// src/agent-tools.ts during the mechanical split.

import { z } from "zod";
import { upsertLead, getLead } from "../store";
import {
  validateAddress,
  autoMeasureRoofBbox,
  estimateLotSqft,
  slopeGradeTier,
  computePolygonSqft,
  measureFromAddress,
} from "../geo";
import { type ToolContext, MAX_RESIDENTIAL_SQFT } from "./shared";

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

export const ValidateAddressArgsSchema = z.object({
  addressLines: z.array(z.string()).describe("Street address line(s), e.g. ['123 Main St']"),
  locality: z.string().describe("City, e.g. 'San Francisco'"),
  adminArea: z.string().describe("State, e.g. 'CA'"),
  postalCode: z.string().describe("ZIP code, e.g. '94110'"),
});

export async function runValidateAddress(
  ctx: ToolContext,
  args: z.infer<typeof ValidateAddressArgsSchema>,
): Promise<ValidateAddressToolResult> {
  const res = await validateAddress(args);

  // Any non-success verdict (error / UNVALIDATABLE) MUST clear previously-persisted
  // parts + coords. Otherwise a customer who corrected address A, then re-typed
  // garbage, leaves A's parts on the lead — and a loosely-ordered LLM could measure
  // the WRONG parcel. Wrong-parcel is worse than no-parcel (it silently prices the
  // wrong lot). Clearing forces the heuristic/draw fallback until a clean validate.
  const clearStaleGeo = async () => {
    const existing = await getLead(ctx.leadId);
    if (
      !existing?.address_number &&
      !existing?.street_name &&
      !existing?.street_type &&
      existing?.lat === undefined &&
      existing?.lng === undefined
    )
      return;
    await upsertLead({
      lead_id: ctx.leadId,
      channel: existing?.channel ?? "form",
      address_number: undefined,
      street_name: undefined,
      street_type: undefined,
      lat: undefined,
      lng: undefined,
    });
  };

  if (!res.ok) {
    await clearStaleGeo();
    return { status: "error", reason: res.reason };
  }
  const original = [args.addressLines.join(" "), args.locality, args.adminArea, args.postalCode]
    .filter(Boolean)
    .join(", ");
  if (res.verdict === "VALIDATED" || res.verdict === "CORRECTED") {
    const existing = await getLead(ctx.leadId);
    await upsertLead({
      lead_id: ctx.leadId,
      channel: existing?.channel ?? "form",
      address: res.verdict === "VALIDATED" ? res.standardized.formattedAddress : existing?.address,
      address_number: res.parts?.addressNumber,
      street_name: res.parts?.streetName,
      street_type: res.parts?.streetType,
      lat: res.standardized.lat,
      lng: res.standardized.lng,
    });
    if (res.verdict === "VALIDATED") {
      return {
        status: "validated",
        standardized: res.standardized.formattedAddress,
        lat: res.standardized.lat,
        lng: res.standardized.lng,
      };
    }
    return {
      status: "needs_confirm",
      didYouMean: res.didYouMean ?? res.standardized.formattedAddress,
      original,
    };
  }
  await clearStaleGeo();
  return { status: "unvalidatable" };
}

// ─────────────────────────────────────────────────────────────────────────────
// measure_property — DataSF parcel outline + condo detect (§A.2) + Elevation slope
// ─────────────────────────────────────────────────────────────────────────────
//
// Primary path is the real SF parcel polygon (measureFromAddress): the customer
// gets the actual lot pre-drawn for one-tap confirm. A stacked-condo parcel
// (mapblklot != blklot) is genuinely ambiguous ownership → shared_multi_unit so
// the agent escalates (§A.2 / §12.2). When the address has no parcel match
// (single-family geocode/EAS miss) we fall back to the Solar+heuristic estimate
// so the area card still has a starting number; the customer draws either way.

export interface MeasurePropertyResult {
  estimated_sqft: number;
  area_confidence: number;
  parcel_ring: { lat: number; lng: number }[];
  area_source: "parcel" | "heuristic" | "none";
  shared_multi_unit: boolean;
  slope_tier: "flat" | "moderate" | "steep";
  max_grade_pct: number | null;
}

export const MeasurePropertyArgsSchema = z.object({
  lat: z.number().describe("Rooftop latitude from validate_address"),
  lng: z.number().describe("Rooftop longitude from validate_address"),
});

export async function runMeasureProperty(
  ctx: ToolContext,
  args: z.infer<typeof MeasurePropertyArgsSchema>,
): Promise<MeasurePropertyResult> {
  const leadForParcel = await getLead(ctx.leadId);
  const lat = typeof leadForParcel?.lat === "number" ? leadForParcel.lat : args.lat;
  const lng = typeof leadForParcel?.lng === "number" ? leadForParcel.lng : args.lng;

  const slope = await slopeGradeTier(lat, lng);
  const slope_tier: "flat" | "moderate" | "steep" = slope.ok ? slope.slope_tier : "flat";
  const max_grade_pct = slope.ok ? slope.max_grade_pct : null;

  let parcel_ring: { lat: number; lng: number }[] = [];
  let area_source: MeasurePropertyResult["area_source"] = "none";
  let shared_multi_unit = false;
  let estimated_sqft = 0;
  let area_confidence = 0.4;

  const parcel =
    leadForParcel?.address_number && leadForParcel?.street_name && leadForParcel?.street_type
      ? await measureFromAddress({
          addressNumber: leadForParcel.address_number,
          streetName: leadForParcel.street_name,
          streetType: leadForParcel.street_type,
        })
      : { ok: false as const, reason: "missing_address_parts" };

  if (parcel.ok && parcel.shared_multi_unit) {
    shared_multi_unit = true;
  } else if (parcel.ok && parcel.parcel_ring.length >= 3) {
    parcel_ring = parcel.parcel_ring;
    area_source = "parcel";
    estimated_sqft = computePolygonSqft(parcel_ring);
    area_confidence = 0.85;
  } else {
    const roof = await autoMeasureRoofBbox(lat, lng);
    if (roof.ok) {
      const est = estimateLotSqft(roof.roof_area_m2);
      estimated_sqft = est.estimated_sqft;
      area_confidence = est.area_confidence;
      area_source = "heuristic";
    }
  }

  const existing = await getLead(ctx.leadId);
  const prevVision = (existing?.vision_assessment ?? {}) as Record<string, unknown>;
  await upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    estimated_sqft,
    area_confidence,
    slope_tier,
    slope_source: "elevation",
    vision_assessment: { ...prevVision, parcel_ring },
  });

  return {
    estimated_sqft,
    area_confidence,
    parcel_ring,
    area_source,
    shared_multi_unit,
    slope_tier,
    max_grade_pct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// confirm_area — server re-derives sqft from polygon path; raises slope on photo hint
// ─────────────────────────────────────────────────────────────────────────────

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
    }
  | {
      status: "lead_missing";
      confirmed_sqft: number;
      message: string;
    };

const SLOPE_RAISE: Record<"flat" | "moderate", "moderate" | "steep"> = {
  flat: "moderate",
  moderate: "steep",
};

export const ConfirmAreaArgsSchema = z.object({
  path: z
    .array(z.object({ lat: z.number(), lng: z.number() }))
    .describe("Polygon ring (unclosed); >5 points → treated as customer_draw"),
});

export async function runConfirmArea(
  ctx: ToolContext,
  args: z.infer<typeof ConfirmAreaArgsSchema>,
): Promise<ConfirmAreaResult> {
  const confirmed_sqft = computePolygonSqft(args.path);
  const existing = await getLead(ctx.leadId);

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

  // No measured lead in this store → measure_property never ran here (cross-route
  // store split). Refuse to fabricate a lead with a DEFAULT flat slope: that would
  // clobber the real (possibly steep) measurement and price a steep lot as flat.
  // Loud lead_missing > silent wrong price; the client re-routes through the agent.
  if (!existing) {
    return {
      status: "lead_missing",
      confirmed_sqft,
      message: "We lost track of your property measurement — let's re-check the address before pricing.",
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

  await upsertLead({
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
