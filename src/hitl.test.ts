// HITL learning loop test (spec §A.6). The owner's approve/reject/override must
// capture a structured reason_code + corrected_value into the events log BEFORE
// the status flip — same proof shape as core.test.ts.
// Run: npx tsx src/hitl.test.ts

import { upsertLead, resetStore, listEvents, getLead, type Lead } from "./store";
import { handleApprove, handleReject, handleOverride, OwnerActionSchema, OverrideSchema } from "./hitl";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const seedReviewLead = (lead_id: string): Promise<Lead> =>
  upsertLead({
    lead_id,
    channel: "telegram",
    name: "Test Owner",
    address: "1 Main St, San Francisco, CA 94110",
    estimated_sqft: 3800,
    area_source: "auto",
    area_confidence: 0.6,
    slope_tier: "flat",
    lead_score: "B",
    ai_recommendation: "Biweekly Signature.",
    price_range: { low: 155, high: 190 },
    status: "Needs Human Review",
    escalation_reason: "low confidence",
  });

async function main() {
  resetStore([]);

  console.log("\n=== handleApprove: structured event + status flip preserved ===");
  {
    await seedReviewLead("L_O1");
    const res = await handleApprove("L_O1", { reason_code: "area_wrong", corrected_value: 4200 });
    ok("returns ok", res.ok, res.error ?? "");
    ok("returns updated lead", !!res.lead, res.lead?.status ?? "");

    const events = await listEvents("L_O1");
    ok("one event captured", events.length === 1, `got ${events.length}`);
    const e = events[0]!;
    ok("event actor=owner", e?.actor === "owner", e?.actor);
    ok("event action=approve", e?.action === "approve", e?.action);
    ok("event reason_code=area_wrong", e?.reason_code === "area_wrong", e?.reason_code);
    ok("event corrected_value=4200", e?.corrected_value === 4200, String(e?.corrected_value));
    ok("agent_decision captured", e?.agent_decision !== undefined);
    ok("inputs captured", e?.inputs !== undefined);

    // status flip preserved (per existing approve route): Needs Human Review → Ready to Schedule
    const lead = await getLead("L_O1");
    ok("status flipped to Ready to Schedule", lead?.status === "Ready to Schedule", `got ${lead?.status}`);
  }

  console.log("\n=== handleApprove: missing lead → 404 shape ===");
  {
    const res = await handleApprove("L_missing", { reason_code: "other" });
    ok("not found", !res.ok && res.error === "not found", res.error ?? "");
  }

  console.log("\n=== handleApprove: body optional (back-compat with old caller) ===");
  {
    await seedReviewLead("L_O1b");
    const res = await handleApprove("L_O1b", {});
    ok("still ok with empty body", res.ok);
    const events = await listEvents("L_O1b");
    ok("event still logged (no reason_code)", events.length === 1 && events[0]?.reason_code === undefined);
  }

  console.log("\n=== handleReject: structured event + status flip preserved ===");
  {
    await seedReviewLead("L_O2");
    const res = await handleReject("L_O2", { reason_code: "should_have_escalated", corrected_value: "out of area" });
    ok("returns ok", res.ok);

    const events = await listEvents("L_O2");
    ok("one event captured", events.length === 1, `got ${events.length}`);
    const e = events[0]!;
    ok("event action=reject", e?.action === "reject", e?.action);
    ok("event reason_code preserved", e?.reason_code === "should_have_escalated");
    ok("event corrected_value preserved", e?.corrected_value === "out of area");

    const lead = await getLead("L_O2");
    ok("status flipped to Not a Fit", lead?.status === "Not a Fit", `got ${lead?.status}`);
  }

  console.log("\n=== handleOverride: pure correction, NO status change ===");
  {
    await seedReviewLead("L_O3");
    const before = await getLead("L_O3");
    const res = await handleOverride("L_O3", {
      field: "area",
      corrected_value: 4500,
      reason_code: "area_wrong",
    });
    ok("returns ok", res.ok, res.error ?? "");
    ok("returns event", !!res.event);

    const events = await listEvents("L_O3");
    ok("one event captured", events.length === 1, `got ${events.length}`);
    const e = events[0]!;
    ok("event action=override_area", e?.action === "override_area", e?.action);
    ok("event actor=owner", e?.actor === "owner");
    ok("event reason_code preserved", e?.reason_code === "area_wrong");
    ok("event corrected_value=4500", e?.corrected_value === 4500);

    const after = await getLead("L_O3");
    ok("status UNCHANGED", after?.status === before?.status, `before=${before?.status} after=${after?.status}`);
  }

  console.log("\n=== handleOverride: every field variant produces correctly-namespaced action ===");
  {
    await seedReviewLead("L_O4");
    await handleOverride("L_O4", { field: "slope", corrected_value: "steep", reason_code: "slope_underestimated" });
    await handleOverride("L_O4", {
      field: "price",
      corrected_value: { low: 200, high: 240 },
      reason_code: "price_too_low",
    });
    await handleOverride("L_O4", { field: "address", corrected_value: "2 Other St", reason_code: "address_wrong" });
    await handleOverride("L_O4", {
      field: "decision",
      corrected_value: "escalate",
      reason_code: "should_have_escalated",
    });

    const events = await listEvents("L_O4");
    ok("four events captured", events.length === 4, `got ${events.length}`);
    const actions = events.map((e) => e.action);
    ok("override_slope present", actions.includes("override_slope"));
    ok("override_price present", actions.includes("override_price"));
    ok("override_address present", actions.includes("override_address"));
    ok("override_decision present", actions.includes("override_decision"));
  }

  console.log("\n=== handleOverride: bad field → error, no event ===");
  {
    await seedReviewLead("L_O5");
    // @ts-expect-error — runtime guard required
    const res = await handleOverride("L_O5", { field: "evil", corrected_value: 1, reason_code: "other" });
    ok("rejected", !res.ok && !!res.error, res.error ?? "");
    ok("no event written", (await listEvents("L_O5")).length === 0);
  }

  console.log("\n=== SEC-B: OwnerActionSchema — bounded inputs for unauthenticated approve/reject ===");
  {
    const okEmpty = OwnerActionSchema.safeParse({});
    ok("empty body accepted (back-compat)", okEmpty.success);

    const okValid = OwnerActionSchema.safeParse({ reason_code: "area_wrong", corrected_value: 4200 });
    ok("valid {reason_code, number corrected_value} accepted", okValid.success);

    const okString = OwnerActionSchema.safeParse({ corrected_value: "out of area" });
    ok("string corrected_value accepted", okString.success);

    const okNull = OwnerActionSchema.safeParse({ corrected_value: null });
    ok("null corrected_value accepted", okNull.success);

    const bigReason = "x".repeat(201);
    const failReason = OwnerActionSchema.safeParse({ reason_code: bigReason });
    ok("reason_code > 200 chars rejected", !failReason.success, failReason.success ? "WRONGLY accepted" : "");

    const bigVal = "x".repeat(2001);
    const failVal = OwnerActionSchema.safeParse({ corrected_value: bigVal });
    ok("corrected_value string > 2000 chars rejected", !failVal.success);

    const failObj = OwnerActionSchema.safeParse({ corrected_value: { a: 1, b: 2 } });
    ok("object corrected_value rejected (no unbounded shapes)", !failObj.success);

    const failExtra = OwnerActionSchema.safeParse({ reason_code: "ok", evil: "extra" });
    ok("extra keys rejected (.strict)", !failExtra.success);
  }

  console.log("\n=== SEC-B: OverrideSchema — same bounds + required field/reason_code ===");
  {
    const okValid = OverrideSchema.safeParse({
      field: "area",
      reason_code: "area_wrong",
      corrected_value: 4500,
    });
    ok("valid override accepted", okValid.success, okValid.success ? "" : okValid.error.message);

    const failField = OverrideSchema.safeParse({
      field: "evil",
      reason_code: "x",
      corrected_value: 1,
    });
    ok("bad field rejected at schema level", !failField.success);

    const failMissingReason = OverrideSchema.safeParse({ field: "area", corrected_value: 1 });
    ok("missing reason_code rejected (required)", !failMissingReason.success);

    const bigReason = OverrideSchema.safeParse({
      field: "area",
      reason_code: "x".repeat(201),
      corrected_value: 1,
    });
    ok("override reason_code > 200 chars rejected", !bigReason.success);

    const failExtra = OverrideSchema.safeParse({
      field: "area",
      reason_code: "ok",
      corrected_value: 1,
      evil: true,
    });
    ok("override extra keys rejected (.strict)", !failExtra.success);

    const failObjVal = OverrideSchema.safeParse({
      field: "price",
      reason_code: "x",
      corrected_value: { low: 1, high: 2 },
    });
    ok("object corrected_value rejected on override", !failObjVal.success);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
