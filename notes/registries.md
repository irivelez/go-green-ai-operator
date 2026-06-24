# legibility-pass — hazard registries + architecture reference

> The 5 registries are the safety map every later phase consults. Keep them current — when a phase surfaces a new
> boundary / duplication / bug, add it here. Seeded from a prior deep-research pass on this repo.

## Architecture reference

**What it is:** an autonomous SF-landscaping sales funnel — a Meta-ad lead lands in a chat and one Claude agent
drives *validate address → qualify → measure yard (DataSF parcel − building footprint) → confirm area on a satellite
map → photos → exact price → Stripe pay → pick slot → book → crew calendar handoff*, with a human reviewing only
escalations. **The load-bearing idea:** *the model proposes; deterministic gates dispose* — every number and every
irreversible action is re-derived server-side from a canonical contract; the LLM cannot emit a price, a sqft, or a charge.

**Systems / modules + boundaries:**
- **Deterministic engine (`src/`, LLM-free):** `pricing.ts` (area-bucket × slope × frequency, + flat `PRICE_BOOK`),
  `contract.ts` (shared types, `PRICE_BOOK`, `FREQUENCY_MULTIPLIER`, `ADD_ON_CATALOG`), `qualify.ts`, `escalation.ts`,
  `area-card-logic.ts`, `intent.ts` (ad-param decode), `scheduler.ts` (slots/booking), `calendar.ts` (crew handoff),
  `metrics.ts` (KPIs), `notify.ts`.
- **Geo / measurement:** `geo.ts` (address-validate, DataSF parcel, slope, polygon area) — key-guarded, never-throws.
- **Vision:** `vision.ts` — photos → strict-JSON `VisionAssessment`; also the photo SSRF/exfil allowlist.
- **Agent tool layer:** `agent-tools.ts` (12 `run*` handlers + `buildTools`) — the safety gates live here.
- **LLM brains / prompts:** `funnel-agent-prompt.ts` (V2 tool flow), `funnel-prompt.ts`, `prompt.ts` (voice),
  `operator.ts` (deterministic decision the dashboard LLM only phrases), `agent.ts` (web-funnel reasoning
  orchestrator; legacy Telegram path routed through the operator), `index.ts` (Telegram entrypoint), `tools.ts`.
- **Persistence:** `store.ts` (per-lead async `Backend`: memory | json | kv/Upstash-Redis), `seed.ts`, `env.ts`.
- **Payments:** `stripe.ts` + `app/api/stripe/webhook` + `app/api/funnel/checkout`.
- **HTTP surface (Next.js, 14 routes):** `app/api/funnel/{agent,checkout,confirm-area,pricing,slots,vision}`,
  `app/api/leads` + `leads/[id]/{approve,reject,override,events}`, `app/api/operator`, `app/api/telegram/webhook`.
- **Frontend:** `app/agent/**` (primary generative-UI chat funnel: `GenerativeChat.tsx`, `cards.tsx`,
  `AreaConfirmCard.tsx`), `app/components/**` (ops dashboard), `app/funnel/**` (legacy wizard), `lib/i18n/**` (EN/ES).

**Data / control flow:** lead state is a single `Lead` record (`store.ts`), the single source of truth; every route
reads/writes it through the async `Backend`. The agent route (`app/api/funnel/agent/route.ts`) runs a Vercel AI SDK
`streamText` + tools loop (`maxSteps`); each tool result renders an interactive card client-side.

**Entry points:** `npm run dev` (Next.js → `/agent` funnel + `/` dashboard, zero keys); `npm run agent`
(long-running Telegram, needs a key); `npm test` / per-suite `tsx src/*.test.ts`.

**Where do I look for X:** prices/buckets/slope mults → `pricing.ts`; tiers/add-ons/types → `contract.ts`; what the
LLM may do / step order → `funnel-agent-prompt.ts` + `agent-tools.ts`; address/parcel/slope → `geo.ts`; vision/photo
allowlist → `vision.ts`; Stripe → `stripe.ts`; slots/calendar → `scheduler.ts` / `calendar.ts`; Lead shape/store →
`store.ts`; HITL → `hitl.ts` + `app/components/ReviewInbox.tsx`; KPIs → `metrics.ts`; env keys → `env.ts` + `.env.example`.

