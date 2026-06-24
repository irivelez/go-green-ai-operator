#!/usr/bin/env node
// Load smoke test for the go-live funnel (go-live G7). Fires concurrent chat requests
// at a DEPLOYED /api/funnel/agent to sanity-check latency, that the deployment responds
// under load, and that the rate-limiter engages. Does NOT pay — it exercises the
// read/LLM-heavy chat path, which is the real per-request cost/latency concern.
//
// Usage:  node scripts/load-smoke.mjs <base-url> [concurrency=10] [rounds=1]
//   e.g.  node scripts/load-smoke.mjs https://gogreen.example.com 20 3
//
// IMPORTANT — honest limitation: this runs from ONE IP, so the per-IP rate limit
// (30 / 10 min, src/rate-limit.ts) will 429 most requests past the first ~30. That
// VALIDATES the limiter, but does NOT load-test raw multi-user capacity — Vercel sets
// the real client IP in x-forwarded-for, so a single machine can't fake distinct
// users. To test true capacity, run distributed (many IPs) or temporarily raise the
// IP limit. For real-world readiness, prefer monitoring during a small soft launch.

const [baseUrlArg, concArg, roundsArg] = process.argv.slice(2);
if (!baseUrlArg) {
  console.error("Usage: node scripts/load-smoke.mjs <base-url> [concurrency=10] [rounds=1]");
  process.exit(1);
}
const baseUrl = baseUrlArg.replace(/\/+$/, "");
const concurrency = Number(concArg) || 10;
const rounds = Number(roundsArg) || 1;

const SAMPLE = "Hi, I need weekly garden maintenance at 1916 Octavia St, San Francisco 94109.";

function oneRequest(i) {
  const leadId = `loadtest-${Date.now()}-${i}-${Math.floor(Math.random() * 1e6)}`;
  const started = performance.now();
  return fetch(`${baseUrl}/api/funnel/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId, language: "en", messages: [{ role: "user", content: SAMPLE }] }),
  })
    .then(async (res) => {
      await res.text().catch(() => {}); // drain the stream → full response time
      return { status: res.status, ms: performance.now() - started };
    })
    .catch((err) => ({ status: 0, ms: performance.now() - started, error: String(err) }));
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`Load smoke → ${baseUrl}/api/funnel/agent · concurrency=${concurrency} · rounds=${rounds}\n`);
  const all = [];
  for (let r = 0; r < rounds; r++) {
    const batch = await Promise.all(Array.from({ length: concurrency }, (_, i) => oneRequest(r * concurrency + i)));
    all.push(...batch);
    console.log(`  round ${r + 1}/${rounds} done (${batch.filter((x) => x.status === 200).length}/${concurrency} ok)`);
  }

  const byStatus = {};
  for (const x of all) byStatus[x.status] = (byStatus[x.status] || 0) + 1;
  const lat = all.map((x) => x.ms).sort((a, b) => a - b);

  console.log("\n=== Results ===");
  console.log("requests:", all.length);
  console.log("status histogram:", JSON.stringify(byStatus));
  console.log(`latency ms: p50=${Math.round(pct(lat, 50))} p95=${Math.round(pct(lat, 95))} max=${Math.round(lat.at(-1) || 0)}`);
  if (byStatus[429]) {
    console.log(`note: ${byStatus[429]} request(s) hit the rate limiter (429) — EXPECTED from one IP; see header comment.`);
  }
  if (byStatus[503]) console.log("note: 503 → ANTHROPIC_API_KEY not set on the deployment.");
  if (byStatus[0]) console.log("note: status 0 → network/transport error (see first error).");
  const firstErr = all.find((x) => x.error);
  if (firstErr) console.log("first error:", firstErr.error);
  process.exit(0);
}

void main();
