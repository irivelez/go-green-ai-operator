# Go Green AI Operator

Autonomous ad→pay→book maintenance funnel for premium SF landscaping. A Meta-ad lead lands in a chat (`/agent`), confirms address + yard area, gets a deterministic exact price, pays via Stripe Checkout, and books a crew slot — autonomously, with human-in-the-loop only on flagged edge cases.

**Built for [BuilderShip Yacht Hackathon](https://luma.com/ship.builders) — Deltanova design-partner build with [Go Green Landscape](https://gogreenlandscape.com).**

> **V1 platform status (current build).** Reliability-first: per-field-atomic Redis Hash store, owner auth (HMAC cookie + Edge `middleware.ts`), email-keyed spend caps + IP/global rate limits, a durable Upstash ZSET job queue drained by secured Vercel Cron (reminders, re-engagement, escalation push, daily GCal export), returning-customer recognition (confirm-first, email-match), and a Job/Visit recurring spine with 3 Stripe subscription webhooks. The LLM never writes final area/price/payment/booking state — deterministic services do. Stack stays Vercel AI SDK v4. `spec.md §A` is authoritative; deferred to V1.1: magic links, `Property` entity, Meta CAPI, full subscription lifecycle, extra cockpit views, bidirectional GCal, Places autocomplete. The sections below are V1-hackathon historical context.

## Two surfaces (one shared brain)

The Claude Agent SDK spawns a `claude` CLI subprocess and needs a writable filesystem, so it **can't run on Vercel serverless**. The build splits over one shared domain core (`src/`):

1. **Live dashboard + serverless Operator** — Next.js on Vercel (the live URL). Runs the **deterministic** engine (qualify → price → escalate → book) in API routes, so it's fully functional with **zero keys**. Claude phrases the replies via the Anthropic **Messages API** when `ANTHROPIC_API_KEY` is set. Telegram channel lives here too (`/api/telegram/webhook`).
2. **Agent SDK runtime** — the long-running Telegram brain (`src/agent.ts` + `src/index.ts`): `query()` loop, in-process MCP tools, `canUseTool` as the escalation gate. Run with `npm run agent` on any host that has a key.

- **Pricing**: Deterministic TS function, **range-only**. Never an LLM guess.
- **Record**: Pluggable store — in-memory (seeded, serverless) · JSON (local) · Airtable (prod swap).

## Hard invariants (enforced in code, not just prompt)

- No scheduling without a confirmed **address**.
- **Range-only** pricing autonomously — final price needs on-site review.
- Extras (irrigation, tree, mulch, hardscape, cleanup) are **separate quoted items**, never "included."
- Idempotent actions only — `(lead_id, action_hash)`, no double-book/double-send.
- Escalation flags → `raise_escalation`, human takes over.

## Voice

Professional, warm, premium, honest. Mirrors EN/ES. Never "cheap", never a final price, never guarantees. Compiled in [`src/prompt.ts`](./src/prompt.ts).

## Run

```bash
npm i

# Prove the spine — no keys needed (intake → qualify → price → book + escalation)
npm test

# Dashboard + Operator console → http://localhost:3000 (works with zero keys)
npm run dev

# Deploy the live URL
vercel --prod

# Optional: full Claude replies + live Telegram
cp .env.example .env   # add ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN
npm run agent          # long-running Agent SDK Telegram runtime (needs a host + key)
```

## Spec

Full design in [`spec.md`](./spec.md) — authoritative.

## Stack

Claude Agent SDK · Telegram Bot API · Airtable · TypeScript / Node 22 · tsx

## License

UNLICENSED — Deltanova / Go Green Landscape build.
