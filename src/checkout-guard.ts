// Double-charge guard (todo 7 — money safety).
//
// Two tabs / two concurrent propose_checkout calls must NOT create two Stripe
// sessions → two charges. Two layers:
//   1. PRIMARY: a Stripe Idempotency-Key derived from (email, tier, frequency,
//      day). Two concurrent callers send the SAME key; Stripe returns the SAME
//      session to both — never a duplicate charge. This is the real defense.
//   2. CACHE: an in-flight key `checkout:{emailHash}:{purchase}` storing the
//      REAL session URL (SET NX EX 1800). A returning/abandoned re-entry GETs
//      the existing URL and reuses it (closes S11 too). The stored value is
//      NEVER a placeholder — only ever a real URL — so a loser can't be handed a
//      non-URL string (Oracle round-2 money-hole fix).
//
// The key is cleared when the paid webhook fires (handleStripeEvent).

import { createHash } from "node:crypto";
import { getSharedRedis } from "./store";
import { canonicalEmail } from "./customer";

const IN_FLIGHT_TTL_SECONDS = 1800; // 30 min — a Stripe Checkout session's life

function purchaseKey(email: string, tier: string, frequency: string): string {
  const emailHash = createHash("sha256").update(canonicalEmail(email)).digest("hex").slice(0, 16);
  return `checkout:${emailHash}:${tier}:${frequency}`;
}

// Deterministic Idempotency-Key for the Stripe call. Day-scoped so a genuine
// next-day re-purchase isn't blocked, but two concurrent same-day calls collide.
export function checkoutIdempotencyKey(email: string, tier: string, frequency: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${canonicalEmail(email)}|${tier}|${frequency}|${day}`)
    .digest("hex");
}

const memInFlight = new Map<string, string>();

export function resetCheckoutGuard(): void {
  memInFlight.clear();
}

// Look up an existing in-flight checkout URL for this purchase, if any.
export async function getInFlightUrl(
  email: string,
  tier: string,
  frequency: string,
): Promise<string | undefined> {
  const key = purchaseKey(email, tier, frequency);
  const redis = getSharedRedis();
  if (redis) {
    const url = await redis.get<string>(key);
    return url ?? undefined;
  }
  return memInFlight.get(key);
}

// Store the REAL session URL under the in-flight key (SET NX EX). Whoever wins
// NX stores it; a loser's later GET returns the winner's real URL. Returns the
// URL that is now authoritative for this purchase (the winner's, which may be
// the value already present if another caller won the race).
export async function storeInFlightUrl(
  email: string,
  tier: string,
  frequency: string,
  realUrl: string,
): Promise<string> {
  const key = purchaseKey(email, tier, frequency);
  const redis = getSharedRedis();
  if (redis) {
    const won = await redis.set(key, realUrl, { nx: true, ex: IN_FLIGHT_TTL_SECONDS });
    if (won === "OK") return realUrl;
    const existing = await redis.get<string>(key);
    return existing ?? realUrl;
  }
  const existing = memInFlight.get(key);
  if (existing) return existing;
  memInFlight.set(key, realUrl);
  return realUrl;
}

// Clear the in-flight key once the purchase is paid (webhook) or terminally done.
export async function clearInFlight(email: string, tier: string, frequency: string): Promise<void> {
  const key = purchaseKey(email, tier, frequency);
  const redis = getSharedRedis();
  if (redis) {
    await redis.del(key);
    return;
  }
  memInFlight.delete(key);
}
