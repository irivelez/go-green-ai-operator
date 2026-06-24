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
  runMeasureProperty,
  runConfirmArea,
  runComputeExactPrice,
  runAnalyzePhotos,
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

const realFetch = globalThis.fetch;
function mockFetch(handler: (url: string) => { status: number; body: unknown }): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

async function main() {

console.log("\n=== S1: qualify_lead — geo + score (in-area A vs out-of-area C) ===");
{
  resetStore([]);
  const inArea = await runQualify(ctx("L1"), {
    address: "123 Main St, San Francisco, CA 94110",
    frequency: "biweekly",
    hasPhotos: true,
  });
  ok("in-area zip 94110 → inArea true", inArea.inArea === true, JSON.stringify(inArea));
  ok("complete in-area residential → score A", inArea.score === "A", `got ${inArea.score}`);

  const outArea = await runQualify(ctx("L1b"), {
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
  const r = await runRecommendTier(ctx("L2"), { tier: "signature", reason: "standard residential, good detail" });
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
  const r = await runComputePricing(ctx("L3"), {
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
  const bad = await runComputePricing(ctx("L3"), { tier: "essential", frequency: "monthly", addOnIds: ["nope-not-real"] });
  ok("unknown add-on → structured error (no throw)", "error" in bad, JSON.stringify(bad));
}

console.log("\n=== S3: propose_checkout — address gate + photos gate + NEVER charges ===");
{
  resetStore([]);
  // Lead with NO photos, NO address yet.
  await upsertLead({ lead_id: "L4", channel: "form", photos: [] });

  const noAddr = await runProposeCheckout(ctx("L4"), {
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
  const noPhotos = await runProposeCheckout(ctx("L4"), {
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
  await upsertLead({ lead_id: "L4", channel: "form", photos: ["data:image/png;base64,xx"] });
  const ready = await runProposeCheckout(ctx("L4"), {
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
  if (ready.status === "missing_address" || ready.status === "missing_photos" || ready.status === "error")
    throw new Error(`expected a priced result, got ${ready.status}`);
  ok("computes authoritative amount", typeof ready.amount === "number" && approxEq(ready.amount as number, expectAmount), `got ${ready.amount}`);
  ok("dev (no Stripe key) → checkout_unavailable_dev, NEVER a silent charge", ready.status === "checkout_unavailable_dev");
}

console.log("\n=== confirm_booking — payment gate (no booking before paid) ===");
{
  resetStore([]);
  resetSlots();
  await upsertLead({ lead_id: "L5", channel: "form", photos: ["x"], status: "AI Qualified" });
  const slots = await runOfferSlots(ctx("L5"));
  ok("offer_slots returns availability", Array.isArray(slots) && slots.length > 0, `got ${Array.isArray(slots) ? slots.length : typeof slots}`);
  const firstSlot = slots[0]!.slotId;
  const blocked = await runConfirmBooking(ctx("L5"), { slotId: firstSlot });
  ok("unpaid lead → booking refused (payment_required)", blocked.status === "payment_required", JSON.stringify(blocked));

  // Simulate webhook flipping the lead to paid.
  await upsertLead({ lead_id: "L5", channel: "form", status: "Ready to Schedule" });
  const booked = await runConfirmBooking(ctx("L5"), { slotId: firstSlot });
  ok("paid lead → booking succeeds", booked.status === "booked", JSON.stringify(booked));
  ok("lead moved to Scheduled", (await getLead("L5"))?.status === "Scheduled" || (await getLead("L5"))?.status === "Work Order Created");
}

console.log("\n=== raise_escalation — marks lead, blocks auto-charge ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L6", channel: "form", photos: [] });
  const esc = await runRaiseEscalation(ctx("L6"), {
    primary: "hoa",
    flags: ["hoa"],
    brief: "Customer mentioned HOA approval needed for the front yard.",
  });
  ok("escalation returns escalated true", esc.escalated === true);
  ok("autoChargeBlocked true", esc.autoChargeBlocked === true);
  ok("lead status → Needs Human Review", (await getLead("L6"))?.status === "Needs Human Review", (await getLead("L6"))?.status);
}

console.log("\n=== T10.a: validate_address — no Google key → graceful error, never throws ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L7", channel: "form" });
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

console.log("\n=== T10.a2: validate_address — VALIDATED persists USPS structured parts on the lead ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L7b", channel: "form" });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true },
            address: { formattedAddress: "1916 Octavia Street, San Francisco, CA 94109-3357, USA" },
            geocode: { location: { latitude: 37.7904, longitude: -122.4271 }, accuracy: "ROOFTOP" },
            uspsData: { standardizedAddress: { firstAddressLine: "1916 OCTAVIA ST" } },
          },
        },
      };
    }
    return { status: 200, body: {} };
  });
  const res = await runValidateAddress(ctx("L7b"), {
    addressLines: ["1916 Octavia St"], locality: "San Francisco", adminArea: "CA", postalCode: "94109",
  });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  ok("status validated", res.status === "validated", JSON.stringify(res).slice(0, 120));
  const lead = (await getLead("L7b"));
  ok("lead.address_number '1916'", lead?.address_number === "1916", lead?.address_number);
  ok("lead.street_name 'OCTAVIA'", lead?.street_name === "OCTAVIA", lead?.street_name);
  ok("lead.street_type 'ST'", lead?.street_type === "ST", lead?.street_type);
}

