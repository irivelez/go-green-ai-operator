// Operator conversation proof — no keys needed (template reply path).
// Drives the serverless brain through every branch the dashboard exercises.

import { resetStore, upsertLead } from "./store";
import { runOperator } from "./operator";
import { getStripeClient } from "./stripe";

resetStore([]);

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// ─────────────────────────────────────────────────────────────────────────────
// Stripe guard tests (STRIPE_LIVE_OK flag)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n=== Stripe Guard: Live Key Protection ===");

// Test 1: sk_test_ always works
const oldKey1 = process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_SECRET_KEY = "sk_test_FAKE";
delete process.env.STRIPE_LIVE_OK;
try {
  getStripeClient();
  ok("sk_test_ key accepted", true);
} catch (e) {
  ok("sk_test_ key accepted", false, String(e));
}
process.env.STRIPE_SECRET_KEY = oldKey1;

// Test 2: sk_live_ without STRIPE_LIVE_OK throws with helpful message
const oldKey2 = process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_SECRET_KEY = "sk_live_FAKE";
delete process.env.STRIPE_LIVE_OK;
try {
  getStripeClient();
  ok("sk_live_ without flag rejected", false, "should have thrown");
} catch (e) {
  const msg = String(e);
  ok("sk_live_ without flag rejected", true, msg);
  ok("error mentions STRIPE_LIVE_OK", /STRIPE_LIVE_OK/.test(msg), msg);
}
process.env.STRIPE_SECRET_KEY = oldKey2;

// Test 3: sk_live_ with STRIPE_LIVE_OK=1 accepted
const oldKey3 = process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_SECRET_KEY = "sk_live_FAKE";
process.env.STRIPE_LIVE_OK = "1";
try {
  getStripeClient();
  ok("sk_live_ with STRIPE_LIVE_OK=1 accepted", true);
} catch (e) {
  ok("sk_live_ with STRIPE_LIVE_OK=1 accepted", false, String(e));
}
process.env.STRIPE_SECRET_KEY = oldKey3;
delete process.env.STRIPE_LIVE_OK;

async function main() {
  console.log("\n=== Conversation 1: A-lead intake → price → book ===");
  const r1 = await runOperator({
    lead_id: "C1", channel: "telegram", name: "Dana",
    text: "Hi! I'd like biweekly maintenance for my place at 742 Valencia St, San Francisco 94110",
    has_photo: true,
  });
  ok("offered slots", r1.decision.intent === "offer_slots", r1.decision.stage);
  ok("priced an exact per-visit point (T5 compat shim)", !!r1.decision.price_range && r1.decision.price_range.high === r1.decision.price_range.low && r1.decision.price_range.low > 0, JSON.stringify(r1.decision.price_range));
  ok("reply mentions a range", /\$\d+/.test(r1.reply));

  // Money gate (cross-model review B1): the legacy operator has NO payment step,
  // so an unpaid lead can no longer be auto-booked — tool_book_evaluation refuses
  // and the operator falls through to re-offering slots. BOOKED now means PAID.
  const r2 = await runOperator({ lead_id: "C1", channel: "telegram", text: "the first one works" });
  ok("unpaid legacy lead NOT auto-booked (money gate)", r2.decision.stage !== "BOOKED", r2.decision.stage);
  ok("falls through to re-offering slots", r2.decision.intent === "offer_slots", r2.decision.intent);

  // After payment (simulated), the same confirmation books successfully.
  await upsertLead({ lead_id: "C1", channel: "telegram", status: "PAID" });
  const r2b = await runOperator({ lead_id: "C1", channel: "telegram", text: "the first one works" });
  ok("paid lead → booked", r2b.decision.stage === "BOOKED", r2b.decision.intent);
  ok("booked slot recorded", !!r2b.decision.booked_slot);

  console.log("\n=== Conversation 2: HOA → escalation ===");
  const r3 = await runOperator({ lead_id: "C2", channel: "email", name: "Tom", text: "Our HOA needs weekly service for the common areas at 1200 Gough St 94109" });
  ok("escalated", r3.decision.escalated && r3.decision.stage === "ESCALATED", r3.decision.escalation_reasons.join(","));

  console.log("\n=== Conversation 3: out of area → not a fit ===");
  const r4 = await runOperator({ lead_id: "C3", channel: "form", text: "monthly service for 120 Hillside Blvd, Daly City 94015" });
  ok("declined out-of-area", r4.decision.stage === "DEAD", r4.decision.intent);

  console.log("\n=== Conversation 4: incomplete → collect info ===");
  const r5 = await runOperator({ lead_id: "C4", channel: "telegram", name: "Olivia", text: "hi do you do garden maintenance?" });
  ok("asks for missing info", r5.decision.intent === "collect_info", r5.decision.missing.join(","));
  ok("reply is the warm intake", /Go Green Landscape/.test(r5.reply));

  console.log("\n=== Conversation 5: Spanish A-lead ===");
  const r6 = await runOperator({ lead_id: "C5", channel: "whatsapp", name: "Carlos", text: "Hola, necesito mantenimiento quincenal para 4127 18th St, San Francisco 94114", has_photo: true });
  ok("responds in Spanish", /Gracias|disponibilidad|jardín|recomendamos/i.test(r6.reply), r6.decision.language);
  ok("priced + offered", r6.decision.intent === "offer_slots" && !!r6.decision.price_range);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
