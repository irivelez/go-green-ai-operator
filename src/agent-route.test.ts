// Proof driver for the agent route's production key guard (S5).
// The old concierge silently fell back to keyword matching with no API key — which
// is exactly what made the live preview feel dumb. In production that must FAIL LOUDLY,
// never degrade silently. Run: npx tsx src/agent-route.test.ts

import { NextRequest } from "next/server";
import { POST } from "../app/api/funnel/agent/route";
import { Body, agentSystemPrompt } from "./funnel-agent-prompt";

let pass = 0,
  fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const env = process.env as Record<string, string | undefined>;

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/funnel/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedEnv = process.env.NODE_ENV;
  delete process.env.ANTHROPIC_API_KEY;

  console.log("\n=== S5: production + no ANTHROPIC_API_KEY → loud failure, NO silent fallback ===");
  env.NODE_ENV = "production";
  {
    const res = await POST(makeReq({ messages: [], leadId: "guard-1", language: "en" }));
    ok("returns 503 (service unavailable)", res.status === 503, `got ${res.status}`);
    const text = await res.text();
    ok("body names the missing key", /ANTHROPIC_API_KEY/.test(text), text.slice(0, 120));
    ok("is JSON error, not a streamed reply", /application\/json/.test(res.headers.get("content-type") ?? ""));
  }

  console.log("\n=== dev + no key → graceful preview stream (page never breaks locally) ===");
  env.NODE_ENV = "development";
  {
    const res = await POST(makeReq({ messages: [], leadId: "guard-2", language: "en" }));
    ok("returns 200", res.status === 200, `got ${res.status}`);
    ok("uses the AI data-stream protocol", res.headers.get("x-vercel-ai-data-stream") === "v1");
    const text = await res.text();
    ok("streams an honest preview-mode message", /preview/i.test(text), text.slice(0, 80));
  }

  console.log("\n=== invalid body → 400 ===");
  {
    const res = await POST(makeReq({ messages: [] })); // missing leadId
    ok("returns 400", res.status === 400, `got ${res.status}`);
  }

  console.log("\n=== T13: Body schema accepts optional `intent` ad-param (back-compat) ===");
  {
    const withIntent = Body.safeParse({ messages: [], leadId: "i-1", language: "en", intent: "weekly_mowing" });
    ok("Body accepts an object WITH intent", withIntent.success, withIntent.success ? "" : JSON.stringify(withIntent.error.issues));
    const withoutIntent = Body.safeParse({ messages: [], leadId: "i-2", language: "en" });
    ok("Body still accepts an object WITHOUT intent (back-compat)", withoutIntent.success);
    const wrongType = Body.safeParse({ messages: [], leadId: "i-3", language: "en", intent: 123 });
    ok("Body rejects non-string intent", !wrongType.success);
  }

  console.log("\n=== T13: agentSystemPrompt weaves the ad intent into a warm opener ===");
  {
    const promptWith = agentSystemPrompt("en", undefined, "weekly_mowing");
    ok("opener mentions mowing", /mowing/i.test(promptWith), promptWith.slice(0, 200));
    ok("opener mentions weekly", /weekly/i.test(promptWith));
    ok("opener flags ad arrival", /ad/i.test(promptWith));

    const promptBare = agentSystemPrompt("en", undefined);
    ok("no intent → no ad opener line", !/arrived from an ad/i.test(promptBare));
  }

  console.log("\n=== T13: prompt encodes the new measure-before-price step order ===");
  {
    const p = agentSystemPrompt("en", undefined);
    ok("step list calls validate_address", /validate_address/.test(p));
    ok("step list calls measure_property", /measure_property/.test(p));
    ok("step list calls confirm_area", /confirm_area/.test(p));
    ok("step list calls compute_exact_price", /compute_exact_price/.test(p));
    const measureIdx = p.indexOf("measure_property");
    const priceIdx = p.indexOf("compute_exact_price");
    ok("measure_property appears BEFORE compute_exact_price", measureIdx > 0 && measureIdx < priceIdx);
  }

  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedEnv !== undefined) env.NODE_ENV = savedEnv;

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
