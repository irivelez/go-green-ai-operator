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

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
}

void main();
