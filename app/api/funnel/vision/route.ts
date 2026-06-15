// Real Claude vision via src/vision.analyzeYardPhotos.
// When ANTHROPIC_API_KEY is set, photos (URLs or data: URIs) are assessed by
// Claude. When it's absent, vision.ts returns an honest low-confidence stub.
// Escape hatches preserved for demo determinism:
//   ?mock=low-confidence → confidence 0.3 → funnel routes to human_review
//   ?mock=neglected      → cleanup forced into cart (§B2 gating)

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { VisionAssessment } from "@/src/contract";
import { analyzeYardPhotos } from "@/src/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  photos: z.array(z.string()).max(6).default([]),
});

const NEGLECTED: VisionAssessment = {
  recommended_tier: "signature",
  confidence: 0.82,
  yard_size_estimate: "medium",
  condition_score: 3,
  overgrowth: "high",
  weeds: "high",
  leaf_litter: "high",
  cleanup_required: true,
  cleanup_confidence: "high",
  detected_extras: ["one-time-cleanup", "mulch-refresh", "hedge-shaping"],
  notes: "Demo neglected assessment — cleanup forced into cart (§B2 gating).",
};

const LOW_CONFIDENCE: VisionAssessment = {
  recommended_tier: "signature",
  confidence: 0.3,
  yard_size_estimate: "medium",
  condition_score: 5,
  overgrowth: "medium",
  weeds: "medium",
  leaf_litter: "medium",
  cleanup_required: false,
  cleanup_confidence: "low",
  detected_extras: [],
  notes: "Demo low-confidence assessment — funnel routes to human_review.",
};

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const mock = new URL(req.url).searchParams.get("mock");
  if (mock === "low-confidence") return NextResponse.json(LOW_CONFIDENCE);
  if (mock === "neglected") return NextResponse.json(NEGLECTED);

  // Real assessment. analyzeYardPhotos handles empty photos + missing key by
  // returning an honest low-confidence assessment (never throws).
  const assessment = await analyzeYardPhotos(parsed.data.photos);
  return NextResponse.json(assessment);
}
