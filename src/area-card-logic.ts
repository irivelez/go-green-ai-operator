// Pure helper for AreaConfirmCard (§A.2 step-4):
// - HIGH confidence + valid roof_bbox → pre-drawn polygon (one-tap confirm path).
// - LOW confidence OR no roof_bbox → empty (customer draws on a blank satellite).
//
// We approximate "maintainable lot" by enlarging the roof bbox ×1.4 around its
// centroid. Returns a 5-point CLOSED ring (first === last) so Google Maps Polygon
// renders cleanly and the unit test can verify closure without a browser.

export type LatLng = { lat: number; lng: number };
export type RoofBbox = { sw: LatLng; ne: LatLng } | null;

const LOT_ENLARGE = 1.4; // approximate lot footprint beyond roof bbox.

export function pickInitialPath(
  roof_bbox: RoofBbox,
  area_confidence: number,
  threshold: number,
): LatLng[] {
  if (!roof_bbox) return [];
  if (area_confidence < threshold) return [];

  const cLat = (roof_bbox.sw.lat + roof_bbox.ne.lat) / 2;
  const cLng = (roof_bbox.sw.lng + roof_bbox.ne.lng) / 2;
  const halfLat = ((roof_bbox.ne.lat - roof_bbox.sw.lat) / 2) * LOT_ENLARGE;
  const halfLng = ((roof_bbox.ne.lng - roof_bbox.sw.lng) / 2) * LOT_ENLARGE;

  // 4 corners (SW, NW, NE, SE) + close.
  const sw: LatLng = { lat: cLat - halfLat, lng: cLng - halfLng };
  const nw: LatLng = { lat: cLat + halfLat, lng: cLng - halfLng };
  const ne: LatLng = { lat: cLat + halfLat, lng: cLng + halfLng };
  const se: LatLng = { lat: cLat - halfLat, lng: cLng + halfLng };
  return [sw, nw, ne, se, sw];
}

// Client-side display-only m² → sqft factor. The SERVER (geo.computePolygonSqft)
// is the authoritative number for pricing; this is just for the live label.
export const M2_TO_SQFT = 10.7639;
