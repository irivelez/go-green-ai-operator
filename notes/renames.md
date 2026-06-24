# Rename catalog + proposals (Phases 5–11)

> The 3-beat identify → propose → apply ledger for renames. Narrow→wide: variables (5–7) → functions/params
> (8–10) → types/files (11). Boundary check against registries.md (A). Apply phases run the trifecta.

## Phase 5 — variable IDENTIFY (cryptic local/private bindings)

Codebase is well-named; this is a short, high-confidence list. Idiomatic short names were **left**: grid `i/j`
(geo/scheduler loops), compass `sw/ne` (geo:196-197), numerical-kernel `t` (geo:330 spherical math), regex `m`
(vision:197, agent-evals:30), date `d`/`s` (operator/scheduler — tight date math), `seed.ts` `t()` ISO-identity
(fixture shorthand, high-occurrence/low-value), `geo.ts` `r`/`v` (tight API-parse scope). All considered, all kept.

| # | file:line | current | scope | why unclear |
|---|---|---|---|---|
| V1 | `src/store.ts:124` | `l` | `MemoryBackend.getLead` (2 lines) | lowercase-L reads as 1/I; the value is the domain object `lead` |
| V2 | `src/agent.ts:447` | `cc` | `runLead` escalation branch (2 lines) | `cc` reads as carbon-copy; it is the captured `contact` |
| V3 | `src/stripe.ts:143` (+ sibling :147) | `a` | `createSubscriptionCheckout` — **two separate arrow scopes** (`.map` :143-145 and `.filter` :147) | `a` is opaque; the value is an `addOn`. Two independent locals → scope-aware rename, NOT a blanket s/a/ |
| V4 | `src/funnel-prompt.ts:96` | `c` | `cleanupGatingLine` (template string uses `c.name`/`c.priceStartingAt`/`c.unit`) | `c` opaque; it is the `cleanup` add-on. Refs inside `${...}` are tsc-checked |
| V5 | `src/hitl.ts:115` | `wo` | `handleApprove` (2 lines) | `wo` cryptic; it is the `workOrder` |
| V6 | `src/agent.ts:346` | `t` | PRICE_BOOK lookup | `t` collides conceptually with i18n `t`; value is a tier spec → `tierSpec` |
| V7 | `src/funnel-prompt.ts:36` | `t` | PRICE_BOOK lookup loop | same as V6 → `tierSpec` |
| V8 | `src/agent-tools.ts:643` | `r` | `runComputeExactPrice` (used at :654-655 `r.perVisit`/`r.monthly`) | `r` opaque; it is the `priced` per-visit result |
| V9 | `src/pricing.ts:110` | `r` | `pricePerVisit` caller | same as V8 → `priced` |

All are private function-local bindings — none are serialized/boundary keys (registry A). The values they hold get
assigned to frozen fields (`per_visit_price`, etc.) but the local *name* is free.

## Phase 6 — variable PROPOSE + critic verdict (the review gate)

`current → proposed`, each checked for collision / misdirection / boundary. **All 9 APPROVED.**

