# src/ — the deterministic engine (global rules in ../CLAUDE.md)

This layer is the single source of truth; every number is re-derived here and is **never** trusted from LLM args.

- **Tools live in `agent-tools/<stage>.ts`; `agent-tools.ts` is the barrel.** Each stage module (`qualify`, `measure`,
  `price`, `checkout`, `schedule`, `escalate`, `photos`, plus `shared.ts` = `ToolContext`/enums/`PAID_STATES`/`MAX_*`)
  exports its pure `run*` handler + lifted `*ArgsSchema`. `agent-tools.ts` re-exports them and holds `buildTools(ctx)`
  (the 11 Vercel AI SDK tools). External imports still use `@/src/agent-tools` / `./agent-tools`.
- **No price or area from the model.** Pricing flows through `pricePerVisit` (area×slope) / `PRICE_BOOK` (flat tiers) in
  `pricing.ts`; `runConfirmArea` (`measure.ts`) re-derives sqft via `computePolygonSqft` (`geo.ts`) — the client number is
  display-only. The flat `compute_pricing` tool is **retired**; `priceCart` survives internally (`runProposeCheckout`
  uses it only for add-on resolution). Tools accept coords / ids, never a price or a square-footage.
- **The model never charges.** `runProposeCheckout` (`checkout.ts`) only stages a Stripe URL from the re-derived amount;
  `runConfirmBooking` (`schedule.ts`) refuses until BOTH `lead.status ∈ PAID_STATES` AND `lead.paid_at` is set — the
  latter written ONLY by `handleStripeEvent` (`stripe.ts`), closing a status-only payment-gate bypass.
- **Tests are the gate floor.** Run every `src/*.test.ts` via `npm run test:all` (no keys, `fetch` mocked; `npm test`
  is core+operator only). **Never edit a test to make code pass; never delete a failing test** (Constitution §9).
- **Frozen serialized names** (renaming orphans live Redis/JSON records): `Lead` field names, `LeadStatus` values, tier
  ids (`essential`/`signature`/`estate`), the 11 tool names + their Zod input keys. Check `../notes/registries.md` (table A) first.
- **Behavior bugs are logged, not fixed** mid-cleanup — see `../notes/registries.md` (table E).
