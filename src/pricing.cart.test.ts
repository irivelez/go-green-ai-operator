// Proof driver for priceCart() — the cart-pricing function over contract types.
// Pure, deterministic, no keys. Run: npx tsx src/pricing.cart.test.ts

import { priceCart } from "./pricing";
import { monthlyFromVisit } from "./contract";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const approxEq = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;

console.log("\n=== Scenario 1: HAPPY signature/biweekly + fertilization + mulch-refresh ===");
{
  const r = priceCart({
    tier: "signature",
    frequency: "biweekly",
    addOnIds: ["fertilization", "mulch-refresh"],
  });
  ok("tier echoed", r.tier === "signature");
  ok("frequency echoed", r.frequency === "biweekly");
  ok("perVisit = 299", r.perVisit === 299, `got ${r.perVisit}`);
  ok("monthlyRecurring = 648.83", approxEq(r.monthlyRecurring, 648.83), `got ${r.monthlyRecurring}`);
  ok("recurringMonthly == monthlyRecurring", r.recurringMonthly === r.monthlyRecurring);
  ok("2 fixed line items", r.fixedAddOnLineItems.length === 2, `got ${r.fixedAddOnLineItems.length}`);
  const ids = r.fixedAddOnLineItems.map((x) => x.addOnId).sort();
  ok("contains fertilization+mulch-refresh", JSON.stringify(ids) === JSON.stringify(["fertilization", "mulch-refresh"]));
  const sumFixed = r.fixedAddOnLineItems.reduce((s, x) => s + x.amount, 0);
  ok("fixed sum = 445 ($95 + $350)", sumFixed === 445, `got ${sumFixed}`);
  ok("firstChargeTotal = 1093.83", approxEq(r.firstChargeTotal, 1093.83), `got ${r.firstChargeTotal}`);
  ok("openEndedFlagged empty", r.openEndedFlagged.length === 0);
  ok("currency USD", r.currency === "USD");
  ok("assumptions present", r.assumptions.length >= 2);
}

console.log("\n=== Scenario 2: EDGE — open-ended excluded from charge ===");
{
  const r = priceCart({
    tier: "signature",
    frequency: "biweekly",
    addOnIds: ["hand-weeding", "irrigation-repair", "leaf-removal"],
  });
  ok("1 fixed line item only (leaf-removal)", r.fixedAddOnLineItems.length === 1, `got ${r.fixedAddOnLineItems.length}`);
  ok("fixed item is leaf-removal", r.fixedAddOnLineItems[0]?.addOnId === "leaf-removal");
  ok("fixed amount $199", r.fixedAddOnLineItems[0]?.amount === 199);
  ok("2 openEnded flagged", r.openEndedFlagged.length === 2, `got ${r.openEndedFlagged.length}`);
  const flaggedIds = r.openEndedFlagged.map((x) => x.addOnId).sort();
  ok("flagged = hand-weeding + irrigation-repair", JSON.stringify(flaggedIds) === JSON.stringify(["hand-weeding", "irrigation-repair"]));
  ok("all flagged have a reason", r.openEndedFlagged.every((x) => typeof x.reason === "string" && x.reason.length > 0));
  const expected = monthlyFromVisit("signature", "biweekly") + 199;
  ok(`firstChargeTotal = monthly + 199 (open-ended NOT charged) = ${expected}`, approxEq(r.firstChargeTotal, expected), `got ${r.firstChargeTotal}`);
  ok("assumptions mention human-estimate note", r.assumptions.some((a) => /human estimate|not charged/i.test(a)));
}

console.log("\n=== Scenario 3: EDGE — unknown add-on id throws ===");
{
  let threw = false;
  let msg = "";
  try {
    priceCart({ tier: "essential", frequency: "monthly", addOnIds: ["does-not-exist"] });
  } catch (e) {
    threw = true;
    msg = (e as Error).message;
  }
  ok("threw", threw);
  ok("error mentions the bad id", /does-not-exist/.test(msg), msg);
  ok("error follows `unknown add-on:` format", /^unknown add-on:/.test(msg), msg);
}

console.log("\n=== Scenario 4: HAPPY essential/weekly, no add-ons ===");
{
  const r = priceCart({ tier: "essential", frequency: "weekly", addOnIds: [] });
  ok("perVisit = 199", r.perVisit === 199);
  ok("monthlyRecurring = 861.67", approxEq(r.monthlyRecurring, 861.67), `got ${r.monthlyRecurring}`);
  ok("firstChargeTotal == monthlyRecurring == 861.67",
    approxEq(r.firstChargeTotal, 861.67) && r.firstChargeTotal === r.monthlyRecurring,
    `got ${r.firstChargeTotal}`);
  ok("no fixed line items", r.fixedAddOnLineItems.length === 0);
  ok("no open-ended flagged", r.openEndedFlagged.length === 0);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
