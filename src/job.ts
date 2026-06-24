// Job + Visit records on the flat Customer model (todo 22 — recurring spine).
//
// A booked first service creates a Job (the recurring subscription/contract) +
// its first Visit. Both are flat Redis Hashes (same per-field-atomic HSET model
// as Lead/Customer). Linked to the Customer by canonical email — NO Property
// entity (V1.1). Idempotent creation via store.actionSeen so a duplicate booking
// never creates a duplicate Job/Visit.
//
//   job:{job_id}     HASH { job_id, customer_email, stripe_subscription_id?,
//                          frequency, tier, status, created_at }
//   visit:{visit_id} HASH { visit_id, job_id, scheduled_at, slot_id, status,
//                          work_order(json)?, created_at }
//   jobs:by-customer:{email}  SET of job_ids (lookup a customer's jobs)
//   visits:by-job:{job_id}    SET of visit_ids (lookup a job's visits)

import { createHash } from "node:crypto";
import { getSharedRedis, actionSeen } from "./store";

export type JobStatus = "active" | "past_due" | "canceled";
export type VisitStatus = "scheduled" | "completed" | "canceled";

export interface Job {
  job_id: string;
  customer_email: string;
  stripe_subscription_id?: string;
  frequency: string;
  tier: string;
  status: JobStatus;
  created_at: string;
}

export interface Visit {
  visit_id: string;
  job_id: string;
  scheduled_at: string;
  slot_id: string;
  status: VisitStatus;
  work_order?: Record<string, unknown>;
  created_at: string;
}

const JOB_KEY = (id: string) => `job:${id}`;
const VISIT_KEY = (id: string) => `visit:${id}`;
const JOBS_BY_CUSTOMER = (email: string) => `jobs:by-customer:${email}`;
const VISITS_BY_JOB = (jobId: string) => `visits:by-job:${jobId}`;

// Deterministic job id from (subscription id || customer+frequency+tier) so the
// same booking maps to the same job (idempotent create).
export function deriveJobId(input: {
  stripe_subscription_id?: string;
  customer_email: string;
  frequency: string;
  tier: string;
}): string {
  if (input.stripe_subscription_id) return `job_${input.stripe_subscription_id}`;
  const h = createHash("sha256")
    .update(`${input.customer_email}|${input.frequency}|${input.tier}`)
    .digest("hex")
    .slice(0, 16);
  return `job_${h}`;
}

export function deriveVisitId(jobId: string, slotId: string): string {
  return `visit_${jobId}_${slotId}`;
}

// ── in-process store (dev) ────────────────────────────────────────────────────
let memJobs = new Map<string, Job>();
let memVisits = new Map<string, Visit>();

export function resetJobs(): void {
  memJobs = new Map();
  memVisits = new Map();
}

const JSON_VISIT_FIELDS = new Set(["work_order"]);

function encodeHash(obj: Record<string, unknown>, jsonFields: Set<string>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = jsonFields.has(k) ? JSON.stringify(v) : (v as string | number);
  }
  return out;
}

async function putJob(job: Job): Promise<void> {
  const redis = getSharedRedis();
  if (redis) {
    const pipe = redis.multi();
    pipe.hset(JOB_KEY(job.job_id), encodeHash(job as unknown as Record<string, unknown>, new Set()));
    pipe.sadd(JOBS_BY_CUSTOMER(job.customer_email), job.job_id);
    await pipe.exec();
    return;
  }
  memJobs.set(job.job_id, { ...job });
}

async function putVisit(visit: Visit): Promise<void> {
  const redis = getSharedRedis();
  if (redis) {
    const pipe = redis.multi();
    pipe.hset(VISIT_KEY(visit.visit_id), encodeHash(visit as unknown as Record<string, unknown>, JSON_VISIT_FIELDS));
    pipe.sadd(VISITS_BY_JOB(visit.job_id), visit.visit_id);
    await pipe.exec();
    return;
  }
  memVisits.set(visit.visit_id, { ...visit });
}

