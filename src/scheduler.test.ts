// Proof driver — slot generation + booking + waitlist gate.
// Hermetic: resetSlots() + resetStore([]) at the top of every scenario.
// Run: npx tsx src/scheduler.test.ts

import {
  generateSlots,
  availableSlots,
  bookSlot,
  noSlotsInWindow,
  resetSlots,
} from "./scheduler";
import { resetStore, upsertLead } from "./store";

// Fixed reference date for determinism:
// 2026-06-14 is a Sunday (UTC) → first Thursday on/after is 2026-06-18.
const FROM = new Date("2026-06-14T00:00:00Z");

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== Scheduler 1: GENERATION (Sun 2026-06-14 → first Thu 2026-06-18) ===");
{
  resetSlots();
  resetStore([]);
  const slots = generateSlots(FROM);
  ok("first slotId === 2026-06-18-T1", slots[0]?.slotId === "2026-06-18-T1", slots[0]?.slotId);
  ok("first slot date === 2026-06-18", slots[0]?.date === "2026-06-18");
  ok("first slot crewSize === 2", slots[0]?.crewSize === 2);
  ok("first slot available === true", slots[0]?.available === true);
  ok(
    "first slot startTime is local ISO 08:00",
    slots[0]?.startTime === "2026-06-18T08:00:00",
    slots[0]?.startTime,
  );
  ok(
    "first slot endTime is local ISO 10:00",
    slots[0]?.endTime === "2026-06-18T10:00:00",
    slots[0]?.endTime,
  );

  // every date is within the 14-day serve window [FROM, FROM+14)
  const windowEnd = new Date(FROM);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 14);
  const allInWindow = slots.every((s) => {
    const d = new Date(s.date + "T00:00:00Z");
    return d.getTime() >= FROM.getTime() && d.getTime() < windowEnd.getTime();
  });
  ok("every date is within 14 days of fromDate", allInWindow);

  // all slotIds unique
  const ids = new Set(slots.map((s) => s.slotId));
  ok("all slotIds unique", ids.size === slots.length, `${ids.size}/${slots.length}`);

  // each date has exactly 4 slots
  const byDate: Record<string, number> = {};
  for (const s of slots) byDate[s.date] = (byDate[s.date] ?? 0) + 1;
  const everyDateFour = Object.values(byDate).every((c) => c === 4);
  ok("each date has exactly 4 slots", everyDateFour);

  // count === (days with slots) × 4
  const dayCount = Object.keys(byDate).length;
  ok(
    `count === ${dayCount} days × 4 = ${dayCount * 4} (got ${slots.length})`,
    slots.length === dayCount * 4,
  );

  // slot id pattern T1..T4 only
  const validIdShape = slots.every((s) => /^\d{4}-\d{2}-\d{2}-T[1-4]$/.test(s.slotId));
  ok("all slotIds match pattern YYYY-MM-DD-T{1..4}", validIdShape);
}

console.log("\n=== Scheduler 2: BOOK + TAKEN (different lead, same slot) ===");
{
  resetSlots();
  resetStore([]);
  upsertLead({ lead_id: "LA", channel: "telegram" });
  upsertLead({ lead_id: "LB", channel: "telegram" });

  const r1 = bookSlot("LA", "2026-06-18-T1", FROM);
  ok("LA books 2026-06-18-T1 ok", r1.ok === true);
  ok(
    "returned slot.slotId matches",
    r1.ok === true && r1.slot.slotId === "2026-06-18-T1",
  );

  const r2 = bookSlot("LB", "2026-06-18-T1", FROM);
  ok("LB → taken", r2.ok === false && r2.reason === "taken", JSON.stringify(r2));
}

console.log("\n=== Scheduler 3: OUT OF WINDOW ===");
{
  resetSlots();
  resetStore([]);
  upsertLead({ lead_id: "LC", channel: "telegram" });
  const r = bookSlot("LC", "2099-01-01-T1", FROM);
  ok(
    "2099 slot → out_of_window",
    r.ok === false && r.reason === "out_of_window",
    JSON.stringify(r),
  );
}

console.log("\n=== Scheduler 3b: LEAD MISSING ===");
{
  resetSlots();
  resetStore([]);
  const r = bookSlot("nope", "2026-06-18-T1", FROM);
  ok(
    "unknown lead → lead_missing",
    r.ok === false && r.reason === "lead_missing",
    JSON.stringify(r),
  );
}

console.log("\n=== Scheduler 4: IDEMPOTENT (same lead, same slot, twice) ===");
{
  resetSlots();
  resetStore([]);
  upsertLead({ lead_id: "LD", channel: "telegram" });

  const r1 = bookSlot("LD", "2026-06-18-T2", FROM);
  const r2 = bookSlot("LD", "2026-06-18-T2", FROM);
  ok("first call ok", r1.ok === true);
  ok("second call ok (idempotent)", r2.ok === true);
  ok(
    "second call returns same slot",
    r1.ok && r2.ok && r1.slot.slotId === r2.slot.slotId,
  );

  // Ledger has exactly 1 booking → total − available === 1
  const total = generateSlots(FROM).length;
  const avail = availableSlots("X", FROM).length;
  ok(
    "ledger has 1 booking (total − available === 1)",
    total - avail === 1,
    `total=${total} avail=${avail}`,
  );
}

console.log("\n=== Scheduler 5: WAITLIST GATE (all slots booked) ===");
{
  resetSlots();
  resetStore([]);
  upsertLead({ lead_id: "LE", channel: "telegram" });

  const slots = generateSlots(FROM);
  for (const s of slots) bookSlot("LE", s.slotId, FROM);
  ok("availableSlots empty", availableSlots("LF", FROM).length === 0);
  ok("noSlotsInWindow === true", noSlotsInWindow(FROM) === true);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
