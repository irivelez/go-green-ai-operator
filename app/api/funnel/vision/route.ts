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
import { photoCaps, photoByteSize } from "@/src/photo-cap";
import { checkRateLimit } from "@/src/spend";
import { clientIp } from "@/src/net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  photos: z.array(z.string()).max(6).default([]),
});

const NEGLECTED: VisionAssessment = {
  recommended_tier: "signature",
  confidence: 0.82,
  slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" },
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
  slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" },
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

  // Cost-bomb guard (cross-model review S8): the standalone vision route hits real
  // Anthropic vision — it MUST carry the same IP/global rate limit the agent route
  // has, or a hostile caller can hammer it directly. No-op without Upstash.
  const rate = await checkRateLimit(clientIp(req.headers, "vision-anon"));
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate_limited", scope: rate.scope }, { status: 429 });
  }

  // Belt-and-suspenders cap at analyze-time (todo 6): the primary count/byte cap
  // is at ingest, but the standalone vision route can be hit directly — trim to
  // the configured count + per-photo byte cap before the Anthropic call.
  const caps = photoCaps();
  const bounded = parsed.data.photos
    .filter((p) => photoByteSize(p) <= caps.maxBytesPerPhoto)
    .slice(0, caps.maxPhotos);

  // Real assessment. analyzeYardPhotos handles empty photos + missing key by
  // returning an honest low-confidence assessment (never throws).
  const assessment = await analyzeYardPhotos(bounded);
  return NextResponse.json(assessment);
}
