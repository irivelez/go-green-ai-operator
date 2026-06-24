// geo_qualify + score_lead — pure rule-based (spec §7, §6). No LLM.

export interface LeadSignals {
  address?: string;
  zip?: string;
  property_type?: "residential" | "commercial" | "hoa" | "property_manager" | "unknown";
  has_photos?: boolean;
  desired_frequency?: string;
  condition_score?: number; // 0..10 from vision
  vision_confidence?: number; // 0..1
}

const SERVICE_AREA_ZIPS = new Set(
  (
    process.env.SERVICE_AREA_ZIPS ??
    "94102,94103,94104,94105,94107,94108,94109,94110,94111,94112,94114,94115,94116,94117,94118,94121,94122,94123,94124,94127,94131,94132,94133,94134,94158"
  )
    .split(",")
    .map((z) => z.trim()),
);

export interface GeoResult {
  in_area: boolean;
  zone: string | null;
  reason: string;
}

export function geoQualify(input: { zip?: string; address?: string }): GeoResult {
  const zip = input.zip ?? input.address?.match(/\b94\d{3}\b/)?.[0];
  if (!zip) return { in_area: false, zone: null, reason: "no zip detected — need address" };
  if (SERVICE_AREA_ZIPS.has(zip)) return { in_area: true, zone: `SF-${zip}`, reason: "in SF service area" };
  return { in_area: false, zone: null, reason: `zip ${zip} outside SF service area` };
}

export type LeadScore = "A" | "B" | "C";

export interface ScoreResult {
  score: LeadScore;
  risk: "low" | "medium" | "high";
  reasons: string[];
}

// A = qualified standard residential, in-area, complete info
// B = residential but incomplete info / needs work
// C = not a fit (out of area, non-residential handled via escalation upstream)
export function scoreLead(s: LeadSignals, geo: GeoResult): ScoreResult {
  const reasons: string[] = [];

  if (!geo.in_area) {
    return { score: "C", risk: "low", reasons: ["out of service area → not a fit"] };
  }
  if (s.property_type && s.property_type !== "residential" && s.property_type !== "unknown") {
    return { score: "C", risk: "high", reasons: [`${s.property_type} → escalate, not standard residential`] };
  }

  const haveAddress = !!s.address || !!s.zip;
  const haveFreq = !!s.desired_frequency;
  const havePhotos = !!s.has_photos;
  const complete = haveAddress && haveFreq && havePhotos;

  if (complete) {
    reasons.push("in-area residential with address + frequency + photos");
    const risk = (s.vision_confidence ?? 1) < 0.5 ? "medium" : "low";
    if (risk === "medium") reasons.push("low vision confidence — verify before autonomous price");
    return { score: "A", risk, reasons };
  }

  if (!haveAddress) reasons.push("missing address");
  if (!haveFreq) reasons.push("missing frequency");
  if (!havePhotos) reasons.push("missing photos");
  return { score: "B", risk: "low", reasons };
}
