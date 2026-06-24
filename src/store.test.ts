// Proof driver — per-field-atomic store (todo 1).
// Hermetic: resetStore([]) + resetEvents() at the top of every scenario.
// Run: npx tsx src/store.test.ts
//
// The reliability gate: concurrent distinct-field writers must NOT lose each
// other's writes (the old whole-lead RMW race), the idempotency ledger must be
// exactly-once under concurrency, and a digit-only string field must round-trip
// as a string (not coerce to a number).

import { resetStore, upsertLead, getLead, actionSeen, type LeadStatus } from "./store";
import { resetEvents, appendEvent, listEvents } from "./events";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  console.log("\n=== Store 1: CONCURRENT DISTINCT-FIELD WRITES (no lost write) ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({ lead_id: "S1", channel: "form" });
    await Promise.all([
      upsertLead({ lead_id: "S1", channel: "form", status: "PAID" }),
      upsertLead({ lead_id: "S1", channel: "form", confirmed_sqft: 2500 }),
    ]);
    const lead = await getLead("S1");
    ok("status survives the concurrent write", lead?.status === "PAID", lead?.status);
    ok("confirmed_sqft survives the concurrent write", lead?.confirmed_sqft === 2500, String(lead?.confirmed_sqft));
  }

  console.log("\n=== Store 2: IDEMPOTENCY LEDGER exactly-once under concurrency ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({ lead_id: "S2", channel: "form" });
    const payload = { sessionId: "sess_abc" };
    const results = await Promise.all([
      actionSeen("S2", "stripe.paid", payload),
      actionSeen("S2", "stripe.paid", payload),
      actionSeen("S2", "stripe.paid", payload),
      upsertLead({ lead_id: "S2", channel: "form", status: "PAID" }),
    ]);
    const seenCount = results.filter((r) => r === true).length;
    // First actionSeen returns false (new); the other two return true (already seen).
    ok("ledger records the action exactly once (2 of 3 see it)", seenCount === 2, `seenCount=${seenCount}`);
    const lead = await getLead("S2");
    ok("status PAID survives concurrent ledger writes", lead?.status === "PAID", lead?.status);
  }

  console.log("\n=== Store 3: HGETALL string-coercion contract (internal_notes='42' stays string) ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({ lead_id: "S3", channel: "form", internal_notes: "42" });
    const lead = await getLead("S3");
    ok("digit-only internal_notes stays a STRING", typeof lead?.internal_notes === "string", typeof lead?.internal_notes);
    ok("internal_notes value === '42'", lead?.internal_notes === "42", JSON.stringify(lead?.internal_notes));
  }

  console.log("\n=== Store 4: STATUS ENUM is the canonical 7-value set ===");
  {
    resetStore([]);
    resetEvents();
    const canonical: LeadStatus[] = ["ACTIVE", "PAUSED", "ESCALATED", "PAID", "BOOKED", "ABANDONED", "DEAD"];
    for (const s of canonical) {
      await upsertLead({ lead_id: `S4-${s}`, channel: "form", status: s });
      const lead = await getLead(`S4-${s}`);
      ok(`status ${s} round-trips`, lead?.status === s, lead?.status);
    }
  }

  console.log("\n=== Store 5: LENIENT READER migrates a legacy literal on load ===");
  {
    // Seed a lead carrying an OLD literal directly (simulating a stale store);
    // the reader must normalize it to the canonical value.
    resetStore([
      {
        lead_id: "S5",
        channel: "form",
        photos: [],
        // @ts-expect-error — intentionally seeding a legacy literal to prove migration
        status: "Needs Human Review",
        created_at: new Date().toISOString(),
      },
    ]);
    resetEvents();
    const lead = await getLead("S5");
    ok("legacy 'Needs Human Review' migrates to ESCALATED", lead?.status === "ESCALATED", lead?.status);
  }

  console.log("\n=== Store 6: NESTED FIELD round-trips (price_range, photos) ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({
      lead_id: "S6",
      channel: "form",
      photos: ["a.jpg", "b.jpg"],
      price_range: { low: 155, high: 190 },
    });
    const lead = await getLead("S6");
    ok("photos array round-trips", Array.isArray(lead?.photos) && lead?.photos.length === 2, JSON.stringify(lead?.photos));
    ok("price_range object round-trips", lead?.price_range?.low === 155 && lead?.price_range?.high === 190, JSON.stringify(lead?.price_range));
  }

  console.log("\n=== Store 6b: explicit-undefined field CLEARS it (Oracle B1 — clearStaleGeo) ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({
      lead_id: "S6b",
      channel: "form",
      address_number: "742",
      street_name: "Valencia",
      street_type: "St",
      lat: 37.76,
      lng: -122.42,
    });
    const before = await getLead("S6b");
    ok("geo parts seeded", before?.address_number === "742" && before?.lat === 37.76);
    // Explicit undefined → CLEAR (mirrors clearStaleGeo on a failed re-validate).
    await upsertLead({
      lead_id: "S6b",
      channel: "form",
      address_number: undefined,
      street_name: undefined,
      street_type: undefined,
      lat: undefined,
      lng: undefined,
    });
    const after = await getLead("S6b");
    ok("address_number cleared", after?.address_number === undefined, String(after?.address_number));
    ok("street_name cleared", after?.street_name === undefined, String(after?.street_name));
    ok("lat cleared", after?.lat === undefined, String(after?.lat));
    ok("lng cleared", after?.lng === undefined, String(after?.lng));
    // A field NOT mentioned in the clear write must survive.
    ok("channel (untouched) survives the clear", after?.channel === "form", after?.channel);
  }

  console.log("\n=== Store 7: EVENT STREAM survives concurrent lead upsert (todo 3) ===");
  {
    resetStore([]);
    resetEvents();
    await upsertLead({ lead_id: "S7", channel: "form" });
    await Promise.all([
      appendEvent("S7", { actor: "owner", action: "e1" }),
      appendEvent("S7", { actor: "agent", action: "e2" }),
      appendEvent("S7", { actor: "system", action: "e3" }),
      upsertLead({ lead_id: "S7", channel: "form", confirmed_sqft: 1800 }),
    ]);
    const events = await listEvents("S7");
    const lead = await getLead("S7");
    ok("all 3 events persisted despite concurrent upsert", events.length === 3, `got ${events.length}`);
    ok("concurrent lead field survives", lead?.confirmed_sqft === 1800, String(lead?.confirmed_sqft));
    ok("listEvents on a lead with no events returns []", (await listEvents("S-none")).length === 0);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
