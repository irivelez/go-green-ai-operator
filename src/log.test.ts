// Proof driver — structured logs + daily cost alarm (todo 11).
// Run: npx tsx src/log.test.ts

import { logEvent, addDailyCost, checkCostAlarm, resetCostMeter } from "./log";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

async function main() {
  console.log("\n=== Log 1: logEvent emits one valid JSON line to stdout ===");
  {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(String(args[0]));
    logEvent({ leadId: "L1", action: "analyze_photos", status: "ok", tokens: 1200, cost_usd: 0.003 });
    console.log = orig;
    ok("one line emitted", lines.length === 1);
    let parsed: Record<string, unknown> = {};
    let valid = true;
    try {
      parsed = JSON.parse(lines[0]!);
    } catch {
      valid = false;
    }
    ok("line is valid JSON", valid);
    ok("has action + ts", parsed.action === "analyze_photos" && typeof parsed.ts === "string");
    ok("carries cost + tokens", parsed.cost_usd === 0.003 && parsed.tokens === 1200);
  }

  console.log("\n=== Log 2: daily cost accumulates ===");
  {
    resetCostMeter();
    await addDailyCost(0.10);
    const total = await addDailyCost(0.15);
    ok("running total accumulates", Math.abs(total - 0.25) < 0.0001, String(total));
  }

  console.log("\n=== Log 3: cost alarm fires ONCE over threshold ===");
  {
    resetCostMeter();
    process.env.DAILY_COST_ALARM_USD = "0.20";
    await addDailyCost(0.30); // over threshold
    const first = await checkCostAlarm();
    const second = await checkCostAlarm();
    ok("alarm fires on first check over threshold", first.fired === true, JSON.stringify(first));
    ok("alarm does NOT fire twice same day", second.fired === false, JSON.stringify(second));
    delete process.env.DAILY_COST_ALARM_USD;
  }

  console.log("\n=== Log 4: under threshold → no alarm ===");
  {
    resetCostMeter();
    process.env.DAILY_COST_ALARM_USD = "1.00";
    await addDailyCost(0.10);
    const r = await checkCostAlarm();
    ok("no alarm under threshold", r.fired === false, JSON.stringify(r));
    delete process.env.DAILY_COST_ALARM_USD;
  }

  console.log("\n=== Log 5: no threshold env → no-op ===");
  {
    resetCostMeter();
    delete process.env.DAILY_COST_ALARM_USD;
    await addDailyCost(99);
    const r = await checkCostAlarm();
    ok("no threshold configured → never fires", r.fired === false);
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
