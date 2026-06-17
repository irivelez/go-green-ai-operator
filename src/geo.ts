// Free-first geo-measurement pipeline — the new pricing input (spec §A.2, §A.3).
//   1. validateAddress     — Google Address Validation API (verdict + standardized + ROOFTOP geocode)
//   2. autoMeasureRoofBbox — Google Solar buildingInsights:findClosest (roof bbox + area)
//   3. estimateLotSqft     — pure heuristic: scale roof by lot-coverage ratio, subtract roof itself
//   4. slopeGradeTier      — Google Elevation API, 3×3 grid → max adjacent grade% → flat/moderate/steep
//   5. computePolygonSqft  — pure: spherical-excess polygon area (server-side mirror of
//                            google.maps.geometry.spherical.computeArea); the authoritative area math.
//
// All Google calls are key-guarded: missing key → {ok:false, reason:"no_key"}, NEVER throws.
// Errors are logged via console.error (Constitution §8 — never silently swallowed).
// V1 cost target: ~$0–0.02/lead — comfortably inside Google's $200/mo free credit.

import { getGoogleServerKey, getLotCoverageRatio } from "./env";

const M2_TO_SQFT = 10.7639;
const EARTH_RADIUS_M = 6378137; // matches google.maps.geometry.spherical default

// ─── 1. validateAddress ──────────────────────────────────────────────────────

export interface ValidateAddressInput {
  addressLines: string[];
  locality: string;
  adminArea: string;
  postalCode: string;
  sessionToken?: string;
}

export type ValidateAddressResult =
  | {
      ok: true;
      verdict: "VALIDATED" | "CORRECTED" | "UNVALIDATABLE";
      standardized: { formattedAddress: string; lat: number; lng: number; accuracy: string };
      didYouMean?: string;
    }
  | { ok: false; reason: string };

export async function validateAddress(input: ValidateAddressInput): Promise<ValidateAddressResult> {
  const key = getGoogleServerKey();
  if (!key) return { ok: false, reason: "no_key" };

  try {
    const res = await fetch(
      `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: {
            regionCode: "US",
            addressLines: input.addressLines,
            locality: input.locality,
            administrativeArea: input.adminArea,
            postalCode: input.postalCode,
          },
          enableUspsCass: true,
          sessionToken: input.sessionToken,
        }),
      },
    );
    if (!res.ok) {
      console.error("[geo] validateAddress non-200:", res.status);
      return { ok: false, reason: `http_${res.status}` };
    }
    const data = (await res.json()) as {
      result?: {
        verdict?: {
          addressComplete?: boolean;
          hasReplacedComponents?: boolean;
          hasInferredComponents?: boolean;
        };
        address?: { formattedAddress?: string };
        geocode?: {
          location?: { latitude?: number; longitude?: number };
          accuracy?: string;
        };
      };
    };
    const r = data.result;
    const formattedAddress = r?.address?.formattedAddress;
    const lat = r?.geocode?.location?.latitude;
    const lng = r?.geocode?.location?.longitude;
    if (!formattedAddress || typeof lat !== "number" || typeof lng !== "number") {
      return { ok: false, reason: "malformed_response" };
    }
    const v = r?.verdict ?? {};
    const corrected = !!(v.hasReplacedComponents || v.hasInferredComponents);
    const verdict: "VALIDATED" | "CORRECTED" | "UNVALIDATABLE" = corrected
      ? "CORRECTED"
      : v.addressComplete
      ? "VALIDATED"
      : "UNVALIDATABLE";
    const out: ValidateAddressResult = {
      ok: true,
      verdict,
      standardized: { formattedAddress, lat, lng, accuracy: r?.geocode?.accuracy ?? "" },
    };
    if (corrected) (out as { didYouMean?: string }).didYouMean = formattedAddress;
    return out;
  } catch (e) {
    console.error("[geo] validateAddress error:", (e as Error).message);
    return { ok: false, reason: "network_error" };
  }
}

// ─── 2. autoMeasureRoofBbox ──────────────────────────────────────────────────

export type AutoMeasureResult =
  | {
      ok: true;
      roof_bbox: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } };
      roof_area_m2: number;
    }
  | { ok: false; reason: string };

export async function autoMeasureRoofBbox(lat: number, lng: number): Promise<AutoMeasureResult> {
  const key = getGoogleServerKey();
  if (!key) return { ok: false, reason: "no_key" };

  try {
    const url =
      `https://solar.googleapis.com/v1/buildingInsights:findClosest` +
      `?location.latitude=${lat}` +
      `&location.longitude=${lng}` +
      `&requiredQuality=HIGH` +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[geo] autoMeasureRoofBbox non-200:", res.status);
      return { ok: false, reason: `http_${res.status}` };
    }
    const data = (await res.json()) as {
      boundingBox?: {
        sw?: { latitude?: number; longitude?: number };
        ne?: { latitude?: number; longitude?: number };
      };
      solarPotential?: { wholeRoofStats?: { areaMeters2?: number } };
    };
    const sw = data.boundingBox?.sw;
    const ne = data.boundingBox?.ne;
    const area = data.solarPotential?.wholeRoofStats?.areaMeters2;
    if (
      typeof sw?.latitude !== "number" || typeof sw?.longitude !== "number" ||
      typeof ne?.latitude !== "number" || typeof ne?.longitude !== "number" ||
      typeof area !== "number"
    ) {
      return { ok: false, reason: "malformed_response" };
    }
    return {
      ok: true,
      roof_bbox: {
        sw: { lat: sw.latitude, lng: sw.longitude },
        ne: { lat: ne.latitude, lng: ne.longitude },
      },
      roof_area_m2: area,
    };
  } catch (e) {
    console.error("[geo] autoMeasureRoofBbox error:", (e as Error).message);
    return { ok: false, reason: "network_error" };
  }
}

