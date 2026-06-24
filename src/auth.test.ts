// Proof driver — owner session auth (todo 4).
// Web Crypto HMAC sign/verify round-trip, tamper rejection, expiry rejection,
// constant-time password check. Run: npx tsx src/auth.test.ts

import {
  signSession,
  verifySession,
  passwordMatches,
  isAuthorizedOwnerRequest,
  SESSION_COOKIE,
} from "./auth";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const SECRET = "test-secret-please-rotate";

async function main() {
  console.log("\n=== Auth 1: sign → verify round-trip ===");
  {
    const token = await signSession(SECRET);
    const session = await verifySession(token, SECRET);
    ok("valid token verifies", session !== null && session.role === "owner", JSON.stringify(session));
  }

  console.log("\n=== Auth 2: tampered token fails ===");
  {
    const token = await signSession(SECRET);
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    const session = await verifySession(tampered, SECRET);
    ok("tampered signature rejected", session === null);
  }

  console.log("\n=== Auth 3: wrong secret fails ===");
  {
    const token = await signSession(SECRET);
    const session = await verifySession(token, "different-secret");
    ok("wrong secret rejected", session === null);
  }

  console.log("\n=== Auth 4: expired token fails ===");
  {
    // Sign with a clock 10 days in the past; TTL is 7 days → expired now.
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const token = await signSession(SECRET, tenDaysAgo);
    const session = await verifySession(token, SECRET);
    ok("expired token rejected", session === null);
  }

  console.log("\n=== Auth 5: malformed token fails ===");
  {
    ok("empty token rejected", (await verifySession("", SECRET)) === null);
    ok("no-dot token rejected", (await verifySession("garbage", SECRET)) === null);
    ok("undefined token rejected", (await verifySession(undefined, SECRET)) === null);
  }

  console.log("\n=== Auth 6: password constant-time compare ===");
  {
    ok("correct password matches", passwordMatches("hunter2", "hunter2"));
    ok("wrong password rejected", !passwordMatches("hunter3", "hunter2"));
    ok("empty expected rejected", !passwordMatches("x", ""));
    ok("length mismatch rejected", !passwordMatches("short", "muchlonger"));
  }

  console.log("\n=== Auth 7: in-handler owner guard (S7 defense-in-depth) ===");
  {
    const token = await signSession(SECRET);
    const goodCookie = `${SESSION_COOKIE}=${token}; other=x`;
    ok("valid session cookie authorizes", await isAuthorizedOwnerRequest(goodCookie, SECRET));
    ok("absent cookie header → unauthorized", !(await isAuthorizedOwnerRequest(null, SECRET)));
    ok("cookie without the session → unauthorized", !(await isAuthorizedOwnerRequest("foo=bar", SECRET)));
    ok("tampered session → unauthorized", !(await isAuthorizedOwnerRequest(`${SESSION_COOKIE}=${token}X`, SECRET)));
    ok("missing secret → unauthorized", !(await isAuthorizedOwnerRequest(goodCookie, "")));
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
