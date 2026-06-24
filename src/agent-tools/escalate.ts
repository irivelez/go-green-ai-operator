// raise_escalation — moved verbatim from src/agent-tools.ts during the mechanical split.

import { z } from "zod";
import { upsertLead, getLead } from "../store";
import { type ToolContext } from "./shared";

export interface RaiseEscalationResult {
  escalated: true;
  autoChargeBlocked: true;
  primary: string;
  flags: string[];
  brief: string;
}

export const RaiseEscalationArgsSchema = z.object({
  primary: z.string().describe("Primary escalation reason"),
  flags: z.array(z.string()).default([]),
  brief: z.string().describe("Complete, self-contained handoff brief for the human reviewer"),
});

export async function runRaiseEscalation(
  ctx: ToolContext,
  args: z.infer<typeof RaiseEscalationArgsSchema>,
): Promise<RaiseEscalationResult> {
  const existing = await getLead(ctx.leadId);
  await upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    status: "Needs Human Review",
    escalation_reason: args.primary,
    internal_notes: [existing?.internal_notes, `ESCALATION (${args.primary}): ${args.brief}`]
      .filter(Boolean)
      .join("\n"),
  });
  return {
    escalated: true,
    autoChargeBlocked: true,
    primary: args.primary,
    flags: args.flags,
    brief: args.brief,
  };
}
