// Geo-measurement pipeline test — validates free-first address-validate + Solar/heuristic
// measure + Elevation slope + the authoritative server-side computePolygonSqft.
// All Google calls are key-guarded; this suite mocks `fetch` so it runs WITHOUT keys.
// Run: npx tsx src/geo.test.ts
// Spec: §A.2 (geo-measurement pipeline), §A.3 (slope handling).

import {
  validateAddress,
  autoMeasureRoofBbox,
  estimateLotSqft,
  slopeGradeTier,
  computePolygonSqft,
  measureFromAddress,
} from "./geo";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// Save real fetch; tests install per-case mocks then restore.
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
console.log("\n=== Scenario 1: validateAddress → CORRECTED (didYouMean set) ===");
{
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true, hasInferredComponents: true },
            address: { formattedAddress: "742 Valencia St, San Francisco, CA 94110, USA" },
            geocode: {
              location: { latitude: 37.7599, longitude: -122.4214 },
              accuracy: "ROOFTOP",
            },
          },
        },
      };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await validateAddress({
    addressLines: ["742 valencia st"],
    locality: "san francisco",
    adminArea: "CA",
    postalCode: "94110",
  });
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("verdict CORRECTED", res.verdict === "CORRECTED", res.verdict);
    ok("didYouMean populated", res.didYouMean === "742 Valencia St, San Francisco, CA 94110, USA",
       res.didYouMean ?? "");
    ok("standardized lat/lng",
       res.standardized.lat === 37.7599 && res.standardized.lng === -122.4214,
       `${res.standardized.lat},${res.standardized.lng}`);
    ok("accuracy preserved", res.standardized.accuracy === "ROOFTOP", res.standardized.accuracy);
  }
  restoreFetch();
}

console.log("\n=== Scenario 2: autoMeasureRoofBbox → Solar payload mapped ===");
{
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("solar.googleapis.com")) {
      return {
        status: 200,
        body: {
          boundingBox: {
            sw: { latitude: 37.7595, longitude: -122.4220 },
            ne: { latitude: 37.7605, longitude: -122.4210 },
          },
          solarPotential: { wholeRoofStats: { areaMeters2: 142.5 } },
        },
      };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await autoMeasureRoofBbox(37.76, -122.4215);
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("roof_area_m2 correct", res.roof_area_m2 === 142.5, String(res.roof_area_m2));
    ok("bbox sw mapped", res.roof_bbox.sw.lat === 37.7595 && res.roof_bbox.sw.lng === -122.4220);
    ok("bbox ne mapped", res.roof_bbox.ne.lat === 37.7605 && res.roof_bbox.ne.lng === -122.4210);
  }
  restoreFetch();
}

console.log("\n=== Scenario 3: estimateLotSqft pure (no network) ===");
{
  // ratio 0.45 (default); roof = 120 m²
  // lot_m2 = 120 / 0.45 = 266.6667
  // maintainable_m2 = lot_m2 - roof = 146.6667
  // maintainable_sqft = 146.6667 * 10.7639 = 1578.7053... → round → 1579
  delete process.env.LOT_COVERAGE_RATIO;
  const r = estimateLotSqft(120);
  ok("estimated_sqft 1579 @ ratio 0.45", r.estimated_sqft === 1579, String(r.estimated_sqft));
  ok("area_confidence 0.75 when roof>0", r.area_confidence === 0.75, String(r.area_confidence));

  const r0 = estimateLotSqft(0);
  ok("area_confidence 0.4 when no roof", r0.area_confidence === 0.4, String(r0.area_confidence));
}