console.log("\n=== T10.a3: validate_address — CORRECTED persists parts (common SF path), withholds address string ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L7c", channel: "form" });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true, hasInferredComponents: true },
            address: { formattedAddress: "1916 Octavia Street, San Francisco, CA 94109-3357, USA" },
            geocode: { location: { latitude: 37.7904, longitude: -122.4271 }, accuracy: "ROOFTOP" },
            uspsData: { standardizedAddress: { firstAddressLine: "1916 OCTAVIA ST" } },
          },
        },
      };
    }
    return { status: 200, body: {} };
  });
  const res = await runValidateAddress(ctx("L7c"), {
    addressLines: ["1916 Octavia St"], locality: "San Francisco", adminArea: "CA", postalCode: "94109",
  });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  ok("status needs_confirm", res.status === "needs_confirm", JSON.stringify(res).slice(0, 120));
  const lead = (await getLead("L7c"));
  // CORRECTED is the COMMON SF path (Google infers ZIP+4 → hasInferredComponents).
  // Parts ARE persisted (the "Yes, use this" button doesn't re-run validate), but the
  // address STRING stays unset until confirmed — measure runs only after "Yes".
  ok("parts persisted on CORRECTED (Yes button doesn't re-validate)", lead?.street_name === "OCTAVIA", lead?.street_name);
  ok("address string NOT yet set on CORRECTED (awaits Yes)", !lead?.address, lead?.address);
}

console.log("\n=== T10.a4: validate_address — typo correction (hasReplacedComponents) still persists parts ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L7d", channel: "form" });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true, hasReplacedComponents: true },
            address: {
              formattedAddress: "1916 Octavia Street, San Francisco, CA 94109-3357, USA",
              addressComponents: [
                { componentType: "street_number", componentName: { text: "1916" } },
                { componentType: "route", componentName: { text: "Octavia Street" } },
              ],
            },
            geocode: { location: { latitude: 37.7904, longitude: -122.4271 }, accuracy: "ROOFTOP" },
            uspsData: { standardizedAddress: { firstAddressLine: "1916 OCTAVIA ST" } },
          },
        },
      };
    }
    return { status: 200, body: {} };
  });
  const res = await runValidateAddress(ctx("L7d"), {
    addressLines: ["1916 Octavea St"], locality: "San Francisco", adminArea: "CA", postalCode: "94109",
  });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  ok("status needs_confirm", res.status === "needs_confirm", JSON.stringify(res).slice(0, 120));
  const lead = (await getLead("L7d"));
  ok("typo-corrected parts persisted from standardized form", lead?.street_name === "OCTAVIA", lead?.street_name);
}

