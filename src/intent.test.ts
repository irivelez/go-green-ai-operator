// Intent decoder — parse Meta ad URL params into service intent.
// Run: npx tsx src/intent.test.ts

import { decodeIntent } from "./intent";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== Intent Decoder ===");

// Test 1: intent param with embedded frequency
{
  const result = decodeIntent({ intent: "weekly_mowing" });
  ok("weekly_mowing → service + frequency", 
    result.service === "mowing" && result.frequency === "weekly" && result.raw === "weekly_mowing",
    `got ${JSON.stringify(result)}`);
}

// Test 2: utm_content with cleanup
{
  const result = decodeIntent({ utm_content: "cleanup" });
  ok("utm_content cleanup → service",
    result.service === "cleanup" && result.raw === "cleanup",
    `got ${JSON.stringify(result)}`);
}

// Test 3: svc + freq + zip params
{
  const result = decodeIntent({ svc: "recurring", freq: "biweekly", zip: "94110" });
  ok("svc + freq + zip → all fields",
    result.service === "recurring" && result.frequency === "biweekly" && result.zip === "94110",
    `got ${JSON.stringify(result)}`);
}

// Test 4: empty params
{
  const result = decodeIntent({});
  ok("empty params → empty object",
    Object.keys(result).length === 0,
    `got ${JSON.stringify(result)}`);
}

// Test 5: garbage input
{
  const result = decodeIntent({ intent: "garbage_xyz" });
  ok("garbage input → raw only, no service",
    result.raw === "garbage_xyz" && result.service === undefined,
    `got ${JSON.stringify(result)}`);
}

// Test 6: mow alias
{
  const result = decodeIntent({ intent: "mow" });
  ok("mow → mowing service",
    result.service === "mowing" && result.raw === "mow",
    `got ${JSON.stringify(result)}`);
}

// Test 7: clean alias
{
  const result = decodeIntent({ intent: "clean" });
  ok("clean → cleanup service",
    result.service === "cleanup" && result.raw === "clean",
    `got ${JSON.stringify(result)}`);
}

// Test 8: maintenance → recurring
{
  const result = decodeIntent({ intent: "maintenance" });
  ok("maintenance → recurring service",
    result.service === "recurring" && result.raw === "maintenance",
    `got ${JSON.stringify(result)}`);
}

// Test 9: biweekly_mowing
{
  const result = decodeIntent({ intent: "biweekly_mowing" });
  ok("biweekly_mowing → service + frequency",
    result.service === "mowing" && result.frequency === "biweekly" && result.raw === "biweekly_mowing",
    `got ${JSON.stringify(result)}`);
}

// Test 10: monthly frequency
{
  const result = decodeIntent({ freq: "monthly" });
  ok("freq: monthly → frequency",
    result.frequency === "monthly",
    `got ${JSON.stringify(result)}`);
}

// Test 11: priority: intent > utm_content > svc
{
  const result = decodeIntent({ intent: "mowing", utm_content: "cleanup", svc: "recurring" });
  ok("intent takes priority over utm_content and svc",
    result.service === "mowing",
    `got ${JSON.stringify(result)}`);
}

// Test 12: utm_content > svc
{
  const result = decodeIntent({ utm_content: "cleanup", svc: "recurring" });
  ok("utm_content takes priority over svc",
    result.service === "cleanup",
    `got ${JSON.stringify(result)}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