// ─── 3. estimateLotSqft (PURE) ───────────────────────────────────────────────

export function estimateLotSqft(roof_area_m2: number): { estimated_sqft: number; area_confidence: number } {
  const ratio = getLotCoverageRatio(); // default 0.45
  // Scale roof to total lot, subtract the roof itself so the estimate is MAINTAINABLE area (lawn),
  // not total lot. Spec §A.2: building bbox scaled by residential lot-coverage heuristic.
  const lot_m2 = roof_area_m2 > 0 ? roof_area_m2 / ratio : 0;
  const maintainable_m2 = Math.max(0, lot_m2 - roof_area_m2);
  return {
    estimated_sqft: Math.round(maintainable_m2 * M2_TO_SQFT),
    area_confidence: roof_area_m2 > 0 ? 0.75 : 0.4,
  };
}

// ─── 4. slopeGradeTier ───────────────────────────────────────────────────────

export type SlopeResult =
  | { ok: true; slope_tier: "flat" | "moderate" | "steep"; max_grade_pct: number; sampled: number }
  | { ok: false; reason: string };

const DEG_LAT_M = 111319.5; // meters per degree of latitude (mean Earth)
const SLOPE_OFFSET_DEG = 0.000225; // ~25m at mid-latitudes

export async function slopeGradeTier(lat: number, lng: number): Promise<SlopeResult> {
  const key = getGoogleServerKey();
  if (!key) return { ok: false, reason: "no_key" };

  // 3×3 grid spanning ~50m around (lat,lng). Adjacent grid step ≈ 25m.
  const dLat = SLOPE_OFFSET_DEG;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = SLOPE_OFFSET_DEG / Math.max(cosLat, 1e-6);
  const points: { lat: number; lng: number }[] = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      points.push({ lat: lat + i * dLat, lng: lng + j * dLng });
    }
  }
  const locations = points.map((p) => `${p.lat},${p.lng}`).join("|");

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/elevation/json` +
        `?locations=${encodeURIComponent(locations)}` +
        `&key=${encodeURIComponent(key)}`,
    );
    if (!res.ok) {
      console.error("[geo] slopeGradeTier non-200:", res.status);
      return { ok: false, reason: `http_${res.status}` };
    }
    const data = (await res.json()) as {
      status?: string;
      results?: { elevation?: number }[];
    };
    const results = data.results;
    if (!Array.isArray(results) || results.length !== 9) {
      return { ok: false, reason: "malformed_response" };
    }
    const elev = results.map((r) => (typeof r.elevation === "number" ? r.elevation : NaN));
    if (elev.some((e) => !Number.isFinite(e))) {
      return { ok: false, reason: "malformed_response" };
    }
    // Walk 4-connected grid neighbours; max |Δelev|/horizontal_distance_m * 100.
    const stepLatM = dLat * DEG_LAT_M;
    const stepLngM = dLng * DEG_LAT_M * cosLat;
    let maxPct = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const here = elev[i * 3 + j]!;
        if (j < 2) {
          const east = elev[i * 3 + (j + 1)]!;
          const pct = (Math.abs(east - here) / stepLngM) * 100;
          if (pct > maxPct) maxPct = pct;
        }
        if (i < 2) {
          const south = elev[(i + 1) * 3 + j]!;
          const pct = (Math.abs(south - here) / stepLatM) * 100;
          if (pct > maxPct) maxPct = pct;
        }
      }
    }
    const slope_tier: "flat" | "moderate" | "steep" =
      maxPct < 5 ? "flat" : maxPct <= 12 ? "moderate" : "steep";
    return { ok: true, slope_tier, max_grade_pct: maxPct, sampled: 9 };
  } catch (e) {
    console.error("[geo] slopeGradeTier error:", (e as Error).message);
    return { ok: false, reason: "network_error" };
  }
}

// ─── 5. computePolygonSqft (PURE — authoritative area math) ──────────────────

// Mirrors google.maps.geometry.spherical.computeArea: signed spherical-excess sum
// over polygon edges (L'Huilier-style polarTriangleArea). Handles an unclosed ring
// — the loop wraps from the last vertex to the first.
export function computePolygonSqft(path: { lat: number; lng: number }[]): number {
  if (path.length < 3) return 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  let prev = path[path.length - 1]!;
  let prevTan = Math.tan((Math.PI / 2 - toRad(prev.lat)) / 2);
  let prevLng = toRad(prev.lng);
  for (const point of path) {
    const tan = Math.tan((Math.PI / 2 - toRad(point.lat)) / 2);
    const lng = toRad(point.lng);
    const dLng = prevLng - lng;
    const t = prevTan * tan;
    total += 2 * Math.atan2(t * Math.sin(dLng), 1 + t * Math.cos(dLng));
    prevTan = tan;
    prevLng = lng;
  }
  const area_m2 = Math.abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M);
  return Math.round(area_m2 * M2_TO_SQFT);
}
