// Shared contract for the Go Green web funnel build.
// Imported by every other module (operator, funnel UI, pricing, checkout, scheduler,
// escalation gate). One source of truth — change it here, ripple everywhere.
//
// Authority: BUILD-DECISIONS.md (supersedes ambiguity in spec.md). Prices extracted
// from "Price Book.docx" + "MASTER PROMPT FOR CLIENT COMMUNICATION.docx".
// Classification rule: BUILD-DECISIONS §3.
//   - Single fixed/starting-at flat price → kind: "fixed" → checkout-eligible.
//   - Per-unit / per-hour / "+ parts" / "+ plant cost" → kind: "open_ended" → human
//     quote, NO auto-charge.
// NEVER invent a price. If it's not in a doc, it's not here.

import type { Lead as StoreLead } from "./store";

// ─────────────────────────────────────────────────────────────────────────────
// 1. TIERS — flat per-visit, productized from "starting at" price book
//    (BUILD-DECISIONS §2). No in-tier modifiers at launch (decision A2).
// ─────────────────────────────────────────────────────────────────────────────

export type Tier = "essential" | "signature" | "estate";

export interface TierSpec {
  id: Tier;
  name: string;
  perVisit: number; // USD, flat per BUILD-DECISIONS §2
  blurb: string;
  includes: string[];
  notIncluded: string[]; // scope-protection — always quoted separately
}

