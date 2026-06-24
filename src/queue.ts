// Durable job queue on Upstash (todo 14 — ZSET + Vercel Cron, no QStash/Inngest).
//
// Model:
//   jobs:scheduled   ZSET, score = runAtMs, member = jobId  (due when score <= now)
//   jobs:in-progress ZSET, score = visibility deadline       (reclaim when score <= now)
//   job:{id}         HASH { type, payload(json), retries }   (retries is a FIELD, not
//                    a separate key — Oracle Fix5: a split counter races the reclaim
//                    sweep vs a handler-failure path)
//   dlq:{type}       LIST of jobIds that exhausted retries
//   dedup:{type}:{stableKey}  SET NX EX guard so a re-run no-ops the side effect
//
// Drain order (the drainer route calls drainQueue under withCronLock):
//   (1) RECLAIM SWEEP FIRST — jobs whose handler crashed before ZREM in-progress
//       (visibility deadline passed) are released back (Oracle Fix6).
//   (2) CLAIM due scheduled jobs atomically via Lua (ZREM scheduled → ZADD
//       in-progress with score = now + VISIBILITY_TIMEOUT).
//   (3) Each handler acquires dedup:{type}:{stableKey} via SET NX BEFORE its side
//       effect (Oracle Fix5 — ALL job types), executes, then ZREM in-progress +
//       DEL job on success.
//   (4) On failure, ONE Lua release script guarded by EXISTS (so a job already
//       DEL'd by a slow-but-successful handler is not resurrected — Oracle r2):
//       retries++ → DLQ after 3, else reschedule with backoff.
//
// VISIBILITY_TIMEOUT MUST be >= 2x the SLOWEST legitimate handler runtime, NOT
// 2x the drain interval (Oracle r2): a 130s handler under a 120s timeout gets
// reclaimed mid-run → duplicate. Handlers here are <30s → 120s is safe.

import { createHash } from "node:crypto";
import { getSharedRedis } from "./store";

export const SCHEDULED = "jobs:scheduled";
export const IN_PROGRESS = "jobs:in-progress";
const JOB_KEY = (id: string) => `job:${id}`;
const DLQ_KEY = (type: string) => `dlq:${type}`;
const DEDUP_KEY = (type: string, stableKey: string) => `dedup:${type}:${stableKey}`;

export const VISIBILITY_TIMEOUT_MS = Number(process.env.QUEUE_VISIBILITY_TIMEOUT_MS ?? 120_000);
const MAX_RETRIES = 3;
const BACKOFF_MS = 60_000;
const DEDUP_TTL_SECONDS = 24 * 60 * 60;

export type JobType =
  | "reminder"
  | "reengagement"
  | "escalation"
  | "escalation_sweep"
  | "cost_alarm_check"
  | "gcal_export";

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
}

// Handler registry: each job type maps to an async handler + a stableKey deriver
// (the dedup key so a re-run no-ops the side effect).
export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
export interface HandlerSpec {
  run: JobHandler;
  stableKey: (payload: Record<string, unknown>) => string;
}

const handlers = new Map<JobType, HandlerSpec>();
export function registerHandler(type: JobType, spec: HandlerSpec): void {
  handlers.set(type, spec);
}

function jobId(type: JobType, payload: Record<string, unknown>): string {
  return `${type}:${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16)}`;
}

// ── in-process queue for dev (no Upstash) ────────────────────────────────────
interface MemJob {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  runAtMs: number;
  retries: number;
  inProgressUntil?: number;
}
let memJobs = new Map<string, MemJob>();
let memDedup = new Set<string>();
let memDlq = new Map<string, string[]>();

export function resetQueue(): void {
  memJobs = new Map();
  memDedup = new Set();
  memDlq = new Map();
}

// ── enqueue ──────────────────────────────────────────────────────────────────

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  runAtMs: number,
): Promise<string> {
  const id = jobId(type, payload);
  const redis = getSharedRedis();
  if (redis) {
    const pipe = redis.multi();
    pipe.hset(JOB_KEY(id), { type, payload: JSON.stringify(payload), retries: 0 });
    pipe.zadd(SCHEDULED, { score: runAtMs, member: id });
    await pipe.exec();
    return id;
  }
  memJobs.set(id, { id, type, payload, runAtMs, retries: 0 });
  return id;
}

// ── atomic claim (Lua: ZREM scheduled → ZADD in-progress with deadline) ──────
const CLAIM_LUA = `
local moved = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local claimed = {}
for _, id in ipairs(moved) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('ZADD', KEYS[2], tonumber(ARGV[2]), id)
  table.insert(claimed, id)
end
return claimed
`;

// ── release after failure (Lua: EXISTS guard → retries++ → DLQ or reschedule) ─
const RELEASE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('ZREM', KEYS[3], ARGV[1])
  return 'gone'
end
local r = redis.call('HINCRBY', KEYS[1], 'retries', 1)
redis.call('ZREM', KEYS[3], ARGV[1])
if r > tonumber(ARGV[3]) then
  local t = redis.call('HGET', KEYS[1], 'type')
  redis.call('LPUSH', 'dlq:' .. t, ARGV[1])
  redis.call('DEL', KEYS[1])
  return 'dlq'
