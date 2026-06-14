// Vision smoke test.
//
// - No ANTHROPIC_API_KEY → SKIP cleanly (exit 0). The shape of the module is
//   still proven by the schema + sentinel checks below, which always run.
// - With a key → fires one real Messages call against a public sample yard
//   photo URL, prints the structured assessment, and asserts the schema
//   parses.

import { analyzeYardPhotos, __test__ } from "./vision";
import { ADD_ON_CATALOG } from "./contract";

const SAMPLE_YARD_PHOTO_URL =
  // Public Wikimedia photo: a residential backyard with lawn, hedges,
  // shrubs — typical SF-ish residential scope. Stable URL.
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Backyard_with_swimming_pool.jpg/1280px-Backyard_with_swimming_pool.jpg";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
}

async function offlineChecks() {
  // Sentinel: empty URL list returns confidence 0 honestly.
  const empty = await analyzeYardPhotos([]);
  assert(empty.confidence === 0, "empty url list must yield confidence 0");
  assert(
    empty.recommended_tier === "essential" ||
      empty.recommended_tier === "signature" ||
      empty.recommended_tier === "estate",
    "sentinel tier must be in {essential,signature,estate}",
  );

  // Schema rejects hallucinated add-on ids.
  const bad = __test__.VisionAssessmentSchema.safeParse({
    yard_size_estimate: "medium",
    condition_score: 6,
    overgrowth: "low",
    weeds: "low",
    leaf_litter: "low",
    cleanup_required: false,
    cleanup_confidence: "low",
    detected_extras: ["totally-made-up-addon"],
    recommended_tier: "signature",
    confidence: 0.8,
  });
  assert(!bad.success, "schema must reject unknown add-on ids");

  // Schema rejects out-of-set tier.
  const badTier = __test__.VisionAssessmentSchema.safeParse({
    yard_size_estimate: "medium",
    condition_score: 6,
    overgrowth: "low",
    weeds: "low",
    leaf_litter: "low",
    cleanup_required: false,
    cleanup_confidence: "low",
    detected_extras: [],
    recommended_tier: "platinum",
    confidence: 0.8,
  });
  assert(!badTier.success, "schema must reject tier outside {essential,signature,estate}");

  // Schema accepts a valid whitelisted assessment.
  const ok = __test__.VisionAssessmentSchema.safeParse({
    yard_size_estimate: "medium",
    condition_score: 7,
    overgrowth: "low",
    weeds: "low",
    leaf_litter: "medium",
    cleanup_required: false,
    cleanup_confidence: "low",
    detected_extras: [ADD_ON_CATALOG[0]!.id],
    recommended_tier: "signature",
    confidence: 0.82,
  });
  assert(ok.success, "schema must accept a valid assessment");

  // extractJsonObject strips code fences.
  const fenced = "```json\n{\"a\":1}\n```";
  assert(
    __test__.extractJsonObject(fenced).trim() === '{"a":1}',
    "extractJsonObject must strip ```json fences",
  );
}

async function liveCheck() {
  console.log(`[vision.test] running live call with model = ${__test__.getVisionModel()}`);
  console.log(`[vision.test] sample photo: ${SAMPLE_YARD_PHOTO_URL}`);
  const start = Date.now();
  const assessment = await analyzeYardPhotos([SAMPLE_YARD_PHOTO_URL]);
  const elapsedMs = Date.now() - start;
  console.log(`[vision.test] elapsed: ${elapsedMs}ms`);
  console.log("[vision.test] structured assessment:");
  console.log(JSON.stringify(assessment, null, 2));

  // The schema MUST parse what analyzeYardPhotos returned (it already did
  // internally on success; we double-check here to make the contract explicit).
  const parsed = __test__.VisionAssessmentSchema.safeParse(assessment);
  assert(parsed.success, `live response failed schema check: ${!parsed.success ? parsed.error.message : ""}`);
  console.log("[vision.test] PASS — schema parsed cleanly");
}

async function main() {
  await offlineChecks();
  console.log("[vision.test] offline schema/sentinel checks: PASS");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[vision.test] SKIP: no key");
    process.exit(0);
  }

  await liveCheck();
}

main().catch((err) => {
  console.error("[vision.test] unexpected error:", err);
  process.exit(1);
});
