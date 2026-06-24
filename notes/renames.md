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
