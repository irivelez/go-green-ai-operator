# CLAUDE.md — Go Green AI Operator

Autonomous SF-landscaping sales funnel: a Meta-ad lead chats with one Claude agent that validates the address →
measures the yard from public SF parcel data → prices it → takes a Stripe payment → books the first visit; a human
reviews only escalations. Next.js + TypeScript (Node 22, `tsx`), Claude via the Anthropic Messages API + Vercel AI SDK.

**The one load-bearing idea:** *the model proposes; deterministic gates dispose.* Every number and every irreversible
action is re-derived server-side from a canonical contract — the LLM cannot emit a price, a square-footage, or a charge.
The contract lives in the `src/agent-tools/` stage modules (re-exported via the `src/agent-tools.ts` barrel). Hold this
when changing anything in the agent path.

## Verify your work (the gate)

The gate is a type-aware lint + the TypeScript compiler + the **full** test suite (all enforced in CI —
`.github/workflows/ci.yml`, node 22):

```bash
npm run lint && npm run typecheck && npm run test:all   # eslint 0 · tsc 0 · EVERY src/*.test.ts (16 suites)
```

- **`npm test` is NOT the full gate** — it runs only `core` + `operator`. `npm run test:all` runs **every**
  `src/*.test.ts` (geo, agent-tools, agent-route, vision, hitl, scheduler, …). Tests need no API keys (they mock `fetch`).
- **`npm run lint` is CI-blocking** (`eslint.config.mjs`: 4 type-aware rules — `no-floating-promises`,
  `consistent-type-imports`, `no-unused-vars`, `no-explicit-any`). `npm run format` is Prettier (120-col; `*.md` excluded
  to protect the hand-aligned docs). Keep both at zero.
- `npm ci` works (lockfile reconciled). `npm run build` is part of CI. Node is pinned via `.nvmrc` / `engines`.
- Test-first; **never edit a test to make failing code pass, never delete a failing test** (Constitution §9).

## Commands

- `npm run dev` → Next.js: `/agent` (the generative-UI chat funnel) + `/` (ops dashboard). Works with **zero keys**.
- `npm run agent` → long-running Telegram brain (`src/index.ts`); needs `ANTHROPIC_API_KEY` + `TELEGRAM_BOT_TOKEN`.
- `npm run typecheck` · `npm run build` (`next build`) · `npm run eval` (real-model evals; skips without a key).
- `npm run lint` (eslint) · `npm run lint:fix` · `npm run format` / `format:check` (prettier).

## Architecture — two LIVE surfaces over one `src/` core

The Claude Agent SDK is serverless-hostile (subprocess + writable FS) so it was dropped; the build splits:

1. **`/agent` (the web funnel)** — the only customer-facing surface. `app/api/funnel/agent/route.ts` is a Vercel AI SDK
   `streamText` + tools loop: the model calls the tools from `buildTools` (`src/agent-tools/`), each tool result streams
   back and renders an interactive card (`app/agent/components/`). Server-side reasoning lives in `src/agent-tools/` +
   the prompt `src/funnel-agent-prompt.ts`. The other live funnel route is `app/api/funnel/confirm-area/route.ts`.
2. **`/` (the ops dashboard)** — read/HITL surface over the store (`app/page.tsx` + `app/components/`).
3. **Telegram (legacy)** — `src/index.ts` → `src/agent.ts`, now a thin **shim** (`runLead` → `runOperator`) over the
   deterministic operator. The old `runFunnelAgent` + Agent-SDK runtime were removed in the web-funnel pivot.

> The `/funnel` multi-step wizard and `lib/i18n/` were **deleted** — do not resurrect them.

**Hard invariants (enforced in code, not just prompt):** the LLM never charges Stripe (`propose_checkout` only stages
a URL; `confirm_booking` refuses until the lead is in `PAID_STATES` **and** `lead.paid_at` is set — `paid_at` is written
ONLY by `handleStripeEvent` in `src/stripe.ts`, closing a status-only payment-gate bypass) · the confirmed-polygon area
is re-derived server-side (`computePolygonSqft`) · the charge equals the measured-area price · no scheduling without a
confirmed address · idempotent actions `(lead_id, action_hash)` · live Stripe gated behind `STRIPE_LIVE_OK=1`,
crew-calendar PII behind `CREW_CALENDAR_ENABLED=1`.