console.log("\n=== T10.a5: validate_address — re-edit overwrites prior parts (No → re-enter) ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L7e", channel: "form", address_number: "1916", street_name: "OCTAVIA", street_type: "ST" });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true },
            address: { formattedAddress: "566 South Van Ness Ave, San Francisco, CA 94110, USA",
              addressComponents: [
                { componentType: "street_number", componentName: { text: "566" } },
                { componentType: "route", componentName: { text: "South Van Ness Avenue" } },
              ] },
            geocode: { location: { latitude: 37.7635, longitude: -122.4165 }, accuracy: "ROOFTOP" },
          },
        },
      };
    }
    return { status: 200, body: {} };
  });
  await runValidateAddress(ctx("L7e"), {
    addressLines: ["566 South Van Ness Ave"], locality: "San Francisco", adminArea: "CA", postalCode: "94110",
  });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  const lead = (await getLead("L7e"));
  ok("re-edit overwrote street_name to 'SOUTH VAN NESS'", lead?.street_name === "SOUTH VAN NESS", lead?.street_name);
  ok("re-edit overwrote address_number to '566'", lead?.address_number === "566", lead?.address_number);
}

console.log("\n=== T10.a7: validate_address — UNVALIDATABLE clears stale parts (no wrong-parcel measure) ===");
{
  resetStore([]);
  // Customer corrected address A (parts persisted), then re-entered garbage that comes
  // back UNVALIDATABLE. The stale A-parts MUST be cleared, else a loosely-ordered LLM
  // could measure the WRONG parcel. Wrong-parcel is worse than no-parcel.
  await upsertLead({
    lead_id: "L7g", channel: "form",
    address_number: "1916", street_name: "OCTAVIA", street_type: "ST",
    lat: 37.7904236, lng: -122.4271081,
  });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: { result: { verdict: {}, address: { formattedAddress: "asdf" }, geocode: { location: { latitude: 0, longitude: 0 } } } },
      };
    }
    return { status: 200, body: {} };
  });
  const res = await runValidateAddress(ctx("L7g"), {
    addressLines: ["asdfqwer"], locality: "Nowhere", adminArea: "ZZ", postalCode: "00000",
  });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  ok("status unvalidatable", res.status === "unvalidatable", JSON.stringify(res));
  const lead = (await getLead("L7g"));
  ok("stale street_name cleared", !lead?.street_name, lead?.street_name);
  ok("stale address_number cleared", !lead?.address_number, lead?.address_number);
  ok("stale lat cleared", lead?.lat === undefined, String(lead?.lat));
}

console.log("\n=== T10.a8: validate_address — clearStaleGeo covers a partial-state lead (only street_type/lng set) ===");
{
  resetStore([]);
  // Defense-in-depth: the early-return guard must check ALL five geo fields, not just
  // three. A lead carrying only street_type/lng (a partial state) must STILL be cleared
  // on UNVALIDATABLE — otherwise a stale fragment could survive into a wrong-parcel join.
  await upsertLead({ lead_id: "L7h", channel: "form", street_type: "ST", lng: -122.4271081 });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: { result: { verdict: {}, address: { formattedAddress: "asdf" }, geocode: { location: { latitude: 0, longitude: 0 } } } },
      };
    }
    return { status: 200, body: {} };
  });
  await runValidateAddress(ctx("L7h"), {
    addressLines: ["asdfqwer"], locality: "Nowhere", adminArea: "ZZ", postalCode: "00000",
  });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  const lead = (await getLead("L7h"));
  ok("stale street_type cleared (partial state)", lead?.street_type === undefined, lead?.street_type);
  ok("stale lng cleared (partial state)", lead?.lng === undefined, String(lead?.lng));
}