export const PRICE_BOOK: Record<Tier, TierSpec> = {
  essential: {
    id: "essential",
    name: "Essential Care",
    perVisit: 199,
    blurb:
      "Reliable recurring maintenance to keep the outdoor space clean, controlled, and presentable.",
    includes: [
      "Basic mowing (if applicable)",
      "Basic edging",
      "Blowing walkways and maintained areas",
      "Light weed control",
      "General cleanup of maintained areas",
      "Light pruning of small plants",
      "Visual check of landscape condition",
      "Removal of small green waste generated during the visit",
    ],
    notIncluded: [
      "Major pruning",
      "Tree trimming",
      "Irrigation repairs",
      "Plant replacement",
      "Fertilization",
      "Mulch installation",
      "Seasonal flowers",
      "Deep cleanup",
      "Hauling of existing debris",
      "Drainage repairs",
      "Pressure washing",
    ],
  },
  signature: {
    id: "signature",
    name: "Signature Care",
    perVisit: 299,
    blurb:
      "More detail, better curb appeal, and proactive recommendations for long-term beauty.",
    includes: [
      "Everything in Essential Care",
      "More detailed bed cleanup",
      "More detailed weed control",
      "Light shrub shaping",
      "Basic plant health observation",
      "Basic irrigation visual check",
      "Seasonal recommendations",
      "Better detail around entryways, walkways, high-visibility areas",
      "Monthly service notes",
    ],
    notIncluded: [
      "Major irrigation repairs",
      "Large tree work",
      "Plant replacement",
      "Major pruning or reduction",
      "Mulch refresh",
      "Seasonal planting",
      "Drainage work",
      "Pressure washing",
      "Large hauling",
      "Hardscape repairs",
    ],
  },
  estate: {
    id: "estate",
    name: "Estate Care",
    perVisit: 399,
    blurb:
      "Premium, high-touch, proactive maintenance with priority scheduling and reporting.",
    includes: [
      "Everything in Signature Care",
      "Priority scheduling when available",
      "More detailed pruning and shaping",
      "Quarterly irrigation visual inspection",
      "Quarterly plant health review",
      "Proactive issue identification",
      "Seasonal care recommendations",
      "Photos after service when requested",
      "Monthly or quarterly landscape report",
      "Front entry and high-visibility detail focus",
      "White-glove cleanup standard",
      "Seasonal upgrade planning",
    ],
    notIncluded: [
      "Large tree work",
      "Major irrigation repairs",
      "Drainage installation or repair",
      "Plant replacement",
      "Mulch installation",
      "Seasonal flowers",
      "Major cleanups",
      "Construction work",
      "Permit-related work",
      "Hardscape repairs",
      "Hauling of non-maintenance debris",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. FREQUENCY + SUBSCRIPTION MATH
//    Monthly Stripe subscription, first month charged now (BUILD-DECISIONS §A3).
//    monthly = per_visit × freq_multiplier.
// ─────────────────────────────────────────────────────────────────────────────

export type Frequency = "weekly" | "biweekly" | "monthly";

export const FREQUENCY_MULTIPLIER: Record<Frequency, number> = {
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1.0,
};

export function monthlyFromVisit(tier: Tier, frequency: Frequency): number {
  const perVisit = PRICE_BOOK[tier].perVisit;
  const monthly = perVisit * FREQUENCY_MULTIPLIER[frequency];
  return Math.round(monthly * 100) / 100; // cents-precision
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ADD-ON CATALOG
//    Extracted from Price Book.docx + Master Prompt. Classification per
//    BUILD-DECISIONS §3:
//      - "fixed"      → whitelisted for autonomous Stripe checkout
//      - "open_ended" → human quote, NO auto-charge (capture intent on the lead)
//
//    "Starting at" is the explicit launch posture (A1: flat-final, accept
//    variability inside the gates). Final price still gets the on-site review
//    caveat in the funnel UI.
// ─────────────────────────────────────────────────────────────────────────────

export type AddOnKind = "fixed" | "open_ended";

export type AddOnCategory =
  | "lawn_turf"
  | "plant_garden"
  | "irrigation"
  | "tree_shrub"
  | "cleanup"
  | "hardscape"
  | "drainage"
  | "premium_client";

export interface AddOn {
  id: string; // stable kebab-case id
  name: string; // display name from Price Book
  category: AddOnCategory;
  kind: AddOnKind;
  priceStartingAt: number; // USD
  unit: string; // "per visit", "per service", "per hour", "+plant cost", …
  // openEndedReason: WHY this can't be charged autonomously (only for open_ended)
  openEndedReason?: string;
  notes?: string;
}

// Helper to keep authoring terse + classification explicit.
function fixedAddOn(
  id: string,
  name: string,
  category: AddOnCategory,
  price: number,
  unit: string,
  notes?: string,
): AddOn {
  return { id, name, category, kind: "fixed", priceStartingAt: price, unit, notes };
}
function openEndedAddOn(
  id: string,
  name: string,
  category: AddOnCategory,
  price: number,
  unit: string,
  openEndedReason: string,
  notes?: string,
): AddOn {
  return {
    id,
    name,
    category,
    kind: "open_ended",
    priceStartingAt: price,
    unit,
    openEndedReason,
    notes,
  };
}

export const ADD_ON_CATALOG: AddOn[] = [
  // Lawn & Turf
  fixedAddOn("fertilization", "Fertilization", "lawn_turf", 95, "per visit"),
  fixedAddOn("aeration", "Aeration", "lawn_turf", 250, "per service"),
  fixedAddOn("overseeding", "Overseeding", "lawn_turf", 250, "per service"),
  openEndedAddOn(
    "sod-repair",
    "Sod repair",
    "lawn_turf",
    12,
    "per sq ft",
    "per-unit (square footage unknown until on-site)",
  ),
  fixedAddOn("artificial-turf-brushing", "Artificial turf brushing", "lawn_turf", 125, "per visit"),
  fixedAddOn("artificial-turf-deep-cleaning", "Artificial turf deep cleaning", "lawn_turf", 250, "per service"),
  fixedAddOn("turf-deodorizer", "Turf deodorizer", "lawn_turf", 95, "per application"),
  fixedAddOn("infill-refresh", "Infill refresh", "lawn_turf", 250, "per service"),

  // Plant & Garden Beds
  fixedAddOn("seasonal-flowers", "Seasonal flowers", "plant_garden", 250, "per installation"),
  openEndedAddOn(
    "plant-replacement",
    "Plant replacement",
    "plant_garden",
    150,
    "+ plant cost",
    "labor + variable plant material cost",
  ),
  fixedAddOn("plant-health-inspection", "Plant health inspection", "plant_garden", 95, "per service"),
  openEndedAddOn(
    "soil-amendment",
    "Soil amendment",
    "plant_garden",
    175,
    "per area",
    "per-unit (count of beds/areas unknown until on-site)",
  ),
  fixedAddOn("mulch-refresh", "Mulch refresh", "plant_garden", 350, "per service"),
  fixedAddOn("compost-application", "Compost application", "plant_garden", 250, "per service"),
  openEndedAddOn(
    "hand-weeding",
    "Hand weeding",
    "plant_garden",
    95,
    "per hour",
    "per-hour (time unknown until on-site)",
  ),
  fixedAddOn("hedge-shaping", "Hedge shaping", "plant_garden", 150, "per service"),
  fixedAddOn("shrub-pruning", "Shrub pruning", "plant_garden", 125, "per service"),
  fixedAddOn("rose-care", "Rose care", "plant_garden", 125, "per service"),

  // Irrigation
  fixedAddOn("irrigation-inspection", "Irrigation inspection", "irrigation", 150, "per service"),
  fixedAddOn("sprinkler-adjustment", "Sprinkler adjustment", "irrigation", 95, "per service"),
  fixedAddOn("drip-line-inspection", "Drip line inspection", "irrigation", 150, "per service"),
  fixedAddOn("timer-programming", "Timer programming", "irrigation", 95, "per service"),
  fixedAddOn("leak-detection", "Leak detection", "irrigation", 150, "per service"),
  fixedAddOn("seasonal-irrigation-adjustment", "Seasonal irrigation adjustment", "irrigation", 95, "per service"),
  openEndedAddOn(
    "irrigation-repair",
    "Irrigation repair",
    "irrigation",
    150,
    "+ parts",
    "labor + variable parts cost",
  ),
  fixedAddOn("smart-controller-setup", "Smart controller setup", "irrigation", 250, "per service"),
  fixedAddOn("water-efficiency-review", "Water efficiency review", "irrigation", 150, "per service"),

  // Tree & Shrub (note: "large tree work, dangerous limbs, special equipment" still
  // escalate via the hard rules in escalation.ts — these flat items are the
  // small/ornamental scope only).
  fixedAddOn("small-tree-trimming", "Small tree trimming", "tree_shrub", 250, "per service"),
  fixedAddOn("ornamental-tree-pruning", "Ornamental tree pruning", "tree_shrub", 250, "per service"),
  fixedAddOn("clearance-pruning", "Clearance pruning", "tree_shrub", 250, "per service"),
  fixedAddOn("limb-removal", "Limb removal", "tree_shrub", 250, "per service"),
  fixedAddOn("hedge-reduction", "Hedge reduction", "tree_shrub", 250, "per service"),
  fixedAddOn("privacy-screen-shaping", "Privacy screen shaping", "tree_shrub", 250, "per service"),

  // Cleanup (one-time cleanup is the §B2 cleanup-gating add-on)
  fixedAddOn("seasonal-cleanup", "Seasonal cleanup", "cleanup", 350, "per service"),
  fixedAddOn("deep-cleanup", "Deep cleanup", "cleanup", 450, "per service"),
  fixedAddOn("leaf-removal", "Leaf removal", "cleanup", 199, "per service"),
  fixedAddOn("green-waste-hauling", "Green waste hauling", "cleanup", 250, "per service"),
  fixedAddOn("storm-cleanup", "Storm cleanup", "cleanup", 450, "per service"),
  fixedAddOn(
    "one-time-cleanup",
    "One-time cleanup",
    "cleanup",
    350,
    "per service",
    "§B2 cleanup-gating add-on — required in cart when vision flags high-confidence neglected",
  ),
  fixedAddOn("pre-event-cleanup", "Pre-event cleanup", "cleanup", 299, "per service"),
  fixedAddOn("post-construction-cleanup", "Post-construction cleanup", "cleanup", 650, "per service"),

  // Hardscape & Surface (cleaning/refresh only — hardscape REPAIR escalates)
  fixedAddOn("pressure-washing", "Pressure washing", "hardscape", 250, "per service"),
  fixedAddOn("paver-cleaning", "Paver cleaning", "hardscape", 250, "per service"),
  fixedAddOn("dg-refresh", "DG refresh", "hardscape", 350, "per service"),
  fixedAddOn("gravel-refresh", "Gravel refresh", "hardscape", 350, "per service"),
  fixedAddOn("rock-area-cleanup", "Rock area cleanup", "hardscape", 199, "per service"),
  fixedAddOn("pathway-cleanup", "Pathway cleanup", "hardscape", 199, "per service"),
  fixedAddOn("hardscape-joint-weed-control", "Weed control in hardscape joints", "hardscape", 150, "per service"),
  fixedAddOn("minor-paver-adjustment", "Minor paver adjustment", "hardscape", 250, "per service"),

  // Drainage (inspection/maintenance only — drainage INSTALL/REPAIR escalates)
  fixedAddOn("drainage-visual-inspection", "Drainage visual inspection", "drainage", 150, "per service"),
  fixedAddOn("downspout-check", "Downspout check", "drainage", 95, "per service"),
  fixedAddOn("french-drain-observation", "French drain observation", "drainage", 150, "per service"),
  fixedAddOn("surface-water-flow-check", "Surface water flow check", "drainage", 150, "per service"),
  fixedAddOn("sump-pump-visual-check", "Sump pump visual check", "drainage", 150, "per service"),
  fixedAddOn("drain-cleaning", "Drain cleaning", "drainage", 250, "per service"),
  fixedAddOn("minor-drainage-maintenance", "Minor drainage maintenance", "drainage", 250, "per service"),
  fixedAddOn("rain-season-preparation", "Rain season preparation", "drainage", 350, "per service"),

  // Premium Client
  fixedAddOn("monthly-landscape-report", "Monthly landscape report", "premium_client", 95, "per month"),
  fixedAddOn("before-after-photos", "Before and after photos", "premium_client", 50, "per visit"),
  fixedAddOn("seasonal-landscape-planning", "Seasonal landscape planning", "premium_client", 250, "per service"),
  fixedAddOn("property-manager-report", "Property manager report", "premium_client", 125, "per report"),
  fixedAddOn("hoa-report", "HOA report", "premium_client", 125, "per report"),
  fixedAddOn("annual-landscape-improvement-plan", "Annual landscape improvement plan", "premium_client", 450, "per service"),
];

export function addOnById(id: string): AddOn | undefined {
  return ADD_ON_CATALOG.find((a) => a.id === id);
}
export function fixedAddOns(): AddOn[] {
  return ADD_ON_CATALOG.filter((a) => a.kind === "fixed");
}
export function openEndedAddOnsList(): AddOn[] {
  return ADD_ON_CATALOG.filter((a) => a.kind === "open_ended");
}

// The cleanup add-on the §B2 vision rule forces into cart when neglected=high.
export const CLEANUP_GATING_ADDON_ID = "one-time-cleanup";

// ─────────────────────────────────────────────────────────────────────────────
// 4. VISION
// ─────────────────────────────────────────────────────────────────────────────

export type Intensity = "low" | "medium" | "high";

export interface VisionAssessment {
  slope_signals: {
    stairs_visible: boolean;
    retaining_wall_visible: boolean;
    terraces_visible: boolean;
    steepness_hint: "none" | "moderate" | "steep";
  };
  condition_score: number; // 0..10
  overgrowth: Intensity;
  weeds: Intensity;
  leaf_litter: Intensity;
  cleanup_required: boolean;
  // §B2 gating: "high" → REQUIRE cleanup add-on in cart before recurring;
  //             "low"  → RECOMMEND only.
  cleanup_confidence: "low" | "high";
  detected_extras: string[]; // add-on ids the agent thinks the customer should see
  recommended_tier: Tier;
  confidence: number; // 0..1 — below 0.5 → escalate per spec §13
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PRICING RESULT
//    What the funnel shows the customer + what gets charged at checkout.
//    Open-ended items NEVER contribute to the charged total.
// ─────────────────────────────────────────────────────────────────────────────

export interface PricingLineItem {
  addOnId: string;
  name: string;
  amount: number; // USD
  unit: string;
}

export interface PricingResult {
  tier: Tier;
  frequency: Frequency;
  perVisit: number; // PRICE_BOOK[tier].perVisit
  monthlyRecurring: number; // monthlyFromVisit(tier, freq)
  fixedAddOnLineItems: PricingLineItem[]; // charged at first checkout
  openEndedFlagged: Array<{ addOnId: string; name: string; reason: string }>; // human-quoted, NOT charged
  firstChargeTotal: number; // monthlyRecurring + sum(fixedAddOnLineItems.amount)
  recurringMonthly: number; // monthlyRecurring alone — what renews
  currency: "USD";
  assumptions: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ESCALATION
// ─────────────────────────────────────────────────────────────────────────────

export type EscalationReason =
  | "hoa"
  | "property_manager"
  | "commercial"
  | "complaint"
  | "refund"
  | "legal_warranty"
  | "damage"
  | "hardscape_large_install"
  | "out_of_area"
  | "extreme_urgency"
  | "open_ended_addon"
  | "low_vision_confidence"
  | "contradictory_scope"
  | "missing_photos"
  | "no_slot_within_window";

export interface EscalationFlag {
  flags: EscalationReason[];
  primary: EscalationReason;
  brief: string; // full handoff brief for the human reviewer
  capturedContact?: { name?: string; email?: string; phone?: string; address?: string };
  // §F1: anything flagged → no auto-charge → human queue.
  autoChargeBlocked: true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. SLOTS — 4 slots/day from Thursday, 14-day serve window
// ─────────────────────────────────────────────────────────────────────────────

export const SLOTS_PER_DAY = 4;
export const SERVE_WINDOW_DAYS = 14; // BUILD-DECISIONS §D2: no slot within N=14d → waitlist
export const FIRST_SERVE_WEEKDAY = 4; // 0=Sun … 4=Thu — first bookable weekday

export interface SlotOffer {
  slotId: string; // stable id, e.g. "2026-06-18-T1"
  date: string; // ISO date (YYYY-MM-DD)
  startTime: string; // ISO datetime
  endTime: string; // ISO datetime
  crewSize: number;
  available: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CHECKOUT
// ─────────────────────────────────────────────────────────────────────────────

export type CheckoutStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "waitlisted" // no slot within 14d → DO NOT charge (§D2)
  | "blocked_by_escalation"; // any escalation flag → no auto-charge (§F1)

export interface CheckoutResult {
  status: CheckoutStatus;
  stripeSubscriptionId?: string;
  stripeFirstChargeId?: string;
  amountCharged?: number; // USD
  currency?: "USD";
  failureReason?: string;
  // First-visit satisfaction guarantee (§F2) — recurring locks only after a
  // successful first visit; before that, this is the active guarantee window.
  firstVisitGuaranteeActive?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. FUNNEL STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

export type FunnelStep =
  | "intent" // describe need
  | "space_photos" // address + photos
  | "tier_recommend" // AI recommends, customer confirms
  | "identity" // name + email + phone + address (mid-flow, §E2)
  | "quote" // see the price + cart
  | "checkout" // Stripe
  | "schedule" // pick a real slot (pay-first → then-pick, §D1)
  | "confirmed" // booked + work order written
  | "waitlist" // no slot within 14d — no charge
  | "human_review"; // escalated — no charge

export interface FunnelState {
  step: FunnelStep;
  language: "en" | "es";
  intent?: string;
  address?: string;
  photos: string[];
  visionAssessment?: VisionAssessment;
  recommendedTier?: Tier;
  confirmedTier?: Tier;
  selectedAddOns: string[]; // AddOn.id[] currently in cart
  frequency?: Frequency;
  identity?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string; // required at the pricing step (§E2)
  };
  pricingResult?: PricingResult;
  selectedSlotId?: string;
  checkoutResult?: CheckoutResult;
  escalation?: EscalationFlag;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. LEAD — extends the existing store.ts Lead with funnel state
// ─────────────────────────────────────────────────────────────────────────────

export interface Lead extends StoreLead {
  funnelState?: FunnelState;
}

// Re-export for downstream importers that want the canonical names from here.
export type { StoreLead };
