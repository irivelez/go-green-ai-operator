// HITL learning loop test (spec §A.6). The owner's approve/reject/override must
// capture a structured reason_code + corrected_value into the events log BEFORE
// the status flip — same proof shape as core.test.ts.
// Run: npx tsx src/hitl.test.ts

import { upsertLead, resetStore, listEvents, getLead, type Lead } from "./store";
import { handleApprove, handleReject, handleOverride } from "./hitl";

resetStore([]);

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const seedReviewLead = (lead_id: string): Lead =>
  upsertLead({
    lead_id, channel: "telegram", name: "Test Owner",
    address: "1 Main St, San Francisco, CA 94110",
    estimated_sqft: 3800, area_source: "auto", area_confidence: 0.6,
    slope_tier: "flat", lead_score: "B",
    ai_recommendation: "Biweekly Signature.",
    price_range: { low: 155, high: 190 },
    status: "Needs Human Review", escalation_reason: "low confidence",
  });

console.log("\n=== handleApprove: structured event + status flip preserved ===");
{
  seedReviewLead("L_O1");
  const res = handleApprove("L_O1", { reason_code: "area_wrong", corrected_value: 4200 });
  ok("returns ok", res.ok, res.error ?? "");
  ok("returns updated lead", !!res.lead, res.lead?.status ?? "");

  const events = listEvents("L_O1");
  ok("one event captured", events.length === 1, `got ${events.length}`);
  const e = events[0]!;
  ok("event actor=owner", e?.actor === "owner", e?.actor);
  ok("event action=approve", e?.action === "approve", e?.action);
  ok("event reason_code=area_wrong", e?.reason_code === "area_wrong", e?.reason_code);
  ok("event corrected_value=4200", e?.corrected_value === 4200, String(e?.corrected_value));
  ok("agent_decision captured", e?.agent_decision !== undefined);
  ok("inputs captured", e?.inputs !== undefined);

  // status flip preserved (per existing approve route): Needs Human Review → Ready to Schedule
  const lead = getLead("L_O1");
  ok("status flipped to Ready to Schedule", lead?.status === "Ready to Schedule",
    `got ${lead?.status}`);
}

console.log("\n=== handleApprove: missing lead → 404 shape ===");
{
  const res = handleApprove("L_missing", { reason_code: "other" });
  ok("not found", !res.ok && res.error === "not found", res.error ?? "");
}

console.log("\n=== handleApprove: body optional (back-compat with old caller) ===");
{
  seedReviewLead("L_O1b");
  const res = handleApprove("L_O1b", {});
  ok("still ok with empty body", res.ok);
  const events = listEvents("L_O1b");
  ok("event still logged (no reason_code)", events.length === 1 && events[0]?.reason_code === undefined);
}

console.log("\n=== handleReject: structured event + status flip preserved ===");
{
  seedReviewLead("L_O2");
  const res = handleReject("L_O2", { reason_code: "should_have_escalated", corrected_value: "out of area" });
  ok("returns ok", res.ok);

  const events = listEvents("L_O2");
  ok("one event captured", events.length === 1, `got ${events.length}`);
  const e = events[0]!;
  ok("event action=reject", e?.action === "reject", e?.action);
  ok("event reason_code preserved", e?.reason_code === "should_have_escalated");
  ok("event corrected_value preserved", e?.corrected_value === "out of area");

  const lead = getLead("L_O2");
  ok("status flipped to Not a Fit", lead?.status === "Not a Fit", `got ${lead?.status}`);
}

console.log("\n=== handleOverride: pure correction, NO status change ===");
{
  seedReviewLead("L_O3");
  const before = getLead("L_O3");
  const res = handleOverride("L_O3", {
    field: "area", corrected_value: 4500, reason_code: "area_wrong",
  });
  ok("returns ok", res.ok, res.error ?? "");
  ok("returns event", !!res.event);

  const events = listEvents("L_O3");
  ok("one event captured", events.length === 1, `got ${events.length}`);
  const e = events[0]!;
  ok("event action=override_area", e?.action === "override_area", e?.action);
  ok("event actor=owner", e?.actor === "owner");
  ok("event reason_code preserved", e?.reason_code === "area_wrong");
  ok("event corrected_value=4500", e?.corrected_value === 4500);

  const after = getLead("L_O3");
  ok("status UNCHANGED", after?.status === before?.status,
    `before=${before?.status} after=${after?.status}`);
}

console.log("\n=== handleOverride: every field variant produces correctly-namespaced action ===");
{
  seedReviewLead("L_O4");
  handleOverride("L_O4", { field: "slope", corrected_value: "steep", reason_code: "slope_underestimated" });
  handleOverride("L_O4", { field: "price", corrected_value: { low: 200, high: 240 }, reason_code: "price_too_low" });
  handleOverride("L_O4", { field: "address", corrected_value: "2 Other St", reason_code: "address_wrong" });
  handleOverride("L_O4", { field: "decision", corrected_value: "escalate", reason_code: "should_have_escalated" });

  const events = listEvents("L_O4");
  ok("four events captured", events.length === 4, `got ${events.length}`);
  const actions = events.map((e) => e.action);
  ok("override_slope present", actions.includes("override_slope"));
  ok("override_price present", actions.includes("override_price"));
  ok("override_address present", actions.includes("override_address"));
  ok("override_decision present", actions.includes("override_decision"));
}

console.log("\n=== handleOverride: bad field → error, no event ===");
{
  seedReviewLead("L_O5");
  // @ts-expect-error — runtime guard required
  const res = handleOverride("L_O5", { field: "evil", corrected_value: 1, reason_code: "other" });
  ok("rejected", !res.ok && !!res.error, res.error ?? "");
  ok("no event written", listEvents("L_O5").length === 0);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
