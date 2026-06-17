// Pricing engine — deterministic, measured-area × slope (spec §A.4 / §9.2).
// Pure function. NEVER an LLM guess. pricePerVisit returns ONE exact number;
// final price is still confirmed on the first on-site visit (spec §9.1).

import {
  PRICE_BOOK,
  FREQUENCY_MULTIPLIER,
  monthlyFromVisit,
  addOnById,
  type Tier as CartTier,
  type Frequency as CartFrequency,
  type PricingResult,
  type PricingLineItem,
} from "./contract";

export type YardSize = "small" | "medium" | "large";
export type Frequency = "weekly" | "biweekly" | "monthly";
export type PackageTier = "essential" | "signature" | "premium";
export type SlopeTier = "flat" | "moderate" | "steep";

export interface PricingCase {
  measured_area_sqft: number;
  slope_tier: SlopeTier;
  frequency: Frequency;
  package_tier?: PackageTier;
  cleanup_required?: boolean;
  weeks_overdue?: number; // retained for caller compat; not used by pricePerVisit
  zone?: string;
}

export interface PriceRange {
  low: number;
  high: number;
  currency: "USD";
  assumptions: string[];
  confidence: number; // 0..1
  covered: boolean; // false → caller must escalate, no autonomous range
}

// §A.4 + §9.2 — recurring maintenance, base per-visit (USD) keyed by MEASURED
// lot area. Anchors are midpoints of the previous biweekly ranges mapped onto
// SF residential lot sizes (small <1500 sqft, medium 1500–4000, large >4000).
// Old biweekly anchors: small [95,115] → 105; medium [155,190] → 173; large [290,370] → 330.
// TODO(spec §A.10): owner sign-off on rate card v2
const AREA_BUCKET_SMALL = 105;  // < 1500 sqft
const AREA_BUCKET_MEDIUM = 173; // 1500 – 4000 sqft (midpoint 172.5 rounded up)
const AREA_BUCKET_LARGE = 330;  // > 4000 sqft

// §A.4 — slope surcharge multiplier applied to the area-bucket base.
// TODO(spec §A.10): owner sign-off on rate card v2
const SLOPE_MULTIPLIER: Record<SlopeTier, number> = {
  flat: 1.0,
  moderate: 1.15,
  steep: 1.35,
};

function pickAreaBucket(sqft: number): { base: number; label: string } {
  if (sqft < 1500) return { base: AREA_BUCKET_SMALL, label: "small (<1500 sqft)" };
  if (sqft <= 4000) return { base: AREA_BUCKET_MEDIUM, label: "medium (1500–4000 sqft)" };
  return { base: AREA_BUCKET_LARGE, label: "large (>4000 sqft)" };
}

// Compat helper for legacy callers that still hold a YardSize bucket: maps to a
// representative measured area inside each bucket. Used by operator.ts which
// gets the yard size from the vision pass, not a measurement.
export function yardSizeToSqft(size: YardSize): number {
  if (size === "small") return 1000;
  if (size === "medium") return 2500;
  return 5000;
}

/**
 * pricePerVisit — measured-area × slope-multiplier deterministic price.
 * Returns ONE exact per-visit number plus the monthly equivalent at the chosen
 * frequency. Final price is still confirmed on the first on-site visit (§9.1).
 */
export function pricePerVisit(input: {
  measured_area_sqft: number;
  slope_tier: SlopeTier;
  frequency: Frequency;
}): { perVisit: number; monthly: number; assumptions: string[]; currency: "USD" } {
  if (!(input.measured_area_sqft > 0)) {
    throw new Error("measured_area_sqft required and > 0");
  }
  const bucket = pickAreaBucket(input.measured_area_sqft);
  const mult = SLOPE_MULTIPLIER[input.slope_tier];
  // Round per-visit to whole dollars — anchors are integers, slope is the only
  // source of fractional cents and the final number lands on a customer quote.
  const perVisit = Math.round(bucket.base * mult);
  const monthly = Math.round(perVisit * FREQUENCY_MULTIPLIER[input.frequency] * 100) / 100;
  return {
    perVisit,
    monthly,
    assumptions: [
      `area bucket: ${bucket.label} → base $${bucket.base}/visit`,
      `slope: ${input.slope_tier} (×${mult})`,
      "final price confirmed on first on-site visit",
    ],
    currency: "USD",
  };
}

/**
 * @deprecated Use {@link pricePerVisit} instead. quoteRange is a thin compat
 * shim over pricePerVisit returning a degenerate range (low === high === perVisit).
 * The old yard-size / range-band / cleanup-surcharge logic moved out — cleanup
 * is now a separately quoted add-on through priceCart, not folded into the band.
 */
export function quoteRange(c: PricingCase): PriceRange {
  const r = pricePerVisit({
    measured_area_sqft: c.measured_area_sqft,
    slope_tier: c.slope_tier,
    frequency: c.frequency,
  });
  return {
    low: r.perVisit,
    high: r.perVisit,
    currency: r.currency,
    assumptions: r.assumptions,
    confidence: 0.85,
    covered: true,
  };
}

// Cart pricing — pure (tier, frequency, add-ons) → PricingResult.
// Authority: BUILD-DECISIONS §A3 (subscription math), §3 (add-on classification).

export function priceCart(input: {
  tier: CartTier;
  frequency: CartFrequency;
  addOnIds: string[];
}): PricingResult {
  const { tier, frequency, addOnIds } = input;

  const perVisit = PRICE_BOOK[tier].perVisit;
  const monthlyRecurring = monthlyFromVisit(tier, frequency);

  const fixedAddOnLineItems: PricingLineItem[] = [];
  const openEndedFlagged: PricingResult["openEndedFlagged"] = [];

  for (const id of addOnIds) {
    const addOn = addOnById(id);
    if (!addOn) throw new Error(`unknown add-on: ${id}`);
    if (addOn.kind === "fixed") {
      fixedAddOnLineItems.push({
        addOnId: addOn.id,
        name: addOn.name,
        amount: addOn.priceStartingAt,
        unit: addOn.unit,
      });
    } else {
      openEndedFlagged.push({
        addOnId: addOn.id,
        name: addOn.name,
        reason: addOn.openEndedReason ?? "requires on-site quote",
      });
    }
  }

  const fixedSum = fixedAddOnLineItems.reduce((s, x) => s + x.amount, 0);
  const firstChargeTotal = Math.round((monthlyRecurring + fixedSum) * 100) / 100;

  const assumptions: string[] = [
    `${PRICE_BOOK[tier].name}: flat $${perVisit}/visit (productized, on-site review for final price)`,
    `monthly = per-visit × ${FREQUENCY_MULTIPLIER[frequency]} (${frequency} frequency)`,
  ];
  if (openEndedFlagged.length > 0) {
    assumptions.push(
      `${openEndedFlagged.length} item${openEndedFlagged.length === 1 ? "" : "s"} need a human estimate — not charged now`,
    );
  }

  return {
    tier,
    frequency,
    perVisit,
    monthlyRecurring,
    fixedAddOnLineItems,
    openEndedFlagged,
    firstChargeTotal,
    recurringMonthly: monthlyRecurring,
    currency: "USD",
    assumptions,
  };
}
