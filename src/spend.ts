// Per-email spend caps + IP/global rate limit (todo 5 — spec §A abuse control).
//
// Each meter is an ATOMIC INCR-then-check, NOT GET-then-INCR (Oracle Fix4:
// check-then-increment is a TOCTOU — two concurrent steps both read under-cap,
// both proceed past the limit). One tiny Lua per meter increments FIRST, then
// decrements + returns 0 if the new value blew the cap, so a breach is detected
// by the caller that pushed over the line. `EXPIRE ... NX` sets the date-scoped
// TTL once on the first INCR so steady traffic doesn't keep refreshing it.
//
// Meters are keyed by CUSTOMER EMAIL (canonical), NOT session id (Metis M3:
// per-session caps reset on a new tab/session → trivially evadable). Before the
// email is known (early funnel), the caller falls back to the lead id, which is
// the stable per-session identifier.
//
// The photo cap (todo 6) is a SEPARATE meter (Metis C4) — it does NOT decrement
// this LLM token budget.

import { Ratelimit } from "@upstash/ratelimit";
import { getSharedRedis } from "./store";
import { canonicalEmail } from "./customer";

// Caps (handoff §9.4 defaults). Tunable via env without code change.
export const SPEND_CAPS = {
  modelStepsPerSession: Number(process.env.SPEND_MAX_STEPS ?? 8),
  usdPerEmailPerDay: Number(process.env.SPEND_MAX_USD ?? 0.5),
  reengagementEmails: Number(process.env.SPEND_MAX_REENGAGEMENT ?? 3),
};

const DAY = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const TTL_DAY_SECONDS = 36 * 60 * 60; // > 24h so a date key lives through its day

// INCR-then-check Lua: increment first; if over the cap, decrement back and
// return 0 (breach). Otherwise return 1 (allowed). EXPIRE ... NX sets the TTL
// once. ARGV[1]=ttl, ARGV[2]=cap. Returns 1 (ok) | 0 (breach).
const INCR_CHECK_LUA = `
local v = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1], 'NX')
if v > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

// USD meter uses a scaled integer (micro-dollars) so we can stay on integer
// INCRBY atomics. INCRBY-then-check mirrors the step meter.
const INCRBY_CHECK_LUA = `
local v = redis.call('INCRBY', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[1], 'NX')
if v > tonumber(ARGV[2]) then
  redis.call('DECRBY', KEYS[1], ARGV[3])
  return 0
end
return 1
`;

// In-process meters for memory/json dev paths (single writer → plain counters).
const memCounters = new Map<string, number>();

export function resetSpend(): void {
  memCounters.clear();
}

function memIncrCheck(key: string, by: number, cap: number): boolean {
  const next = (memCounters.get(key) ?? 0) + by;
  if (next > cap) return false;
  memCounters.set(key, next);
  return true;
}

// Identity key: canonical email when present, else the lead id (stable per
// session pre-email). This is what defeats session-reset evasion.
function identityKey(emailOrLeadId: string): string {
  return emailOrLeadId.includes("@") ? canonicalEmail(emailOrLeadId) : emailOrLeadId;
}

async function incrCheck(key: string, cap: number): Promise<boolean> {
  const redis = getSharedRedis();
  if (redis) {
    const res = (await redis.eval(INCR_CHECK_LUA, [key], [String(TTL_DAY_SECONDS), String(cap)])) as number;
    return res === 1;
  }
  return memIncrCheck(key, 1, cap);
}

async function incrByCheck(key: string, by: number, cap: number): Promise<boolean> {
  const redis = getSharedRedis();
  if (redis) {
    const res = (await redis.eval(
      INCRBY_CHECK_LUA,
      [key],
      [String(TTL_DAY_SECONDS), String(cap), String(by)],
    )) as number;
    return res === 1;
  }
  return memIncrCheck(key, by, cap);
}

export interface SpendCheck {
  allowed: boolean;
  meter: "model_steps" | "usd_budget" | "reengagement";
}

// One model step. Cap is per-identity-per-day (date-bucketed key — Oracle S3:
// the key needs the date suffix so it's a true daily window, not a 36h sliding
// one). Returns allowed=false on the step that breaches → caller escalates + stops.
export async function chargeModelStep(emailOrLeadId: string): Promise<SpendCheck> {
  const id = identityKey(emailOrLeadId);
  const ok = await incrCheck(`spend:steps:${id}:${DAY()}`, SPEND_CAPS.modelStepsPerSession);
  return { allowed: ok, meter: "model_steps" };
}

// Add estimated LLM USD (micro-dollar precision). Cap is per-email-per-day.
export async function chargeUsd(emailOrLeadId: string, usd: number): Promise<SpendCheck> {
  const id = identityKey(emailOrLeadId);
  const micro = Math.max(0, Math.round(usd * 1_000_000));
  const capMicro = Math.round(SPEND_CAPS.usdPerEmailPerDay * 1_000_000);
  const ok = await incrByCheck(`spend:usd:${id}:${DAY()}`, micro, capMicro);
  return { allowed: ok, meter: "usd_budget" };
}

// One re-engagement email. Cap is per-email lifetime-of-funnel (date-bucketed).
export async function chargeReengagement(emailOrLeadId: string): Promise<SpendCheck> {
  const id = identityKey(emailOrLeadId);
  const ok = await incrCheck(`spend:reengage:${id}`, SPEND_CAPS.reengagementEmails);
  return { allowed: ok, meter: "reengagement" };
}

// Abuse rate limits (Metis M3/UA5): per-IP/hour blocks the email-rotation cost
// bomb; global/min throttle blocks Anthropic quota exhaustion on an ad spike.
// Both no-op (always allow) without Upstash so dev/zero-key stays usable.
export const RATE_LIMITS = {
  perIpPerHour: Number(process.env.RATE_LIMIT_IP_HOUR ?? 20),
  globalPerMinute: Number(process.env.RATE_LIMIT_GLOBAL_MIN ?? 20),
};

let ipLimiter: Ratelimit | null = null;
let globalLimiter: Ratelimit | null = null;
let limitersInit = false;

function initLimiters(): void {
  if (limitersInit) return;
  limitersInit = true;
  const redis = getSharedRedis();
  if (!redis) return;
  ipLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMITS.perIpPerHour, "1 h"),
    prefix: "rl:ip",
  });
  globalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMITS.globalPerMinute, "1 m"),
    prefix: "rl:global",
  });
}

export interface RateCheck {
  allowed: boolean;
  scope: "ip" | "global" | "none";
}

// Check IP first, then the global throttle. Without Upstash both are no-ops.
export async function checkRateLimit(ip: string): Promise<RateCheck> {
  initLimiters();
  if (ipLimiter) {
    const r = await ipLimiter.limit(ip);
    if (!r.success) return { allowed: false, scope: "ip" };
  }
  if (globalLimiter) {
    const r = await globalLimiter.limit("all");
    if (!r.success) return { allowed: false, scope: "global" };
  }
  return { allowed: true, scope: "none" };
}