console.log("\n=== T10.a6: validate_address — persists rooftop lat/lng on the lead (slope source of truth) ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L7f", channel: "form" });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true, hasInferredComponents: true },
            address: { formattedAddress: "1916 Octavia Street, San Francisco, CA 94109-3357, USA" },
            geocode: { location: { latitude: 37.7904236, longitude: -122.4271081 }, accuracy: "ROOFTOP" },
            uspsData: { standardizedAddress: { firstAddressLine: "1916 OCTAVIA ST" } },
          },
        },
      };
    }
    return { status: 200, body: {} };
  });
  await runValidateAddress(ctx("L7f"), {
    addressLines: ["1916 Octavia St"], locality: "San Francisco", adminArea: "CA", postalCode: "94109",
  });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  const lead = (await getLead("L7f"));
  ok("lead.lat persisted (CORRECTED path too)", lead?.lat === 37.7904236, String(lead?.lat));
  ok("lead.lng persisted (CORRECTED path too)", lead?.lng === -122.4271081, String(lead?.lng));
}

console.log("\n=== T10.g1: measure_property — slope read from lead lat/lng, not LLM args (steep stays steep) ===");
{
  resetStore([]);
  // The lead carries the REAL rooftop coords from validate (a known steep SF block).
  // The LLM passes WRONG/flat coords — the server MUST ignore them and use the lead's.
  await upsertLead({
    lead_id: "L_M3", channel: "form",
    address_number: "1916", street_name: "OCTAVIA", street_type: "ST",
    lat: 37.7904236, lng: -122.4271081,
  });
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  let elevationSeen = "";
  mockFetch((url) => {
    if (url.includes("maps.googleapis.com/maps/api/elevation")) {
      elevationSeen = url;
      // 3x3 grid rising ~7.5m per 25m row → ~30% grade → steep.
      return {
        status: 200,
        body: {
          status: "OK",
          results: [
            { elevation: 0 }, { elevation: 0 }, { elevation: 0 },
            { elevation: 7.5 }, { elevation: 7.5 }, { elevation: 7.5 },
            { elevation: 15 }, { elevation: 15 }, { elevation: 15 },
          ],
        },
      };
    }
    if (url.includes("ramy-di5m")) return { status: 200, body: [] };
    return { status: 200, body: {} };
  });
  const r = await runMeasureProperty(ctx("L_M3"), { lat: 0, lng: 0 });
  restoreFetch();
  delete process.env.GOOGLE_MAPS_API_KEY;
  ok("slope_tier 'steep' from lead coords (LLM 0,0 ignored)", r.slope_tier === "steep", r.slope_tier);
  ok("elevation sampled the lead's REAL lat (37.79), not LLM 0,0", elevationSeen.includes("37.79"), elevationSeen.slice(0, 90));
  ok("lead.slope_tier persisted steep", (await getLead("L_M3"))?.slope_tier === "steep", (await getLead("L_M3"))?.slope_tier);
}

console.log("\n=== T10.g0: measure_property — reads address parts off the lead (no LLM args needed) ===");
{
  resetStore([]);
  await upsertLead({
    lead_id: "L_M0", channel: "form",
    address_number: "1450", street_name: "PAGE", street_type: "ST",
  });
  delete process.env.GOOGLE_MAPS_API_KEY;
  let easUrlSeen = "";
  mockFetch((url) => {
    if (url.includes("ramy-di5m")) {
      easUrlSeen = url;
      return { status: 200, body: [{ parcel_number: "3704018", block: "3704", lot: "018" }] };
    }
    if (url.includes("acdm-wktn") && url.includes(".geojson")) {
      return {
        status: 200,
        body: {
          features: [{
            geometry: {
              type: "MultiPolygon",
              coordinates: [[[
                [-122.42, 37.75], [-122.42, 37.7504],
                [-122.4195, 37.7504], [-122.4195, 37.75], [-122.42, 37.75],
              ]]],
            },
            properties: { blklot: "3704018", mapblklot: "3704018" },
          }],
        },
      };
    }
    if (url.includes("acdm-wktn")) {
      return { status: 200, body: [{ blklot: "3704018", mapblklot: "3704018" }] };
    }
    return { status: 200, body: {} };
  });
  const r = await runMeasureProperty(ctx("L_M0"), { lat: 37.7502, lng: -122.4198 });
  restoreFetch();
  ok("area_source 'parcel' from lead parts (no args)", r.area_source === "parcel", r.area_source);
  ok("parcel_ring drawn", r.parcel_ring.length >= 3, `len ${r.parcel_ring.length}`);
  ok("EAS query used the lead's street parts", easUrlSeen.includes("PAGE"), easUrlSeen.slice(0, 120));
}

