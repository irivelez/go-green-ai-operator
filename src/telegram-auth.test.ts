// Proof driver — Telegram webhook fail-closed auth (cross-model review S11).
// The bug: a deploy with a live TELEGRAM_BOT_TOKEN but no TELEGRAM_WEBHOOK_SECRET
// accepted ANY POST. The fix MUST reject when a token is set but the secret is
// missing OR mismatched. Run: npx tsx src/telegram-auth.test.ts

import { telegramWebhookAuth } from "./telegram-auth";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  console.log("\n=== TG-Auth 1: token set + secret UNSET → REJECT (the S11 hole) ===");
  {
    const r = telegramWebhookAuth({ token: "bot123", expectedSecret: undefined, presentedSecret: null });
    ok("fails closed when secret is not configured", r.ok === false, JSON.stringify(r));
    ok("reason is secret_not_configured", r.ok === false && r.reason === "secret_not_configured");
  }

  console.log("\n=== TG-Auth 2: token set + secret set + MISMATCH → REJECT ===");
  {
    const r = telegramWebhookAuth({ token: "bot123", expectedSecret: "s3cr3t", presentedSecret: "wrong" });
    ok("rejects a mismatched presented secret", r.ok === false, JSON.stringify(r));
    ok("reason is secret_mismatch", r.ok === false && r.reason === "secret_mismatch");
  }

  console.log("\n=== TG-Auth 3: token set + secret set + MISSING header → REJECT ===");
  {
    const r = telegramWebhookAuth({ token: "bot123", expectedSecret: "s3cr3t", presentedSecret: null });
    ok("rejects when no secret header is presented", r.ok === false, JSON.stringify(r));
  }

  console.log("\n=== TG-Auth 4: token set + secret set + MATCH → ALLOW ===");
  {
    const r = telegramWebhookAuth({ token: "bot123", expectedSecret: "s3cr3t", presentedSecret: "s3cr3t" });
    ok("allows a correct presented secret", r.ok === true, JSON.stringify(r));
  }

  console.log("\n=== TG-Auth 5: no token (route inert) → ALLOW (dev stays usable) ===");
  {
    const r = telegramWebhookAuth({ token: undefined, expectedSecret: undefined, presentedSecret: null });
    ok("no token configured → no-op allow", r.ok === true, JSON.stringify(r));
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
