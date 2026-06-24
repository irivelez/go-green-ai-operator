// Proof driver — trusted client-IP resolution (cross-model review S9).
// The naive x-forwarded-for[0] is client-spoofable; clientIp must prefer the
// platform-trusted x-real-ip / rightmost XFF hop. Run: npx tsx src/net.test.ts

import { clientIp } from "./net";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

function h(map: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(map)) headers.set(k, v);
  return headers;
}

async function main() {
  console.log("\n=== Net 1: x-real-ip is trusted over a spoofed XFF ===");
  {
    // Attacker prepends a fake IP to x-forwarded-for; x-real-ip is the truth.
    const ip = clientIp(h({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" }), "fb");
    ok("uses x-real-ip, NOT the spoofed leftmost XFF", ip === "203.0.113.9", ip);
  }

  console.log("\n=== Net 2: no x-real-ip → rightmost XFF hop (not the client-controlled leftmost) ===");
  {
    const ip = clientIp(h({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }), "fb");
    ok("takes the rightmost (proxy-appended) hop", ip === "203.0.113.9", ip);
  }

  console.log("\n=== Net 3: a fully spoofed single-entry XFF still uses the rightmost (the only hop) ===");
  {
    // With a single entry and no x-real-ip, the rightmost == that entry. This is
    // the unavoidable local/dev case; in prod Vercel always sets x-real-ip.
    const ip = clientIp(h({ "x-forwarded-for": "5.5.5.5" }), "fb");
    ok("single-entry XFF → that entry", ip === "5.5.5.5", ip);
  }

  console.log("\n=== Net 4: no proxy headers → fallback (local dev) ===");
  {
    const ip = clientIp(h({}), "lead-123");
    ok("falls back to the stable key when no proxy header", ip === "lead-123", ip);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