---

## (A) FROZEN-BOUNDARY registry — do NOT rename without human approval

No cross-repo consumers (single repo `github.com/irivelez/go-green-ai-operator`, no published package), so **exported
TS symbols are repo-internal and renameable with the trifecta**. The frozen surface is the *serialized / external*
contract:

| Boundary item | Kind | Where | Why frozen |
|---|---|---|---|
| `Lead` field names (`lead_id`, `status`, `lat`, `lng`, `estimated_sqft`, `confirmed_sqft`, `slope_tier`, `per_visit_price`, `monthly_price`, `area_source`, `owner_id`, `_actions`, `events`, `created_at`, …) | Serialized DB columns | `store.ts` Lead interface | Persisted verbatim to Upstash Redis / JSON; renaming orphans live records |
| `LeadStatus` string values ("Ready to Schedule", "Scheduled", "Needs Human Review", "New", …) | Serialized enum | `contract.ts` / `store.ts` | Persisted + compared by string; cross-route state machine |
| Tier ids `essential` / `signature` / `estate`; `ADD_ON_CATALOG` ids; `Intensity` `low/medium/high` | Serialized values | `contract.ts` | Stored on the lead + in Stripe metadata; LLM/eval contract |
| LLM tool names (`qualify_lead`, `analyze_photos`, `validate_address`, `measure_property`, `confirm_area`, `recommend_tier`, `compute_exact_price`, `propose_checkout`, `offer_slots`, `confirm_booking`, `raise_escalation`) | Prompt/eval contract | `agent-tools.ts` `buildTools` | Named in `funnel-agent-prompt.ts` + evals; a rename needs the **3-sync** (spec/code+tests/prompt) — treat as frozen here. **`compute_pricing` REMOVED (2026-06-23):** the legacy flat LLM-pricing tool was retired — the live funnel prices only via `compute_exact_price` (measured area×slope). This was the one deliberate frozen-tool-name removal. |
| Zod tool **input param keys** (the JSON keys the model sends) | Model↔tool contract | `agent-tools.ts` tool schemas | The model is prompted to send these exact keys |
| API route paths (`app/api/**/route.ts` folder names) | URL contract | `app/api/**` | Called by the frontend/webhooks by literal path |
| Env var names (`ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_LIVE_OK`, `CREW_CALENDAR_ENABLED`, `COMPOSIO_API_KEY`, `GOOGLE_CALENDAR_ID`, `STORE_BACKEND`, `LEADS_DB_PATH`, `UPSTASH_*`, `KV_REST_API_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `LOT_COVERAGE_RATIO`, `AREA_CONFIDENCE_THRESHOLD`, `SOCRATA_APP_TOKEN`) | Runtime config | `env.ts`, `.env.example` | Read from `process.env`; must match deploy env |
| DataSF dataset ids (`acdm-wktn` parcels, `ramy-di5m` footprints), Socrata/Google/Stripe/Composio API URLs+params | External API contract | `geo.ts`, `stripe.ts`, `calendar.ts` | Third-party contract |
| `VisionAssessment` schema keys; `ALLOWED_PHOTO_RE` | Serialized + security | `vision.ts` | Stored on lead; the regex is a security control |
| npm script names (`dev`, `build`, `agent`, `test`, `eval`, `typecheck`) | Tooling contract | `package.json` | Invoked by humans/docs/this tracker |
| i18n message keys | Client contract | `lib/i18n/{en,es}.ts` | Referenced by components by key |

## (B) INTENTIONAL-DUPLICATION registry — do NOT merge (guards Phase 3)

| Duplicated thing | Copies | Why it must stay duplicated |
|---|---|---|
| Polygon-area math | `computePolygonSqft` (`geo.ts`, server, spherical-excess) ↔ `google.maps.geometry.spherical.computeArea` (client, `AreaConfirmCard.tsx`) | Server is the authority; client is display-only. Deliberate mirror across the trust boundary. |
| Two pricing systems | flat `PRICE_BOOK` path (`priceCart`) ↔ measured `pricePerVisit` (area×slope) | **FLAT PATH RETIRED (2026-06-23):** the measured `pricePerVisit` (area×slope) path is now the sole customer-facing pricing surface; the `compute_pricing` LLM tool + `runComputePricing` are gone. `priceCart` SURVIVES — `runProposeCheckout` still uses it for add-on resolution (fixed vs open-ended classification, catalog lookup/validation), and it backs the legacy flat-recurring fallback when a lead was never measured. Still NOT duplication to collapse. |
| Server `Lead` type | `store.ts` → `app/components/types.ts` via `src/lead-dto.ts` | **DERIVED (EPIC 2, 2026-06-23):** the client `Lead` is `Omit<Lead, "_actions"\|"owner_id"\|"events">` imported from the single source — the former hand-copied mirror had already drifted (missing every v2 field). Registry-B "must stay in sync (not import)" relaxed for `Lead`. `Kpis`/`Decision` stay client-local view-models. |
| Override allow-list | `OVERRIDE_FIELDS` (`hitl.ts`) ↔ leads/override route enum ↔ `REASON_CODES` (`ReviewInbox.tsx`) | Spans server↔client boundary; DRY only within one side, not across. |
| EN/ES dictionaries | `lib/i18n/en.ts` ↔ `lib/i18n/es.ts` | Parallel-by-design translation pair. |
| Add-on `kind` filters | `agent-tools.ts` keeps `'fixed'` ↔ `stripe.ts` blocks `'open_ended'` | Opposite predicates over the same catalog — complementary, not duplicate. |
| `channel ?? "form"` default | `store`-layer callers in `agent-tools.ts` (×8), `stripe.ts:281`, `app/api/funnel/agent/route.ts:86`, `app/api/operator/route.ts:26` | Phase-3 finding: a 1-line default spread across module boundaries; the agent-tools ×8 are incidental (7/8 also read `existing` for other fields). NOT a safe within-boundary merge — leave inline. |

## (C) DEAD-CODE candidates — verify against the oracle INCLUDING `src/*.test.ts` (Phases 1, 4)

| Candidate | Where | Reachable? (verified) | Action (Phase 1 outcome) |
|---|---|---|---|
| `confirmPayment` | `stripe.ts:233` | 0 call sites (only self + 2 comments). Speculative "future success_url handler". | **DELETED** (+ overview bullet + section header) |
| `RoofBbox` type | `src/area-card-logic.ts:10` | 0 refs; vestige of the retired roof-bbox approach. | **DELETED** |
| `getDict` | `lib/i18n/index.ts:15` | 0 refs; undocumented exact dup of the documented `t()`. | **DELETED** |
| `fmtLAtime` (+ private `LA_TIME`) | `app/components/format.ts` | 0 refs; `LA_TIME` consumed only by `fmtLAtime`. | **DELETED** (both) |
| `SlopePhotoPromptCard` import | `GenerativeChat.tsx:34` | Export is test-referenced (`cards-smoke.test`) → KEEP export; the *import* was unused (no `renderTool` case). | **DELETED import only** |
| `useLang` | `lib/i18n/index.ts:44` | Finder false positive — used by `useT` (live via `app/funnel/page.tsx`). | KEEP |
| `t()` (i18n) | `lib/i18n/index.ts:75` | 0 refs but documented intentional API for server fragments. | KEEP (cautious bias) |
| `contract.print.ts`, `stripe.smoke.ts` | `src/` | Standalone CLI dev-tools (`tsx src/X.ts`) — their own entry points, like `route.ts`/`page.tsx`. | KEEP (intentional utilities, not dead leaves) |
| `isStripeLiveOK`, `getAreaConfidenceThreshold` | `env.ts` | Tested in `env.test.ts` → test-reachable. | KEEP |
| `quoteRange` (`@deprecated` shim) | `pricing.ts` | Used by `operator.ts` + `core.test.ts`. | KEEP |
| `decodeIntent` utm/svc/zip branches | `intent.ts` | Covered by `intent.test.ts`. | KEEP |

> Oracle note: `tsconfig.json` has `strict` + `noUncheckedIndexedAccess` but **not** `noUnusedLocals`/`noUnusedParameters`,
> so unused locals/imports do NOT fail typecheck — they must be found by the Phase-1 finders, not the gate.

## (D) STALE-DOC targets — feeds Phase 12

| Doc/comment | Where | What's stale |
|---|---|---|
| "Claude Agent SDK / `query()` loop" / Stack list | `README.md` + `AGENTS.md:9,13,71` | **FIXED (Phase 14)** — dep dropped (`AGENTS.md:28`, absent from `package.json`); `agent.ts` uses the Messages API. README + AGENTS.md now describe the long-running Telegram runtime as a Messages-API loop; README Stack lists "Anthropic Messages API · Vercel AI SDK". New `CLAUDE.md` is the authoritative agent-onboarding doc. (Full V1→V2 *product* re-narration of README remains the tracked HANDOFF §7 TODO — out of scope for behavior-preserving cleanup.) |
| "TEST MODE ONLY" header | `stripe.ts:1` | **FIXED (Phase 12)** — now "test-mode by default; live gated by STRIPE_LIVE_OK=1". Also fixed: `handleStripeWebhook`→`handleStripeEvent` (stripe.ts:10) and the "live keys refused at boot" invariant (stripe.ts:15); webhook route header (app/api/stripe/webhook/route.ts:1). |
| "TEST MODE ONLY" (smoke script) | `stripe.smoke.ts:1` | **KEPT** — a smoke test legitimately should run test-mode; reasonable caution, not stale. |
| Rename-stale comments after phases 7/10 | repo-wide | **Scanned (Phase 12): none** — no commented-out code anywhere; `confirmPayment`/`frEs` fully gone. |

## (E) LOG-NOT-FIX behavior bugs — record, never fix mid-pass

| Bug | file:line | Wrong behavior (vs expected) |
|---|---|---|
| Divergent slot generators | `scheduler.ts` windows `[08-10,10-12,13-15,15-17]` (UTC) vs `app/api/funnel/slots/route.ts` `[08-11,11-14,14-17,17-19]` (`-07:00`, host-local `getDay()`) | UI offers slot times that don't match what `bookSlot` actually books. |
| Partial-write reverts to flat charge | `agent-tools.ts` measured-vs-flat branch (keys on `confirmed_sqft>0 && slope_tier`) | A store write that loses `slope_tier` silently bills the flat tier instead of the measured price (re-opens "review blocker A" via a different gap). |
| Same-lead read-modify-write race | `store.ts:316-333` (already documented in code) | Concurrent writers on one lead lose the loser (last-writer-wins); Stripe webhook vs `runConfirmArea`. |
| `PAID_STATES` conflation | `operator.ts:262`, `hitl.ts:123` set "Ready to Schedule" without a Stripe charge | Harmless today (LLM can't reach those setters); a latent payment-gate bypass if ever wired to `confirm_booking`. |
| Invalid seed Intensity | `seed.ts` seeds `overgrowth:'med'` | Not in `low|medium|high` (`contract.ts`); would fail the schema if re-validated. |
| `JsonBackend.load()` silent discard | `store.ts:150-154` | A corrupt JSON file silently discards ALL leads instead of erroring. |
| Inert pay button | `ExactPriceCard` (`cards.tsx`) "Pay & lock" has no `onClick` | Dead button; checkout actually happens via `CheckoutCard`. |
| Out-of-sync lockfile | `package-lock.json` vs `package.json` | `npm ci` fails ("Missing @cypress/request"); only `npm install` works. Repo-hygiene, not behavior. |
