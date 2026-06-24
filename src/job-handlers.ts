// Job handler registry (todo 14 scaffold; populated by B15-B18).
//
// registerAllHandlers() wires every JobType to its handler + dedup stableKey.
// The drain route calls it once per invocation (registration is idempotent — the
// queue's handler Map just re-sets the same entries). Handlers are added as their
// owning todos land:
//   - reminder / reengagement  → todos 15/16 (src/reminders.ts)
//   - escalation               → todo 17 (src/notify.ts queue push)
//   - escalation_sweep         → todo 9 sweep, cron-driven here
//   - cost_alarm_check         → todo 11 cost alarm, cron-driven here
//   - gcal_export              → todo 18 (src/calendar.ts)

import { registerHandler } from "./queue";
import { sweepEscalations } from "./hitl";
import { checkCostAlarm } from "./log";
import { registerReminderHandlers } from "./reminders";
import { deliverOwnerEscalation, type EscalationAlert } from "./notify";
import { exportTodaysVisits } from "./calendar";

let registered = false;

export function registerAllHandlers(): void {
  if (registered) return;
  registered = true;

  // Reminder + re-engagement handlers (todos 15/16).
  registerReminderHandlers();

  // Owner escalation push (todo 17): Telegram + email, deduped (lead,reason,day),
  // retried via the queue → DLQ on terminal failure.
  registerHandler("escalation", {
    run: async (payload) => {
      await deliverOwnerEscalation(payload as unknown as EscalationAlert);
    },
    stableKey: (p) => `escalation:${p.lead_id}:${p.reason}:${new Date().toISOString().slice(0, 10)}`,
  });

  // Escalation timeout sweep (todo 9): one job per day-bucket; dedup on the date.
  registerHandler("escalation_sweep", {
    run: async () => {
      await sweepEscalations();
    },
    stableKey: () => `sweep:${new Date().toISOString().slice(0, 13)}`, // hourly bucket
  });

  // Daily cost alarm check (todo 11).
  registerHandler("cost_alarm_check", {
    run: async () => {
      await checkCostAlarm();
    },
    stableKey: () => `cost:${new Date().toISOString().slice(0, 13)}`,
  });

  // Daily one-way GCal export (todo 18): dedup on the calendar date.
  registerHandler("gcal_export", {
    run: async () => {
      await exportTodaysVisits();
    },
    stableKey: () => `gcal:${new Date().toISOString().slice(0, 10)}`,
  });
}

// Test-only: reset the registered flag so a test can re-register fresh handlers.
export function resetHandlerRegistration(): void {
  registered = false;
}
