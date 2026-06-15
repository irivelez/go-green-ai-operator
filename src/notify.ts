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
