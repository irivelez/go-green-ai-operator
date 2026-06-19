// Pure helper for AreaConfirmCard (§A.2 step-4):
// - real DataSF parcel ring (≥3 pts) → pre-draw it for one-tap confirm.
// - no parcel match (empty ring) → empty (customer draws on a blank satellite).
//
// The ring is the authoritative lot outline (acdm-wktn), so we pre-draw it
// verbatim — no roof-bbox ×1.4 fudge. Returns it CLOSED (first === last) so the
// Google Maps Polygon renders cleanly and the test can verify closure headlessly.

export type LatLng = { lat: number; lng: number };
export type RoofBbox = { sw: LatLng; ne: LatLng } | null;

export function pickInitialPath(parcelRing: LatLng[]): LatLng[] {
  if (!Array.isArray(parcelRing) || parcelRing.length < 3) return [];
  const first = parcelRing[0]!;
  const last = parcelRing[parcelRing.length - 1]!;
  const closed = first.lat === last.lat && first.lng === last.lng;
  return closed ? [...parcelRing] : [...parcelRing, { lat: first.lat, lng: first.lng }];
}

// Client-side display-only m² → sqft factor. The SERVER (geo.computePolygonSqft)
// is the authoritative number for pricing; this is just for the live label.
export const M2_TO_SQFT = 10.7639;
