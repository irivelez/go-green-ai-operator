// Proof driver — runs the deterministic spine end-to-end with NO external keys.
// This is the 30-minute demo of correctness: intake→qualify→price→book + escalation + hard rules.
// Run: npx tsx src/core.test.ts

import { upsertLead, resetStore, appendEvent, listEvents, getLead } from "./store";
import {
  tool_score_lead, tool_quote_range, tool_book_evaluation,
  tool_create_work_order, tool_raise_escalation, checkEscalation, visionFallback,
} from "./tools";
import { yardSizeToSqft } from "./pricing";

// Hermetic: start from a clean store every run (no cross-run state bleed).
resetStore([]);

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== Scenario 1: happy A-lead (medium yard, biweekly, SF 94110) ===");
{
  const lead = upsertLead({ lead_id: "L1", channel: "telegram", name: "Dana",
    address: "742 Valencia St, San Francisco, 94110", desired_frequency: "biweekly",
    photos: ["photo1.jpg"] });
  const vision = visionFallback();
  const scored = tool_score_lead({
    address: lead.address, desired_frequency: "biweekly", has_photos: true,
    property_type: "residential", vision_confidence: vision.confidence,
  });
  ok("scored A", scored.score === "A", `got ${scored.score}`);
  ok("in service area", scored.geo.in_area, scored.geo.zone ?? "");

  const range = tool_quote_range({
    measured_area_sqft: yardSizeToSqft("medium"),
    slope_tier: "flat", frequency: "biweekly",
    cleanup_required: vision.cleanup_required,
  });
  ok("range covered", range.covered, `$${range.low}-$${range.high}`);
  ok("range is exact (compat shim returns point)", range.high === range.low);

  upsertLead({ lead_id: "L1", channel: "telegram", lead_score: "A", zone: scored.geo.zone,
    suggested_package: "signature", price_range: { low: range.low, high: range.high } });

  const booked = tool_book_evaluation({ ...lead, address: lead.address } as never, "2026-06-15T15:00:00Z");
  ok("booked (has address)", booked.ok, booked.reason ?? "");
  const wo = tool_create_work_order("L1");
  ok("work order created", "work_order" in wo && !!(wo as { work_order: unknown }).work_order);
  ok("idempotent re-book blocked", !tool_book_evaluation({ ...lead, address: lead.address } as never, "2026-06-15T15:00:00Z").ok);
}

console.log("\n=== Scenario 2: HOA → escalation (no autonomous booking) ===");
{
  upsertLead({ lead_id: "L2", channel: "telegram", name: "Sam",
    address: "1 Main St, San Francisco, 94105", photos: [] });
  const esc = checkEscalation({ inbound_text: "Hi, our HOA needs weekly service for the common areas." });
  ok("HOA flagged", esc.escalate, esc.reasons.join(", "));
  const lead = tool_raise_escalation("L2", "telegram", esc.reasons.join(", "), "HOA common-area request — needs human.");
  ok("routed to Needs Human Review", lead.status === "Needs Human Review");
}

console.log("\n=== Scenario 3: hard rule — no address → no scheduling ===");
{
  const noAddr = upsertLead({ lead_id: "L3", channel: "telegram", name: "Pat", photos: ["p.jpg"] });
  const booked = tool_book_evaluation(noAddr, "2026-06-16T17:00:00Z");
  ok("booking denied without address", !booked.ok, booked.reason ?? "");
}

console.log("\n=== Scenario 4: events log captures owner corrections (HITL learning loop) ===");
{
  upsertLead({ lead_id: "L4", channel: "telegram", name: "Mo",
    address: "1500 Page St, San Francisco, 94117", estimated_sqft: 3800,
    area_source: "auto", area_confidence: 0.62 });
  const e1 = appendEvent("L4", { actor: "owner", action: "override_area",
    reason_code: "area_wrong", corrected_value: 4200,
    agent_decision: { estimated_sqft: 3800 } });
  ok("appendEvent returns event with ts", typeof e1.ts === "string" && e1.ts.length > 0);
  const events = listEvents("L4");
  ok("listEvents has one event", events.length === 1, `got ${events.length}`);
  const first = events[0]!;
  ok("event reason_code preserved", first.reason_code === "area_wrong", first.reason_code);
  ok("event corrected_value preserved", first.corrected_value === 4200, String(first.corrected_value));
  ok("event actor preserved", first.actor === "owner");

  appendEvent("L4", { actor: "agent", action: "rescore", inputs: { sqft: 4200 } });
  const events2 = listEvents("L4");
  ok("order preserved on second append", events2.length === 2 && events2[1]!.action === "rescore");

  const lead = getLead("L4");
  ok("extended fields persist on Lead", lead?.estimated_sqft === 3800 && lead?.area_source === "auto");

  const noLead = appendEvent("L_missing", { actor: "system", action: "noop" });
  ok("missing lead no-op returns unsaved event", typeof noLead.ts === "string" && listEvents("L_missing").length === 0);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
