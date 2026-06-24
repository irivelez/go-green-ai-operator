// Trusted client-IP resolution for rate limiting (cross-model review S9).
//
// The naive `x-forwarded-for.split(",")[0]` takes the LEFTMOST entry, which is
// CLIENT-CONTROLLED — an attacker just prepends a fake IP to get a fresh
// rate-limit bucket per request, defeating the per-IP cap. On Vercel the genuine
// client IP is in `x-real-ip` (set by the platform proxy; a client-sent value is
// overwritten), and Vercel APPENDS the real client IP as the RIGHTMOST `x-forwarded-for`
// entry. So we trust x-real-ip first, then the rightmost XFF hop, and only fall
// back to a caller-supplied stable key (e.g. leadId) when no proxy header exists
// (local dev). We NEVER trust the leftmost XFF entry.

export function clientIp(headers: Headers, fallback: string): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // Rightmost = the hop Vercel/its proxy appended (trusted), NOT the
    // leftmost client-controlled value.
    const trusted = parts[parts.length - 1];
    if (trusted) return trusted;
  }

  return fallback;
}
