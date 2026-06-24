// Cron-overlap lock (todo 8 — Vercel Cron has NO built-in mutex).
//
// A drain that runs longer than its cron interval would overlap the next
// invocation → double-processing. `withCronLock` wraps a handler in a Redis
// `SET NX EX` lock so only ONE invocation runs at a time.
//
// TTL = the function's maxDuration + 30s slack, NOT the cron interval (Oracle
// Fix7 / Momus S3): the lock exists to survive a slow run; if the TTL were below
// the legitimate runtime the lock would expire mid-run and a second drainer
// would start — exactly what the lock must prevent. The lock is DEL'd on success
// so the TTL only matters on a crash.

import { getSharedRedis } from "./store";

const LOCK_KEY = (name: string) => `cronlock:${name}`;

// In-process lock for dev (single process → a held flag is sufficient).
const memLocks = new Set<string>();

export function resetCronLocks(): void {
  memLocks.clear();
}

export interface CronLockResult<T> {
  ran: boolean;
  result?: T;
}

// Run `fn` under an exclusive lock named `name`. If the lock is already held,
// no-op (ran=false). TTL defaults to 90s (maxDuration 60 + 30 slack); pass the
// route's own maxDuration+30 when it differs.
export async function withCronLock<T>(
  name: string,
  fn: () => Promise<T>,
  ttlSeconds = 90,
): Promise<CronLockResult<T>> {
  const key = LOCK_KEY(name);
  const redis = getSharedRedis();

  if (redis) {
    const acquired = await redis.set(key, Date.now().toString(), { nx: true, ex: ttlSeconds });
    if (acquired !== "OK") return { ran: false };
    try {
      const result = await fn();
      return { ran: true, result };
    } finally {
      // Release on success OR throw — the TTL is only a crash backstop.
      await redis.del(key);
    }
  }

  if (memLocks.has(key)) return { ran: false };
  memLocks.add(key);
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    memLocks.delete(key);
  }
}