else
  redis.call('ZADD', KEYS[2], tonumber(ARGV[2]), ARGV[1])
  return 'retry'
end
`;

export interface DrainResult {
  reclaimed: number;
  executed: number;
  failed: number;
  dlq: number;
}

// Drain due jobs. Call under withCronLock. now is injectable for tests.
export async function drainQueue(now = Date.now()): Promise<DrainResult> {
  const result: DrainResult = { reclaimed: 0, executed: 0, failed: 0, dlq: 0 };
  const redis = getSharedRedis();

  if (redis) {
    // (1) Reclaim sweep FIRST: in-progress jobs past their visibility deadline.
    const stale = await redis.zrange<string[]>(IN_PROGRESS, "-inf", now, { byScore: true });
    for (const id of stale) {
      const outcome = await releaseRedis(redis, id, now);
      result.reclaimed++;
      if (outcome === "dlq") result.dlq++;
    }
    // (2) Claim due scheduled jobs atomically.
    const claimed = (await redis.eval(
      CLAIM_LUA,
      [SCHEDULED, IN_PROGRESS],
      [String(now), String(now + VISIBILITY_TIMEOUT_MS)],
    )) as string[];
    // (3) Execute each.
    for (const id of claimed) {
      const job = await redis.hgetall<{ type: string; payload: string }>(JOB_KEY(id));
      if (!job?.type) {
        await redis.zrem(IN_PROGRESS, id);
        continue;
      }
      const type = job.type as JobType;
      const payload = parsePayload(job.payload);
      const spec = handlers.get(type);
      if (!spec) {
        await releaseRedis(redis, id, now);
        result.failed++;
        continue;
      }
      const dedupKey = DEDUP_KEY(type, spec.stableKey(payload));
      try {
        const dedupOk = await redis.set(dedupKey, "1", { nx: true, ex: DEDUP_TTL_SECONDS });
        if (dedupOk === "OK") {
          await spec.run(payload);
        }
        // success (or already-done via dedup): remove from in-progress + delete body.
        await redis.zrem(IN_PROGRESS, id);
        await redis.del(JOB_KEY(id));
        result.executed++;
      } catch {
        // Handler threw AFTER we set the dedup key (cross-model review B3): clear
        // it so the retry can actually re-run the side effect. Leaving it set
        // meant the retry's SET NX failed → handler skipped → job deleted as
        // "executed" → the side effect (reminder/escalation) silently lost forever.
        await redis.del(dedupKey);
        const outcome = await releaseRedis(redis, id, now);
        result.failed++;
        if (outcome === "dlq") result.dlq++;
      }
    }
    return result;
  }

  // ── in-process drain (dev) ──────────────────────────────────────────────────
  // Reclaim stale in-progress.
  for (const job of memJobs.values()) {
    if (job.inProgressUntil && job.inProgressUntil <= now) {
      job.inProgressUntil = undefined;
      result.reclaimed++;
    }
  }
  const due = [...memJobs.values()].filter((j) => !j.inProgressUntil && j.runAtMs <= now);
  for (const job of due) {
    job.inProgressUntil = now + VISIBILITY_TIMEOUT_MS;
    const spec = handlers.get(job.type);
    if (!spec) {
      memFail(job, result, now);
      continue;
    }
    const dk = DEDUP_KEY(job.type, spec.stableKey(job.payload));
    try {
      if (!memDedup.has(dk)) {
        memDedup.add(dk);
        await spec.run(job.payload);
      }
      memJobs.delete(job.id);
      result.executed++;
    } catch {
      // Clear the dedup entry on failure so the retry can re-run (B3 — dev path
      // mirrors the Redis fix).
      memDedup.delete(dk);
      memFail(job, result, now);
    }
  }
  return result;
}

function memFail(job: MemJob, result: DrainResult, now: number): void {
  job.inProgressUntil = undefined;
  job.retries++;
  result.failed++;
  if (job.retries > MAX_RETRIES) {
    const list = memDlq.get(job.type) ?? [];
    list.push(job.id);
    memDlq.set(job.type, list);
    memJobs.delete(job.id);
    result.dlq++;
  } else {
    job.runAtMs = now + BACKOFF_MS;
  }
}

async function releaseRedis(
  redis: NonNullable<ReturnType<typeof getSharedRedis>>,
  id: string,
  now: number,
): Promise<string> {
  return (await redis.eval(
    RELEASE_LUA,
    [JOB_KEY(id), SCHEDULED, IN_PROGRESS],
    [id, String(now + BACKOFF_MS), String(MAX_RETRIES)],
  )) as string;
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

// DLQ depth for a job type (owner Today view shows this — todo 12 placeholder).
export async function dlqDepth(type: JobType): Promise<number> {
  const redis = getSharedRedis();
  if (redis) return (await redis.llen(DLQ_KEY(type))) ?? 0;
  return memDlq.get(type)?.length ?? 0;
}
