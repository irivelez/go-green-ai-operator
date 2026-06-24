// Appointment reminders + abandoned re-engagement (todos 15/16).
//
// On confirm_booking we enqueue two reminder jobs (day-before, morning-of). The
// queue (todo 14) drives delivery; the handler sends a customer email via
// Composio Gmail (src/notify.ts). Idempotency is the queue's per-handler
// dedup key (reminder:{leadId}:{type}:{date}) so a duplicate drain sends once.
// The LLM never decides WHEN — enqueue time + cron decide (deterministic).
//
// Re-engagement (todo 16) lives here too: +1h/+24h/+72h resume emails for a lead
// that went quiet pre-payment, cancelled at-execute by a state check, reusing the
// staged Checkout URL (re-staged if the Stripe session expired).

import { enqueue, registerHandler } from "./queue";
import { getLead } from "./store";
import { sendCustomerEmail } from "./notify";
import { chargeReengagement } from "./spend";
import { checkoutSessionExpired } from "./stripe";
import { clearInFlight } from "./checkout-guard";

const HOUR_MS = 60 * 60 * 1000;

// Local-day 8am for the morning-of reminder, derived from the visit ISO.
function morningOf(visitIso: string): number {
  const d = new Date(visitIso);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

// Enqueue day-before + morning-of reminders for a booked visit.
export async function scheduleAppointmentReminders(
  leadId: string,
  visitIso: string,
  now = Date.now(),
): Promise<{ enqueued: number }> {
  const visitMs = Date.parse(visitIso);
  if (!Number.isFinite(visitMs)) return { enqueued: 0 };
  let enqueued = 0;
  const dayBefore = visitMs - 24 * HOUR_MS;
  const morning = morningOf(visitIso);
  // Only schedule reminders that are still in the future.
  if (dayBefore > now) {
    await enqueue("reminder", { leadId, kind: "day_before", visitIso }, dayBefore);
    enqueued++;
  }
  if (morning > now) {
    await enqueue("reminder", { leadId, kind: "morning_of", visitIso }, morning);
    enqueued++;
  }
  return { enqueued };
}

function reminderBody(kind: string, visitIso: string): { subject: string; body: string } {
  const when = new Date(visitIso).toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (kind === "morning_of") {
    return {
      subject: "Your Go Green crew arrives today",
      body: `Good morning! Your Go Green Landscape crew is scheduled for today, ${when}. We'll see you soon.`,
    };
  }
  return {
    subject: "Reminder: your Go Green visit is tomorrow",
    body: `A friendly reminder that your Go Green Landscape maintenance visit is scheduled for ${when}. Reply if anything's changed.`,
  };
}

// Re-engagement (todo 16): three nudges for an abandoned pre-payment lead.
export async function scheduleReengagement(
  leadId: string,
  now = Date.now(),
): Promise<{ enqueued: number }> {
  await enqueue("reengagement", { leadId, step: "1h" }, now + 1 * HOUR_MS);
  await enqueue("reengagement", { leadId, step: "24h" }, now + 24 * HOUR_MS);
  await enqueue("reengagement", { leadId, step: "72h" }, now + 72 * HOUR_MS);
  return { enqueued: 3 };
}

const RESUME_BASE = process.env.AGENT_RESUME_URL ?? "http://localhost:3000/agent";

function resumeLink(leadId: string): string {
  return `${RESUME_BASE}?lead=${encodeURIComponent(leadId)}`;
}

// Terminal states where a re-engagement nudge must NOT fire (Momus S6: cancel via
// at-execute state check, not per-job-id tracking).
const REENGAGE_DEAD_STATES = new Set(["PAID", "BOOKED", "DEAD", "ABANDONED"]);

export function registerReminderHandlers(): void {
  registerHandler("reminder", {
    run: async (payload) => {
      const leadId = String(payload.leadId);
      const kind = String(payload.kind);
      const visitIso = String(payload.visitIso);
      const lead = await getLead(leadId);
      if (!lead?.customer_email) return;
      // Only remind for a still-booked visit.
      if (lead.status !== "BOOKED") return;
      const { subject, body } = reminderBody(kind, visitIso);
      await sendCustomerEmail(lead.customer_email, subject, body);
    },
    stableKey: (p) =>
      `reminder:${p.leadId}:${p.kind}:${new Date(String(p.visitIso)).toISOString().slice(0, 10)}`,
  });

  registerHandler("reengagement", {
    run: async (payload) => {
      const leadId = String(payload.leadId);
      const lead = await getLead(leadId);
      if (!lead?.customer_email) return;
      // At-execute cancellation: a paid/booked/dead/abandoned lead gets no nudge.
      if (REENGAGE_DEAD_STATES.has(lead.status)) return;
      // Spend cap on re-engagement emails (todo 5).
      const allowed = await chargeReengagement(lead.customer_email);
      if (!allowed.allowed) return;
      // If a Checkout was staged and has since expired (Stripe sessions live
      // ~24h, this email may be the +24h/+72h nudge), re-stage a fresh one so the
      // resume link is never dead (Oracle Fix3). Re-staging clears A7's stale
      // in-flight key so the next propose_checkout creates a live session.
      if (lead.staged_session_id && lead.staged_tier && lead.staged_frequency) {
        if (await checkoutSessionExpired(lead.staged_session_id)) {
          await clearInFlight(lead.customer_email, lead.staged_tier, lead.staged_frequency);
        }
      }
      await sendCustomerEmail(
        lead.customer_email,
        "Still want your yard handled?",
        `You were a few steps from booking your Go Green Landscape service. Pick up where you left off: ${resumeLink(leadId)}`,
      );
    },
    stableKey: (p) => `reengage:${p.leadId}:${p.step}`,
  });
}
