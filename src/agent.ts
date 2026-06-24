// Backward-compat shim for the staged Telegram entrypoint (src/index.ts).
//
// The web-funnel orchestrator (runFunnelAgent) and the Agent-SDK runtime were retired
// in the web-funnel pivot — that reasoning surface now lives in app/agent + src/agent-tools.ts.
// What remains here is the legacy Telegram path: route the call through the deterministic
// operator so index.ts keeps typechecking and running WITHOUT the serverless-incompatible
// claude-agent-sdk.

import { runOperator } from "./operator";

export interface RunLeadInput {
  lead_id: string;
  channel: "telegram" | "email" | "whatsapp" | "form";
  inbound_text: string;
  photo_urls?: string[];
}

/** @deprecated Legacy Telegram path. The web funnel lives in app/agent + src/agent-tools.ts. */
export async function runLead(input: RunLeadInput): Promise<{ result: string }> {
  const res = await runOperator({
    lead_id: input.lead_id,
    channel: input.channel,
    text: input.inbound_text,
    has_photo: (input.photo_urls?.length ?? 0) > 0,
  });
  return { result: res.reply };
}
