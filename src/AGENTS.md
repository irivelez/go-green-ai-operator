# SRC KNOWLEDGE

## OVERVIEW
`src/` is the shared domain core: deterministic pricing, qualification, geo measurement, persistence, scheduling, HITL, Stripe, prompts, and the legacy/agent runtimes used by both Next routes and tests.

## STRUCTURE
| Area | Files | Notes |
|------|-------|-------|
| Funnel tools | `agent-tools.ts` | Main V2 behavior surface; 29 exported/local symbols. |
| Pricing contract | `pricing.ts`, `contract.ts` | Tier/frequency/add-on catalog and exact price math. |
| Geo measurement | `geo.ts` | Address validation, DataSF parcel lookup, slope, polygon area. |
| Store | `store.ts` | `memory`, `json`, `kv`; async per-lead API. |
| Side effects | `stripe.ts`, `calendar.ts`, `notify.ts`, `scheduler.ts` | Gated and idempotent where they mutate state. |
| HITL | `hitl.ts` | Owner approve/reject/override events. |
| Legacy runtime | `agent.ts`, `operator.ts`, `index.ts`, `tools.ts` | Dashboard/Telegram/operator spine. |
| Tests/evals | `*.test.ts`, `agent-evals.ts` | Standalone scripts, no framework runner. |

## WHERE TO LOOK
| Task | Start Here | Run |
|------|------------|-----|
| Change a funnel tool | `agent-tools.ts` | `tsx src/agent-tools.test.ts` |
| Change pricing | `pricing.ts`, `contract.ts` | `tsx src/pricing.test.ts && tsx src/pricing.cart.test.ts && tsx src/pricing-checkout.test.ts` |
| Change measurement | `geo.ts`, `agent-tools.ts` | `tsx src/geo.test.ts && tsx src/agent-tools.test.ts` |
| Change persistence | `store.ts` | `npm test && tsx src/hitl.test.ts && tsx src/scheduler.test.ts` |
| Change prompt flow | `funnel-agent-prompt.ts`, `agent-evals.ts` | `tsx src/agent-route.test.ts && npm run eval` |
| Change Stripe | `stripe.ts`, `agent-tools.ts` | `tsx src/pricing-checkout.test.ts && tsx src/agent-tools.test.ts` |

## CONVENTIONS
- Domain functions are plain TypeScript and usually exported for direct script tests.
- Store APIs are async; always `await` `getLead`, `upsertLead`, `appendEvent`, `actionSeen`, and `allLeads`.
- External integrations are key-guarded. Missing keys return structured unavailable/no-op results so zero-key tests and local dev stay usable.
- Pricing and checkout use `contract.ts` for canonical tier/frequency/add-on names; never duplicate catalog literals.
- Tests use local `ok()`/assert helpers and call `process.exit(...)`; keep that style unless adding a real test runner.

## ANTI-PATTERNS
- Do not invent prices in prompts, route handlers, or UI. Use `priceCart` / exact pricing only.
- Do not fold open-ended add-ons into the charged total.
- Do not fabricate paid/booked states in dev when Stripe or calendar is unavailable.
- Do not use `json` backend for multi-process/serverless production; it is local shared-state only.
- Do not assume tenant isolation exists. `owner_id?` is not enforced anywhere.
- Do not add whole-lead RMW writes without considering the existing `upsertLead` / `appendEvent` / `actionSeen` race.
- Do not swallow errors silently; log and return a bounded failure shape when an integration should not break the customer flow.
