// Interim dashboard-lock auth decision test (go-live G4).
// Run: npx tsx src/dashboard-auth.test.ts

import { dashboardAuthDecision } from "./dashboard-auth";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const basic = (u: string, p: string) => "Basic " + btoa(`${u}:${p}`);

console.log("\n=== Dashboard auth decision ===");

// Credentials unset: open in dev, fail-closed on Vercel.
{
  ok(
    "unset + dev → allow",
    dashboardAuthDecision({ authHeader: null, user: undefined, pass: undefined, isVercel: false }) === "allow",
  );
  ok(
    "unset + Vercel → misconfigured (fail closed)",
    dashboardAuthDecision({ authHeader: null, user: undefined, pass: undefined, isVercel: true }) === "misconfigured",
  );
}

// Credentials set: enforce.
{
  const cfg = { user: "owner", pass: "s3cret", isVercel: true };
  ok("no header → challenge", dashboardAuthDecision({ ...cfg, authHeader: null }) === "challenge");
  ok("non-Basic header → challenge", dashboardAuthDecision({ ...cfg, authHeader: "Bearer x" }) === "challenge");
  ok("malformed base64 → challenge", dashboardAuthDecision({ ...cfg, authHeader: "Basic !!!" }) === "challenge");
  ok("wrong password → challenge", dashboardAuthDecision({ ...cfg, authHeader: basic("owner", "nope") }) === "challenge");
  ok("wrong user → challenge", dashboardAuthDecision({ ...cfg, authHeader: basic("nope", "s3cret") }) === "challenge");
  ok("correct creds → allow", dashboardAuthDecision({ ...cfg, authHeader: basic("owner", "s3cret") }) === "allow");
}

// Password containing colons survives (split on the first colon only).
{
  ok(
    "colon in password → allow",
    dashboardAuthDecision({ user: "owner", pass: "a:b:c", isVercel: true, authHeader: basic("owner", "a:b:c") }) ===
      "allow",
  );
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
