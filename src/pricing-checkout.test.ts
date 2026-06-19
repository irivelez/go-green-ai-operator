// Proof driver for the Stripe recurring-unit-amount math (review blocker A).
// The bug we lock down here: the funnel quoted the customer the MEASURED
// area×slope price (pricePerVisit), but Stripe charged the LEGACY flat
// PRICE_BOOK[tier].perVisit price → customer quoted one number, billed another
// (medium flat biweekly: $173/visit quoted vs $299/visit charged).
//
// recurringUnitAmountCents is the single source of truth for the subscription
// line's unit_amount. With measuredPerVisit present, that number wins. Without
// it (legacy callers / no measurement), the PRICE_BOOK flat fallback path
// stays intact so existing callers don't break.
//
// Run: npx tsx src/pricing-checkout.test.ts

import { recurringUnitAmountCents } from "./stripe";
import { PRICE_BOOK, FREQUENCY_MULTIPLIER } from "./contract";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== Scenario 1: MEASURED — biweekly medium flat ($173/visit) → 37541 cents ===");
{
  // 173 × 2.17 = 375.41 → 37541 cents. THIS is what the customer was quoted on
  // ExactPriceCard — and what Stripe MUST charge.
  const c = recurringUnitAmountCents({ measuredPerVisit: 173, frequency: "biweekly" });
  ok("173 × 2.17 → 37541 cents", c === 37541, `got ${c}`);
}

console.log("\n=== Scenario 2: LEGACY fallback — signature tier biweekly ($299/visit) → 64883 cents ===");
{
  // Back-compat: no measurement → PRICE_BOOK flat path. This is the BUG's old
  // shape, intentionally preserved for legacy callers (operator.ts compat).
  const c = recurringUnitAmountCents({ tier: "signature", frequency: "biweekly" });
  ok("299 × 2.17 → 64883 cents", c === 64883, `got ${c}`);
}

console.log("\n=== Scenario 3: MEASURED beats LEGACY when both supplied ===");
{
  // Defense in depth: if a caller passes both (e.g. someone forgets to drop
  // tier from a legacy code path), measuredPerVisit wins — never the flat tier.
  const c = recurringUnitAmountCents({
    measuredPerVisit: 173,
    tier: "signature",
    frequency: "biweekly",
  });
  ok("measured wins over flat tier → 37541 cents", c === 37541, `got ${c}`);
}

console.log("\n=== Scenario 4: all 3 tiers × all 3 frequencies (legacy path stable) ===");
{
  for (const tier of ["essential", "signature", "estate"] as const) {
    for (const frequency of ["weekly", "biweekly", "monthly"] as const) {
      const expected = Math.round(
        PRICE_BOOK[tier].perVisit * FREQUENCY_MULTIPLIER[frequency] * 100,
      );
      const actual = recurringUnitAmountCents({ tier, frequency });
      ok(
        `${tier} × ${frequency} → ${expected} cents`,
        actual === expected,
        `got ${actual}`,
      );
    }
  }
}

console.log("\n=== Scenario 5: missing both measuredPerVisit AND tier → throws ===");
{
  let threw = false; let msg = "";
  try {
    recurringUnitAmountCents({ frequency: "biweekly" } as never);
  } catch (e) { threw = true; msg = (e as Error).message; }
  ok("throws when neither input present", threw, msg);
}

console.log("\n=== Scenario 6: measured large×steep biweekly — quote == charge ===");
{
  // pricePerVisit({large 6000 sqft, steep, biweekly}) = round(330 × 1.35) = 446
  // 446 × 2.17 = 967.82 → 96782 cents
  const c = recurringUnitAmountCents({ measuredPerVisit: 446, frequency: "biweekly" });
  ok("446 × 2.17 → 96782 cents", c === 96782, `got ${c}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
