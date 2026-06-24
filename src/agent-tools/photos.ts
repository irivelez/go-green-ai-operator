// analyze_photos — moved verbatim from src/agent-tools.ts during the mechanical split.

import { z } from "zod";
import { analyzeYardPhotos, isAllowedPhoto } from "../vision";
import { upsertLead, getLead } from "../store";
import { type VisionAssessment } from "../contract";
import { type ToolContext } from "./shared";

export const AnalyzePhotosArgsSchema = z.object({
  photoUrls: z
    .array(z.string())
    .optional()
    .describe("Optional image URLs; omit to use the photos already on the lead"),
});

export async function runAnalyzePhotos(
  ctx: ToolContext,
  args: z.infer<typeof AnalyzePhotosArgsSchema>,
): Promise<VisionAssessment> {
  const existing = await getLead(ctx.leadId);
  // Prefer explicit urls; otherwise assess the photos already on the lead (the
  // client seeds them on upload, so the model needn't pass huge data: URLs).
  // Filter through isAllowedPhoto so a prompt-injected http/file URL is neither
  // sent to the model NOR persisted onto the lead (where a future renderer would
  // fetch it) — closes the sibling exfil vector to the funnel-route photo filter.
  const raw = args.photoUrls && args.photoUrls.length > 0 ? args.photoUrls : existing?.photos ?? [];
  const urls = raw.filter(isAllowedPhoto);
  const assessment = await analyzeYardPhotos(urls);
  await upsertLead({
    lead_id: ctx.leadId,
    channel: existing?.channel ?? "form",
    photos: urls,
    vision_assessment: assessment as unknown as Record<string, unknown>,
  });
  return assessment;
}
