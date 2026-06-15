// Proof driver for the agent route's production key guard (S5).
// The old concierge silently fell back to keyword matching with no API key — which
// is exactly what made the live preview feel dumb. In production that must FAIL LOUDLY,
// never degrade silently. Run: npx tsx src/agent-route.test.ts

import { NextRequest } from "next/server";
import { POST } from "../app/api/funnel/agent/route";

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

  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedEnv !== undefined) env.NODE_ENV = savedEnv;

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
