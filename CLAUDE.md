# CLAUDE.md — Go Green AI Operator

Autonomous SF-landscaping sales funnel: a Meta-ad lead chats with one Claude agent that validates the address →
measures the yard from public SF parcel data → prices it → takes a Stripe payment → books the first visit; a human
reviews only escalations. Next.js + TypeScript (Node 22, `tsx`), Claude via the Anthropic Messages API + Vercel AI SDK.

**The one load-bearing idea:** *the model proposes; deterministic gates dispose.* Every number and every irreversible
action is re-derived server-side from a canonical contract (`src/agent-tools.ts`) — the LLM cannot emit a price, a
square-footage, or a charge. Hold this when changing anything in the agent path.

## Verify your work (the gate)

There is **no ESLint and no CI workflow**; the gate is the TypeScript compiler + the test suite:

```bash
npm run typecheck                                   # tsc --noEmit — must stay at 0 errors
for f in src/*.test.ts; do npx tsx "$f" || break; done   # ALL 17 suites must pass
```

- **`npm test` is NOT the full gate** — it runs only `core` + `operator`. The real gate is **every** `src/*.test.ts`
  (geo, agent-tools, vision, hitl, scheduler, …). Tests need no API keys (they mock `fetch`).
- **`npm ci` fails** here (committed lockfile is out of sync) — use **`npm install`**.
- Test-first; **never edit a test to make failing code pass, never delete a failing test** (Constitution §9).

## Commands

- `npm run dev` → Next.js: `/agent` (the primary generative-UI chat funnel) + `/` (ops dashboard). Works with **zero keys**.
- `npm run agent` → long-running Telegram brain (`src/index.ts`); needs `ANTHROPIC_API_KEY` + `TELEGRAM_BOT_TOKEN`.
- `npm run typecheck` · `npm run build` (`next build`) · `npm run eval` (real-model evals; skips without a key).

## Architecture — two surfaces over one `src/` core

The Claude **Agent SDK is serverless-hostile** (subprocess + writable FS) so it was dropped; the build splits:
1. **Vercel serverless** (`app/api/**`) runs the deterministic engine (qualify→price→escalate→book), fully functional
   with zero keys. The V2 agent brain `app/api/funnel/agent/route.ts` is a Vercel AI SDK `streamText` + tools loop;
   each tool result renders an interactive card (`app/agent/components/`).
2. **Long-running Telegram** (`src/index.ts` → `src/agent.ts`) uses the plain `@anthropic-ai/sdk` Messages API.

**Hard invariants (enforced in code, not just prompt):** the LLM never charges Stripe (`propose_checkout` only stages
a URL; `confirm_booking` refuses until paid) · the confirmed-polygon area is re-derived server-side
(`computePolygonSqft`) · the charge equals the measured-area price · no scheduling without a confirmed address ·
idempotent actions `(lead_id, action_hash)` · live Stripe gated behind `STRIPE_LIVE_OK=1`, crew-calendar PII behind
`CREW_CALENDAR_ENABLED=1`.

## Where to look

| Change… | File |
|---|---|
| price / area buckets / slope multipliers | `src/pricing.ts` |
| tiers, add-on catalog, shared types | `src/contract.ts` |
| what the LLM may do / funnel step order | `src/funnel-agent-prompt.ts` + `src/agent-tools.ts` |
| address / parcel / slope / polygon area | `src/geo.ts` |
| vision schema / photo allowlist | `src/vision.ts` |
| Stripe charge / webhook | `src/stripe.ts` + `app/api/stripe/webhook` |
| Lead shape / store backend (memory·json·kv) | `src/store.ts` |
| HITL approve/reject/override | `src/hitl.ts` + `app/components/ReviewInbox.tsx` |
| chat funnel UI / dashboard | `app/agent/` / `app/page.tsx` + `app/components/` |

## Boundaries & gotchas (don't break these)

- **Frozen (serialized) — rename only with care:** `Lead` field names + `LeadStatus` string values (persisted to
  Redis/JSON), tier ids (`essential`/`signature`/`estate`), LLM tool names + their Zod input keys, API route paths,
  env var names. Full map + the 8 logged behavior findings: `notes/registries.md`.
- **Open known gaps (release blockers for scale):** no auth on `app/api/leads/*` and no `middleware.ts` (tenant
  isolation); a same-lead read-modify-write race in `src/store.ts`; no per-run spend cap; unratified rate card.
- `STORE_BACKEND` selects the store (`memory` default / `json` local / `kv` Upstash prod). Behavior bugs found during
  cleanup are **logged, not fixed** (`notes/registries.md` §E).

## Docs are reference, not gospel

`spec.md`, `AGENTS.md`, and the runbooks describe *intent* — they can lag the code. On any conflict, **the current
source wins**: verify signatures/behavior against the file, not the doc. Behavior bugs are deliberately
**logged-not-fixed** in `notes/registries.md` (E), so code can intentionally differ from a doc's ideal.

## Reference docs (read on demand — these do NOT auto-load)

Plain links, deliberately **not** `@`-imports: a CLAUDE.md `@`-import loads the whole file into context at launch (it is
not lazy), and `spec.md` alone is ~640 lines. Open these only when a task needs them.

- [AGENTS.md](./AGENTS.md) — project memory + the Engineering Constitution (§0–§10) + detailed known gaps.
- [spec.md](./spec.md) — authoritative contract; **§A is the current V2 ad→pay→book build** (supersedes v1 §§1–19).
- [HANDOFF.md](./HANDOFF.md) — V2 pipeline state + carried-forward items.
- [BUILD-DECISIONS.md](./BUILD-DECISIONS.md) — locked web-funnel decisions.
- [notes/registries.md](./notes/registries.md) — frozen-boundary / intentional-duplication / known-gaps map.
- [notes/agent-legibility-research.md](./notes/agent-legibility-research.md) — why these are links, not `@`-imports.
- [docs/](./docs/) — **runbooks**: worked, code-grounded edit guides, e.g. [add a funnel step](./docs/runbooks/add-a-funnel-step.md).

When editing under `src/` or `app/`, a nested `CLAUDE.md` there adds area-specific rules (those *do* load on demand).