console.log("\n=== T10.g: measure_property — single-family DataSF parcel ring → outline + no escalation ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L_M1", channel: "form", address_number: "1450", street_name: "PAGE", street_type: "ST" });
  delete process.env.GOOGLE_MAPS_API_KEY; // slope/Solar key-guarded off; DataSF still runs
  mockFetch((url) => {
    if (url.includes("ramy-di5m")) {
      return { status: 200, body: [{ parcel_number: "3704018", block: "3704", lot: "018" }] };
    }
    if (url.includes("acdm-wktn") && url.includes(".geojson")) {
      return {
        status: 200,
        body: {
          features: [{
            geometry: {
              type: "MultiPolygon",
              coordinates: [[[
                [-122.42, 37.75], [-122.42, 37.7504],
                [-122.4195, 37.7504], [-122.4195, 37.75], [-122.42, 37.75],
              ]]],
            },
            properties: { blklot: "3704018", mapblklot: "3704018" },
          }],
        },
      };
    }
    if (url.includes("acdm-wktn")) {
      return { status: 200, body: [{ blklot: "3704018", mapblklot: "3704018" }] };
    }
    return { status: 200, body: {} };
  });

  const r = await runMeasureProperty(ctx("L_M1"), { lat: 37.7502, lng: -122.4198 });
  restoreFetch();
  ok("area_source 'parcel'", r.area_source === "parcel", r.area_source);
  ok("NOT shared_multi_unit", r.shared_multi_unit === false, String(r.shared_multi_unit));
  ok("parcel_ring threaded to card", r.parcel_ring.length >= 3, `len ${r.parcel_ring.length}`);
  ok("estimated_sqft re-derived from ring > 0", r.estimated_sqft > 0, String(r.estimated_sqft));
}

console.log("\n=== T10.h: measure_property — stacked condo (mapblklot≠blklot) → shared_multi_unit (escalate) ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L_M2", channel: "form", address_number: "488", street_name: "FOLSOM", street_type: "ST" });
  delete process.env.GOOGLE_MAPS_API_KEY;
  mockFetch((url) => {
    if (url.includes("ramy-di5m")) {
      return { status: 200, body: [{ parcel_number: "3737084", block: "3737", lot: "084" }] };
    }
    if (url.includes("acdm-wktn")) {
      return { status: 200, body: [{ blklot: "3737084", mapblklot: "3737042" }] };
    }
    return { status: 200, body: {} };
  });

  const r = await runMeasureProperty(ctx("L_M2"), { lat: 37.7879, lng: -122.3944 });
  restoreFetch();
  ok("shared_multi_unit true → agent must escalate", r.shared_multi_unit === true, String(r.shared_multi_unit));
  ok("no parcel_ring for escalated condo", r.parcel_ring.length === 0, `len ${r.parcel_ring.length}`);
  ok("area_source 'none' (no pricing for condo)", r.area_source === "none", r.area_source);
}

