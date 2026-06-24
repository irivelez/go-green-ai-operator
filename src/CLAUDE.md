# src/ — the deterministic engine (global rules in ../CLAUDE.md)

This layer is the single source of truth; every number is re-derived here and is **never** trusted from LLM args.

- **No price or area from the model.** Pricing flows through `pricePerVisit` (area×slope) / `PRICE_BOOK` (flat tiers) in
  `pricing.ts`; `runConfirmArea` re-derives sqft via `computePolygonSqft(args.path)` (`geo.ts`) — the client number is
  display-only. Tools in `agent-tools.ts` accept coords / ids, never a price or a square-footage.
- **The model never charges.** `runProposeCheckout` only stages a Stripe URL from the re-derived amount;
  `runConfirmBooking` refuses until the lead is in a paid state.
- **Tests are the gate floor.** All `src/*.test.ts` run via `tsx` (17 suites, no keys, `fetch` mocked). **Never edit a
  test to make code pass; never delete a failing test** (Constitution §9).
- **Frozen serialized names** (renaming orphans live Redis/JSON records): `Lead` field names, `LeadStatus` values, tier
  ids (`essential`/`signature`/`estate`), tool names + their Zod input keys. Check `../notes/registries.md` (table A) first.
- **Behavior bugs are logged, not fixed** mid-cleanup — see `../notes/registries.md` (table E).
