// Environment helpers test — validates typed access to geo + calendar + pricing keys.
// Run: npx tsx src/env.test.ts

import {
  getGoogleServerKey,
  getGoogleCalendarId,
  isStripeLiveOK,
  getLotCoverageRatio,
  getAreaConfidenceThreshold,
} from "./env";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

console.log("\n=== Environment Helpers ===");

// Test: getLotCoverageRatio defaults to 0.45 when unset
{
  delete process.env.LOT_COVERAGE_RATIO;
  const ratio = getLotCoverageRatio();
  ok("getLotCoverageRatio() defaults to 0.45", ratio === 0.45, `got ${ratio}`);
}

// Test: getLotCoverageRatio reads from env when set
{
  process.env.LOT_COVERAGE_RATIO = "0.55";
  const ratio = getLotCoverageRatio();
  ok("getLotCoverageRatio() reads 0.55 from env", ratio === 0.55, `got ${ratio}`);
}

// Test: getLotCoverageRatio falls back to 0.45 on garbage input
{
  process.env.LOT_COVERAGE_RATIO = "garbage";
  const ratio = getLotCoverageRatio();
  ok("getLotCoverageRatio() falls back to 0.45 on NaN", ratio === 0.45, `got ${ratio}`);
}

// Test: getAreaConfidenceThreshold defaults to 0.6 when unset
{
  delete process.env.AREA_CONFIDENCE_THRESHOLD;
  const threshold = getAreaConfidenceThreshold();
  ok("getAreaConfidenceThreshold() defaults to 0.6", threshold === 0.6, `got ${threshold}`);
}

// Test: getAreaConfidenceThreshold reads from env when set
{
  process.env.AREA_CONFIDENCE_THRESHOLD = "0.75";
  const threshold = getAreaConfidenceThreshold();
  ok("getAreaConfidenceThreshold() reads 0.75 from env", threshold === 0.75, `got ${threshold}`);
}

// Test: isStripeLiveOK is false when unset
{
  delete process.env.STRIPE_LIVE_OK;
  const ok_val = isStripeLiveOK();
  ok("isStripeLiveOK() is false when unset", ok_val === false, `got ${ok_val}`);
}

// Test: isStripeLiveOK is true when set to "1"
{
  process.env.STRIPE_LIVE_OK = "1";
  const ok_val = isStripeLiveOK();
  ok("isStripeLiveOK() is true when '1'", ok_val === true, `got ${ok_val}`);
}

// Test: isStripeLiveOK is false when set to anything else
{
  process.env.STRIPE_LIVE_OK = "0";
  const ok_val = isStripeLiveOK();
  ok("isStripeLiveOK() is false when '0'", ok_val === false, `got ${ok_val}`);
}

// Test: getGoogleServerKey returns undefined when unset
{
  delete process.env.GOOGLE_MAPS_API_KEY;
  const key = getGoogleServerKey();
  ok("getGoogleServerKey() returns undefined when unset", key === undefined, `got ${key}`);
}

// Test: getGoogleServerKey returns value when set
{
  process.env.GOOGLE_MAPS_API_KEY = "test-key-123";
  const key = getGoogleServerKey();
  ok("getGoogleServerKey() returns value when set", key === "test-key-123", `got ${key}`);
}

// Test: getGoogleCalendarId returns undefined when unset
{
  delete process.env.GOOGLE_CALENDAR_ID;
  const id = getGoogleCalendarId();
  ok("getGoogleCalendarId() returns undefined when unset", id === undefined, `got ${id}`);
}

// Test: getGoogleCalendarId returns value when set
{
  process.env.GOOGLE_CALENDAR_ID = "test-calendar-id";
  const id = getGoogleCalendarId();
  ok("getGoogleCalendarId() returns value when set", id === "test-calendar-id", `got ${id}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