console.log("\n=== T10.b: confirm_area — re-derives sqft from path; client-supplied number ignored ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L8", channel: "form" });
  // ~50m × 100m rectangle anchored near SF (T7 ref): ≈ 53820 sqft from computePolygonSqft.
  const path = [
    { lat: 37.75,             lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 + 0.001136 },
    { lat: 37.75,             lng: -122.42 + 0.001136 },
  ];
  const r = await runConfirmArea(ctx("L8"), { path });
  ok("status confirmed", r.status === "confirmed", JSON.stringify(r));
  if (r.status === "confirmed") {
    ok("re-derived confirmed_sqft ≈ 53820 (±200)", Math.abs(r.confirmed_sqft - 53820) < 200, `got ${r.confirmed_sqft}`);
    ok("area_confirmed_by_customer true on lead", (await getLead("L8"))?.area_confirmed_by_customer === true);
    ok("4-corner rect → area_source 'auto'", r.area_source === "auto", `got ${r.area_source}`);
    // Even if a malicious LLM crammed in a different number, the path's own area math wins.
    // We don't expose a "claimed sqft" input — there's literally nowhere to inject one.
  }
}

console.log("\n=== T10.b2: confirm_area — no lead → lead_missing, NEVER fabricates a flat-slope stub ===");
{
  resetStore([]);
  // Cross-route store split (defect #4): measure_property wrote slope to one store
  // instance, confirm_area's route reads a DIFFERENT instance with NO lead. It MUST
  // refuse to invent a flat-slope stub (which would clobber the real steep slope and
  // price a steep lot as flat). Loud lead_missing > silent wrong price.
  const path = [
    { lat: 37.75,             lng: -122.42 },
    { lat: 37.75 + 0.000135,  lng: -122.42 },
    { lat: 37.75 + 0.000135,  lng: -122.42 + 0.000204 },
    { lat: 37.75,             lng: -122.42 + 0.000204 },
  ];
  const r = await runConfirmArea(ctx("L_NOLEAD"), { path });
  ok("status 'lead_missing' (no fabricated stub)", r.status === "lead_missing", JSON.stringify(r).slice(0, 120));
  ok("confirmed_sqft still echoed for client feedback", typeof (r as { confirmed_sqft?: number }).confirmed_sqft === "number");
  ok("lead NOT created with default flat slope", (await getLead("L_NOLEAD")) === undefined, JSON.stringify((await getLead("L_NOLEAD"))));
}

console.log("\n=== T10.b3: confirm_area → compute_exact_price — colocated steep slope prices steep (not flat) ===");
{
  resetStore([]);
  // The measure step already persisted steep on this lead (same store). confirm_area
  // must PRESERVE steep (not reset to flat), so compute_exact_price prices steep.
  await upsertLead({ lead_id: "L_STEEP", channel: "form", slope_tier: "steep", slope_source: "elevation" });
  const path = [
    { lat: 37.75,             lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 },
    { lat: 37.75 + 0.000449,  lng: -122.42 + 0.001136 },
    { lat: 37.75,             lng: -122.42 + 0.001136 },
  ];
  const ca = await runConfirmArea(ctx("L_STEEP"), { path });
  ok("confirm_area preserves steep", ca.status === "confirmed" && ca.slope_tier === "steep", JSON.stringify(ca).slice(0, 120));
  const sqft = ca.status === "confirmed" ? ca.confirmed_sqft : 0;
  const price = await runComputeExactPrice(ctx("L_STEEP"), { tier: "signature", frequency: "biweekly" });
  const expected = pricePerVisit({ measured_area_sqft: sqft, slope_tier: "steep", frequency: "biweekly" });
  ok("price uses steep multiplier (not flat)", price.status === "priced" && price.perVisit === expected.perVisit, JSON.stringify(price).slice(0, 120));
}

