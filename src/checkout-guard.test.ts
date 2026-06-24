// Proof driver — double-charge guard (todo 7).
// In dev (no Upstash) the in-flight key uses the in-process Map; SET-NX
// semantics are identical (single-writer). Run: npx tsx src/checkout-guard.test.ts

import {
  getInFlightUrl,
  storeInFlightUrl,
  clearInFlight,
  checkoutIdempotencyKey,
  resetCheckoutGuard,
} from "./checkout-guard";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const E = "dana@example.com";

async function main() {
  console.log("\n=== Guard 1: idempotency key is deterministic per (email,tier,freq,day) ===");
  {
    const k1 = checkoutIdempotencyKey(E, "signature", "weekly");
    const k2 = checkoutIdempotencyKey("Dana@Example.com ", "signature", "weekly");
    const k3 = checkoutIdempotencyKey(E, "estate", "weekly");
    ok("same purchase → same key (canonicalized email)", k1 === k2, `${k1.slice(0, 8)} vs ${k2.slice(0, 8)}`);
    ok("different tier → different key", k1 !== k3);
  }

  console.log("\n=== Guard 2: store then reuse the in-flight URL ===");
  {
    resetCheckoutGuard();
    const url = "https://checkout.stripe.com/c/pay/cs_test_REAL";
    const stored = await storeInFlightUrl(E, "signature", "weekly", url);
    ok("store returns the real url", stored === url, stored);
    const fetched = await getInFlightUrl(E, "signature", "weekly");
    ok("reuse fetches the same real url", fetched === url, String(fetched));
  }

  console.log("\n=== Guard 3: concurrent store → both get the SAME real url (no 2nd session) ===");
  {
    resetCheckoutGuard();
    const a = "https://checkout.stripe.com/c/pay/cs_test_A";
    const b = "https://checkout.stripe.com/c/pay/cs_test_B";
    const [r1, r2] = await Promise.all([
      storeInFlightUrl(E, "signature", "biweekly", a),
      storeInFlightUrl(E, "signature", "biweekly", b),
    ]);
    ok("both callers receive the SAME url (winner's)", r1 === r2, `${r1} vs ${r2}`);
    ok("stored value is always a real URL (never a placeholder)", r1.startsWith("https://"));
  }

  console.log("\n=== Guard 4: clear lets a fresh purchase stage again ===");
  {
    resetCheckoutGuard();
    await storeInFlightUrl(E, "essential", "monthly", "https://checkout.stripe.com/c/old");
    await clearInFlight(E, "essential", "monthly");
    const after = await getInFlightUrl(E, "essential", "monthly");
    ok("after clear, no in-flight url", after === undefined, String(after));
  }

  console.log("\n=== Guard 5: distinct purchases don't collide ===");
  {
    resetCheckoutGuard();
    await storeInFlightUrl(E, "signature", "weekly", "https://w");
    const other = await getInFlightUrl(E, "signature", "monthly");
    ok("different frequency has no shared in-flight url", other === undefined, String(other));
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
