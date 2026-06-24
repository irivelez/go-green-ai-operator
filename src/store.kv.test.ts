// OPT-IN KV integration smoke test (cross-model review S12).
//
// The whole suite runs the MEMORY backend, so the production-critical Upstash
// paths (per-field HSET/HDEL, action ledger SADD/SISMEMBER, customer HSETNX) are
// otherwise unexercised — exactly the "passes in memory, breaks on KV" bug class
// the build is most exposed to. This driver hits the REAL public store API with
// STORE_BACKEND=kv so the KvBackend code path is proven against a live Upstash.
//
// It is OPT-IN: with no Upstash env vars it prints SKIP and exits 0, so the
// keyless gate (npm test / CI) never depends on it. Run against a throwaway
// Upstash db with:
//   STORE_BACKEND=kv UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     npx tsx src/store.kv.test.ts
//
// Every key it touches is namespaced with a unique run id and DELETED at the end.

const hasUpstash =
  !!(process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL) &&
  !!(process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN);

if (!hasUpstash || process.env.STORE_BACKEND !== "kv") {
  console.log(
    "\n=== Store-KV: SKIPPED (set STORE_BACKEND=kv + UPSTASH_REDIS_REST_URL/_TOKEN to run) ===\n",
  );
  process.exit(0);
}

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  const { upsertLead, getLead, actionSeen, actionAlreadySeen } = await import("./store");
  const { materializeCustomer, lookupCustomerByEmail } = await import("./customer");
  const { Redis } = await import("@upstash/redis");

  const redis = new Redis({
    url: (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)!,
    token: (process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN)!,
  });

  const runId = `kvtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const leadId = `${runId}-lead`;
  const email = `${runId}@example.com`;
  const cleanup = [`lead:${leadId}`, `actions:${leadId}`, `customer:${email}`];

  try {
    console.log("\n=== Store-KV 1: per-field HSET — distinct-field writers both survive ===");
    {
      await upsertLead({ lead_id: leadId, channel: "form", confirmed_sqft: 1200 });
      await upsertLead({ lead_id: leadId, channel: "form", status: "PAID" });
      const lead = await getLead(leadId);
      ok("confirmed_sqft survived the second write", lead?.confirmed_sqft === 1200, JSON.stringify(lead?.confirmed_sqft));
      ok("status was applied", lead?.status === "PAID", lead?.status);
    }

    console.log("\n=== Store-KV 2: HDEL — undefined field is a CLEAR on KV ===");
    {
      await upsertLead({ lead_id: leadId, channel: "form", internal_notes: "scratch" });
      const before = await getLead(leadId);
      await upsertLead({ lead_id: leadId, channel: "form", internal_notes: undefined });
      const after = await getLead(leadId);
      ok("note was set first", before?.internal_notes === "scratch");
      ok("undefined cleared the field (HDEL)", after?.internal_notes === undefined, JSON.stringify(after?.internal_notes));
    }

    console.log("\n=== Store-KV 3: scalar string field round-trips as a string (no coercion) ===");
    {
      await upsertLead({ lead_id: leadId, channel: "form", internal_notes: "42" });
      const lead = await getLead(leadId);
      ok('internal_notes "42" stays a string', lead?.internal_notes === "42" && typeof lead?.internal_notes === "string");
    }

    console.log("\n=== Store-KV 4: action ledger — SADD returns seen=false first, true on replay ===");
    {
      const first = await actionSeen(leadId, "send_quote", { v: 1 });
      const second = await actionSeen(leadId, "send_quote", { v: 1 });
      ok("first fire not seen", first === false);
      ok("replay seen (atomic SADD)", second === true);
      const peek = await actionAlreadySeen(leadId, "send_quote", { v: 1 });
      ok("read-only SISMEMBER sees it without marking", peek === true);
      const unseen = await actionAlreadySeen(leadId, "send_quote", { v: 2 });
      ok("a different payload is not seen", unseen === false);
    }

    console.log("\n=== Store-KV 5: customer HSETNX — createdAt stable, updatedAt bumps ===");
    {
      const c1 = await materializeCustomer(email, { address: "1 A St", sqft: 1000 });
      await new Promise((r) => setTimeout(r, 5));
      const c2 = await materializeCustomer(email, { sqft: 1500 });
      ok("createdAt is stable across upserts (HSETNX)", c1.createdAt === c2.createdAt, `${c1.createdAt} vs ${c2.createdAt}`);
      ok("updatedAt advanced", c2.updatedAt >= c1.updatedAt);
      ok("address preserved from the first write", c2.address === "1 A St", c2.address);
      ok("sqft overwritten by the second write", c2.sqft === 1500, String(c2.sqft));
      const looked = await lookupCustomerByEmail(email);
      ok("lookup re-hydrates from HGETALL", looked?.sqft === 1500 && looked?.email === email);
    }
  } finally {
    await redis.del(...cleanup);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