console.log("\n=== T10.c: confirm_area — vision steepness_hint='steep' raises tier flat→moderate ===");
{
  resetStore([]);
  await upsertLead({
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
  const r = await runConfirmArea(ctx("L9"), { path });
  ok("status confirmed", r.status === "confirmed");
  if (r.status === "confirmed") {
    ok("slope_tier raised flat → moderate", r.slope_tier === "moderate", `got ${r.slope_tier}`);
    ok("slope_source 'photo_raised'", r.slope_source === "photo_raised", `got ${r.slope_source}`);
    ok("persisted to lead", (await getLead("L9"))?.slope_tier === "moderate" && (await getLead("L9"))?.slope_source === "photo_raised");
  }

  // A second confirm (customer redraws) must NOT raise the tier AGAIN — the photo
  // hint already applied once. Re-raising moderate→steep on every re-confirm is a bug.
  const r2 = await runConfirmArea(ctx("L9"), { path });
  if (r2.status === "confirmed") {
    ok("second confirm does NOT double-raise (stays moderate)", r2.slope_tier === "moderate", `got ${r2.slope_tier}`);
    ok("slope_source stays photo_raised", r2.slope_source === "photo_raised", `got ${r2.slope_source}`);
  }
}

console.log("\n=== SEC-F: confirm_area re-draw clears stale price (no pay against an outdated quote) ===");
{
  resetStore([]);
  await upsertLead({
    lead_id: "L_SEC_F", channel: "form",
    confirmed_sqft: 2500, slope_tier: "flat",
    per_visit_price: 173, monthly_price: 375.41,
  });
  // ~15m × 18m rectangle ≈ 2,900 sqft — a valid SF residential lot (under the
  // 60000 sqft ceiling), so the re-confirm reaches the persist path.
  const path = [
    { lat: 37.75,             lng: -122.42 },
    { lat: 37.75 + 0.000135,  lng: -122.42 },
    { lat: 37.75 + 0.000135,  lng: -122.42 + 0.000204 },
    { lat: 37.75,             lng: -122.42 + 0.000204 },
  ];
  const r = await runConfirmArea(ctx("L_SEC_F"), { path });
  ok("re-confirm succeeds", r.status === "confirmed", JSON.stringify(r).slice(0, 120));
  const lead = (await getLead("L_SEC_F"));
  ok("stale per_visit_price cleared on re-confirm", lead?.per_visit_price === undefined, `got ${lead?.per_visit_price}`);
  ok("stale monthly_price cleared on re-confirm", lead?.monthly_price === undefined, `got ${lead?.monthly_price}`);
}

console.log("\n=== SEC-D: confirm_area — out-of-range polygon is refused, never persisted as confirmed ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L_SEC_D", channel: "form" });
  // ~1000m × 2000m rectangle ≈ 21.5M sqft — well above 60000 sqft SF residential ceiling.
  const huge = [
    { lat: 37.75,           lng: -122.42 },
    { lat: 37.75 + 0.00898, lng: -122.42 },               // ~1000m N
    { lat: 37.75 + 0.00898, lng: -122.42 + 0.02272 },     // ~2000m E
    { lat: 37.75,           lng: -122.42 + 0.02272 },
  ];
  const r = await runConfirmArea(ctx("L_SEC_D"), { path: huge });
  ok("out-of-range returns status 'area_out_of_range'",
    r.status === "area_out_of_range", JSON.stringify(r).slice(0, 200));
  ok("confirmed_sqft echoed for client feedback",
    typeof r.confirmed_sqft === "number" && r.confirmed_sqft > 60000, `got ${r.confirmed_sqft}`);
  const lead = (await getLead("L_SEC_D"));
  ok("lead NOT marked area_confirmed_by_customer",
    lead?.area_confirmed_by_customer !== true, `got ${lead?.area_confirmed_by_customer}`);
  ok("lead.confirmed_sqft NOT persisted from oversized polygon",
    !lead?.confirmed_sqft || lead.confirmed_sqft <= 60000,
    `got ${lead?.confirmed_sqft}`);
}

