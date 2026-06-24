// Typed environment helpers — geo measurement + crew calendar + pricing calibration.
// Spec: §A.2 (geo-measurement pipeline), §A.10 (pricing calibration).

/**
 * Public base URL of the deployed app — used to build ABSOLUTE Stripe success/cancel
 * URLs that must point at the real domain, not localhost (go-live G2). Prefers an
 * explicit APP_BASE_URL (your custom domain); falls back to Vercel's per-deploy
 * VERCEL_URL, then localhost for dev. Trailing slashes trimmed.
 */
export function getAppBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Get Google Maps server-side API key (restricted to Address Validation + Solar + Elevation + Places).
 * Used server-side only; never exposed to client.
 * Spec: §A.2 — Address Validation API, Solar buildingInsights:findClosest, Elevation API.
 */
export function getGoogleServerKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY;
}

/**
 * Get the DataSF Socrata app token (X-App-Token header).
 * Spec: §A.2 — Socrata defaulted to SODA3 (Oct 2025) and throttles anonymous
 * traffic; a free app token restores reliable throughput. Key-guarded like the
 * Google key: missing token still attempts the anonymous SODA2 endpoint, and any
 * throttle/failure falls through to the customer-draw fallback (never throws).
 */
export function getSocrataAppToken(): string | undefined {
  return process.env.SOCRATA_APP_TOKEN;
}

/**
 * Get Google Calendar ID for crew handoff.
 * Spec: §A.5 — crew endpoint via Google Calendar event (Composio).
 */
export function getGoogleCalendarId(): string | undefined {
  return process.env.GOOGLE_CALENDAR_ID;
}

/**
 * Check if Stripe LIVE mode is enabled (production charge gate).
 * Spec: §A.5 — "V1 ships LIVE Stripe (real money), not test mode."
 * Only true when explicitly set to "1"; any other value is false.
 */
export function isStripeLiveOK(): boolean {
  return process.env.STRIPE_LIVE_OK === "1";
}

/**
 * Get lot coverage ratio for heuristic area estimation.
 * Spec: §A.2 — "parcel-area ESTIMATE = building bbox scaled by a residential lot-coverage heuristic (SF default)".
 * Default: 0.45 (SF residential standard).
 * Falls back to default if env value is NaN.
 */
export function getLotCoverageRatio(): number {
  const val = parseFloat(process.env.LOT_COVERAGE_RATIO || "");
  return isNaN(val) ? 0.45 : val;
}

/**
 * Get area confidence threshold for draw-on-failure logic.
 * Spec: §A.2 — "confidence HIGH → polygon is pre-drawn; customer taps 'looks right' (one tap) or nudges it.
 * confidence LOW → polygon is rough/absent; customer draws/redraws the maintained area."
 * Default: 0.6 (60% confidence triggers pre-draw; below triggers blank canvas).
 * Falls back to default if env value is NaN.
 */
export function getAreaConfidenceThreshold(): number {
  const val = parseFloat(process.env.AREA_CONFIDENCE_THRESHOLD || "");
  return isNaN(val) ? 0.6 : val;
}
