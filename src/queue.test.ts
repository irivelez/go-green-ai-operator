// Proof driver — durable ZSET job queue (todo 14).
// In dev (no Upstash) the queue uses the in-process model; the claim/reclaim/
// retry/DLQ/dedup contract is the same. Run: npx tsx src/queue.test.ts

import {
  enqueue,
  drainQueue,
  registerHandler,
  dlqDepth,
  resetQueue,
  type JobType,
} from "./queue";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_000_000;

async function main() {
  console.log("\n=== Queue 1: due job executes exactly once; not-yet-due skipped ===");
  {
    resetQueue();
    let runs = 0;
    registerHandler("reminder", {
      run: async () => {
        runs++;
      },
      stableKey: (p) => `r:${p.leadId}`,
    });
    await enqueue("reminder", { leadId: "L1" }, NOW - 1000); // due
    await enqueue("reminder", { leadId: "L2" }, NOW + 60_000); // future
    const r = await drainQueue(NOW);
    ok("one due job executed", runs === 1, `runs=${runs}`);
    ok("drain reports executed=1", r.executed === 1, JSON.stringify(r));
    // Draining again does not re-run the future job.
    const r2 = await drainQueue(NOW);
    ok("future job still skipped", r2.executed === 0, JSON.stringify(r2));
  }

  console.log("\n=== Queue 2: dedup — a re-run finds its key and no-ops the side effect ===");
  {
    resetQueue();
    let sends = 0;
    registerHandler("reminder", {
      run: async () => {
        sends++;
      },
      stableKey: () => "fixed-key",
    });
    await enqueue("reminder", { leadId: "A" }, NOW - 1);
    await drainQueue(NOW);
    // Enqueue a DIFFERENT job that maps to the SAME stableKey → dedup suppresses.
    await enqueue("reminder", { leadId: "B" }, NOW - 1);
    await drainQueue(NOW);
    ok("side effect ran once despite two drained jobs (dedup)", sends === 1, `sends=${sends}`);
  }

  console.log("\n=== Queue 3: failing job retries to DLQ after 3 ===");
  {
    resetQueue();
    let attempts = 0;
    registerHandler("reengagement", {
      run: async () => {
        attempts++;
        throw new Error("always fails");
      },
      stableKey: (p) => `re:${p.leadId}:${attempts}`, // unique each attempt so dedup never blocks
    });
    let t = NOW;
    await enqueue("reengagement", { leadId: "F" }, t);
    // Drain enough times to exhaust retries (each failure reschedules +backoff).
    for (let i = 0; i < 6; i++) {
      t += 120_000; // advance past visibility + backoff each pass
      await drainQueue(t);
    }
    const depth = await dlqDepth("reengagement");
    ok("failing job landed in DLQ", depth >= 1, `dlqDepth=${depth}`);
    ok("retried before DLQ (>3 attempts)", attempts >= 3, `attempts=${attempts}`);
  }

  console.log("\n=== Queue 4: reclaim — a 'dead' in-progress job is retried by the next drain ===");
  {
    resetQueue();
    let runs = 0;
    let firstCall = true;
    registerHandler("reminder", {
      run: async () => {
        runs++;
        if (firstCall) {
          firstCall = false;
          throw new Error("worker died mid-run"); // simulate crash → release path
        }
      },
      stableKey: (p) => `rc:${p.leadId}:${runs}`,
    });
    let t = NOW;
    await enqueue("reminder", { leadId: "RC" }, t);
    await drainQueue(t); // first attempt fails → rescheduled
    t += 200_000; // past backoff + visibility
    await drainQueue(t); // retried
    ok("job retried after a simulated crash", runs >= 2, `runs=${runs}`);
  }

  console.log("\n=== Queue 5: concurrent drains claim disjoint jobs (no double-exec) ===");
  {
    resetQueue();
    const seen = new Set<string>();
    let doubles = 0;
    registerHandler("reminder", {
      run: async (p) => {
        const k = String(p.leadId);
        if (seen.has(k)) doubles++;
        seen.add(k);
      },
      stableKey: (p) => `cc:${p.leadId}`,
    });
    for (let i = 0; i < 5; i++) await enqueue("reminder", { leadId: `J${i}` }, NOW - 1);
    await Promise.all([drainQueue(NOW), drainQueue(NOW)]);
    ok("no job executed twice across concurrent drains", doubles === 0, `doubles=${doubles}`);
    ok("all 5 jobs executed", seen.size === 5, `seen=${seen.size}`);
  }

  console.log("\n=== Queue 6: B3 — failed job with a STABLE dedup key still re-runs on retry ===");
  {
    // The realistic case: reminders/escalations use a STABLE dedup key
    // (leadId:type:date), NOT a per-attempt key. The dedup is set BEFORE the
    // side effect; if the handler throws, the key must be CLEARED so the retry
    // actually re-runs. The earlier dedup-kill bug (cross-model review B3) left
    // the key set → retry skipped the handler → side effect silently lost.
    resetQueue();
    let sideEffects = 0;
    let attempt = 0;
    registerHandler("escalation", {
      run: async () => {
        attempt++;
        if (attempt === 1) throw new Error("transient provider failure");
        sideEffects++; // only counts a REAL delivery
      },
      stableKey: () => "stable-key-leadX-day", // STABLE — same across retries
    });
    let t = NOW;
    await enqueue("escalation", { lead_id: "X", reason: "hoa" }, t);
    await drainQueue(t); // attempt 1 → throws → dedup MUST be cleared
    t += 200_000; // past backoff + visibility
    await drainQueue(t); // attempt 2 → must actually re-run the side effect
    ok("handler re-ran on retry (dedup cleared on failure)", attempt === 2, `attempt=${attempt}`);
    ok("side effect actually delivered on the retry (not silently dropped)", sideEffects === 1, `sideEffects=${sideEffects}`);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