console.log("\n=== Scenario 4: slopeGradeTier → steep (~14% grade) ===");
{
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  // 3x3 grid, row-major. Adjacent vertical step ≈ 25m at offset 0.000225 deg lat.
  // Elevations rise 3.6m per row → max grade ≈ 3.6/25.05 ≈ 14.37% → "steep".
  mockFetch((url) => {
    if (url.includes("maps.googleapis.com/maps/api/elevation")) {
      return {
        status: 200,
        body: {
          status: "OK",
          results: [
            { elevation: 0 }, { elevation: 0 }, { elevation: 0 },
            { elevation: 3.6 }, { elevation: 3.6 }, { elevation: 3.6 },
            { elevation: 7.2 }, { elevation: 7.2 }, { elevation: 7.2 },
          ],
        },
      };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await slopeGradeTier(37.75, -122.42);
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("slope_tier steep", res.slope_tier === "steep", res.slope_tier);
    ok("max_grade_pct > 12", res.max_grade_pct > 12, String(res.max_grade_pct));
    ok("sampled 9 points", res.sampled === 9, String(res.sampled));
  }
  restoreFetch();
}

console.log("\n=== Scenario 5: computePolygonSqft on ~50m × 100m rectangle ===");
{
  // Anchor lat 37.75; 50m N (Δlat=0.000449), 100m E at cos(37.75°)≈0.7906 (Δlng=0.001136).
  // True area ≈ 5000 m² → 5000 * 10.7639 ≈ 53820 sqft.
  // Unclosed ring (4 corners, last ≠ first).
  const path = [
    { lat: 37.75,         lng: -122.42 },
    { lat: 37.75 + 0.000449, lng: -122.42 },
    { lat: 37.75 + 0.000449, lng: -122.42 + 0.001136 },
    { lat: 37.75,         lng: -122.42 + 0.001136 },
  ];
  const sqft = computePolygonSqft(path);
  ok("rectangle ≈ 53820 sqft (±200)", Math.abs(sqft - 53820) < 200, `got ${sqft}`);

  ok("degenerate <3 points → 0", computePolygonSqft([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]) === 0);
}

console.log("\n=== Scenario 6: missing key → {ok:false, reason:'no_key'}, never throws ===");
{
  delete process.env.GOOGLE_MAPS_API_KEY;
  // Install a fetch that would FAIL the test if called — proves no network without a key.
  globalThis.fetch = (async () => {
    throw new Error("fetch must NOT be called without an API key");
  }) as typeof fetch;

  const va = await validateAddress({
    addressLines: ["1 Main St"], locality: "SF", adminArea: "CA", postalCode: "94105",
  });
  ok("validateAddress no_key", !va.ok && va.reason === "no_key", JSON.stringify(va));

  const rb = await autoMeasureRoofBbox(37.75, -122.42);
  ok("autoMeasureRoofBbox no_key", !rb.ok && rb.reason === "no_key", JSON.stringify(rb));

  const sg = await slopeGradeTier(37.75, -122.42);
  ok("slopeGradeTier no_key", !sg.ok && sg.reason === "no_key", JSON.stringify(sg));

  restoreFetch();
}

console.log("\n=== Scenario 7: measureFromAddress → single-family parcel outline ===");
{
  // EAS returns one row (parcel_number = blklot, no separator); parcels returns
  // mapblklot == blklot (single-family); footprint returns one MultiPolygon.
  mockFetch((url) => {
    if (url.includes("ramy-di5m")) {
      return { status: 200, body: [{ parcel_number: "3704018", block: "3704", lot: "018" }] };
    }
    if (url.includes("acdm-wktn") && url.includes(".geojson")) {
      return {
        status: 200,
        body: {
          features: [
            {
              geometry: {
                type: "MultiPolygon",
                coordinates: [[[
                  [-122.42, 37.75],
                  [-122.42, 37.7504],
                  [-122.4195, 37.7504],
                  [-122.4195, 37.75],
                  [-122.42, 37.75],
                ]]],
              },
              properties: { blklot: "3704018", mapblklot: "3704018" },
            },
          ],
        },
      };
    }
    if (url.includes("acdm-wktn")) {
      return { status: 200, body: [{ blklot: "3704018", mapblklot: "3704018" }] };
    }
    if (url.includes("ynuv-fyni")) {
      return { status: 200, body: { features: [] } };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await measureFromAddress({
    addressNumber: "1450",
    streetName: "PAGE",
    streetType: "ST",
  });
  ok("ok:true", res.ok, JSON.stringify(res).slice(0, 160));
  if (res.ok) {
    ok("not a condo (single-family)", res.shared_multi_unit === false, String(res.shared_multi_unit));
    ok("parcel ring returned (lat/lng)", Array.isArray(res.parcel_ring) && res.parcel_ring.length >= 3,
       `len ${res.parcel_ring?.length}`);
    ok("ring point is {lat,lng}", res.parcel_ring[0]?.lat === 37.75 && res.parcel_ring[0]?.lng === -122.42,
       JSON.stringify(res.parcel_ring[0]));
    ok("blklot threaded", res.blklot === "3704018", res.blklot);
  }
  restoreFetch();
}

console.log("\n=== Scenario 8: measureFromAddress → condo (mapblklot ≠ blklot) → shared_multi_unit ===");
{
  // 488 Folsom: EAS blklot 3737084 → parcel mapblklot 3737042 (stacked condo).
  mockFetch((url) => {
    if (url.includes("ramy-di5m")) {
      return { status: 200, body: [{ parcel_number: "3737084", block: "3737", lot: "084" }] };
    }
    if (url.includes("acdm-wktn")) {
      return { status: 200, body: [{ blklot: "3737084", mapblklot: "3737042" }] };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await measureFromAddress({
    addressNumber: "488",
    streetName: "FOLSOM",
    streetType: "ST",
  });
  ok("ok:true", res.ok, JSON.stringify(res).slice(0, 160));
  if (res.ok) {
    ok("shared_multi_unit true (escalate)", res.shared_multi_unit === true, String(res.shared_multi_unit));
    ok("no parcel ring needed for escalated condo", !res.parcel_ring || res.parcel_ring.length === 0,
       `len ${res.parcel_ring?.length ?? 0}`);
  }
  restoreFetch();
}

console.log("\n=== Scenario 9: measureFromAddress → no EAS match → fallback (blank-draw) ===");
{
  // 1450 Page genuinely absent from EAS → empty array → blank-draw fallback,
  // NOT an error, NOT an escalation (§A.2 single-family no-match path).
  mockFetch((url) => {
    if (url.includes("ramy-di5m")) return { status: 200, body: [] };
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await measureFromAddress({
    addressNumber: "1450",
    streetName: "PAGE",
    streetType: "ST",
  });
  ok("ok:false with reason no_parcel_match", !res.ok && res.reason === "no_parcel_match", JSON.stringify(res));
  restoreFetch();
}

console.log("\n=== Scenario 10: measureFromAddress never throws on network error ===");
{
  // DataSF works WITHOUT a token (token only improves rate limits) — so unlike the
  // Google no_key guard, measureFromAddress always attempts the call and must
  // degrade gracefully (→ fallback), never throw, when the network fails.
  delete process.env.SOCRATA_APP_TOKEN;
  globalThis.fetch = (async () => {
    throw new Error("simulated network failure");
  }) as typeof fetch;

  let threw = false;
  let res: Awaited<ReturnType<typeof measureFromAddress>> | undefined;
  try {
    res = await measureFromAddress({ addressNumber: "1", streetName: "MAIN", streetType: "ST" });
  } catch {
    threw = true;
  }
  ok("never throws on network failure", !threw);
  ok("returns ok:false fallback", !!res && !res.ok, JSON.stringify(res));
  restoreFetch();
}

console.log("\n=== Scenario 11: validateAddress → surfaces USPS-normalized structured parts (parcel join input) ===");
{
  // The DataSF parcel join needs number / street-name-without-type / USPS street-type.
  // Google's uspsData.standardizedAddress.firstAddressLine is already CASS-normalized
  // ("1916 OCTAVIA ST") — the authoritative source. validateAddress MUST surface these
  // so the lead can persist them and measure_property never depends on the LLM re-parsing.
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true },
            address: {
              formattedAddress: "1916 Octavia St, San Francisco, CA 94109-3357, USA",
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
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await validateAddress({
    addressLines: ["1916 octavia st"], locality: "san francisco", adminArea: "CA", postalCode: "94109",
  });
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("verdict VALIDATED", res.verdict === "VALIDATED", res.verdict);
    ok("parts.addressNumber '1916'", res.parts?.addressNumber === "1916", res.parts?.addressNumber);
    ok("parts.streetName 'OCTAVIA' (type stripped, uppercased)", res.parts?.streetName === "OCTAVIA", res.parts?.streetName);
    ok("parts.streetType 'ST' (USPS abbrev)", res.parts?.streetType === "ST", res.parts?.streetType);
  }
  restoreFetch();
}

console.log("\n=== Scenario 12: validateAddress → directional 'South Van Ness Ave' keeps full word in street_name ===");
{
  // Verified against live EAS (ramy-di5m): directionals are stored SPELLED OUT inside
  // street_name ('SOUTH VAN NESS') with NO predirection column — 'S VAN NESS' returns 0 rows.
  // Google's route component carries the full word ('South Van Ness Avenue'); uspsData
  // abbreviates ('S VAN NESS') and would MISS. So route is the primary source.
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true },
            address: {
              formattedAddress: "100 S Van Ness Ave, San Francisco, CA 94103, USA",
              addressComponents: [
                { componentType: "street_number", componentName: { text: "100" } },
                { componentType: "route", componentName: { text: "South Van Ness Avenue" } },
              ],
            },
            geocode: { location: { latitude: 37.7726, longitude: -122.4188 }, accuracy: "ROOFTOP" },
            uspsData: { standardizedAddress: { firstAddressLine: "100 S VAN NESS AVE" } },
          },
        },
      };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await validateAddress({
    addressLines: ["100 s van ness ave"], locality: "san francisco", adminArea: "CA", postalCode: "94103",
  });
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("streetName 'SOUTH VAN NESS' (full directional kept, matches EAS)", res.parts?.streetName === "SOUTH VAN NESS", res.parts?.streetName);
    ok("streetType 'AVE'", res.parts?.streetType === "AVE", res.parts?.streetType);
    ok("addressNumber '100'", res.parts?.addressNumber === "100", res.parts?.addressNumber);
  }
  restoreFetch();
}

console.log("\n=== Scenario 12b: validateAddress → numbered street '3rd Street' zero-pads to EAS form '03RD' ===");
{
  // Verified live: EAS zero-pads numbered streets to 2 digits — '03RD','01ST','09TH'
  // exist, '11TH'+ unchanged. Google route gives '3rd Street' → naive '3RD' would MISS.
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true },
            address: {
              formattedAddress: "1000 3rd St, San Francisco, CA 94158, USA",
              addressComponents: [
                { componentType: "street_number", componentName: { text: "1000" } },
                { componentType: "route", componentName: { text: "3rd Street" } },
              ],
            },
            geocode: { location: { latitude: 37.7706, longitude: -122.3899 }, accuracy: "ROOFTOP" },
            uspsData: { standardizedAddress: { firstAddressLine: "1000 3RD ST" } },
          },
        },
      };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await validateAddress({
    addressLines: ["1000 3rd st"], locality: "san francisco", adminArea: "CA", postalCode: "94158",
  });
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("streetName '03RD' (zero-padded to EAS convention)", res.parts?.streetName === "03RD", res.parts?.streetName);
    ok("streetType 'ST'", res.parts?.streetType === "ST", res.parts?.streetType);
  }
  restoreFetch();
}