## Where to look

| Change… | File |
|---|---|
| price / area buckets / slope multipliers | `src/pricing.ts` |
| tiers, add-on catalog, shared types | `src/contract.ts` |
| what the LLM may do (the 11 tools) | `src/agent-tools/` (per-stage) + `src/agent-tools.ts` (barrel + `buildTools`) |
| funnel step order / system prompt | `src/funnel-agent-prompt.ts` |
| address / parcel / slope / polygon area | `src/geo.ts` |
| vision schema / photo allowlist | `src/vision.ts` |
| Stripe charge / webhook / `paid_at` | `src/stripe.ts` + `app/api/stripe/webhook` |
| Lead shape / store backend (memory·json·kv) | `src/store.ts` |
| client Lead view (browser-safe `Omit`) | `src/lead-dto.ts` → `app/components/types.ts` |
| new web-lead id (`web-<uuid>`) | `src/id.ts` |
| route-body / owner-action wrappers | `app/api/_helpers.ts` |
| HITL approve/reject/override | `src/hitl.ts` + `app/components/ReviewInbox.tsx` |
| chat funnel UI / dashboard | `app/agent/components/` / `app/page.tsx` + `app/components/` |

The 11 LLM tools: `qualify_lead`, `analyze_photos`, `validate_address`, `measure_property`, `confirm_area`,
`recommend_tier`, `compute_exact_price`, `propose_checkout`, `offer_slots`, `confirm_booking`, `raise_escalation`. The
flat `compute_pricing` tool is **retired**; `priceCart` survives internally (`runProposeCheckout` uses it only for add-on
resolution). `PRICE_BOOK` + measured `pricePerVisit` are intact.

## Boundaries & gotchas (don't break these)

- **Frozen (serialized) — rename only with care:** `Lead` field names + `LeadStatus` string values (persisted to
  Redis/JSON), tier ids (`essential`/`signature`/`estate`), the 11 LLM tool names + their Zod input keys, API route
  paths, env var names. Full map + the logged behavior findings: `notes/registries.md`.
- **Open known gaps (release blockers for scale):** no auth on `app/api/leads/*` and no `middleware.ts` (tenant
  isolation — only the unguessable `web-<uuid>` lead id protects records); no per-run spend cap; unratified rate card.
- `STORE_BACKEND` selects the store (`memory` default / `json` local / `kv` Upstash prod). Behavior bugs found during
  cleanup are **logged, not fixed** (`notes/registries.md` §E).

## Docs are reference, not gospel

`spec.md`, `AGENTS.md`, and the runbooks describe *intent* — they can lag the code. On any conflict, **the current
source wins**: verify signatures/behavior against the file, not the doc. Behavior bugs are deliberately
**logged-not-fixed** in `notes/registries.md` (E), so code can intentionally differ from a doc's ideal. Cite by
`file:symbol`, never by line number (they rot).

## Reference docs (read on demand — these do NOT auto-load)

Plain links, deliberately **not** `@`-imports: a CLAUDE.md `@`-import loads the whole file into context at launch (it is
not lazy), and `spec.md` alone is ~640 lines. Open these only when a task needs them.

- [AGENTS.md](./AGENTS.md) — project memory + the Engineering Constitution (§0–§10) + detailed known gaps.
- [spec.md](./spec.md) — authoritative contract; **§A is the current V2 ad→pay→book build** (supersedes v1 §§1–19).
- [HANDOFF.md](./HANDOFF.md) — V2 pipeline state + carried-forward items.
- [BUILD-DECISIONS.md](./BUILD-DECISIONS.md) — locked web-funnel decisions.
- [notes/registries.md](./notes/registries.md) — frozen-boundary / intentional-duplication / known-gaps map.
- [notes/agent-legibility-research.md](./notes/agent-legibility-research.md) — why these are links, not `@`-imports.
- [docs/runbooks/add-a-funnel-step.md](./docs/runbooks/add-a-funnel-step.md) — worked, code-grounded edit guide.
- [docs/runbooks/deploy-to-vercel.md](./docs/runbooks/deploy-to-vercel.md) — go-live checklist: env vars, KV, live Stripe, dashboard lock, smoke tests.

When editing under `src/` or `app/`, a nested `CLAUDE.md` there adds area-specific rules (those *do* load on demand).
