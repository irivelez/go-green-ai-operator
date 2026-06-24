// Proof driver for pricePerVisit() — measured-area × slope multiplier.
// Pure, deterministic, no keys. Run: npx tsx src/pricing.test.ts
// Authority: spec.md §A.4 (replaces guessed small|medium|large with measured area).

import { pricePerVisit, quoteRange } from "./pricing";
import { FREQUENCY_MULTIPLIER } from "./contract";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const approxEq = (a: number, b: number, eps = 1.0) => Math.abs(a - b) <= eps;

console.log("\n=== Scenario 1: medium yard (2500 sqft), flat, biweekly — exact price ===");
{
  const r = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "flat", frequency: "biweekly" });
  // base 173 (midpoint of biweekly [155,190]) × 1.0 = 173
  ok("perVisit === 173", r.perVisit === 173, `got ${r.perVisit}`);
  ok("currency USD", r.currency === "USD");
  ok(
    "monthly === perVisit × biweekly multiplier",
    Math.abs(r.monthly - r.perVisit * FREQUENCY_MULTIPLIER["biweekly"]) < 0.005,
    `got ${r.monthly}, expected ${r.perVisit * FREQUENCY_MULTIPLIER["biweekly"]}`,
  );
  ok(
    "assumptions mention area bucket",
    r.assumptions.some((a) => /medium|bucket|sqft/i.test(a)),
  );
  ok(
    "assumptions mention slope multiplier",
    r.assumptions.some((a) => /slope/i.test(a)),
  );
  ok(
    "assumptions mention on-site review",
    r.assumptions.some((a) => /final price confirmed on first on-site visit/i.test(a)),
  );
}

console.log("\n=== Scenario 2: slope multipliers (flat→moderate→steep) ===");
{
  const flat = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "flat", frequency: "biweekly" });
  const moderate = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "moderate", frequency: "biweekly" });
  const steep = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "steep", frequency: "biweekly" });
  ok(
    "moderate ≈ flat × 1.15",
    approxEq(moderate.perVisit, flat.perVisit * 1.15),
    `moderate=${moderate.perVisit}, flat×1.15=${flat.perVisit * 1.15}`,
  );
  ok(
    "steep ≈ flat × 1.35",
    approxEq(steep.perVisit, flat.perVisit * 1.35),
    `steep=${steep.perVisit}, flat×1.35=${flat.perVisit * 1.35}`,
  );
}

console.log("\n=== Scenario 3: measured_area_sqft <= 0 throws ===");
{
  let threw = false;
  let msg = "";
  try {
    pricePerVisit({ measured_area_sqft: 0, slope_tier: "flat", frequency: "biweekly" });
  } catch (e) {
    threw = true;
    msg = (e as Error).message;
  }
  ok("throws on sqft=0", threw, msg);
  ok("error mentions measured_area_sqft", /measured_area_sqft/i.test(msg), msg);

  let threwNeg = false;
  try {
    pricePerVisit({ measured_area_sqft: -10, slope_tier: "flat", frequency: "biweekly" });
  } catch {
    threwNeg = true;
  }
  ok("throws on negative sqft", threwNeg);
}

console.log("\n=== Scenario 4: monthly = perVisit × FREQUENCY_MULTIPLIER (all 3 frequencies) ===");
{
  const weekly = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "flat", frequency: "weekly" });
  ok(
    "weekly: monthly = perVisit × 4.33",
    Math.abs(weekly.monthly - weekly.perVisit * FREQUENCY_MULTIPLIER["weekly"]) < 0.01,
    `${weekly.monthly} vs ${weekly.perVisit * 4.33}`,
  );
  const monthly = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "flat", frequency: "monthly" });
  ok(
    "monthly: monthly = perVisit × 1.0",
    Math.abs(monthly.monthly - monthly.perVisit * 1.0) < 0.01,
    `${monthly.monthly}`,
  );
}

console.log("\n=== Scenario 5: area buckets — small/medium/large boundaries ===");
{
  const small = pricePerVisit({ measured_area_sqft: 800, slope_tier: "flat", frequency: "biweekly" });
  const medium = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "flat", frequency: "biweekly" });
  const large = pricePerVisit({ measured_area_sqft: 6000, slope_tier: "flat", frequency: "biweekly" });
  ok("small bucket (800 sqft) = 105", small.perVisit === 105, `got ${small.perVisit}`);
  ok("medium bucket (2500 sqft) = 173", medium.perVisit === 173, `got ${medium.perVisit}`);
  ok("large bucket (6000 sqft) = 330", large.perVisit === 330, `got ${large.perVisit}`);
}

console.log("\n=== Scenario 6: quoteRange compat shim — single point, not a band ===");
{
  const range = quoteRange({
    measured_area_sqft: 2500,
    slope_tier: "flat",
    frequency: "biweekly",
  });
  const point = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "flat", frequency: "biweekly" });
  ok("range covered", range.covered);
  ok("range.low === perVisit", range.low === point.perVisit, `low=${range.low}, perVisit=${point.perVisit}`);
  ok("range.high === perVisit", range.high === point.perVisit, `high=${range.high}, perVisit=${point.perVisit}`);
  ok("range.low === range.high (no band)", range.low === range.high);
  ok("confidence === 0.85", range.confidence === 0.85, `got ${range.confidence}`);
  ok("currency USD", range.currency === "USD");
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
