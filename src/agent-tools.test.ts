// Proof driver for the agent tool layer (src/agent-tools.ts) — the deterministic
// engine wrapped as LLM-callable tools. Pure handlers, no LLM, no network.
// Run: npx tsx src/agent-tools.test.ts
//
// Invariant under test (the whole point of the rebuild): the tools RE-DERIVE every
// number/decision server-side and refuse unsafe actions. An LLM can never inject a
// price, skip the address gate, or trigger a charge.

import {
  runQualify,
  runRecommendTier,
  runComputePricing,
  runProposeCheckout,
  runOfferSlots,
  runConfirmBooking,
  runRaiseEscalation,
  type ToolContext,
} from "./agent-tools";
import { PRICE_BOOK, monthlyFromVisit } from "./contract";
import { resetStore, upsertLead, getLead } from "./store";
import { resetSlots } from "./scheduler";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const approxEq = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;
const ctx = (leadId: string): ToolContext => ({ leadId, language: "en" });

console.log("\n=== S1: qualify_lead — geo + score (in-area A vs out-of-area C) ===");
{
  resetStore([]);
  const inArea = runQualify(ctx("L1"), {
    address: "123 Main St, San Francisco, CA 94110",
    frequency: "biweekly",
    hasPhotos: true,
  });
  ok("in-area zip 94110 → inArea true", inArea.inArea === true, JSON.stringify(inArea));
  ok("complete in-area residential → score A", inArea.score === "A", `got ${inArea.score}`);

  const outArea = runQualify(ctx("L1b"), {
    address: "1 Mountain View Ave, 95014",
    frequency: "weekly",
    hasPhotos: true,
  });
  ok("out-of-area zip 95014 → inArea false", outArea.inArea === false, JSON.stringify(outArea));
  ok("out-of-area → score C", outArea.score === "C", `got ${outArea.score}`);
  ok("out-of-area → escalate flag set", outArea.escalate === true);
}

console.log("\n=== S4: recommend_tier — server re-derives from PRICE_BOOK, ignores any LLM-supplied price ===");
{
  resetStore([]);
  // Even if a jailbroken model tried to inject a fake price via extra args, the
  // handler only reads PRICE_BOOK. We pass the documented args (tier, reason).
  const r = runRecommendTier(ctx("L2"), { tier: "signature", reason: "standard residential, good detail" });
  ok("tier echoed", r.tier === "signature");
  ok("perVisit comes from PRICE_BOOK ($299) not the model", r.perVisit === PRICE_BOOK.signature.perVisit && r.perVisit === 299, `got ${r.perVisit}`);
  ok("name from PRICE_BOOK", r.name === "Signature Care");
  ok("returns all 3 tier options for the card", r.options.length === 3, `got ${r.options.length}`);
  ok("options carry authoritative prices", r.options.every((o) => o.perVisit === PRICE_BOOK[o.tier].perVisit));
  ok("reason preserved", r.reason.length > 0);
}

console.log("\n=== S2: compute_pricing — all numbers server-derived; open-ended never charged ===");
{
  resetStore([]);
  const r = runComputePricing(ctx("L3"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: ["fertilization", "hand-weeding"], // fertilization fixed $95, hand-weeding open-ended
  });
  ok("no error", !("error" in r), JSON.stringify(r));
  if (!("error" in r)) {
    ok("monthlyRecurring = 299*2.17 = 648.83", approxEq(r.monthlyRecurring, 648.83), `got ${r.monthlyRecurring}`);
    ok("1 fixed line item (fertilization)", r.fixedAddOnLineItems.length === 1 && r.fixedAddOnLineItems[0]?.addOnId === "fertilization");
    ok("hand-weeding flagged open-ended (NOT charged)", r.openEndedFlagged.some((x) => x.addOnId === "hand-weeding"));
    const expected = monthlyFromVisit("signature", "biweekly") + 95;
    ok(`firstChargeTotal = monthly + 95 = ${expected}`, approxEq(r.firstChargeTotal, expected), `got ${r.firstChargeTotal}`);
  }
  // unknown id → structured error, never a throw that kills the stream
  const bad = runComputePricing(ctx("L3"), { tier: "essential", frequency: "monthly", addOnIds: ["nope-not-real"] });
  ok("unknown add-on → structured error (no throw)", "error" in bad, JSON.stringify(bad));
}

