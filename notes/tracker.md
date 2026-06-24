# legibility-pass — progress tracker

> Resumable state for the behavior-preserving legibility pass. Update the row after every phase.
> On resume, read this table and continue at the first non-`done` phase.
> Statuses: `pending` / `in-progress` / `done` / `skipped` / `blocked`.

**Repo:** `gogreen-ai-operator`  ·  **Branch:** `cleanup/legibility-pass`  ·  **Started:** 2026-06-23

## Discovered gate (from recon — probe, never hardcode)

The repo has **no ESLint/Prettier config and no CI workflow** (`.github/workflows` absent). The static gate is
therefore the TypeScript compiler; the "linter finding-count must not rise" rule reduces to **`tsc` stays at 0 errors**.

- **Static / typecheck:** `npm run typecheck`  (= `tsc --noEmit`)  → baseline **0 errors** (clean)
- **Tests (FULL set — the gate, not the CI subset):** run **every** `src/*.test.ts`:
  ```bash
  for f in src/*.test.ts; do node ./node_modules/tsx/dist/cli.mjs "$f" || { echo "FAIL $f"; break; }; done
  ```
  → baseline **17 / 17 suites pass**, **≈436 ✅ assertions** (`agent.test.ts` uses a different marker; it passes).
- **Build (available, NOT in the per-phase loop):** `npm run build` (`next build`) — `tsc --noEmit` already covers
  every `.ts/.tsx` via `tsconfig.include`, so typecheck is the in-loop static gate; build is a final-phase confirm.

**Why the gate is the full suite, not `npm test`:** the wired `npm test` only runs `core` + `operator`
(`package.json:14`). The other 15 suites (geo, agent-tools, vision, hitl, scheduler, …) are real and must hold, so the
gate names the full path set explicitly (recon Step 1).

### Environment setup prefix (one-time, not part of any phase commit)
- `node_modules` is **gitignored**; deps installed via **`npm install`** (NOT `npm ci` — the committed
  `package-lock.json` is out of sync with `package.json`, so `npm ci` fails: *"Missing @cypress/request from lock
  file"*, pulled transitively by the optional `node-telegram-bot-api`). **`package-lock.json` is restored after
  install** so no phase commit touches it. (Logged in registry E as a repo-hygiene finding.)
- Node v22.22.3, npm 11.5.2.

### Pure-rename gate (phases 7, 10, 11) — the trifecta
1. **No-misdirection grep:** old whole-word token gone everywhere (code, comments, strings, docs).
2. **Over-reach grep:** frozen substrings + unrelated same-named copies still intact.
3. **The gate:** typecheck 0 errors + 17/17 suites + **symmetric diff (+N/−N)**.

| # | Phase | Status | Commit | Notes (counts, decisions, links) |
|---|---|---|---|---|
| 0 | Recon / bootstrap | done | | gate discovered; architecture ref + 5 registries written; baseline 17/17 green, tsc 0 |
| 1 | Subtract dead code | done | | 5 removals, −56/+0: `confirmPayment` (stripe.ts), `RoofBbox` (area-card-logic), `getDict` (i18n), `fmtLAtime`+`LA_TIME` (format), unused `SlopePhotoPromptCard` import (GenerativeChat). Gate green. |
| 2 | Magic literals → constants | done | | 5 consts, selective: `SLOPE_FLAT_MAX_PCT`/`SLOPE_MODERATE_MAX_PCT` (geo:301, pricing-bearing), `REASON_CODE_MAX` (×2, hitl) + `CORRECTED_VALUE_MAX`, `MAX_TIER_INCLUDES` (×2, agent-tools). Skipped 3×3-grid 3/2/9 (idiomatic) + `maxSteps:8` (key self-names). Gate green. |
| 3 | DRY (within a system) | done | | **Empty surface** (valid). Examined: agent-tools `channel ?? "form"` ×8 — incidental, 7/8 also read `existing` for other fields → over-reach to merge; `channel ?? "form"` default spans store/stripe/routes → cross-boundary; two `vision_assessment ?? {}` casts target different types; route parsing not a uniform idiom. No safe within-boundary merge. Notes-only commit. |
| 4 | Dead code, 2nd pass | done | | 1 orphan: `type CheckoutResult` import in stripe.ts — orphaned by Phase-1 `confirmPayment` removal (`createSubscriptionCheckout` returns `{url,sessionId}`, not `CheckoutResult`). Type def kept (still used at contract.ts:512). Gate green. |
| 5 | Identify variables | done | | notes/renames.md — 9 candidates (V1-V9), all function-local; idiomatic shorts (i/j, sw/ne, regex m, date d/s, seed t) left |
| 6 | Propose variable names | done | | notes/renames.md Phase 6 — all 9 approved; collision/misdirection/boundary cleared (`priced` string-literals & `contact` prompt-string are not identifiers) |
| 7 | Apply variable renames | done | | 9 renames, symmetric diff (5/5,5/5,7/7,2/2,5/5,2/2,4/4). Trifecta clean: gate green, seed-loop `l` + `status:"priced"` strings + `:212` prompt-string all intact (over-reach guards). |
| 8 | Identify functions/params | done | | notes/renames.md Phase 8 — 1 candidate F1 `frEs`→`frequencyEs` (private, operator.ts). Typed single-letter params + callback params left (type annotation suffices). |
| 9 | Propose function names | done | | `frEs→frequencyEs` approved (no collision, private, no misdirection) |
| 10 | Apply function renames | done | | `frEs→frequencyEs` (operator.ts, 2 sites incl. template call). Trifecta: old token gone, symmetric 2/2, gate green. |
| 11 | Classes & file names | pending | | may be "empty surface" |
| 12 | Clean comments/docstrings | pending | | default-KEEP; diff review |
| 13 | Research legibility techniques | pending | | notes-only; fact-checked |
| 14 | Self-onboarding capstone | pending | | doc + fresh-context eval |

**Per-phase learnings:**
- Recon: a prior deep-research pass on this repo seeded the architecture reference + registries; the cross-cutting
  audits' verified findings populate registry (E) and the dead-code candidates in (C).
- Tests import many internal symbols → the reachability oracle for dead code **must include `src/*.test.ts`**: an
  export with "no prod consumer" is often still test-referenced and is therefore NOT dead (and its test must not be
  deleted — doctrine invariant 8 / build-discipline §9).
