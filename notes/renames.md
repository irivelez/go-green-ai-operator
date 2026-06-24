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
