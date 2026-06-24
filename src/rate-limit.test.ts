// Rate-limit helper test (go-live G3).
// Run: npx tsx src/rate-limit.test.ts  (no Upstash env → limiter degrades to allow).

import { clientIp, checkFunnelRateLimit } from "./rate-limit";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  console.log("\n=== Rate limit ===");

  // clientIp extraction
  ok("x-forwarded-for first hop", clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })) === "1.2.3.4");
  ok("x-real-ip fallback", clientIp(new Headers({ "x-real-ip": "9.9.9.9" })) === "9.9.9.9");
  ok("unknown when no ip headers", clientIp(new Headers()) === "unknown");

  // No Upstash configured in the test env → limiter is a no-op (dev flow stays open).
  // (CI and local tests never set the Upstash vars.)
  const r = await checkFunnelRateLimit("1.2.3.4", "web-x");
  ok("degrades to allow without Upstash", r.ok === true);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