console.log("\n=== Scenario 12c: validateAddress → unrecognized street type → no parts (degrade to draw, never guess) ===");
{
  // Oracle guard: if the last route token isn't a known USPS-style type, do NOT persist
  // a garbage join key — return no parts so measure falls through to heuristic/draw.
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true },
            address: {
              formattedAddress: "1 Pier 39, San Francisco, CA 94133, USA",
              addressComponents: [
                { componentType: "street_number", componentName: { text: "1" } },
                { componentType: "route", componentName: { text: "Embarcadero" } },
              ],
            },
            geocode: { location: { latitude: 37.8087, longitude: -122.4098 }, accuracy: "ROOFTOP" },
          },
        },
      };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await validateAddress({
    addressLines: ["1 embarcadero"], locality: "san francisco", adminArea: "CA", postalCode: "94133",
  });
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("no parts when type unrecognized (single-token route)", res.parts === undefined, JSON.stringify(res.parts));
  }
  restoreFetch();
}

console.log("\n=== Scenario 13: validateAddress → no uspsData → addressComponents fallback (route type-mapped) ===");
{
  // When uspsData is absent (e.g. non-deliverable address), fall back to
  // addressComponents: street_number + route ("Octavia Street") → map Street→ST.
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  mockFetch((url) => {
    if (url.includes("addressvalidation.googleapis.com")) {
      return {
        status: 200,
        body: {
          result: {
            verdict: { addressComplete: true },
            address: {
              formattedAddress: "1916 Octavia St, San Francisco, CA 94109, USA",
              addressComponents: [
                { componentType: "street_number", componentName: { text: "1916" } },
                { componentType: "route", componentName: { text: "Octavia Street" } },
              ],
            },
            geocode: { location: { latitude: 37.7904, longitude: -122.4271 }, accuracy: "ROOFTOP" },
          },
        },
      };
    }
    return { status: 404, body: { error: "unexpected url" } };
  });

  const res = await validateAddress({
    addressLines: ["1916 octavia st"], locality: "san francisco", adminArea: "CA", postalCode: "94109",
  });
  ok("ok:true", res.ok);
  if (res.ok) {
    ok("fallback addressNumber '1916'", res.parts?.addressNumber === "1916", res.parts?.addressNumber);
    ok("fallback streetName 'OCTAVIA'", res.parts?.streetName === "OCTAVIA", res.parts?.streetName);
    ok("fallback streetType 'ST' (Street→ST mapped)", res.parts?.streetType === "ST", res.parts?.streetType);
  }
  restoreFetch();
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
}

void main();
