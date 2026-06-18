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
  runValidateAddress,
  runConfirmArea,
  runComputeExactPrice,
  type ToolContext,
} from "./agent-tools";
import { PRICE_BOOK, monthlyFromVisit } from "./contract";
import { pricePerVisit } from "./pricing";
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

async function main() {

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

console.log("\n=== T10.a: validate_address — no Google key → graceful error, never throws ===");
{
  resetStore([]);
  upsertLead({ lead_id: "L7", channel: "form" });
  delete process.env.GOOGLE_MAPS_API_KEY;
  let threw = false;
  let result: Awaited<ReturnType<typeof runValidateAddress>> | undefined;
  try {
    result = await runValidateAddress(ctx("L7"), {
      addressLines: ["123 Main St"],
      locality: "San Francisco",
      adminArea: "CA",
      postalCode: "94110",
    });
  } catch {
    threw = true;
  }
  ok("no_key → did not throw", !threw);
  ok("no_key → status 'error' (graceful)", result?.status === "error", JSON.stringify(result));
  ok("no_key → reason surfaced", typeof (result as { reason?: string })?.reason === "string");
}

console.log("\n=== T10.b: confirm_area — re-derives sqft from path; client-supplied number ignored ===");
{
  resetStore([]);
  upsertLead({ lead_id: "L8", channel: "form" });
  // ~50m × 100m rectangle anchored near SF (T7 ref): ≈ 53820 sqft from computePolygonSqft.
  const path = [
    { lat: 37.75,             lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 + 0.001136 },
    { lat: 37.75,             lng: -122.42 + 0.001136 },
  ];
  const r = runConfirmArea(ctx("L8"), { path });
  ok("status confirmed", r.status === "confirmed", JSON.stringify(r));
  if (r.status === "confirmed") {
    ok("re-derived confirmed_sqft ≈ 53820 (±200)", Math.abs(r.confirmed_sqft - 53820) < 200, `got ${r.confirmed_sqft}`);
    ok("area_confirmed_by_customer true on lead", getLead("L8")?.area_confirmed_by_customer === true);
    ok("4-corner rect → area_source 'auto'", r.area_source === "auto", `got ${r.area_source}`);
    // Even if a malicious LLM crammed in a different number, the path's own area math wins.
    // We don't expose a "claimed sqft" input — there's literally nowhere to inject one.
  }
}

console.log("\n=== T10.c: confirm_area — vision steepness_hint='steep' raises tier flat→moderate ===");
{
  resetStore([]);
  upsertLead({
    lead_id: "L9",
    channel: "form",
    slope_tier: "flat",
    slope_source: "elevation",
    vision_assessment: { slope_signals: { steepness_hint: "steep" } },
  });
  const path = [
    { lat: 37.75,             lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 + 0.001136 },
    { lat: 37.75,             lng: -122.42 + 0.001136 },
  ];
  const r = runConfirmArea(ctx("L9"), { path });
  ok("status confirmed", r.status === "confirmed");
  if (r.status === "confirmed") {
    ok("slope_tier raised flat → moderate", r.slope_tier === "moderate", `got ${r.slope_tier}`);
    ok("slope_source 'photo_raised'", r.slope_source === "photo_raised", `got ${r.slope_source}`);
    ok("persisted to lead", getLead("L9")?.slope_tier === "moderate" && getLead("L9")?.slope_source === "photo_raised");
  }

  // A second confirm (customer redraws) must NOT raise the tier AGAIN — the photo
  // hint already applied once. Re-raising moderate→steep on every re-confirm is a bug.
  const r2 = runConfirmArea(ctx("L9"), { path });
  if (r2.status === "confirmed") {
    ok("second confirm does NOT double-raise (stays moderate)", r2.slope_tier === "moderate", `got ${r2.slope_tier}`);
    ok("slope_source stays photo_raised", r2.slope_source === "photo_raised", `got ${r2.slope_source}`);
  }
}

console.log("\n=== SEC-D: confirm_area — out-of-range polygon is refused, never persisted as confirmed ===");
{
  resetStore([]);
  upsertLead({ lead_id: "L_SEC_D", channel: "form" });
  // ~1000m × 2000m rectangle ≈ 21.5M sqft — well above 60000 sqft SF residential ceiling.
  const huge = [
    { lat: 37.75,           lng: -122.42 },
    { lat: 37.75 + 0.00898, lng: -122.42 },               // ~1000m N
    { lat: 37.75 + 0.00898, lng: -122.42 + 0.02272 },     // ~2000m E
    { lat: 37.75,           lng: -122.42 + 0.02272 },
  ];
  const r = runConfirmArea(ctx("L_SEC_D"), { path: huge });
  ok("out-of-range returns status 'area_out_of_range'",
    r.status === "area_out_of_range", JSON.stringify(r).slice(0, 200));
  ok("confirmed_sqft echoed for client feedback",
    typeof r.confirmed_sqft === "number" && r.confirmed_sqft > 60000, `got ${r.confirmed_sqft}`);
  const lead = getLead("L_SEC_D");
  ok("lead NOT marked area_confirmed_by_customer",
    lead?.area_confirmed_by_customer !== true, `got ${lead?.area_confirmed_by_customer}`);
  ok("lead.confirmed_sqft NOT persisted from oversized polygon",
    !lead?.confirmed_sqft || lead.confirmed_sqft <= 60000,
    `got ${lead?.confirmed_sqft}`);
}

console.log("\n=== T10.d: compute_exact_price — missing confirmed_sqft → structured refusal ===");
{
  resetStore([]);
  upsertLead({ lead_id: "L10", channel: "form" }); // no confirmed_sqft
  const r = runComputeExactPrice(ctx("L10"), { tier: "signature", frequency: "biweekly" });
  ok("status 'missing_measurement'", r.status === "missing_measurement", JSON.stringify(r));
  ok("message present", typeof (r as { message?: string }).message === "string" && (r as { message: string }).message.length > 0);
}

console.log("\n=== T10.e: compute_exact_price — 2500 sqft + flat + biweekly matches pricePerVisit ===");
{
  resetStore([]);
  upsertLead({ lead_id: "L11", channel: "form", confirmed_sqft: 2500, slope_tier: "flat" });
  const r = runComputeExactPrice(ctx("L11"), { tier: "signature", frequency: "biweekly" });
  const expected = pricePerVisit({ measured_area_sqft: 2500, slope_tier: "flat", frequency: "biweekly" });
  ok("status 'priced'", r.status === "priced", JSON.stringify(r));
  if (r.status === "priced") {
    ok("perVisit matches engine", r.perVisit === expected.perVisit, `got ${r.perVisit}, expected ${expected.perVisit}`);
    ok("monthly matches engine", Math.abs(r.monthly - expected.monthly) < 0.005, `got ${r.monthly}, expected ${expected.monthly}`);
    ok("tier_name from PRICE_BOOK", r.tier_name === PRICE_BOOK.signature.name);
    ok("currency USD", r.currency === "USD");
  }
}

console.log("\n=== T13: propose_checkout — charge == quote (measured area×slope, NOT flat PRICE_BOOK) — review blocker A ===");
{
  // The bug: ExactPriceCard quoted the customer the MEASURED price (pricePerVisit
  // using confirmed_sqft + slope_tier), but Stripe was billing the flat
  // PRICE_BOOK[tier].perVisit price — e.g. medium flat biweekly: $173/visit quoted
  // → $375.41/mo, but $299×2.17=$648.83/mo charged. They MUST agree.
  resetStore([]);
  upsertLead({
    lead_id: "L13",
    channel: "form",
    photos: ["data:image/png;base64,xx"],
    confirmed_sqft: 2500,   // medium bucket
    slope_tier: "flat",
  });
  const r = runProposeCheckout(ctx("L13"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: [],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "123 Main St, SF 94110",
  });
  const measured = pricePerVisit({
    measured_area_sqft: 2500,
    slope_tier: "flat",
    frequency: "biweekly",
  });
  // measured.perVisit = 173; measured.monthly = 375.41
  // legacy flat would have been monthlyFromVisit("signature","biweekly") = 648.83
  ok(
    "not a gate refusal",
    r.status !== "missing_address" && r.status !== "missing_photos",
    JSON.stringify(r),
  );
  ok(
    `monthlyRecurring == MEASURED (${measured.monthly}) NOT flat 648.83`,
    typeof r.monthlyRecurring === "number" && approxEq(r.monthlyRecurring, measured.monthly),
    `got ${r.monthlyRecurring}`,
  );
  ok(
    "amount (no add-ons) == measured monthly",
    typeof r.amount === "number" && approxEq(r.amount, measured.monthly),
    `got ${r.amount}`,
  );
  ok(
    "measuredPerVisit surfaced for the Stripe call",
    (r as { measuredPerVisit?: number }).measuredPerVisit === measured.perVisit,
    `got ${(r as { measuredPerVisit?: number }).measuredPerVisit}`,
  );

  // Defence in depth: add fixed add-on still rides on TOP of the MEASURED monthly,
  // never the flat one. Add fertilization ($95).
  const r2 = runProposeCheckout(ctx("L13"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: ["fertilization"],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "123 Main St, SF 94110",
  });
  const expectedAmount = Math.round((measured.monthly + 95) * 100) / 100;
  ok(
    `amount = MEASURED monthly + $95 = ${expectedAmount}`,
    typeof r2.amount === "number" && approxEq(r2.amount, expectedAmount),
    `got ${r2.amount}`,
  );
  ok(
    "monthlyRecurring still == MEASURED (add-on is one-time, not recurring)",
    typeof r2.monthlyRecurring === "number" && approxEq(r2.monthlyRecurring, measured.monthly),
    `got ${r2.monthlyRecurring}`,
  );
}

console.log("\n=== T13.b: propose_checkout — legacy back-compat: no measurement → flat PRICE_BOOK path stays ===");
{
  // Existing callers without confirmed_sqft + slope_tier still get the legacy
  // priceCart numbers — nothing else breaks. (operator.ts compat.)
  resetStore([]);
  upsertLead({
    lead_id: "L13b",
    channel: "form",
    photos: ["data:image/png;base64,xx"],
    // no confirmed_sqft, no slope_tier
  });
  const r = runProposeCheckout(ctx("L13b"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: [],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "123 Main St, SF 94110",
  });
  const flat = monthlyFromVisit("signature", "biweekly"); // 648.83
  ok(
    "monthlyRecurring falls back to flat 648.83",
    typeof r.monthlyRecurring === "number" && approxEq(r.monthlyRecurring, flat),
    `got ${r.monthlyRecurring}`,
  );
  ok(
    "no measuredPerVisit surfaced (no measurement)",
    (r as { measuredPerVisit?: number }).measuredPerVisit === undefined,
    `got ${(r as { measuredPerVisit?: number }).measuredPerVisit}`,
  );
}

console.log("\n=== T13.c: compute_exact_price — persists per_visit_price + monthly_price on the lead ===");
{
  // The whole system has to agree on the priced numbers. After compute_exact_price
  // runs, the lead carries them so propose_checkout / dashboard / audit all read
  // the same source of truth.
  resetStore([]);
  upsertLead({ lead_id: "L13c", channel: "form", confirmed_sqft: 2500, slope_tier: "flat" });
  const r = runComputeExactPrice(ctx("L13c"), { tier: "signature", frequency: "biweekly" });
  ok("status priced", r.status === "priced", JSON.stringify(r));
  const lead = getLead("L13c");
  ok(
    "per_visit_price persisted (173)",
    lead?.per_visit_price === 173,
    `got ${lead?.per_visit_price}`,
  );
  ok(
    "monthly_price persisted (375.41)",
    typeof lead?.monthly_price === "number" && approxEq(lead.monthly_price, 375.41),
    `got ${lead?.monthly_price}`,
  );
  ok(
    "desired_frequency persisted",
    lead?.desired_frequency === "biweekly",
    `got ${lead?.desired_frequency}`,
  );
  ok(
    "suggested_package persisted",
    lead?.suggested_package === PRICE_BOOK.signature.name,
    `got ${lead?.suggested_package}`,
  );
}

console.log("\n=== T10.f: confirm_booking — calendar wire is fire-and-forget; booking still succeeds with no key ===");
{
  resetStore([]);
  resetSlots();
  // No COMPOSIO_API_KEY / GOOGLE_CALENDAR_ID in test env → createCrewEvent returns unconfigured no-op.
  delete process.env.COMPOSIO_API_KEY;
  delete process.env.GOOGLE_CALENDAR_ID;
  upsertLead({
    lead_id: "L12",
    channel: "form",
    photos: ["x"],
    status: "Ready to Schedule",
    address: "123 Main St, SF 94110",
    confirmed_sqft: 2500,
    slope_tier: "flat",
    suggested_package: "Signature Care",
  });
  const slots = runOfferSlots(ctx("L12"));
  const slotId = slots[0]!.slotId;
  const booked = runConfirmBooking(ctx("L12"), { slotId });
  ok("calendar no-op did NOT block booking", booked.status === "booked", JSON.stringify(booked));
  ok("lead status Scheduled (booking persisted)",
    getLead("L12")?.status === "Scheduled" || getLead("L12")?.status === "Work Order Created",
    getLead("L12")?.status);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);

}

void main();
