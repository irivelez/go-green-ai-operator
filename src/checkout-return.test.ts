// Post-payment return parser test (go-live G2).
// Run: npx tsx src/checkout-return.test.ts

import { parseCheckoutReturn } from "./checkout-return";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== parseCheckoutReturn ===");

{
  const r = parseCheckoutReturn("?checkout=success&lead=web-abc&session_id=cs_123");
  ok("success flag", r.isSuccess === true);
  ok("not cancelled", r.isCancelled === false);
  ok("leadId from URL", r.leadId === "web-abc");
}
{
  const r = parseCheckoutReturn("?checkout=cancelled&lead=web-xyz");
  ok("cancelled flag", r.isCancelled === true);
  ok("not success", r.isSuccess === false);
  ok("leadId from URL on cancel", r.leadId === "web-xyz");
}
{
  // Same-tab return with no lead param → fall back to the persisted id.
  const r = parseCheckoutReturn("?checkout=success", "web-stored");
  ok("falls back to stored leadId", r.leadId === "web-stored");
}
{
  // URL lead wins over stored.
  const r = parseCheckoutReturn("?checkout=success&lead=web-url", "web-stored");
  ok("URL lead beats stored", r.leadId === "web-url");
}
{
  // Normal first visit: no checkout params.
  const r = parseCheckoutReturn("", null);
  ok("no params → not a return", !r.isSuccess && !r.isCancelled);
  ok("no leadId when none available", r.leadId === null);
}
{
  // Empty/whitespace lead param ignored in favour of the stored fallback.
  const r = parseCheckoutReturn("?checkout=success&lead=%20", "web-stored");
  ok("blank lead param ignored", r.leadId === "web-stored");
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