| # | rename | collision check | over-reach note for Phase 7 |
|---|---|---|---|
| V1 | `l → lead` (store.ts:124) | no `lead` in `getLead` scope (the 45 file-wide `lead` are other methods/the `Lead` type) | change only :123-124 |
| V2 | `cc → contact` (agent.ts:447) | the only lowercase `contact` is a prompt string at :212 (different scope) | change only :447-448; leave the :212 string |
| V3 | `a → addOn` (stripe.ts:143,147) | no existing `addOn` identifier (`addOnById` doesn't match) | **two separate arrow scopes** — rename both `a`s, scope-aware, NOT a blanket s/a/ |
| V4 | `c → cleanup` (funnel-prompt.ts:96) | no `cleanup` identifier; the word "cleanup" only appears in string add-on ids/prose | change only the `c`/`c.x` tokens; leave string prose |
| V5 | `wo → workOrder` (hitl.ts:115) | no existing `workOrder` | change only :115-116 |
| V6 | `t → tierSpec` (agent.ts:346) | 0 existing `tierSpec`; avoids the i18n-`t` clash | scope-local |
| V7 | `t → tierSpec` (funnel-prompt.ts:36) | 0 existing `tierSpec` | scope-local |
| V8 | `r → priced` (agent-tools.ts:643) | the 3 file `priced` are 2 string-literal `status:"priced"` + 1 comment — NOT identifiers; coherent | change `r`/`r.perVisit`/`r.monthly` in `runComputeExactPrice` only |
| V9 | `r → priced` (pricing.ts:110) | 0 existing `priced` | scope-local |

Critic note: the rename set is deliberately small + scope-local (smallest blast radius). The Phase-7 trifecta
(no-misdirection grep on the old token, over-reach grep on must-stay siblings, gate + symmetric diff) is the
verification; a separate critic sub-agent is disproportionate for 9 single-function locals under a strict typechecker.

## Phase 7 — variable APPLY (done)

All 9 applied, gate green (tsc 0, 17/17). **Symmetric diff** confirms pure renames: agent-tools 5/5, agent 5/5,
funnel-prompt 7/7, hitl 2/2, pricing 5/5, store 2/2, stripe 4/4. Over-reach guards verified intact: `store.ts:121`
seed-loop `for (const l of seed)` (the OTHER `l`), both `status: "priced"` string-literals, the `agent.ts:212`
"their contact details" prompt string.

## Phase 8 — function/param IDENTIFY

Function NAMES are overwhelmingly clear (detectLanguage, lastUserMessage, pickAreaBucket, firstWeekdayOnOrAfter,
outerRingFromGeoJson, lowConfidenceAssessment, …). Exported names are also widely referenced (tests/routes/prompts)
and already good — high churn, no gain — so left. Exactly ONE genuinely cryptic private name:

| # | file:line | current | refs | why unclear |
|---|---|---|---|---|
| F1 | `src/operator.ts:339` | `frEs` (private) | def + 1 call (`:329`, inside a template `${…}`) | "frEs" is opaque; it maps a frequency string → its Spanish word → `frequencyEs` |

**Considered and LEFT** (the type annotation carries the meaning; renaming is low-value churn):
- single-letter typed params `s: FunnelState` (agent.ts ×3), `c: PricingCase` (pricing/tools), `s: LeadSignals`
  (qualify), `l: Ledger` (scheduler), `c: CaseState` (escalation) — the `: Type` annotation already documents them.
- `.map/.filter/.reduce` callback params (`b` block, `l` lead, `s` seconds, `p` point, `x` acc) — idiomatic, tight scope.
- `client()` Composio factories (calendar/notify) — clear at the call site `const composio = client(apiKey)`.
- `collectContact`'s inner `cc` accumulator (operator-of-contact-fields) — acceptable; a separate scope from the
  Phase-7 `cc→contact` (which was `runLead`'s).

## Phase 9 — function PROPOSE + critic verdict

| rename | collision | boundary | misdirection | verdict |
|---|---|---|---|---|
| `frEs → frequencyEs` (operator.ts:339) | `frequencyEs` absent | private (not exported / not a tool name) | clearly "frequency in Spanish", matches the `es` branch | **APPROVED** |

No sibling same-named function exists to wrongly merge. Apply in Phase 10 (2 sites: def + the `${frEs(…)}` template
call, both tsc-checked).

## Phase 10 — function APPLY (done)
`frEs→frequencyEs` applied; trifecta clean (old token gone, `frequencyEs` ×2, symmetric 2/2, gate green).

## Phase 11 — classes & files: EMPTY SURFACE (valid outcome)

Boundary-critic inventory found nothing worth the (widest) blast radius:
- **Classes:** `MemoryBackend` / `JsonBackend` / `KvBackend` (`store.ts`) — all clear, implement `Backend`. No rename.
- **Types/interfaces (~50):** uniformly clear, consistent `XxxInput/XxxResult/XxxOutput` convention. The data types
  (`Lead`, `LeadEvent`, `VisionAssessment`, `LeadStatus`, tier ids) are serialized **frozen boundaries** (registry A).
- **Filenames:** all descriptive. The only mild ambiguity — the prompt trio (`prompt.ts` master voice /
  `funnel-prompt.ts` base / `funnel-agent-prompt.ts` V2 agent) and `tools.ts` (legacy) vs `agent-tools.ts` (V2) — is
  each distinguishable AND **doc-referenced** (AGENTS.md / HANDOFF / spec) AND build-significant (import paths).
  Renaming = widest blast radius + doc desync for ~0 legibility gain. **Left as-is.**

No code change. Gate unchanged (green from Phase 10).
