// Agent SDK harness — the brain (spec §4.4, §5). STAGED: needs ANTHROPIC_API_KEY + npm install.
// The autonomy model maps onto native primitives: canUseTool = the escalation gate;
// allowedTools = business-tools-only (Bash/file off); systemPrompt = Master Prompt.
//
// Verify the exact tool()/createSdkMcpServer signatures against the installed SDK before
// the live run — the business logic in tools.ts is final; this is the glue.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import { checkEscalation } from "./escalation.js";

export interface RunLeadInput {
  lead_id: string;
  channel: "telegram" | "email" | "whatsapp" | "form";
  inbound_text: string;
  photo_urls?: string[];
}

// One lead = one resumable Agent SDK session.
export async function runLead(input: RunLeadInput, sessionId?: string) {
  // Pre-gate: a flagged case never reaches client-facing tools.
  const esc = checkEscalation({ inbound_text: input.inbound_text });

  const result = query({
    prompt: input.inbound_text,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: "claude-sonnet-4-6",
      // Business tools only — the SDK's default Bash/Read/Write stay OFF.
      allowedTools: [
        "mcp__gogreen__geo_qualify", "mcp__gogreen__score_lead",
        "mcp__gogreen__quote_range", "mcp__gogreen__book_evaluation",
        "mcp__gogreen__create_work_order", "mcp__gogreen__raise_escalation",
      ],
      permissionMode: "default",
      // The escalation gate IS this callback (spec §4.4).
      canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
        const clientFacing = ["book_evaluation", "send_message"].some((t) => toolName.includes(t));
        if (esc.escalate && clientFacing) {
          return { behavior: "deny" as const, message: `escalated: ${esc.reasons.join(", ")}` };
        }
        return { behavior: "allow" as const, updatedInput: toolInput };
      },
      ...(sessionId ? { resume: sessionId } : {}),
      maxTurns: 12,
    },
  });

  for await (const msg of result) {
    if (msg.type === "result") return msg;
  }
}
