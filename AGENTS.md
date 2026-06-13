# Go Green AI Operator — project memory

Autonomous ops layer for Go Green Landscape (premium garden maintenance, SF). Deltanova design-partner build. **Full design: [`spec.md`](./spec.md) — authoritative.**

## What it is
Autonomous maintenance funnel: intake → qualify → range-price → book, with human-in-the-loop escalation. Standard residential = full autonomy; flagged cases → human queue.

## Stack (load-bearing)
- **Brain**: Claude Agent SDK (TS) — `query()` loop, `canUseTool` = the escalation gate, native vision. `src/agent.ts`.
- **Channel**: Telegram Bot API (live). WhatsApp = post-event config swap. `src/index.ts`.
- **Record**: Airtable (prod) — JSON file stand-in for demo, `src/store.ts`.
- **Pricing**: deterministic TS function, range-only, `src/pricing.ts`. NEVER an LLM guess.

## Hard rules (invariants — enforced in code, not just prompt)
- No scheduling without a confirmed **address**.
- **Range-only** pricing autonomously — final price needs on-site review.
- Extras (irrigation, tree, mulch, hardscape, cleanup) are **separate quoted items**, never "included."
- Idempotent actions only — `(lead_id, action_hash)`, no double-book/double-send.
- Escalation flags (§12.2) → `raise_escalation`, human takes over.

## Voice
Master Prompt: professional, warm, premium, honest. Mirror EN/ES. Never "cheap", never a final price, never guarantees. Compiled in `src/prompt.ts`.

## Run
- `npm run test:core` — proves the spine, **no keys needed**.
- Live: set `ANTHROPIC_API_KEY` + `TELEGRAM_BOT_TOKEN`, `npm i`, `npm run dev`.

## Open (spec §19): crew slot capacity · WA number · form webhook · dashboard staffing/lang · full SF zip list · rate-card sign-off.
