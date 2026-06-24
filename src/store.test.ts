// Store config-safety test — the Vercel production-backend guard.
// Run: npx tsx src/store.test.ts  (no keys; importing ./store must not throw here
// because the test process has no VERCEL env → pickBackend() picks memory).

import { prodStoreBackendError } from "./store";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== Store production-backend guard ===");

// Off Vercel (local dev / CI / tests): never enforce, regardless of mode.
{
  ok("no VERCEL → null (memory)", prodStoreBackendError({}) === null);
  ok("no VERCEL → null (json)", prodStoreBackendError({ LEADS_DB_PATH: ".dev-data/leads.json" }) === null);
  ok("no VERCEL → null (explicit json)", prodStoreBackendError({ STORE_BACKEND: "json" }) === null);
}

// On Vercel: only kv is safe; everything else is a loud, actionable error.
{
  ok("VERCEL + kv → null", prodStoreBackendError({ VERCEL: "1", STORE_BACKEND: "kv" }) === null);
}
{
  const e = prodStoreBackendError({ VERCEL: "1" }); // defaults to memory
  ok("VERCEL + default(memory) → error", e !== null);
  ok("error names STORE_BACKEND", !!e && e.includes("STORE_BACKEND"));
  ok("error names the bad mode", !!e && e.includes('"memory"'));
}
{
  const e = prodStoreBackendError({ VERCEL: "1", STORE_BACKEND: "json" });
  ok("VERCEL + json → error", e !== null);
  ok("error names json", !!e && e.includes('"json"'));
}
{
  // LEADS_DB_PATH set but no STORE_BACKEND infers json → still unsafe on Vercel.
  const e = prodStoreBackendError({ VERCEL: "1", LEADS_DB_PATH: "/tmp/leads.json" });
  ok("VERCEL + inferred json → error", e !== null && e.includes('"json"'));
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
