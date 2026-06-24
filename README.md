# Go Green AI Operator

Autonomous maintenance funnel for premium SF landscaping. A Meta-ad lead lands in a chat and one Claude agent drives it end-to-end: **qualify → measure the yard → price → pay → book** — with a human reviewing only escalations.

**Built for [BuilderShip Yacht Hackathon](https://luma.com/ship.builders) — Deltanova design-partner build with [Go Green Landscape](https://gogreenlandscape.com).**

> The load-bearing idea: **the model proposes; deterministic gates dispose.** Every number and every irreversible action (price, square footage, charge, booking) is re-derived server-side from a canonical contract — the LLM cannot emit a price, a sqft, or a charge. [`CLAUDE.md`](./CLAUDE.md) and [`spec.md`](./spec.md) are authoritative; on any conflict, the code wins.

## Two surfaces (one shared brain)

Both run on Next.js (Vercel) over one shared domain core (`src/`):

1. **`/agent` — the generative-UI chat funnel** (the customer-facing product). The LLM orchestrates the whole funnel by **calling tools** (`src/agent-tools/`) via the Vercel AI SDK (`streamText` + a server-side multi-step tool loop); each tool result renders as an interactive React card (validate address, draw/confirm the parcel on a satellite map, exact-price card, Stripe checkout, slot picker). The model never sees the drawn polygon or the charge — geometry is POSTed straight to `/api/funnel/confirm-area` and the Stripe link is built server-side.
2. **`/` — the ops dashboard + Operator console.** Pipeline board, KPIs, and the human-in-the-loop review inbox (approve / reject / override). Runs the **deterministic** engine, so it's fully functional with **zero keys**.

The Anthropic **Messages API** phrases natural-language replies when `ANTHROPIC_API_KEY` is set; without a key the `/agent` chat shows a local-preview notice while the deterministic surfaces stay green.

- **Pricing**: deterministic TS — exact per-visit + monthly from `confirmed_sqft × slope_tier` (area buckets × slope multiplier). Never an LLM guess.
- **Record**: pluggable async store — in-memory (seeded, serverless) · JSON (local, shared across routes) · Upstash Redis (prod).

A legacy long-running **Telegram** runtime also routes through the same deterministic operator (`npm run agent` → `src/index.ts`); its bot libraries are `optionalDependencies`.

## Hard invariants (enforced in code, not just prompt)

- No scheduling without a confirmed **address**, and no booking until the lead is actually **paid** (`confirm_booking` requires `status ∈ PAID_STATES` **and** `paid_at`, set only by the Stripe webhook).
- Price + area are **re-derived server-side** from the confirmed parcel — never trusted from model args or a client number.
- Add-ons (irrigation, tree, mulch, hardscape, cleanup) are **separate quoted items**, never "included"; open-ended add-ons can never reach Stripe.
- `propose_checkout` **never charges** — it stages a secure Stripe Checkout link the customer clicks.
- Idempotent actions only — `(lead_id, action_hash)`, no double-book/double-send.
- Escalation flags → `raise_escalation`, human takes over.

## Voice

Professional, warm, premium, honest. Mirrors EN/ES. Never "cheap", never a final price, never guarantees. Compiled in [`src/prompt.ts`](./src/prompt.ts) (dashboard/Telegram) and [`src/funnel-agent-prompt.ts`](./src/funnel-agent-prompt.ts) (the `/agent` tool flow).

## Run

```bash
npm ci

# Prove the spine — no keys needed. Full gate = typecheck + ALL src/*.test.ts (16 suites):
npm run typecheck && npm run test:all   # npm test runs only core+operator

# /agent chat funnel + / dashboard → http://localhost:3000 (works with zero keys)
npm run dev

# Deploy the live URL
vercel --prod

# Optional: full Claude replies + live geo/Stripe — add keys to .env
cp .env.example .env   # ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, STRIPE_SECRET_KEY, …
```

CI runs the same gate on Node 22 — `npm ci && typecheck && test:all && build` ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)). Node is pinned via `.nvmrc` / `engines`.

## Spec

Full design in [`spec.md`](./spec.md) (§A is the current V2 build). Agent onboarding: [`CLAUDE.md`](./CLAUDE.md). Hazard registries + architecture map: [`notes/registries.md`](./notes/registries.md).

## Stack

Anthropic Messages API · Vercel AI SDK · DataSF + Google Maps (geo/measurement) · Stripe · Upstash Redis · TypeScript / Node 22 · tsx

## License

UNLICENSED — Deltanova / Go Green Landscape build.
