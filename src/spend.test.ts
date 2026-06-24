// Proof driver — per-email spend caps + rate limit (todo 5).
// In dev (no Upstash) the meters use the in-process counters; the atomic
// INCR-then-check semantics are identical (single-writer). Run: npx tsx src/spend.test.ts

import {
  chargeModelStep,
  chargeUsd,
  chargeReengagement,
  checkRateLimit,
  resetSpend,
  SPEND_CAPS,
} from "./spend";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  console.log("\n=== Spend 1: model-step cap → (N+1)th step blocked ===");
  {
    resetSpend();
    const email = "stepper@example.com";
    let lastAllowed = true;
    for (let i = 0; i < SPEND_CAPS.modelStepsPerSession; i++) {
      const r = await chargeModelStep(email);
      lastAllowed = r.allowed;
    }
    ok("steps 1..cap all allowed", lastAllowed === true);
    const over = await chargeModelStep(email);
    ok("(cap+1)th step blocked", over.allowed === false, JSON.stringify(over));
  }

  console.log("\n=== Spend 2: same email across two 'sessions' shares the cap ===");
  {
    resetSpend();
    const email = "shared@example.com";
    for (let i = 0; i < SPEND_CAPS.modelStepsPerSession; i++) await chargeModelStep(email);
    // A "new session" would pass a fresh leadId, but recognition keys by email →
    // the same identity → the cap is already spent.
    const over = await chargeModelStep(email);
    ok("email-keyed cap is NOT reset by a new session", over.allowed === false);
  }

  console.log("\n=== Spend 3: USD budget cap ===");
  {
    resetSpend();
    const email = "spender@example.com";
    const under = await chargeUsd(email, SPEND_CAPS.usdPerEmailPerDay - 0.01);
    ok("spend under budget allowed", under.allowed === true);
    const over = await chargeUsd(email, 0.5);
    ok("spend over budget blocked", over.allowed === false, JSON.stringify(over));
  }

  console.log("\n=== Spend 4: re-engagement email cap ===");
  {
    resetSpend();
    const email = "nudge@example.com";
    let allowed = 0;
    for (let i = 0; i < SPEND_CAPS.reengagementEmails + 2; i++) {
      const r = await chargeReengagement(email);
      if (r.allowed) allowed++;
    }
    ok("exactly cap re-engagement emails allowed", allowed === SPEND_CAPS.reengagementEmails, `allowed=${allowed}`);
  }

  console.log("\n=== Spend 5: concurrent steps cannot exceed the cap (atomic INCR) ===");
  {
    resetSpend();
    const email = "race@example.com";
    const cap = SPEND_CAPS.modelStepsPerSession;
    const results = await Promise.all(
      Array.from({ length: cap + 5 }, () => chargeModelStep(email)),
    );
    const allowed = results.filter((r) => r.allowed).length;
    ok("no more than cap steps allowed under concurrency", allowed === cap, `allowed=${allowed} cap=${cap}`);
  }

  console.log("\n=== Spend 6: rate limit no-op without Upstash (dev) ===");
  {
    const r = await checkRateLimit("1.2.3.4");
    ok("rate check allows in dev (no Upstash)", r.allowed === true, JSON.stringify(r));
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
