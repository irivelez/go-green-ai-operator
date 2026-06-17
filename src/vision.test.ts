// Vision schema unit tests — TDD for T4: slope_signals replaces yard_size_estimate.
// Run: npx tsx src/vision.test.ts
// No external keys needed — tests the Zod schema only via __test__ export.

import { analyzeYardPhotos, __test__ } from "./vision";
import { ADD_ON_CATALOG } from "./contract";

const { VisionAssessmentSchema } = __test__;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// ─── Shared valid base (fields that don't change) ────────────────────────────
const BASE = {
  condition_score: 7,
  overgrowth: "low",
  weeds: "low",
  leaf_litter: "low",
  cleanup_required: false,
  cleanup_confidence: "low",
  detected_extras: [],
  recommended_tier: "signature",
  confidence: 0.85,
};

console.log("\n=== T4: VisionAssessmentSchema — slope_signals replaces yard_size_estimate ===");

// (a) Valid object WITH slope_signals and WITHOUT yard_size_estimate → must parse OK
{
  const valid = {
    ...BASE,
    slope_signals: {
      stairs_visible: false,
      retaining_wall_visible: false,
      terraces_visible: false,
      steepness_hint: "none",
    },
  };
  const r = VisionAssessmentSchema.safeParse(valid);
  ok("valid slope_signals object parses successfully", r.success,
    r.success ? "" : r.error.message);
}

// (b) Object WITH stale yard_size_estimate and WITHOUT slope_signals → must FAIL
{
  const stale = {
    ...BASE,
    yard_size_estimate: "medium",
  };
  const r = VisionAssessmentSchema.safeParse(stale);
  ok("stale yard_size_estimate (no slope_signals) is rejected", !r.success,
    r.success ? "WRONGLY accepted" : "correctly rejected");
}

// (c) slope_signals with all steepness_hint values accepted
{
  for (const hint of ["none", "moderate", "steep"] as const) {
    const obj = {
      ...BASE,
      slope_signals: {
        stairs_visible: true,
        retaining_wall_visible: false,
        terraces_visible: true,
        steepness_hint: hint,
      },
    };
    const r = VisionAssessmentSchema.safeParse(obj);
    ok(`steepness_hint "${hint}" accepted`, r.success,
      r.success ? "" : r.error.message);
  }
}

// (d) slope_signals with invalid steepness_hint → rejected
{
  const bad = {
    ...BASE,
    slope_signals: {
      stairs_visible: false,
      retaining_wall_visible: false,
      terraces_visible: false,
      steepness_hint: "extreme", // not in enum
    },
  };
  const r = VisionAssessmentSchema.safeParse(bad);
  ok("invalid steepness_hint rejected", !r.success,
    r.success ? "WRONGLY accepted" : "correctly rejected");
}

// (e) Missing slope_signals entirely → rejected
{
  const missing = { ...BASE };
  const r = VisionAssessmentSchema.safeParse(missing);
  ok("missing slope_signals rejected", !r.success,
    r.success ? "WRONGLY accepted" : "correctly rejected");
}

// (f) Schema still rejects hallucinated add-on ids (regression)
{
  const badAddon = {
    ...BASE,
    slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" },
    detected_extras: ["totally-made-up-addon"],
  };
  const r = VisionAssessmentSchema.safeParse(badAddon);
  ok("schema still rejects unknown add-on ids", !r.success,
    r.success ? "WRONGLY accepted" : "correctly rejected");
}

// (g) Schema still rejects out-of-set tier (regression)
{
  const badTier = {
    ...BASE,
    slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" },
    recommended_tier: "platinum",
  };
  const r = VisionAssessmentSchema.safeParse(badTier);
  ok("schema still rejects tier outside {essential,signature,estate}", !r.success,
    r.success ? "WRONGLY accepted" : "correctly rejected");
}

// (h) Schema accepts a valid whitelisted assessment with slope_signals (regression)
{
  const good = {
    ...BASE,
    slope_signals: { stairs_visible: false, retaining_wall_visible: false, terraces_visible: false, steepness_hint: "none" },
    detected_extras: [ADD_ON_CATALOG[0]!.id],
  };
  const r = VisionAssessmentSchema.safeParse(good);
  ok("schema accepts valid assessment with whitelisted add-on", r.success,
    r.success ? "" : r.error.message);
}

// (i) extractJsonObject strips code fences (regression)
{
  const fenced = "```json\n{\"a\":1}\n```";
  ok("extractJsonObject strips ```json fences",
    __test__.extractJsonObject(fenced).trim() === '{"a":1}');
}

async function main() {
  // (j) Sentinel: empty URL list returns confidence 0 (regression — no key needed)
  {
    const empty = await analyzeYardPhotos([]);
    ok("empty url list yields confidence 0", empty.confidence === 0, `got ${empty.confidence}`);
    ok("sentinel has slope_signals", "slope_signals" in empty, JSON.stringify(empty));
    ok("sentinel slope_signals.steepness_hint is 'none'",
      (empty as { slope_signals?: { steepness_hint?: string } }).slope_signals?.steepness_hint === "none");
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[vision.test] unexpected error:", err);
  process.exit(1);
});
