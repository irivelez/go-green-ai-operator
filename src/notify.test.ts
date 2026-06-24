// Proof driver — escalation push via the queue with retry/DLQ + dedup (todo 17).
// Run: npx tsx src/notify.test.ts

import { enqueueOwnerEscalation } from "./notify";
import { drainQueue, resetQueue, dlqDepth, registerHandler } from "./queue";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 3_000_000_000_000;

async function main() {
  console.log("\n=== Notify 1: escalation enqueues a push; one delivery per (lead,reason,day) ===");
  {
    resetQueue();
    let deliveries = 0;
    // Override the escalation handler with a counter (the real one sends Telegram+email).
    registerHandler("escalation", {
      run: async () => {
        deliveries++;
      },
      stableKey: (p) => `escalation:${p.lead_id}:${p.reason}:${new Date(NOW).toISOString().slice(0, 10)}`,
    });
    await enqueueOwnerEscalation({ lead_id: "L1", channel: "form", reason: "hoa", brief: "HOA approval needed" });
    await drainQueue(NOW);
    // Same (lead,reason,day) → dedup suppresses a second delivery.
    await enqueueOwnerEscalation({ lead_id: "L1", channel: "form", reason: "hoa", brief: "HOA approval needed (again)" });
    await drainQueue(NOW);
    ok("delivered exactly once per (lead,reason,day)", deliveries === 1, `deliveries=${deliveries}`);
  }

  console.log("\n=== Notify 2: failing delivery retries → DLQ after 3 ===");
  {
    resetQueue();
    let attempts = 0;
    registerHandler("escalation", {
      run: async () => {
        attempts++;
        throw new Error("provider down");
      },
      // Unique stableKey per attempt so dedup never blocks the retry.
      stableKey: () => `escalation-fail:${attempts}`,
    });
    let t = NOW;
    await enqueueOwnerEscalation({ lead_id: "L2", channel: "form", reason: "damage", brief: "x" });
    for (let i = 0; i < 6; i++) {
      t += 200_000;
      await drainQueue(t);
    }
    const depth = await dlqDepth("escalation");
    ok("failed escalation lands in DLQ", depth >= 1, `dlqDepth=${depth}`);
    ok("retried before DLQ", attempts >= 3, `attempts=${attempts}`);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
