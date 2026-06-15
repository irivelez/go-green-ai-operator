# Go Green AI Operator — project memory

Autonomous ops layer for Go Green Landscape (premium garden maintenance, SF). Deltanova design-partner build. **Full design: [`spec.md`](./spec.md) — authoritative.**

## What it is
Autonomous maintenance funnel: intake → qualify → range-price → book, with human-in-the-loop escalation. Standard residential = full autonomy; flagged cases → human queue.

## Two surfaces (KEY architecture fact)
The Claude Agent SDK spawns a `claude` CLI subprocess + needs a writable FS → it **cannot run on Vercel serverless** (verified). So the build splits, sharing ONE domain core (`src/pricing|qualify|escalation|store|prompt|tools|operator.ts`):

1. **Live dashboard + serverless Operator** (the live URL) — Next.js on Vercel. Runs the **deterministic** engine (qualify/price/escalate/book) in API routes → fully functional with **zero keys**. Claude phrases replies via the Anthropic **Messages API** when `ANTHROPIC_API_KEY` is set. Telegram channel here too (`app/api/telegram/webhook`).
   - UI: `app/page.tsx` + `app/components/*`. Routes: `app/api/{operator,leads,leads/[id]/approve,leads/[id]/reject,telegram/webhook}`.
2. **Agent SDK runtime** (`src/agent.ts` + `src/index.ts`) — the long-running Telegram brain. `query()` loop, in-process MCP tools (`createSdkMcpServer`+`tool()`), `canUseTool` = escalation gate + built-ins-off guard. Run via `npm run agent` on a host with a key.

- **Pricing**: deterministic TS, range-only, `src/pricing.ts`. NEVER an LLM guess.
- **Store**: pluggable `src/store.ts` — memory (default, serverless, seeded `src/seed.ts`) | json (local) | Airtable (prod swap).

## Hard rules (invariants — enforced in code, not just prompt)
- No scheduling without a confirmed **address**.
- **Range-only** pricing autonomously — final price needs on-site review.
- Extras (irrigation, tree, mulch, hardscape, cleanup) are **separate quoted items**, never "included."
- Idempotent actions only — `(lead_id, action_hash)`, no double-book/double-send.
- Escalation flags (§12.2) → `raise_escalation`, human takes over.

## Voice
Master Prompt: professional, warm, premium, honest. Mirror EN/ES. Never "cheap", never a final price, never guarantees. Compiled in `src/prompt.ts`.

## Run
- `npm test` — proves the spine (core + operator), **no keys needed**.
- Dashboard + Operator: `npm run dev` → http://localhost:3000 (works with zero keys).
- Deploy live: `vercel --prod` (project `irivelezs-projects/gogreen-ai-operator`).
- Agent SDK Telegram runtime (optional, long-running host): set `ANTHROPIC_API_KEY` + `TELEGRAM_BOT_TOKEN`, `npm run agent`.
- Add `ANTHROPIC_API_KEY` (Vercel env) → Claude writes the replies. Add `TELEGRAM_BOT_TOKEN` → `GET /api/telegram/webhook?setup=1` registers the live channel.

## Open (spec §19): crew slot capacity · WA number · form webhook · dashboard staffing/lang · full SF zip list · rate-card sign-off.
