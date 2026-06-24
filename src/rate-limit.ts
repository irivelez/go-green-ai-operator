// Rate limiting for the PUBLIC LLM funnel endpoint (app/api/funnel/agent). The
// funnel is open to the internet (Meta ads), so without a guard a script can hammer
// the Anthropic-backed tool loop and run up real cost. Two limits in production: a
// per-IP sliding window (abuse) and a per-lead daily cap — the interim spend proxy
// until a true token budget lands, paired with the route's maxSteps=8 turn cap.
//
// Without Upstash configured (local dev / zero-key), limiting is a NO-OP so the dev
// flow stays open — the same env-guarded degradation as the KV store backend.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const IP_LIMIT = 30; // requests per window, per client IP
const IP_WINDOW = "10 m";
const LEAD_LIMIT = 100; // requests per day, per lead (a real funnel is ~10-30 turns)
const LEAD_WINDOW = "1 d";

export type RateLimitResult = { ok: true } | { ok: false; scope: "ip" | "lead"; retryAfterSec: number };

let ipLimiter: Ratelimit | null = null;
let leadLimiter: Ratelimit | null = null;
let initialized = false;

function init(): void {
  if (initialized) return;
  initialized = true;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return; // no Upstash → no-op limiter (dev)
  const redis = new Redis({ url, token });
  ipLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(IP_LIMIT, IP_WINDOW), prefix: "rl:funnel:ip" });
  leadLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(LEAD_LIMIT, LEAD_WINDOW),
    prefix: "rl:funnel:lead",
  });
}

// Client IP from the proxy headers: first hop of x-forwarded-for, else x-real-ip,
// else "unknown" (a shared bucket — still better than no limit).
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0];
    if (first && first.trim()) return first.trim();
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export async function checkFunnelRateLimit(ip: string, leadId: string): Promise<RateLimitResult> {
  init();
  const retryAfter = (reset: number) => Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  if (ipLimiter) {
    const r = await ipLimiter.limit(`ip:${ip}`);
    if (!r.success) return { ok: false, scope: "ip", retryAfterSec: retryAfter(r.reset) };
  }
  if (leadLimiter) {
    const r = await leadLimiter.limit(`lead:${leadId}`);
    if (!r.success) return { ok: false, scope: "lead", retryAfterSec: retryAfter(r.reset) };
  }
  return { ok: true };
}
