# API KNOWLEDGE

## OVERVIEW
`app/api/` contains the server boundaries. Routes are thin where possible, but several enforce product gates around models, Stripe, Telegram, lead state, and customer-drawn area confirmation.

## STRUCTURE
| Path | Purpose |
|------|---------|
| `funnel/agent/route.ts` | Primary streaming AI SDK endpoint; production key guard. |
| `funnel/confirm-area/route.ts` | Server-side polygon confirmation, bypassing model context. |
| `funnel/{pricing,checkout,slots,vision}/route.ts` | Focused staged funnel endpoints. |
| `leads/*` | Dashboard lead list, approvals, rejection, override, events. |
| `operator/route.ts` | Older deterministic operator endpoint. |
| `stripe/webhook/route.ts` | Raw-body Stripe webhook reducer. |
| `telegram/webhook/route.ts` | Telegram channel setup/webhook. |

## WHERE TO LOOK
| Task | Route | Core Module |
|------|-------|-------------|
| Agent stream | `funnel/agent/route.ts` | `src/agent-tools.ts`, `src/funnel-agent-prompt.ts` |
| Area redraw | `funnel/confirm-area/route.ts` | `src/agent-tools.ts`, `src/geo.ts` |
| Checkout | `funnel/checkout/route.ts`, `stripe/webhook/route.ts` | `src/stripe.ts`, `src/store.ts` |
| Slots | `funnel/slots/route.ts` | `src/scheduler.ts` |
| HITL dashboard actions | `leads/[id]/*` | `src/hitl.ts`, `src/store.ts` |
| Telegram/operator | `telegram/webhook/route.ts`, `operator/route.ts` | `src/operator.ts` |

## CONVENTIONS
- Routes that need SDKs/secrets use `runtime = "nodejs"`; do not move them to Edge.
- `funnel/agent/route.ts` uses `dynamic = "force-dynamic"` and `maxDuration = 60`.
- Production without `ANTHROPIC_API_KEY` returns 503; local dev streams an honest preview response.
- Routes should call deterministic `src/` functions for every irreversible or numeric decision.
- Stripe webhook handling must verify raw request body and reduce events idempotently.
- Lead IDs from the client are untrusted identifiers; never use them as authorization proof for multi-owner production.

## ANTI-PATTERNS
- No silent keyword/model fallback in production.
- No secret-bearing route should expose secrets to model context or browser payloads.
- No API route should trust client-computed prices, sqft, payment, or booked state.
- No in-memory-only state across separate route invocations for facts that matter.
- No live Stripe or calendar side effects unless the env gate explicitly enables them.

## TESTS
- Agent route guard: `tsx src/agent-route.test.ts`.
- Tool behavior under these routes: `tsx src/agent-tools.test.ts`.
- Stripe/pricing regressions: `tsx src/pricing-checkout.test.ts`.
- Dashboard/store side effects: `npm test && tsx src/hitl.test.ts`.
