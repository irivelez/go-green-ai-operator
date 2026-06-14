// Claude-native yard photo vision.
//
// Single Messages API call: hand Claude the customer's photo URLs as image
// content blocks, ask for a strict JSON assessment, validate with zod, return.
//
// This module does NOT escalate. It returns an honest VisionAssessment with
// `confidence` set correctly (0 on parse failure, 0–1 from the model otherwise).
// The autonomy gate (canCheckoutAutonomously in S1) is what blocks low-confidence
// cases from autonomous checkout (spec §13 + BUILD-DECISIONS §F1).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  ADD_ON_CATALOG,
  type VisionAssessment,
} from "./contract";

// ─────────────────────────────────────────────────────────────────────────────
// Model selection — env-overridable per task brief.
// Default: Opus 4.7 (best vision). Set VISION_MODEL=claude-sonnet-4-5 for speed.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_VISION_MODEL = "claude-opus-4-7";

function getVisionModel(): string {
  return process.env.VISION_MODEL ?? DEFAULT_VISION_MODEL;
}

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist of add-on ids — Claude can ONLY return these in detected_extras.
// ─────────────────────────────────────────────────────────────────────────────
const ADDON_IDS = ADD_ON_CATALOG.map((a) => a.id) as [string, ...string[]];
const ADDON_ID_SET = new Set<string>(ADDON_IDS);

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema mirrors VisionAssessment exactly. Rejects hallucinated add-on ids
// and out-of-set tier values.
// ─────────────────────────────────────────────────────────────────────────────
const YardSizeSchema = z.enum(["small", "medium", "large"]);
const IntensitySchema = z.enum(["low", "medium", "high"]);
const TierSchema = z.enum(["essential", "signature", "estate"]);

const VisionAssessmentSchema = z.object({
  yard_size_estimate: YardSizeSchema,
  condition_score: z.number().min(0).max(10),
  overgrowth: IntensitySchema,
  weeds: IntensitySchema,
  leaf_litter: IntensitySchema,
  cleanup_required: z.boolean(),
  cleanup_confidence: z.enum(["low", "high"]),
  detected_extras: z
    .array(z.string())
    .transform((ids) => Array.from(new Set(ids)))
    .pipe(
      z
        .array(z.string())
        .refine((ids) => ids.every((id) => ADDON_ID_SET.has(id)), {
          message: "detected_extras must only contain ids from ADD_ON_CATALOG",
        }),
    ),
  recommended_tier: TierSchema,
  confidence: z.number().min(0).max(1),
  notes: z.string().optional(),
}) satisfies z.ZodType<VisionAssessment>;

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const addonLines = ADD_ON_CATALOG.map(
    (a) => `  - ${a.id} — ${a.name} (${a.category}, ${a.kind})`,
  ).join("\n");

  return `You are the vision-assessment surface of Go Green Landscape's autonomous maintenance funnel (SF premium residential).

Your ONLY job: look at the customer's yard photo(s) and return a single strict-JSON assessment that downstream deterministic code can act on. No prose, no markdown, no apologies — JSON only.

# What you must judge from the photos

- yard_size_estimate: "small" | "medium" | "large" — relative residential SF lot size.
- condition_score: integer 0–10 — overall maintained-ness (0 = abandoned, 10 = magazine-cover).
- overgrowth, weeds, leaf_litter: "low" | "medium" | "high" intensity.
- cleanup_required: true iff the yard needs a one-time cleanup BEFORE recurring service makes sense.
- cleanup_confidence: "high" only when the neglected state is visually obvious (heavy debris, knee-high weeds, dense leaf litter across the maintained area, clearly months of no service). Otherwise "low". DEFAULT TO "low" when in doubt — "high" forces a $350 cleanup add-on into the customer's cart (BUILD-DECISIONS §B2), so be conservative.
- detected_extras: array of add-on ids that the customer should plausibly see offered, based on what is visible in the photo. USE ONLY ids from the whitelist below — never invent. Empty array is fine.
- recommended_tier: "essential" | "signature" | "estate". Map roughly: simple/small/clean → essential; standard residential with detail areas → signature; large, highly-detailed, multi-zone, white-glove-warranted → estate.
- confidence: 0–1 overall confidence in your assessment. Below 0.5 → downstream will escalate to a human; be honest. Low-quality, ambiguous, indoor-looking, blurry, single-angle, or non-yard photos → confidence well below 0.5.
- notes: optional one-line free-text observation for the human reviewer.

# Allowed add-on ids (whitelist — anything else is rejected)

${addonLines}

# Allowed tier ids

essential, signature, estate

# Output format (STRICT)

Return EXACTLY one JSON object, no code fences, no commentary. Shape:

{
  "yard_size_estimate": "small" | "medium" | "large",
  "condition_score": <number 0-10>,
  "overgrowth": "low" | "medium" | "high",
  "weeds": "low" | "medium" | "high",
  "leaf_litter": "low" | "medium" | "high",
  "cleanup_required": <boolean>,
  "cleanup_confidence": "low" | "high",
  "detected_extras": [<add-on id strings from the whitelist above>],
  "recommended_tier": "essential" | "signature" | "estate",
  "confidence": <number 0-1>,
  "notes": "<optional short string>"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Honest-failure sentinel — confidence 0 → caller escalates.
// ─────────────────────────────────────────────────────────────────────────────
function lowConfidenceAssessment(reason: string): VisionAssessment {
  return {
    yard_size_estimate: "medium",
    condition_score: 5,
    overgrowth: "medium",
    weeds: "medium",
    leaf_litter: "medium",
    cleanup_required: false,
    cleanup_confidence: "low",
    detected_extras: [],
    recommended_tier: "signature",
    confidence: 0,
    notes: `vision failed: ${reason}`,
  };
}

// Strip code fences / surrounding prose if the model adds them anyway.
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  // Strip ```json … ``` fences.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
  // Otherwise grab the first top-level { … } span.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function analyzeYardPhotos(urls: string[]): Promise<VisionAssessment> {
  if (!urls || urls.length === 0) {
    return lowConfidenceAssessment("no photos provided");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return lowConfidenceAssessment("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic();
  const model = getVisionModel();

  const imageBlocks = urls.map((url) => ({
    type: "image" as const,
    source: { type: "url" as const, url },
  }));

  const userContent: Anthropic.ContentBlockParam[] = [
    ...imageBlocks,
    {
      type: "text" as const,
      text:
        urls.length === 1
          ? "Assess this yard photo. Return JSON only."
          : `Assess these ${urls.length} yard photos (same property). Return one combined JSON only.`,
    },
  ];

  let rawText: string;
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: userContent }],
    });
    rawText = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return lowConfidenceAssessment(`Anthropic call failed: ${msg}`);
  }

  if (!rawText) {
    return lowConfidenceAssessment("empty model response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(rawText));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return lowConfidenceAssessment(`JSON.parse failed: ${msg}`);
  }

  const result = VisionAssessmentSchema.safeParse(parsed);
  if (!result.success) {
    return lowConfidenceAssessment(`schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

// Exposed for tests.
export const __test__ = {
  VisionAssessmentSchema,
  extractJsonObject,
  lowConfidenceAssessment,
  getVisionModel,
};
