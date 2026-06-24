// Baseline security headers (go-live G5). Safe, no-breakage set — applied to every
// route. A Content-Security-Policy is deliberately NOT set yet: the /agent page loads
// the Google Maps JS SDK (and Stripe Checkout is a full redirect), so a CSP needs a
// tested allowlist + report-only rollout to avoid silently breaking the map (the
// measure step). Tracked as a post-launch follow-up.
const securityHeaders = [
  // Force HTTPS for two years incl. subdomains. No `preload` — that's a hard-to-undo
  // commitment for a fresh domain; add it once the domain is stable.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Anti-clickjacking. SAMEORIGIN (not DENY) leaves room to embed on Go Green's own
  // origin later while still blocking cross-origin framing of the payment funnel.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Domain logic lives in src/ and is imported by app/ routes; nothing extra needed.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
