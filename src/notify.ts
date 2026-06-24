// Owner escalation alerts via Composio → Gmail (GMAIL_SEND_EMAIL).
// Deterministic, fire-and-forget: when a lead is flagged for human review, the
// business owner gets an email. Key-guarded so tests + the zero-key demo stay green:
//   - no COMPOSIO_API_KEY or no GO_GREEN_OWNER_EMAIL → silent no-op.
//   - any failure is swallowed (logged) — a notification must NEVER break the funnel.

import { Composio } from "@composio/core";
import type { Lead } from "./store";

let _client: Composio | null = null;
function client(apiKey: string): Composio {
  if (!_client) _client = new Composio({ apiKey });
  return _client;
}

export interface EscalationAlert {
  lead_id: string;
  channel: Lead["channel"];
  reason: string;
  brief: string;
}

function buildBody(a: EscalationAlert): string {
  return [
    `A Go Green lead has been flagged for human review.`,
    ``,
    `Lead:     ${a.lead_id}`,
    `Channel:  ${a.channel}`,
    `Reason:   ${a.reason}`,
    ``,
    `Details:`,
    a.brief || "(none)",
    ``,
    `Open the operator dashboard to take over this lead.`,
    `— Go Green AI Operator`,
  ].join("\n");
}

// Returns true if an email was sent, false if skipped/failed. Never throws.
export async function notifyOwnerEscalation(a: EscalationAlert): Promise<boolean> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const to = process.env.GO_GREEN_OWNER_EMAIL;
  const userId = process.env.COMPOSIO_USER_ID || "default";
  if (!apiKey || !to) return false; // zero-key / unconfigured → no-op (tests stay green)

  try {
    const res = await client(apiKey).tools.execute("GMAIL_SEND_EMAIL", {
      userId,
      arguments: {
        recipient_email: to,
        subject: `🚨 Lead needs review: ${a.lead_id} — ${a.reason}`,
        body: buildBody(a),
      },
    });
    if (!res.successful) {
      console.error("[notify] GMAIL_SEND_EMAIL failed:", res.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notify] escalation email error:", (e as Error).message);
    return false;
  }
}

// Enqueue an owner-escalation push onto the durable queue (todo 17) so a failed
// send retries → DLQ instead of being lost (the old fire-and-forget path). Dedup
// is the queue's per-handler key (lead,reason,day) so the owner isn't spammed.
export async function enqueueOwnerEscalation(a: EscalationAlert): Promise<void> {
  // Lazy import to avoid a static cycle (queue → handlers → notify).
  const { enqueue } = await import("./queue");
  await enqueue("escalation", { ...a }, Date.now());
}

// The escalation job handler (registered in job-handlers.ts). Sends Telegram +
// email; throws on total failure so the queue retries → DLQ.
export async function deliverOwnerEscalation(a: EscalationAlert): Promise<void> {
  const sentEmail = await notifyOwnerEscalation(a);
  const sentTelegram = await notifyOwnerTelegram(
    `🚨 Lead ${a.lead_id} needs review — ${a.reason}\n${a.brief}`.slice(0, 600),
  );
  // If BOTH channels are configured-and-failed, throw so the queue retries.
  // When neither is configured (zero-key dev), both return false → treat as a
  // no-op success (nothing to retry).
  const emailConfigured = !!process.env.COMPOSIO_API_KEY && !!process.env.GO_GREEN_OWNER_EMAIL;
  const telegramConfigured = !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_OWNER_CHAT_ID;
  const anyConfigured = emailConfigured || telegramConfigured;
  if (anyConfigured && !sentEmail && !sentTelegram) {
    throw new Error(`owner escalation push failed for lead ${a.lead_id} (all configured channels failed)`);
  }
}

// Owner Telegram push (todo 17). Key-guarded + never throws. Returns true if sent.
export async function notifyOwnerTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok;
  } catch (e) {
    console.error("[notify] owner telegram error:", (e as Error).message);
    return false;
  }
}

// Generic customer email (reminders, re-engagement). Key-guarded + never throws.
// Returns true if sent, false if skipped/failed.
export async function sendCustomerEmail(to: string, subject: string, body: string): Promise<boolean> {
  const apiKey = process.env.COMPOSIO_API_KEY;
  const userId = process.env.COMPOSIO_USER_ID || "default";
  if (!apiKey || !to) return false;
  try {
    const res = await client(apiKey).tools.execute("GMAIL_SEND_EMAIL", {
      userId,
      arguments: { recipient_email: to, subject, body },
    });
    if (!res.successful) {
      console.error("[notify] customer email failed:", res.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notify] customer email error:", (e as Error).message);
    return false;
  }
}
