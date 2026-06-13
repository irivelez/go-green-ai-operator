# Go Green AI Operator

Autonomous maintenance funnel for premium SF landscaping. Telegram intake → vision-qualifies the yard → range-prices → books. Human-in-the-loop only when the spec says so.

**Built for [BuilderShip Yacht Hackathon](https://luma.com/ship.builders) — Deltanova design-partner build with [Go Green Landscape](https://gogreenlandscape.com).**

## What it does

- **Channel**: Telegram bot (live). WhatsApp-ready via config swap.
- **Brain**: Claude Agent SDK `query()` loop. `canUseTool` is the escalation gate.
- **Vision**: Native — qualifies yard photos in-thread.
- **Pricing**: Deterministic TS function, **range-only**. Never an LLM guess.
- **Record**: Airtable in prod, JSON stand-in for demo.

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
# Prove the spine — no keys needed
npm i
npm run test:core

# Live
cp .env.example .env  # add ANTHROPIC_API_KEY + TELEGRAM_BOT_TOKEN
npm run dev
```

## Spec

Full design in [`spec.md`](./spec.md) — authoritative.

## Stack

Claude Agent SDK · Telegram Bot API · Airtable · TypeScript / Node 22 · tsx

## License

UNLICENSED — Deltanova / Go Green Landscape build.
