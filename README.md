# Go Green AI Operator

Autonomous maintenance funnel for premium SF landscaping. Telegram intake → vision-qualifies the yard → range-prices → books. Human-in-the-loop only when the spec says so.

**Built for [BuilderShip Yacht Hackathon](https://luma.com/ship.builders) — Deltanova design-partner build with [Go Green Landscape](https://gogreenlandscape.com).**

> **Current build:** the V2 autonomous **ad → measure → price → pay → book** funnel (the `/agent` chat). [`spec.md` §A](./spec.md) and [`CLAUDE.md`](./CLAUDE.md) are authoritative; the V1 Telegram summary below is partial context.

## Two surfaces (one shared brain)

The Claude Agent SDK spawns a `claude` CLI subprocess and needs a writable filesystem, so it **can't run on Vercel serverless** — it was dropped in favor of the Anthropic **Messages API** + Vercel **AI SDK**. The build still splits over one shared domain core (`src/`):

1. **Live dashboard + serverless Operator** — Next.js on Vercel (the live URL). Runs the **deterministic** engine (qualify → price → escalate → book) in API routes, so it's fully functional with **zero keys**. Claude phrases the replies via the Anthropic **Messages API** when `ANTHROPIC_API_KEY` is set. Telegram channel lives here too (`/api/telegram/webhook`).
2. **Long-running Telegram runtime** — the Telegram brain (`src/agent.ts` + `src/index.ts`): a Messages-API reasoning loop that runs the deterministic escalation gate first, then has Claude phrase the reply. Run with `npm run agent` on any host that has a key.

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
npm install   # (npm ci fails — committed lockfile is out of sync)

# Prove the spine — no keys needed. Full gate = typecheck + ALL src/*.test.ts:
npm run typecheck
for f in src/*.test.ts; do npx tsx "$f" || break; done   # npm test runs only core+operator

# Dashboard + Operator console → http://localhost:3000 (works with zero keys)
npm run dev

# Deploy the live URL
vercel --prod

# Optional: full Claude replies + live Telegram
cp .env.example .env   # add ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN
npm run agent          # long-running Telegram runtime (needs a host + key)
```

## Spec

Full design in [`spec.md`](./spec.md) — authoritative (§A is the current V2 build). Agent onboarding: [`CLAUDE.md`](./CLAUDE.md).

## Stack

Anthropic Messages API · Vercel AI SDK · Telegram Bot API · Airtable · TypeScript / Node 22 · tsx

## License

UNLICENSED — Deltanova / Go Green Landscape build.
