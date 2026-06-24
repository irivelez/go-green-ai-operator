// qualify_lead — moved verbatim from src/agent-tools.ts during the mechanical split.

import { z } from "zod";
import { geoQualify, scoreLead } from "../qualify";
import { upsertLead, getLead } from "../store";
import { type ToolContext, FrequencyEnum } from "./shared";

export interface QualifyResult {
  inArea: boolean;
  zone: string | null;
  score: "A" | "B" | "C";
  risk: string;
  reasons: string[];
  escalate: boolean;
}

export const QualifyArgsSchema = z.object({
  address: z.string().optional().describe("Full service address including ZIP if known"),
  frequency: FrequencyEnum.optional().describe("Desired service frequency"),
  hasPhotos: z.boolean().optional().describe("Whether the customer has provided yard photos"),
});

export async function runQualify(ctx: ToolContext, args: z.infer<typeof QualifyArgsSchema>): Promise<QualifyResult> {
  const geo = geoQualify({ address: args.address });
  const score = scoreLead(
    {
      address: args.address,
      property_type: "residential",
      has_photos: args.hasPhotos,
      desired_frequency: args.frequency,
    },
    geo,
  );
  const escalate = !geo.in_area || score.score === "C";

  const existing = await getLead(ctx.leadId);
  await upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    address: args.address ?? existing?.address,
    zone: geo.zone,
    desired_frequency: args.frequency ?? existing?.desired_frequency,
    lead_score: score.score,
    risk_level: score.risk,
    status: escalate ? (existing?.status ?? "New Lead") : "AI Qualified",
  });

  return {
    inArea: geo.in_area,
    zone: geo.zone,
    score: score.score,
    risk: score.risk,
    reasons: [geo.reason, ...score.reasons],
    escalate,
  };
}
