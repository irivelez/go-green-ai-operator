// Stripe smoke test — TEST MODE ONLY.
//
// Run: `tsx src/stripe.smoke.ts`
//   - With STRIPE_SECRET_KEY (sk_test_…) present: creates a real Checkout
//     Session in test mode and prints the URL (clickable in a real browser).
//   - Without the key: skips cleanly (exit 0) with a friendly note.
//
// Scenario: tier=signature, freq=biweekly, add-ons=fertilization + mulch-refresh.

import { createSubscriptionCheckout } from "./stripe";

async function main(): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.log("[stripe.smoke] STRIPE_SECRET_KEY not set — skipping smoke (this is fine).");
    return;
  }

  const out = await createSubscriptionCheckout({
    tier: "signature",
    frequency: "biweekly",
    selectedAddOnIds: ["fertilization", "mulch-refresh"],
    customer: {
      name: "Test Customer",
      email: "test+gogreen@example.com",
      phone: "+14155550123",
      address: "123 Test St, San Francisco, CA 94110",
    },
    leadId: `smoke-${Date.now()}`,
  });

  console.log("[stripe.smoke] Checkout session created (TEST MODE).");
  console.log(`  sessionId: ${out.sessionId}`);
  console.log(`  url:       ${out.url}`);
}

main().catch((err) => {
  console.error("[stripe.smoke] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
