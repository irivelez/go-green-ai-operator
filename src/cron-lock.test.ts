// Proof driver — cron-overlap lock (todo 8).
// In dev (no Upstash) the lock uses an in-process Set; the mutual-exclusion
// contract is the same. Run: npx tsx src/cron-lock.test.ts

import { withCronLock, resetCronLocks } from "./cron-lock";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\n=== Cron 1: concurrent calls — only one runs ===");
  {
    resetCronLocks();
    let runs = 0;
    const slow = async () => {
      runs++;
      await sleep(50);
      return "done";
    };
    const [a, b] = await Promise.all([withCronLock("drain", slow), withCronLock("drain", slow)]);
    ok("exactly one invocation ran", runs === 1, `runs=${runs}`);
    const ranCount = [a, b].filter((r) => r.ran).length;
    ok("exactly one returned ran=true", ranCount === 1, `ranCount=${ranCount}`);
    ok("the other no-op'd (ran=false)", [a, b].some((r) => !r.ran));
  }

  console.log("\n=== Cron 2: lock released after success → next call acquires ===");
  {
    resetCronLocks();
    let runs = 0;
    const fn = async () => {
      runs++;
      return runs;
    };
    await withCronLock("drain", fn);
    const second = await withCronLock("drain", fn);
    ok("second sequential call runs (lock released)", second.ran === true && runs === 2, `runs=${runs}`);
  }

  console.log("\n=== Cron 3: lock released even when fn throws ===");
  {
    resetCronLocks();
    let threw = false;
    try {
      await withCronLock("drain", async () => {
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    ok("error propagated", threw);
    const after = await withCronLock("drain", async () => "ok");
    ok("next caller acquires after a throw (lock released)", after.ran === true);
  }

  console.log("\n=== Cron 4: distinct lock names don't block each other ===");
  {
    resetCronLocks();
    let aRan = false,
      bRan = false;
    await Promise.all([
      withCronLock("drainA", async () => {
        aRan = true;
      }),
      withCronLock("drainB", async () => {
        bRan = true;
      }),
    ]);
    ok("both distinct locks ran", aRan && bRan);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
