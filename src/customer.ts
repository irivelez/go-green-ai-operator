// Email-PK Customer store (todo 2 — spec §A.6 returning-customer memory).
//
// The Customer entity is keyed by a CANONICAL email and stored as a flat Redis
// Hash `customer:{canonicalEmail}` — the same per-field-atomic HSET model as the
// Lead (todo 1). "Flat" = no nested objects; one HSET field per property. This
// is the read path Phase B returning-recognition (todo 20) queries: a verified
// email match → "same garden?" without re-asking address/sqft/slope.
//
// Schema LOCKED (Metis D3): subscription fields are optional (set in Phase C);
// address/sqft/slope are required for Phase B recognition (D1). A returning
// customer's new address OVERWRITES the stored one (AG5 — flat model; the
// Property entity is V1.1).
//
// Canonicalization collapses gmail dots/plus-tags + case/whitespace so the same
// human is one key. This is the dedup boundary for the double-charge guard
// (todo 7) and the spend cap (todo 5), so it MUST be deterministic.

import { getSharedRedis } from "./store";

export interface Customer {
  email: string; // canonical
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  address?: string;
  sqft?: number;
  slope?: "flat" | "moderate" | "steep";
  status: string;
  createdAt: string;
  updatedAt: string;
}

const CUSTOMER_KEY = (canonicalEmail: string) => `customer:${canonicalEmail}`;

// Canonicalize an email so the same human maps to one key:
//   - trim + lowercase
//   - gmail/googlemail: strip dots in the local part + drop the +tag
//   - other providers: drop the +tag only (dots are significant elsewhere)
export function canonicalEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

const STRING_KEYS = new Set<keyof Customer>([
  "email",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "address",
  "slope",
  "status",
  "createdAt",
  "updatedAt",
]);

function hydrate(canonical: string, raw: Record<string, unknown>): Customer {
  const out: Record<string, unknown> = { email: canonical };
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (k === "sqft") out[k] = typeof v === "number" ? v : Number(v);
    else if (STRING_KEYS.has(k as keyof Customer)) out[k] = typeof v === "string" ? v : String(v);
    else out[k] = v;
  }
  if (typeof out.status !== "string") out.status = "active";
  if (typeof out.createdAt !== "string") out.createdAt = new Date().toISOString();
  if (typeof out.updatedAt !== "string") out.updatedAt = out.createdAt;
  return out as unknown as Customer;
}

// In-process store for memory/json dev paths (no Upstash). Keyed by canonical.
const memCustomers = new Map<string, Customer>();

export function resetCustomers(): void {
  memCustomers.clear();
}

// Atomic per-field upsert (HSET) — only the provided fields are written, so a
// payment-time update can't clobber a concurrent recognition write. createdAt is
// set once (HSETNX); updatedAt is bumped every call.
export async function materializeCustomer(
  rawEmail: string,
  fields: Partial<Omit<Customer, "email" | "createdAt" | "updatedAt">>,
): Promise<Customer> {
  const email = canonicalEmail(rawEmail);
  const now = new Date().toISOString();
  const redis = getSharedRedis();
  if (redis) {
    const payload: Record<string, string | number> = { updatedAt: now };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      payload[k] = v as string | number;
    }
    const pipe = redis.multi();
    pipe.hset(CUSTOMER_KEY(email), payload);
    pipe.hsetnx(CUSTOMER_KEY(email), "email", email);
    pipe.hsetnx(CUSTOMER_KEY(email), "status", fields.status ?? "active");
    pipe.hsetnx(CUSTOMER_KEY(email), "createdAt", now);
    await pipe.exec();
    return (await lookupCustomerByEmail(email))!;
  }
  const existing = memCustomers.get(email);
  const merged: Customer = {
    email,
    status: "active",
    createdAt: now,
    ...(existing ?? {}),
    ...fields,
    updatedAt: now,
  };
  memCustomers.set(email, merged);
  return merged;
}

export async function lookupCustomerByEmail(rawEmail: string): Promise<Customer | undefined> {
  const email = canonicalEmail(rawEmail);
  const redis = getSharedRedis();
  if (redis) {
    const raw = await redis.hgetall<Record<string, unknown>>(CUSTOMER_KEY(email));
    if (!raw || Object.keys(raw).length === 0) return undefined;
    return hydrate(email, raw);
  }
  const c = memCustomers.get(email);
  return c ? { ...c } : undefined;
}
