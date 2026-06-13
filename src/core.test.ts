// Proof driver — runs the deterministic spine end-to-end with NO external keys.
// This is the 30-minute demo of correctness: intake→qualify→price→book + escalation + hard rules.
// Run: npx tsx src/core.test.ts

import { upsertLead } from "./store.js";
import {
  tool_score_lead, tool_quote_range, tool_book_evaluation,
  tool_create_work_order, tool_raise_escalation, checkEscalation, visionFallback,
} from "./tools.js";

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
    yard_size_bucket: vision.yard_size_estimate, frequency: "biweekly",
    cleanup_required: vision.cleanup_required,
  });
  ok("range covered", range.covered, `$${range.low}-$${range.high}`);
  ok("range is a band, not a point", range.high > range.low);

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

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
