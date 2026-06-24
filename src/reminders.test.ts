// Proof driver — appointment reminders + re-engagement (todos 15/16).
// Run: npx tsx src/reminders.test.ts

import {
  scheduleAppointmentReminders,
  scheduleReengagement,
  registerReminderHandlers,
} from "./reminders";
import { drainQueue, resetQueue, dlqDepth } from "./queue";
import { resetStore, upsertLead, getLead } from "./store";
import { resetSpend } from "./spend";
import { resetCheckoutGuard, storeInFlightUrl, getInFlightUrl } from "./checkout-guard";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// Spy on customer emails by replacing the Composio path's effect: we set no
// COMPOSIO_API_KEY so sendCustomerEmail no-ops, and instead assert the handler
// RAN (status gate) via a state probe — but to count sends we register our own
// counter by monkeypatching is brittle; instead we count drained executions.

const NOW = 2_000_000_000_000; // fixed far-future epoch for determinism

async function main() {
  registerReminderHandlers();

  console.log("\n=== Reminders 1: booking enqueues day-before + morning-of ===");
  {
    resetQueue();
    resetStore([]);
    const visit = new Date(NOW + 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days out
    const r = await scheduleAppointmentReminders("LR1", visit, NOW);
    ok("two reminders enqueued", r.enqueued === 2, `enqueued=${r.enqueued}`);
  }

  console.log("\n=== Reminders 2: past-visit windows are not scheduled ===");
  {
    resetQueue();
    resetStore([]);
    const pastVisit = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    const r = await scheduleAppointmentReminders("LR2", pastVisit, NOW);
    ok("no reminders for a past visit", r.enqueued === 0, `enqueued=${r.enqueued}`);
  }

  console.log("\n=== Reminders 3: reminder handler runs once for a BOOKED lead (idempotent drain) ===");
  {
    resetQueue();
    resetStore([]);
    await upsertLead({ lead_id: "LR3", channel: "form", status: "BOOKED", customer_email: "c@x.com" });
    // Visit 5 days out → both day-before and morning-of windows are FUTURE at
    // schedule time (now), so both enqueue; draining past them executes them.
    const visit = new Date(NOW + 5 * 24 * 60 * 60 * 1000).toISOString();
    const sched = await scheduleAppointmentReminders("LR3", visit, NOW);
    const drainAt = Date.parse(visit) + 10 * 60 * 60 * 1000; // well after both windows
    const d1 = await drainQueue(drainAt);
    const d2 = await drainQueue(drainAt); // re-drain: dedup → no double send
    ok("both windows enqueued", sched.enqueued === 2, `enqueued=${sched.enqueued}`);
    ok("reminders executed on first drain", d1.executed >= 1, JSON.stringify(d1));
    ok("re-drain does not re-execute (dedup)", d2.executed === 0, JSON.stringify(d2));
    ok("no DLQ", (await dlqDepth("reminder")) === 0);
  }

  console.log("\n=== Reengagement 1: enqueues 3 nudges ===");
  {
    resetQueue();
    resetStore([]);
    resetSpend();
    const r = await scheduleReengagement("LR4", NOW);
    ok("three re-engagement jobs enqueued", r.enqueued === 3, `enqueued=${r.enqueued}`);
  }

  console.log("\n=== Reengagement 2: a paid lead's nudge no-ops at execute ===");
  {
    resetQueue();
    resetStore([]);
    resetSpend();
    await upsertLead({ lead_id: "LR5", channel: "form", status: "PAID", customer_email: "p@x.com" });
    await scheduleReengagement("LR5", NOW - 100 * 60 * 60 * 1000); // all 3 due now
    const d = await drainQueue(NOW);
    // Jobs are claimed + executed (handler runs) but the handler no-ops on PAID;
    // executed counts the drain, and there is no DLQ / error.
    ok("re-engagement jobs drained without error", d.failed === 0, JSON.stringify(d));
    ok("lead stays PAID (no side effect changed it)", (await getLead("LR5"))?.status === "PAID");
  }

  console.log("\n=== Reengagement 3: expired staged session → re-stage (clear in-flight) before email ===");
  {
    resetQueue();
    resetStore([]);
    resetSpend();
    resetCheckoutGuard();
    // Seed an in-flight URL for this purchase, then a lead carrying a staged
    // session id. With no STRIPE_SECRET_KEY, checkoutSessionExpired() returns
    // true → the handler must clear the in-flight key before emailing.
    await storeInFlightUrl("re@x.com", "signature", "weekly", "https://checkout.stripe.com/c/old");
    await upsertLead({
      lead_id: "LR6",
      channel: "form",
      status: "ACTIVE",
      customer_email: "re@x.com",
      staged_session_id: "cs_expired",
      staged_tier: "signature",
      staged_frequency: "weekly",
    });
    await scheduleReengagement("LR6", NOW - 100 * 60 * 60 * 1000);
    await drainQueue(NOW);
    const stillCached = await getInFlightUrl("re@x.com", "signature", "weekly");
    ok("expired session → in-flight key cleared (re-stage on next checkout)", stillCached === undefined, String(stillCached));
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