console.log("\n=== S3: propose_checkout — address gate + photos gate + NEVER charges ===");
{
  resetStore([]);
  // Lead with NO photos, NO address yet.
  upsertLead({ lead_id: "L4", channel: "form", photos: [] });

  const noAddr = runProposeCheckout(ctx("L4"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: [],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "", // missing
  });
  ok("missing address → refusal status, no Stripe URL", noAddr.status === "missing_address" && !("url" in noAddr), JSON.stringify(noAddr));

  // Address present but no photos on the lead → photos gate.
  const noPhotos = runProposeCheckout(ctx("L4"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: [],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "123 Main St, SF 94110",
  });
  ok("missing photos → refusal status", noPhotos.status === "missing_photos", JSON.stringify(noPhotos));

  // Photos present, no Stripe key in test env → dev-unavailable, but still NEVER charges + returns the amount.
  upsertLead({ lead_id: "L4", channel: "form", photos: ["data:image/png;base64,xx"] });
  const ready = runProposeCheckout(ctx("L4"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: ["fertilization"],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "123 Main St, SF 94110",
  });
  const expectAmount = monthlyFromVisit("signature", "biweekly") + 95;
  ok("photos+address present → not a gate refusal", ready.status !== "missing_address" && ready.status !== "missing_photos", JSON.stringify(ready));
  ok("computes authoritative amount", typeof ready.amount === "number" && approxEq(ready.amount as number, expectAmount), `got ${ready.amount}`);
  ok("dev (no Stripe key) → checkout_unavailable_dev, NEVER a silent charge", ready.status === "checkout_unavailable_dev");
}

console.log("\n=== confirm_booking — payment gate (no booking before paid) ===");
{
  resetStore([]);
  resetSlots();
  upsertLead({ lead_id: "L5", channel: "form", photos: ["x"], status: "AI Qualified" });
  const slots = runOfferSlots(ctx("L5"));
  ok("offer_slots returns availability", Array.isArray(slots) && slots.length > 0, `got ${Array.isArray(slots) ? slots.length : typeof slots}`);
  const firstSlot = slots[0]!.slotId;
  const blocked = runConfirmBooking(ctx("L5"), { slotId: firstSlot });
  ok("unpaid lead → booking refused (payment_required)", blocked.status === "payment_required", JSON.stringify(blocked));

  // Simulate webhook flipping the lead to paid.
  upsertLead({ lead_id: "L5", channel: "form", status: "Ready to Schedule" });
  const booked = runConfirmBooking(ctx("L5"), { slotId: firstSlot });
  ok("paid lead → booking succeeds", booked.status === "booked", JSON.stringify(booked));
  ok("lead moved to Scheduled", getLead("L5")?.status === "Scheduled" || getLead("L5")?.status === "Work Order Created");
}

console.log("\n=== raise_escalation — marks lead, blocks auto-charge ===");
{
  resetStore([]);
  upsertLead({ lead_id: "L6", channel: "form", photos: [] });
  const esc = runRaiseEscalation(ctx("L6"), {
    primary: "hoa",
    flags: ["hoa"],
    brief: "Customer mentioned HOA approval needed for the front yard.",
  });
  ok("escalation returns escalated true", esc.escalated === true);
  ok("autoChargeBlocked true", esc.autoChargeBlocked === true);
  ok("lead status → Needs Human Review", getLead("L6")?.status === "Needs Human Review", getLead("L6")?.status);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