console.log("\n=== SEC-E: analyze_photos — LLM-supplied unsafe photoUrls are not persisted to the lead ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L_SEC_E", channel: "form", photos: ["data:image/png;base64,QQ=="] });
  await runAnalyzePhotos(ctx("L_SEC_E"), {
    photoUrls: ["http://169.254.169.254/latest/meta-data/", "data:image/png;base64,QQ=="],
  });
  const photos = (await getLead("L_SEC_E"))?.photos ?? [];
  ok("metadata-IP url NOT persisted to lead.photos",
    !photos.some((p) => p.startsWith("http")), JSON.stringify(photos).slice(0, 120));
  ok("safe data: url retained", photos.some((p) => p.startsWith("data:image/")));
}

console.log("\n=== T10.d: compute_exact_price — missing confirmed_sqft → structured refusal ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L10", channel: "form" }); // no confirmed_sqft
  const r = await runComputeExactPrice(ctx("L10"), { tier: "signature", frequency: "biweekly" });
  ok("status 'missing_measurement'", r.status === "missing_measurement", JSON.stringify(r));
  ok("message present", typeof (r as { message?: string }).message === "string" && (r as { message: string }).message.length > 0);
}

console.log("\n=== T10.e: compute_exact_price — 2500 sqft + flat + biweekly matches pricePerVisit ===");
{
  resetStore([]);
  await upsertLead({ lead_id: "L11", channel: "form", confirmed_sqft: 2500, slope_tier: "flat" });
  const r = await runComputeExactPrice(ctx("L11"), { tier: "signature", frequency: "biweekly" });
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
  await upsertLead({
    lead_id: "L13",
    channel: "form",
    photos: ["data:image/png;base64,xx"],
    confirmed_sqft: 2500,   // medium bucket
    slope_tier: "flat",
  });
  const r = await runProposeCheckout(ctx("L13"), {
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
  if (r.status === "missing_address" || r.status === "missing_photos" || r.status === "error")
    throw new Error(`expected a priced result, got ${r.status}`);
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
  const r2 = await runProposeCheckout(ctx("L13"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: ["fertilization"],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "123 Main St, SF 94110",
  });
  if (r2.status === "missing_address" || r2.status === "missing_photos" || r2.status === "error")
    throw new Error(`expected a priced result, got ${r2.status}`);
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
  await upsertLead({
    lead_id: "L13b",
    channel: "form",
    photos: ["data:image/png;base64,xx"],
    // no confirmed_sqft, no slope_tier
  });
  const r = await runProposeCheckout(ctx("L13b"), {
    tier: "signature",
    frequency: "biweekly",
    addOnIds: [],
    name: "Jane",
    email: "jane@example.com",
    phone: "555",
    address: "123 Main St, SF 94110",
  });
  if (r.status === "missing_address" || r.status === "missing_photos" || r.status === "error")
    throw new Error(`expected a priced result, got ${r.status}`);
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
  await upsertLead({ lead_id: "L13c", channel: "form", confirmed_sqft: 2500, slope_tier: "flat" });
  const r = await runComputeExactPrice(ctx("L13c"), { tier: "signature", frequency: "biweekly" });
  ok("status priced", r.status === "priced", JSON.stringify(r));
  const lead = (await getLead("L13c"));
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
  await upsertLead({
    lead_id: "L12",
    channel: "form",
    photos: ["x"],
    status: "Ready to Schedule",
    address: "123 Main St, SF 94110",
    confirmed_sqft: 2500,
    slope_tier: "flat",
    suggested_package: "Signature Care",
  });
  const slots = await runOfferSlots(ctx("L12"));
  const slotId = slots[0]!.slotId;
  const booked = await runConfirmBooking(ctx("L12"), { slotId });
  ok("calendar no-op did NOT block booking", booked.status === "booked", JSON.stringify(booked));
  ok("lead status Scheduled (booking persisted)",
    (await getLead("L12"))?.status === "Scheduled" || (await getLead("L12"))?.status === "Work Order Created",
    (await getLead("L12"))?.status);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);

}

void main();
