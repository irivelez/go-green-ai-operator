// Photo count + byte cap at INGEST (todo 6 — cost-bomb guard).
//
// A hostile lead can upload 50 photos in one request; capping only at
// analyze-time (the Anthropic call) stops the vision spend but NOT the storage
// cost-bomb — the photos already landed in the store. So this meter runs at the
// agent-route INGEST, BEFORE upsertLead persists them (Oracle/Momus S2).
//
// This is a SEPARATE meter from the LLM token budget (todo 5 / Metis C4): photo
// uploads do NOT decrement the $0.50 spend budget. Caps (Metis M7): 2 photos
// max, 10MB/photo, 20MB/session. The per-session count is an atomic INCR so
// concurrent requests can't both slip past the limit.

import { getSharedRedis } from "./store";
import { canonicalEmail } from "./customer";

export function photoCaps() {
  return {
    maxPhotos: Number(process.env.PHOTO_MAX_COUNT ?? 2),
    maxBytesPerPhoto: Number(process.env.PHOTO_MAX_BYTES ?? 10 * 1024 * 1024),
    maxBytesPerSession: Number(process.env.PHOTO_MAX_SESSION_BYTES ?? 20 * 1024 * 1024),
  };
}

const TTL_DAY_SECONDS = 36 * 60 * 60;
const DAY = () => new Date().toISOString().slice(0, 10);

// Atomic count meter: INCR, set TTL once, DECR + return 0 on breach.
const COUNT_LUA = `
local v = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1], 'NX')
if v > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

const BYTES_LUA = `
local v = redis.call('INCRBY', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[1], 'NX')
if v > tonumber(ARGV[2]) then
  redis.call('DECRBY', KEYS[1], ARGV[3])
  return 0
end
return 1
`;

const memCount = new Map<string, number>();
const memBytes = new Map<string, number>();

export function resetPhotoCaps(): void {
  memCount.clear();
  memBytes.clear();
}

function identityKey(emailOrLeadId: string): string {
  return emailOrLeadId.includes("@") ? canonicalEmail(emailOrLeadId) : emailOrLeadId;
}

// Decoded byte size of a base64 data URI (the payload after the comma).
export function photoByteSize(dataUri: string): number {
  const comma = dataUri.indexOf(",");
  const b64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

async function countIncr(key: string): Promise<boolean> {
  const cap = photoCaps().maxPhotos;
  const redis = getSharedRedis();
  if (redis) {
    const r = (await redis.eval(COUNT_LUA, [key], [String(TTL_DAY_SECONDS), String(cap)])) as number;
    return r === 1;
  }
  const next = (memCount.get(key) ?? 0) + 1;
  if (next > cap) return false;
  memCount.set(key, next);
  return true;
}

async function bytesIncr(key: string, by: number): Promise<boolean> {
  const cap = photoCaps().maxBytesPerSession;
  const redis = getSharedRedis();
  if (redis) {
    const r = (await redis.eval(BYTES_LUA, [key], [String(TTL_DAY_SECONDS), String(cap), String(by)])) as number;
    return r === 1;
  }
  const next = (memBytes.get(key) ?? 0) + by;
  if (next > cap) return false;
  memBytes.set(key, next);
  return true;
}

export interface PhotoCapResult {
  accepted: string[];
  rejected: number;
  message?: string;
}

// Filter a batch of incoming photos against the count + per-photo + per-session
// byte caps. Returns only the photos that fit; the caller persists `accepted`
// and surfaces `message` to the customer when anything was dropped.
export async function admitPhotos(
  emailOrLeadId: string,
  photos: string[],
): Promise<PhotoCapResult> {
  const id = identityKey(emailOrLeadId);
  const day = DAY();
  const countKey = `photo:count:${id}:${day}`;
  const bytesKey = `photo:bytes:${id}:${day}`;
  const accepted: string[] = [];
  let rejected = 0;

  const maxBytesPerPhoto = photoCaps().maxBytesPerPhoto;
  for (const p of photos) {
    const size = photoByteSize(p);
    if (size > maxBytesPerPhoto) {
      rejected++;
      continue;
    }
    if (!(await countIncr(countKey))) {
      rejected++;
      continue;
    }
    if (!(await bytesIncr(bytesKey, size))) {
      rejected++;
      continue;
    }
    accepted.push(p);
  }

  return {
    accepted,
    rejected,
    message: rejected > 0 ? "I have enough photos to price your yard." : undefined,
  };
}