export async function getJob(jobId: string): Promise<Job | undefined> {
  const redis = getSharedRedis();
  if (redis) {
    const raw = await redis.hgetall<Record<string, unknown>>(JOB_KEY(jobId));
    if (!raw || Object.keys(raw).length === 0) return undefined;
    return raw as unknown as Job;
  }
  const j = memJobs.get(jobId);
  return j ? { ...j } : undefined;
}

export async function getVisit(visitId: string): Promise<Visit | undefined> {
  const redis = getSharedRedis();
  if (redis) {
    const raw = await redis.hgetall<Record<string, unknown>>(VISIT_KEY(visitId));
    if (!raw || Object.keys(raw).length === 0) return undefined;
    return raw as unknown as Visit;
  }
  const v = memVisits.get(visitId);
  return v ? { ...v } : undefined;
}

// Per-field atomic update (used by the subscription webhooks in todo 23).
// Returns true only if the Job EXISTED and was updated. The KV path is guarded so
// it never creates an orphan `{status}` hash for a non-existent job (cross-model
// review S5: a webhook keyed on a sub id with no matching Job would otherwise
// fabricate a phantom record). Atomic on Redis via a single Lua EXISTS-then-HSET.
const UPDATE_JOB_STATUS_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[1])
return 1
`;
export async function updateJobStatus(jobId: string, status: JobStatus): Promise<boolean> {
  const redis = getSharedRedis();
  if (redis) {
    const r = (await redis.eval(UPDATE_JOB_STATUS_LUA, [JOB_KEY(jobId)], [status])) as number;
    return r === 1;
  }
  const j = memJobs.get(jobId);
  if (!j) return false;
  memJobs.set(jobId, { ...j, status });
  return true;
}

export interface CreateJobInput {
  customer_email: string;
  stripe_subscription_id?: string;
  frequency: string;
  tier: string;
  scheduled_at: string;
  slot_id: string;
  work_order?: Record<string, unknown>;
}

export interface CreateJobResult {
  job: Job;
  visit: Visit;
  created: boolean; // false when an existing job/visit was returned (idempotent)
}

// A booked first service → Job + first Visit. Idempotent on (customer, job id):
// a duplicate booking returns the existing records, never duplicates them.
export async function createJobWithFirstVisit(input: CreateJobInput): Promise<CreateJobResult> {
  const jobId = deriveJobId(input);
  const visitId = deriveVisitId(jobId, input.slot_id);

  const already = await actionSeen(input.customer_email, "create_job", jobId);
  if (already) {
    const job = await getJob(jobId);
    const visit = await getVisit(visitId);
    if (job && visit) return { job, visit, created: false };
  }

  const now = new Date().toISOString();
  const job: Job = {
    job_id: jobId,
    customer_email: input.customer_email,
    stripe_subscription_id: input.stripe_subscription_id,
    frequency: input.frequency,
    tier: input.tier,
    status: "active",
    created_at: now,
  };
  const visit: Visit = {
    visit_id: visitId,
    job_id: jobId,
    scheduled_at: input.scheduled_at,
    slot_id: input.slot_id,
    status: "scheduled",
    work_order: input.work_order,
    created_at: now,
  };
  await putJob(job);
  await putVisit(visit);
  return { job, visit, created: true };
}

// Idempotent next-visit creation (todo 24). One Visit per (job, period).
export async function createNextVisit(input: {
  job_id: string;
  period: string;
  scheduled_at: string;
  slot_id: string;
}): Promise<{ visit: Visit; created: boolean }> {
  const visitId = `visit_${input.job_id}_${input.period}`;
  const seen = await actionSeen(input.job_id, "next_visit", input.period);
  if (seen) {
    const existing = await getVisit(visitId);
    if (existing) return { visit: existing, created: false };
  }
  const visit: Visit = {
    visit_id: visitId,
    job_id: input.job_id,
    scheduled_at: input.scheduled_at,
    slot_id: input.slot_id,
    status: "scheduled",
    created_at: new Date().toISOString(),
  };
  await putVisit(visit);
  return { visit, created: true };
}
