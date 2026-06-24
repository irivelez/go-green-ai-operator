// Proof driver — Job/Visit records on the flat Customer model (todos 22/24).
// Run: npx tsx src/job.test.ts

import {
  createJobWithFirstVisit,
  createNextVisit,
  getJob,
  getVisit,
  updateJobStatus,
  deriveJobId,
  resetJobs,
} from "./job";
import { resetStore } from "./store";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const base = {
  customer_email: "dana@example.com",
  stripe_subscription_id: "sub_123",
  frequency: "biweekly",
  tier: "signature",
  scheduled_at: "2026-07-01T15:00:00-07:00",
  slot_id: "2026-07-01-T1",
  work_order: { window: "15:00–17:00", date: "2026-07-01" },
};

async function main() {
  console.log("\n=== Job 1: booking creates Job + first Visit linked to customer ===");
  {
    resetStore([]);
    resetJobs();
    const r = await createJobWithFirstVisit(base);
    ok("job created", r.created === true);
    ok("job linked to customer email", r.job.customer_email === "dana@example.com");
    ok("job carries frequency + tier", r.job.frequency === "biweekly" && r.job.tier === "signature");
    ok("job status active", r.job.status === "active");
    ok("first visit linked to job", r.visit.job_id === r.job.job_id);
    ok("visit scheduled", r.visit.status === "scheduled");
    const persistedJob = await getJob(r.job.job_id);
    const persistedVisit = await getVisit(r.visit.visit_id);
    ok("job persisted + retrievable", persistedJob?.job_id === r.job.job_id);
    ok("visit persisted + retrievable", persistedVisit?.visit_id === r.visit.visit_id);
  }

  console.log("\n=== Job 2: duplicate booking → no duplicate Job (idempotent) ===");
  {
    resetStore([]);
    resetJobs();
    const r1 = await createJobWithFirstVisit(base);
    const r2 = await createJobWithFirstVisit(base);
    ok("first create is new", r1.created === true);
    ok("second create is idempotent (not new)", r2.created === false);
    ok("same job id", r1.job.job_id === r2.job.job_id);
    ok("job id derived from subscription", r1.job.job_id === deriveJobId(base));
  }

  console.log("\n=== Job 3: updateJobStatus (used by sub webhooks) ===");
  {
    resetStore([]);
    resetJobs();
    const r = await createJobWithFirstVisit(base);
    const ok1 = await updateJobStatus(r.job.job_id, "past_due");
    ok("updateJobStatus returns true for an existing job", ok1 === true);
    ok("status flips to past_due", (await getJob(r.job.job_id))?.status === "past_due");
    await updateJobStatus(r.job.job_id, "canceled");
    ok("status flips to canceled", (await getJob(r.job.job_id))?.status === "canceled");
    // S5: a missing job → returns false + creates NO orphan hash.
    const ok2 = await updateJobStatus("job_does_not_exist", "canceled");
    ok("updateJobStatus returns false for a missing job", ok2 === false);
    ok("no orphan job hash created for the missing id", (await getJob("job_does_not_exist")) === undefined);
  }

  console.log("\n=== Job 4: idempotent next-visit creation (todo 24) ===");
  {
    resetStore([]);
    resetJobs();
    const r = await createJobWithFirstVisit(base);
    const n1 = await createNextVisit({
      job_id: r.job.job_id,
      period: "2026-08",
      scheduled_at: "2026-08-01T15:00:00-07:00",
      slot_id: "2026-08-01-T1",
    });
    const n2 = await createNextVisit({
      job_id: r.job.job_id,
      period: "2026-08",
      scheduled_at: "2026-08-01T15:00:00-07:00",
      slot_id: "2026-08-01-T1",
    });
    ok("first next-visit is new", n1.created === true);
    ok("duplicate period → no new visit (idempotent)", n2.created === false);
    ok("same next-visit id", n1.visit.visit_id === n2.visit.visit_id);
    // A different period creates a distinct visit.
    const n3 = await createNextVisit({
      job_id: r.job.job_id,
      period: "2026-09",
      scheduled_at: "2026-09-01T15:00:00-07:00",
      slot_id: "2026-09-01-T1",
    });
    ok("different period → new visit", n3.created === true && n3.visit.visit_id !== n1.visit.visit_id);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
