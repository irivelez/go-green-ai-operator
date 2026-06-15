// Pricing engine — deterministic, range-only (spec §9.1 / §9.2).
// Pure function. NEVER an LLM guess. Anything outside coverage → escalate (no autonomous range).

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

export interface PricingCase {
  yard_size_bucket: YardSize;
  frequency: Frequency;
  package_tier?: PackageTier;
  cleanup_required?: boolean;
  weeks_overdue?: number; // first-cut surcharge driver
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

// §9.2 recurring maintenance — price per visit (Go Green premium, SF residential)
const PER_VISIT: Record<YardSize, Record<Frequency, [number, number]>> = {
  small: { weekly: [70, 85], biweekly: [95, 115], monthly: [120, 145] },
  medium: { weekly: [115, 140], biweekly: [155, 190], monthly: [210, 260] },
  large: { weekly: [210, 260], biweekly: [290, 370], monthly: [420, 540] },
};

// §9.2 typical cleanup job ranges by size
const CLEANUP: Record<YardSize, [number, number]> = {
  small: [280, 700],
  medium: [650, 1500],
  large: [1300, 3000],
};

const MIN_SERVICE = [150, 200] as const; // travel + setup floor

// First-cut surcharge for overdue recurring (§9.2)
function firstCutSurcharge(weeksOverdue?: number): [number, number] {
  if (!weeksOverdue || weeksOverdue < 2) return [0, 0];
  if (weeksOverdue <= 3) return [25, 50];
  if (weeksOverdue <= 6) return [75, 150];
  return [0, 0]; // 6+ weeks → caller should reprice as cleanup, not surcharge
}

export function quoteRange(c: PricingCase): PriceRange {
  const assumptions: string[] = [];

  const visit = PER_VISIT[c.yard_size_bucket]?.[c.frequency];
  if (!visit) {
    return {
      low: 0, high: 0, currency: "USD", assumptions: ["case outside rubric coverage"],
      confidence: 0, covered: false,
    };
  }

  let [low, high] = visit;
  assumptions.push(
    `${c.yard_size_bucket} yard, ${c.frequency} recurring maintenance (SF premium tier)`,
    `per-visit range; final price needs on-site review`
  );

  // Overdue first cut
  if (c.weeks_overdue && c.weeks_overdue >= 6) {
    const [cl, ch] = CLEANUP[c.yard_size_bucket];
    assumptions.push(`6+ weeks overdue → first service repriced as initial cleanup`);
    return {
      low: cl, high: ch, currency: "USD",
      assumptions, confidence: 0.55, covered: true,
    };
  }
  const [sl, sh] = firstCutSurcharge(c.weeks_overdue);
  if (sl > 0) {
    low += sl; high += sh;
    assumptions.push(`+$${sl}-$${sh} first-cut surcharge (${c.weeks_overdue} wks overdue)`);
  }

  // Cleanup-required adds a one-time line (quoted separately, never "included")
  if (c.cleanup_required) {
    const [cl, ch] = CLEANUP[c.yard_size_bucket];
    assumptions.push(
      `initial cleanup required BEFORE recurring — separate one-time line $${cl}-$${ch}`
    );
  }

  // Minimum service floor
  if (high < MIN_SERVICE[0]) {
    assumptions.push(`min service charge $${MIN_SERVICE[0]}-$${MIN_SERVICE[1]}/visit applies`);
    low = Math.max(low, MIN_SERVICE[0]);
    high = Math.max(high, MIN_SERVICE[1]);
  }

  // Confidence: full inputs → high; missing size/overdue signals → lower
  const confidence = c.cleanup_required === undefined ? 0.7 : 0.85;

  return { low, high, currency: "USD", assumptions, confidence, covered: true };
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
