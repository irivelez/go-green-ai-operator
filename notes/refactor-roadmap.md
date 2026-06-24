# Major-refactor execution tracker

Resumable state for the full refactor (EPICs 0–7). Plan of record:
`~/.claude/plans/let-s-fix-them-all-snoopy-ember.md`. Branch `cleanup/legibility-pass`. Baseline: tsc 0, 17/17 suites.

**Gate per commit:** `npm run typecheck` (0) + all `src/*.test.ts` (after EPIC 0: `npm run test:all`). `npm run build`
after EPIC 4 + at the end. One logical change per commit. Update the row below as each lands.

| # | Commit | Epic | Impact | Status |
|---|---|---|---|---|
| 0 | tracker (this file) | — | doc | **done** |
| 0a | reconcile lockfile so `npm ci` works (DEDUP-13) | 0 | preserving | **done** `b961bcc` |
| 0b-i | `test:all` runner + CI workflow (DEDUP-14) | 0 | preserving | **done** `355a58f` |
| 0b-ii | ESLint flat config (non-blocking) + autofix | 0 | preserving | **DEFERRED** (own focused pass; gate already CI-enforced) |
| 0b-iii | Prettier isolated format pass + blame-ignore | 0 | preserving | **DEFERRED** (60-file cosmetic reformat → standalone PR) |
| 0b-iv | `.nvmrc`/engines + gate-doc collapse | 0 | preserving | **done** |
| 4a | delete dead v1 wizard + retarget stripe URLs (DEDUP-12) | 4 | behavior-changing (dead) | **done** (−26 files; agent.ts 521→27; gate 17→16; build clean) |
| 1a | `PAID_STATES: Set<LeadStatus>` (DEDUP-09) | 1 | preserving | **done** |
| 1b | `interface WorkOrder` (DEDUP-06) | 1 | preserving | **done** |
| 1c | `ProposeCheckoutResult` discriminated split (DEDUP-08) | 1 | preserving | **done** |
| 1d | tool Zod→z.infer + client `ToolResultMap` (DEDUP-04) | 1 | preserving | **done** |
| 2a | `LeadDTO` derive client types (DEDUP-07) + registry-B | 2 | preserving (B relax) | **done** |
| 3a | `newWebLeadId()` (DEDUP-11) | 3 | preserving | **done** |
| 3b | `withBody`/`ownerActionRoute` route wrappers (DEDUP-03) | 3 | preserving | **done** |
| 6a | shared agent dict + `lib/format.ts` (DEDUP-10) | 6 | preserving | **done** (money() unified; slot-time deduped; dicts left — disjoint) |
| 5a | PAID_STATES gate-bypass hardening + test | 5 | behavior-changing | **done** 825272c |
| 5b | retire flat pricing path (compute_pricing/priceCart) | 5 | behavior-changing | **done** |
| 7a | split `agent-tools.ts` → per-stage modules (re-export) | 7 | preserving | **done** (barrel 139 lines; 8 modules; build green) |

## Do NOT touch
- Registry-A frozen: Lead field names, LeadStatus values, tier/add-on/Intensity ids, **LLM tool names + Zod keys**
  (only 5b removes one tool, deliberately), route paths + runtime/dynamic, env vars, VisionAssessment keys + ALLOWED_PHOTO_RE,
  npm script names. EPIC 1d/7 keep names byte-identical.
- Registry-B stays: `channel ?? "form"`, `vision_assessment` loose Record, server↔client polygon math, EN/ES two files,
  override allow-list, add-on `kind` filters, the `ConfirmAreaResult.confirmed_sqft` tested echo.

## EPIC-4 manifest (verified)
DELETE: `app/funnel/**`; `app/api/funnel/{pricing,slots,vision,checkout}`; `lib/i18n/**`; `src/agent.test.ts`;
`runFunnelAgent`+helpers in `src/agent.ts`. KEEP: `runLead` (used by index.ts); `app/api/funnel/{agent,confirm-area}`;
`src/funnel-agent-prompt.ts`+`funnel-prompt.ts` (LIVE); EscalationFlag/Reason. RETARGET: `stripe.ts` success/cancel URLs
`/funnel/*`→`/agent`. Remove FunnelState/FunnelStep from contract.ts iff runLead no longer needs them (gate decides).
