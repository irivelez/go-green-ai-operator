# Go Green Maintenance AI Operator — Build Spec

**Version:** 2.0 · **Status:** Ready to build (pivot) · **Owner:** Deltanova (design-partner engagement)
**Design partner:** Go Green Landscape — premium garden maintenance, San Francisco
**Document type:** Production build spec (agent-native).

> **READ THIS FIRST — v2 supersedes v1 where they conflict.** [§A — V2: Autonomous ad→pay→book sales pipeline](#a--v2-autonomous-adpaybook-sales-pipeline) is the authoritative spec for the current build. Sections **1–19 below are v1 context** (the autonomous intake→qualify→price→**book-an-evaluation** funnel) and remain valid except where §A overrides them. The biggest overrides: pricing is now **measured-area + slope** (not guessed buckets), the first autonomous action is a **live Stripe charge for month-1 recurring** (not a free on-site evaluation), and the lead arrives from a **Meta ad** (not a cold inbound message). The Engineering Constitution and hard invariants (idempotency, range/extras discipline, escalation gate, "the LLM never charges Stripe") carry over unchanged.

---

## A — V2: Autonomous ad→pay→book sales pipeline

**Status:** authoritative for the current build · **Supersedes:** v1 §0, §3.2 staging, §6 state machine endpoint, §9.1 size model, §12.1 on-site-review rule (for measurable standard lots) · **Carries over:** everything else in v1 + the Engineering Constitution in `AGENTS.md`.

### A.0 The pitch (v2)

> A Meta-ad lead who wants their yard maintained lands in a chat, and the agent **measures their property from the address, prices it exactly, collects the first month by card, and books the first service onto the crew's calendar — autonomously, end to end.** Humans touch only the fraction the agent flags, and every human touch is captured as a labeled correction that tunes the system to flag less next time.

The win condition is **highest autonomous conversion, money actually collected, minimal outbound.** Outbound is the small tail of leads that didn't convert — and the agents work that tail too.

### A.1 The funnel (the one flow that matters)

```
Meta ad (intent encoded in the click)
   │
   ▼
1. WELCOME        agent opens already knowing the service intent (from ad param); blank-chat otherwise
2. ADDRESS        customer enters address → Address Validation API → "did you mean X?" → ROOFTOP geocode
                  HARD GATE: no validated address → no measurement → no price
3. MEASURE        address → parcel polygon (LightBox) → minus building footprint → maintainable area (sqft)
                  + slope grade from Elevation API (coarse tier) + photos (support + slope cross-check)
4. CONFIRM AREA   show the customer an outlined satellite image: "we'll maintain ~X sqft — look right?"
                  → tap "looks right" (consent) OR drag/redraw the area (self-service fallback when data is thin)
5. PRICE          measured-area bucket × frequency × slope multiplier = ONE EXACT per-visit price
                  (deterministic; never an LLM number; tiers = "what's included" descriptors only)
6. PAY            propose_checkout stages a LIVE Stripe Checkout for month-1 recurring → customer pays
                  HARD GATE: the LLM never charges; Stripe charges on the customer's click
7. SCHEDULE       only after paid → offer_slots → customer picks → confirm_booking (refuses until paid)
8. CREW HANDOFF   booked job → Google Calendar event (Composio) with the work order:
                  address · measured area · slope · tier inclusions · access notes · PAID status
   │
   ▼ (at any step, on a flag)
ESCALATE          raise_escalation → owner dashboard → human acts → correction captured as a label (§A.6)
```

This reuses the existing tool-driven generative-UI funnel (`app/agent` + `app/api/funnel/agent/route.ts` + `src/agent-tools.ts`). New tools slot into `buildTools()`; new cards slot into `cards.tsx`. **No rewrite — extension.**

### A.2 Geo-measurement pipeline (the new pricing input)

There is **no "Google Earth measure" API** — that tool is manual desktop-only (confirmed). Automated measurement is assembled from real APIs. **V1 is free-first** (locked): try a cheap/free auto-measure, and **fall back to customer-draws-on-map only when confidence is low.** Paid parcel/AI vendors (LightBox, Nearmap) are the **precision upgrade**, deliberately OUT of V1 to de-risk per-lead cost before conversion is proven.

**V1 cost target: ~$0–0.02/lead** (vs $0.10–2.15 with paid parcel/AI). All Google calls below sit comfortably inside Google's $200/mo free Maps credit at test volume.

| Step | V1 service (free-first) | Input → Output | Cost / notes |
|---|---|---|---|
| Typeahead (prevent typos) | **Google Places Autocomplete** | partial string → ranked predictions + placeId | At the address input, so most addresses are clean before validation. ~$0.003/req |
| Validate + correct address | **Google Address Validation API** | address → `verdict` (VALIDATED/CORRECTED/UNVALIDATABLE) + standardized address + ROOFTOP geocode | Surfaces "did you mean X?"; `CORRECTED`/non-ROOFTOP → confirm with customer before measuring. ~$0.005/req. Docs: developers.google.com/maps/documentation/address-validation |
| **Auto-measure attempt** (building) | **Google Solar `buildingInsights:findClosest`** | geocode → roof/building footprint + `boundingBox` | ~$0.01/req. Gives the building footprint to subtract + a satellite-anchored outline to pre-draw |
| **Auto-measure attempt** (lot) | **Parcel-area ESTIMATE** = building bbox scaled by a residential lot-coverage heuristic (SF default), bounded by the satellite frame | geocode + roof bbox → estimated maintainable sqft + **confidence** | Free (derived). Coarse on purpose — its job is to PRE-DRAW a starting polygon, not to be the final number |
| Slope | **Google Elevation API** (sampled grid → grade %) | parcel grid points → elevations → coarse tier (flat / moderate / steep) | ~free at test volume. ~10–30m res is coarse → **photo cross-check is mandatory** (§A.3). USGS 3DEP 1m = free precise upgrade |
| **Fallback + confirm (always)** | **Google Maps JS (satellite + Drawing/Geometry)** | render the auto-outline; customer drags/redraws the polygon → `geometry.spherical.computeArea()` → sqft client-side | **$0/measurement.** The §A.1-step-4 card. The customer's confirmed/redrawn polygon is BOTH the authoritative measurement AND the price consent |

**Auto-measure → draw-on-failure logic (locked):**

```
1. geocode (validated address)
2. auto-measure attempt:
     roof bbox (Solar) + lot-coverage heuristic → estimated_sqft + confidence
3. ALWAYS render the result on a satellite map as an editable polygon (pre-drawn from step 2,
   or a blank draw surface if step 2 returned nothing / low confidence)
4. confidence HIGH  → polygon is pre-drawn; customer taps "looks right" (one tap) or nudges it
   confidence LOW   → polygon is rough/absent; customer draws/redraws the maintained area
5. the FINAL authoritative area = the polygon the customer confirmed (computeArea on their polygon)
6. persist: estimated_sqft, confirmed_sqft, area_source ("auto"|"customer_draw"),
            area_confidence, area_confirmed_by_customer=true
```

The customer ALWAYS confirms on the map; the only thing confidence changes is whether we hand them a pre-drawn outline (fast, one tap) or a blank canvas (they draw). **No human/owner step in either path** — escalation happens only if the customer abandons without confirming a polygon, or on an §A.1 flag.

**Maintainable-area rule (locked):** present "approx maintainable area" = the customer-confirmed polygon, with the building footprint pre-subtracted from the auto-outline when available. Not exact lawn segmentation in V1 (Nearmap AI lawn/hardscape split is the paid precision upgrade).

**Paid precision upgrade (POST-V1, evidence-gated per Constitution §0):** swap the step-2 heuristic for **LightBox Parcels** (real county polygon + area, ~$0.10) and optionally **Nearmap AI Rollup** (true roof/driveway/tree/lawn split, ~$0.50–2). This removes the customer-draw step entirely for covered addresses. Add only once conversion justifies the per-lead spend. Docs: developer.lightboxre.com/apis/parcels · developer.nearmap.com/docs/ai-api

### A.3 Slope handling (locked)

Coarse elevation grade is a **price modifier**, not a gate — but it has a known failure: a terraced backyard behind a flat-fronted house reads as flat and underprices the exact SF hill-lots where labor explodes. Corrective:

- Compute coarse grade tier from Elevation API grid.
- **Agent explicitly prompts for / inspects a slope-revealing photo** (stairs, retaining walls, terraces).
- **Elevation-flat BUT photo-shows-steps → bump the slope tier.** Photo evidence can raise, not lower, the modifier (so it isn't gameable by flattering angles).
- Slope tier feeds the exact price (§A.4).

### A.4 Pricing model (v2 — supersedes v1 §9.1)

**Locked:** `exact_per_visit = f(area_bucket, frequency, slope_tier)`. One number, charged directly — no range to the paying customer, no human approval for standard measurable lots.

- Replace [`PER_VISIT`/`CLEANUP` in `src/pricing.ts`](./src/pricing.ts) (keyed `small|medium|large`) with **area-range buckets** (sqft → price), each × frequency, × **slope multiplier** (e.g. flat ×1.0 / moderate ×1.15 / steep ×1.35 — values from the rate-card sign-off, §19.6).
- Replace `PricingCase.yard_size_bucket: YardSize` with `{ measured_area_sqft: number; slope_tier: "flat"|"moderate"|"steep" }`.
- Add to the measurement result + `Lead` shape: `estimated_sqft`, `confirmed_sqft`, `area_source: "auto"|"customer_draw"`, `area_confidence`, `area_confirmed_by_customer: boolean`, `slope_tier`, `slope_source`. The pricing input `measured_area_sqft` = `confirmed_sqft` (the customer-confirmed polygon is always authoritative — §A.2).
- **`PRICE_BOOK` (tiers) is UNCHANGED** — tiers become "what's included" descriptors shown next to the exact price; the area/slope/frequency math drives the dollars.
- Blast radius (from audit): rewrite `pricing.ts` lookups + `quoteRange`, retire `operator.ts:inferYardSize()`, update `vision.ts` schema/prompt, update `seed.ts` + `agent-evals.ts` fixtures. `priceCart`, Stripe, idempotency, escalation gate untouched.

### A.5 Money + crew handoff (supersedes v1 evaluation-first)

**Locked:** the first autonomous action is a **live Stripe charge for month-1 recurring maintenance.** Geo-measurement **replaces the on-site evaluation gate** for standard measurable lots — v1 §12.1 "no final price without on-site review" is **lifted for those cases** (still enforced for escalated/unmeasurable ones).

- **Order (locked): pay FIRST, then pick slot.** `confirm_booking` already refuses until paid — keep that gate.
- **Margin safety without on-site review (locked):** the **first crew visit re-measures on-site**; if reality is materially off the remote data, the agent **reprices visit-2-onward** (with notice). Month-1 stays. Reversibility (correct-forward, not clawback) is what makes the up-front autonomous charge safe (Constitution §5).
- **V1 ships LIVE Stripe** (real money), not test mode.
- **Crew endpoint (locked): Google Calendar event** via the already-wired Composio path — carrying address · measured area · slope · tier inclusions · access notes · paid-status. The crew lives in their calendar; no new app to adopt. (Internal `work_order` record persists in the store for the office/dashboard.)

### A.6 Two UIs + the human-in-the-loop learning loop

**UI 1 — Lead funnel** (`app/agent`): the ad→pay→book chat above. New cards: **AddressConfirmCard** ("did you mean X?"), **AreaConfirmCard** (satellite + outline + drag-to-redraw), **SlopePhotoPromptCard**, **ExactPriceCard**, then existing checkout/slot/confirmation cards.

**UI 2 — Owner dashboard** (`app/page.tsx` + review inbox): watch the pipeline, intervene on flags. **Ships in V1 with core features** (thin but real, working day 1).

**The learning loop (NEW — no substrate exists today; must be built):** the current approve/reject only flips status + appends free text. V2 requires:

1. **Structured reason code** on every approve/reject/override (e.g. `area_wrong · slope_underestimated · should_have_escalated · price_too_low · address_wrong`).
2. **The corrected value**, not just yes/no — when the owner overrides, capture the RIGHT answer (correct area, correct slope tier, correct decision). This is the highest-signal datum.
3. A minimal **`events` store** (the substrate for both): append-only `{lead_id, ts, actor, action, reason_code?, corrected_value?, agent_decision, inputs}`. This is the v1 §17 audit log, finally real, and the home for #1 and #2.
4. **Periodic rubric/prompt tuning** from accumulated reason-codes + corrections — the actual "reduce human intervention over time" mechanism. (Auto-regression-eval-per-override is a fast-follow, not V1.)

> Scope honesty: the user prioritized reason-code + corrected-value + periodic tuning. Full per-lead event tracing and auto-generated regression evals are described as the natural extension but are **not V1 blockers** — except the minimal `events` row, which is required because the corrected value has nowhere else to live.

### A.7 Lead source — Meta ads

**Locked:** leads arrive as a **blank chat with the service intent encoded in the ad click** (UTM/param), no Meta Lead Form for V1. The funnel route reads the intent param so the agent opens warm ("Looks like you're after weekly mowing — let's get you booked"). Meta Instant Forms + webhook ingestion is a later option, not V1.

### A.8 V1 market-test definition of done (locked must-be-real)

For a real paying customer from a real Meta ad, ALL must genuinely work end-to-end:

1. **Real address-validate + auto area measurement** (with map confirm/draw fallback).
2. **Real exact price + real LIVE Stripe charge** (money actually collected).
3. **Real slot booking the crew can see** (Google Calendar event with the work order).
4. **Real owner dashboard** shipped with core features (watch + intervene + capture the structured correction) — thin but real, working day 1.

Deferred / nice-to-have for the test: Nearmap precision lawn-split, USGS 1m slope, Meta Instant Forms, auto-regression-eval generation, multi-channel (WhatsApp/email).

### A.9 New/changed modules (extend-in-place map)

| Module | Action |
|---|---|
| `src/geo.ts` (NEW) | address-validate · auto-measure-attempt (Solar roof bbox + lot-coverage heuristic → estimated_sqft + confidence) · slope-grade — free-first wrappers over the APIs in §A.2, each returning a typed result + confidence + source. NO paid parcel vendor in V1. |
| `src/geo.ts` → measurement | `estimated_sqft` + `area_confidence` feed the map card; the **customer-confirmed polygon** (`geometry.spherical.computeArea`, client-side) is the authoritative `confirmed_sqft`. Draw-on-low-confidence, one-tap-on-high-confidence (§A.2). |
| `src/pricing.ts` | rewrite `PER_VISIT`/`CLEANUP`/`quoteRange` to area+slope; new `PricingCase` shape (§A.4) |
| `src/vision.ts` | drop `yard_size_estimate`; add slope-photo cross-check; keep condition/cleanup |
| `src/agent-tools.ts` | new tools: `validate_address · measure_property · confirm_area · compute_exact_price`; keep `propose_checkout`/`offer_slots`/`confirm_booking`/`raise_escalation` |
| `src/store.ts` | extend `Lead` with measurement + slope + `area_confirmed_by_customer`; add `events` append-log + reason-code/corrected-value capture |
| `app/agent/components/cards.tsx` | AddressConfirm · AreaConfirm(map) · SlopePhotoPrompt · ExactPrice cards |
| `app/components/ReviewInbox.tsx` + approve/reject routes | structured reason-code + corrected-value capture → `events` |
| Crew handoff | Composio Google Calendar event on booking (work order payload) |
| `PRICE_BOOK`, Stripe, idempotency, escalation gate, dashboard shell | **unchanged** |

### A.10 Open items for sign-off (v2-specific; extends §19)

1. **Rate card v2:** the area-range→price table + slope multipliers (flat/moderate/steep) need owner sign-off before live auto-charge.
2. **Measurement (V1 = free-first, LOCKED):** auto-measure attempt (Solar roof bbox + lot-coverage heuristic) → customer-draws-on-map fallback; NO paid parcel/AI vendor in V1. Sign-off needed only on the **lot-coverage heuristic default** (SF residential) and the **confidence threshold** that decides pre-drawn-vs-blank. LightBox/Nearmap are the evidence-gated post-V1 upgrade (§A.2).
3. **Reprice policy:** the threshold ("materially off") + notice copy for visit-2 reprice after on-site re-measure.
4. **Meta:** ad-param schema for intent encoding; pixel/conversion tracking on the pay event.
5. **Live Stripe:** account/keys for live mode + the month-1 recurring product/price IDs.
6. **Calendar:** which Google Calendar the crew actually uses + event/work-order field mapping.

---

## 0. The one-sentence pitch

> **v1 context** — see §A.0 for the v2 pitch. The first autonomous action in v2 is a paid booking, not a free evaluation.

An **autonomous operations layer** that runs Go Green's recurring-maintenance funnel end-to-end — from the first "can you mow my yard?" to a qualified, scoped, calendar-booked evaluation with a crew-ready work order — handling standard cases with **no human in the loop**, and escalating only the calls that genuinely need a human.

It is the first piece of a **digital twin of the business**: software that plays the office, coordinator, and dispatcher roles so the humans are left with the mower and the high-judgment decisions.

---

## 1. First-principles framing (why this shape)

A landscaping business is an **information pipeline wrapped around a physical crew**:

```
Acquire → Qualify & scope → Price → Schedule/route → EXECUTE (physical) → Document → Bill → Retain/upsell → Handle exceptions
```

Only **Execute** needs human hands. Everything else is information work — and it's ~80% of the owner/office's time. The margin lever in field services is **route density** (jobs clustered geographically = less windshield time = more billable hours), which is why *geography is a qualification criterion*, not an afterthought.

**V1 deliberately owns the front of the pipeline** — Acquire → Qualify → (range) Price → Schedule — because that's where leads leak today (slow response, missing info, bad-fit jobs, scope confusion) and where autonomy pays off fastest. Billing, routing optimization, and the design/build revenue engine are explicitly **out of scope for V1** (see §3) and phased later.

---

## 2. Goal, non-goals, success metrics

### 2.1 Primary goal
Convert more inbound maintenance leads into **qualified, properly-scoped, booked evaluations** — automatically, within ~1 minute of first contact, without scope disputes downstream.

### 2.2 North-star metric
**Qualified bookings / week** (A-leads turned into scheduled evaluations with a complete work order).

### 2.3 Supporting metrics (instrumented from day 1)
- Median **time-to-first-response** (target: < 60s)
- **% leads with complete info** before scheduling (address + photos + frequency)
- **% leads correctly qualified** (A/B/C vs. human spot-check) — eval metric
- **Autonomy rate**: % of leads resolved with zero human touch
- **Escalation precision**: % of escalations that genuinely needed a human (low false-escalation)
- **Scope-dispute rate**: post-visit "I thought that was included" incidents (target: ~0)

### 2.4 Non-goals (V1)
- ❌ Final/binding pricing without human approval (range-only autonomy — see §9)
- ❌ Design/build project intake (hardscape, drainage, turf, pergolas, retaining walls)
- ❌ Route optimization across the crew calendar (V1 books into open slots only)
- ❌ Invoicing, payments, collections
- ❌ Autonomous handling of HOA / commercial / property-manager / complaint / legal cases
- ❌ SMS channel (Email + WhatsApp + Website form only)

---

## 3. The autonomy model (the core of the system)

The interview locked **Balanced autonomy**: the agent handles standard maintenance **fully autonomously**, and escalates flagged cases to a human review queue. The design principle:

> **Autonomy is gated by case *type*, not by step.** Inside a "standard residential maintenance" case the agent runs the whole flow alone. The moment a case trips a flag, control transfers to the dashboard.

### 3.1 Decision rights matrix

| Decision | Agent acts autonomously | Requires human |
|---|---|---|
| Reply to new lead (warm intake) | ✅ always | — |
| Detect language, mirror EN/ES | ✅ | — |
| Request address / photos / frequency | ✅ | — |
| Read photos → assess yard condition | ✅ | — |
| Qualify A / B / C | ✅ | — |
| Detect "initial cleanup required" | ✅ | — |
| Recommend frequency + package | ✅ | — |
| Quote a **price range** (rule-based, standard residential) | ✅ within the pricing engine's guardrails | — |
| **Final/binding price** | ❌ | ✅ approve in dashboard |
| Book an evaluation into an open standard slot (in-area, qualified) | ✅ | — |
| Create work order + Drive folder + calendar event | ✅ | — |
| Run the 1h / 24h / 3d / 7d follow-up sequence | ✅ | — |
| Anything tripping an **escalation flag** (§12.2) | ❌ | ✅ |

### 3.2 Rollout: shadow mode → supervised → autonomous
*Shadow mode* = the agent drafts every action but nothing is sent/booked; a human compares the agent's proposed action against what they'd do. We graduate per case-type once eval accuracy clears the bar (§14).

1. **Shadow** (days 1–N): agent proposes, human sends everything. Collect eval data.
2. **Supervised**: agent auto-sends intake + info requests; human approves bookings + ranges.
3. **Autonomous (target)**: agent runs standard cases end-to-end; human only touches the escalation queue.

This staging is how we push autonomy to the max *safely* — we earn each increment with measured accuracy, not hope.

---

## 4. System architecture (agent-native)

```
                 ┌─────────────────────────────────────────────────────────┐
   Inbound       │                    GO GREEN AI OPERATOR                  │
 ┌──────────┐    │                                                          │
 │ Telegram │──▶ │  ┌───────────┐   ┌──────────────────────────────────┐   │
 │  (LIVE)  │    │  │  Channel  │   │        AGENT CORE (brain)        │   │
 ├──────────┤    │  │ normalizer│──▶│  Claude Agent SDK (TS) · query() │   │
 │  Email   │──▶ │  │ (per chan)│   │  built-in loop + MCP tools       │   │
 ├──────────┤    │  └───────────┘   │  canUseTool gate · subagents     │   │
 │ WhatsApp │──▶ │        ▲         └──────────────┬───────────────────┘   │
 └──────────┘    │        │                        │ tool calls            │
                 │        │         ┌──────────────┼───────────────────┐   │
                 │   mem0 (client   │              ▼                   │   │
                 │   + thread       │   ┌──────────────────────────┐   │   │
                 │   memory)        │   │   TOOL LAYER (Composio)   │   │   │
                 │                  │   │ Gmail · WhatsApp · GCal · │   │   │
                 │                  │   │ Drive · Airtable          │   │   │
                 │                  │   ├──────────────────────────┤   │   │
                 │                  │   │  CUSTOM TOOLS             │   │   │
                 │                  │   │ pricing_engine · vision   │   │   │
                 │                  │   │ (Claude) · geo_qualify ·  │   │   │
                 │                  │   │ pricing_research (Tavily) │   │   │
                 │                  │   └──────────────────────────┘   │   │
                 │                                                       │   │
                 │   ┌───────────────────────────────────────────────┐ │   │
                 │   │   Airtable  = system of record (lead pipeline) │ │   │
                 │   └───────────────────────────────────────────────┘ │   │
                 └──────────────────────────┬──────────────────────────┘   │
                                            ▼                              │
                          ┌─────────────────────────────────┐             │
                          │  Next.js HITL dashboard (Vercel) │  ◀── human  │
                          │  review inbox · approvals · KPIs │     operator │
                          └─────────────────────────────────┘             │
```

### 4.1 Stack — load-bearing vs additive (honest split)

Not everything is required for a functional product. The **load-bearing** layer *is* the product and must be live. The **additive** layer earns hackathon sponsor credit and adds demo-able beats — wire the pieces that genuinely save build time or land a memorable moment, drop the rest before they become risk.

**Load-bearing — must be real and live:**

| Layer | Tech | Why it's non-negotiable |
|---|---|---|
| Operator brain + autonomy runtime | **Claude Agent SDK** (TS, `@anthropic-ai/claude-agent-sdk`) | The product. Built-in agentic `query()` loop, MCP tools, context compaction, sessions, subagents — **and native Claude vision** (reads yard photos directly, no separate vision service). Its permission layer *is* our autonomy model (§4.4). |
| Live channel | **Telegram Bot API** | Real two-way customer conversation in the demo; instant, free, reliable, native photo + button support (§4.2) |
| System of record | **Airtable** | Persists the lead pipeline; doubles as a visible back-office judges can watch update live |
| Pricing engine | **Deterministic TS function** (§9) | Real autonomous range-quoting off the researched rate card — not an LLM guess |
| Human surface | **Next.js dashboard** + **Vercel AI SDK** (Vercel) | The "autonomy + human-in-the-loop" story: review inbox, approvals, live pipeline + KPIs. Vercel AI SDK powers any streaming UI bits the Agent SDK isn't built to render |

**Additive — sponsor credit / extra demo features, safe to cut:**

| Tool | Use it for | If we skip it |
|---|---|---|
| **Composio** (`SHIP_BUILDERS`) | Google Calendar booking + Gmail/Drive in one SDK — saves OAuth glue | Book into a simple internal slot table; sync Google later |
| **mem0** (`SHIPBUILDERS`) | Returning-client memory ("welcome back" vs. cold intake) — strong demo beat | Store recent context in Airtable |
| **Tavily** (`TVLY-7CCN692Z`) | The live pricing-research workflow (§9.3) — already produced our rate card | Rate card stays static in Airtable |
| **Nebius** (`BUILDER-SHIP-HACK`) | Cheap bulk inference / heavier vision at scale | **Dropped from V1** — Claude is already multimodal |

> **Honest answer to "do we need all of it?": No.** The Claude Agent SDK + Telegram + Airtable + a Next.js dashboard + the pricing engine is a complete, functional product. The four sponsor tools are *additive*. This is also why we build on the **Agent SDK's built-in loop + permission gates** rather than the original doc's Make/n8n decision-tree flows — only a reasoning loop with native autonomy controls can handle a messy, bilingual, photo-laden chat *and* keep the human in the loop on exactly the right calls.

### 4.2 Channel strategy — Telegram live, WhatsApp as the swap

The agent core is **channel-agnostic**: a thin per-channel *adapter* normalizes any inbound (text + photos) into one internal message shape, so adding or swapping a channel is a config change, not a rewrite.

- **Telegram = the live channel.** Official Bot API, token in ~60s from @BotFather, rock-solid, native photo + inline-button support (perfect for the customer flow *and* one-tap human approvals). Zero approval friction — the right bet for a judged live demo.
- **WhatsApp = the production swap, demoed not depended-on.** Baileys (unofficial WhatsApp-Web) self-hosts but carries ban risk + fragile QR sessions — bad on a live stage. The official Cloud API needs Meta verification + template approval — too slow for the window. We show the adapter interface + a mock WhatsApp thread to prove the swap, and wire it for real post-event.
- **Email / website form = demoed** through the same adapter (Composio Gmail or a webhook) — shown working on one example, not load-bearing for the live run.

### 4.3 Integration philosophy — build the new operations, not a wrapper

We're speccing a **digital twin / brand-new operating model**, not bolting AI onto Go Green's current spreadsheet. So we **integrate-for-real only the few things that are both high-value and low-friction** (live channel, pricing engine, booking, record store) and **demo or stub the rest** (Google Workspace sync, Drive photo archive, multi-channel intake, water-rebate lookups). The demo's job is to show the **new AI-run modus operandi** — autonomous intake → qualify → price → book under human oversight — not feature-parity with how they work today.

### 4.4 Why the Claude Agent SDK runs the brain (from day one)

The autonomy model (§3) isn't bolted on with custom `if`-statements — it maps **1:1 onto native Agent SDK primitives**, which is exactly why we adopt it from the first commit:

| Our spec concept | Agent SDK primitive | What it gives us |
|---|---|---|
| HITL approval gate (§3.1 decision-rights) | **`canUseTool(toolName, input)`** callback → `allow` / `deny` (+ edited input) | The escalation gate *is* a native callback. `book_evaluation` / `send_final_price` on a flagged case → `deny` → route to dashboard; standard case → `allow`. |
| Hard rules, "code-level not prompt-level" (§12.1) | **`PreToolUse` hooks** (matcher + deny decision) | "No schedule without address," "range-only pricing," idempotency — enforced deterministically, can't be prompt-jailbroken. |
| Operator roles: qualifier / scheduler / pricing (§5) | **Subagents** (`agents` / `AgentDefinition`) with per-role tools + model | Cheap model qualifies; stronger model handles scope + pricing. Tool access scoped per role. |
| ReAct loop over long bilingual photo threads (§5) | **Built-in `query()` loop** + context compaction + sessions | We don't hand-roll the loop or memory compaction; each lead = a resumable session. |
| Composio / Google / Airtable tools (§7) | **MCP-native** (`mcpServers` + `allowedTools`) | Composio's MCP server plugs straight in; non-business tools (Bash/file) are disabled via `allowedTools`. |

**Division of labor:** the **Agent SDK is the backend brain/runtime**; the **Vercel AI SDK + Next.js** render the human-facing dashboard and any streaming UI (the Agent SDK runs as a Node process, not a React surface). Complementary layers, not competitors.

**Tradeoff we accept:** the SDK carries coding-agent DNA (Bash/Read/Write/file tools, expects a working dir). We neutralize it by restricting `allowedTools` to only our MCP business tools. Anthropic-only is a non-issue — Claude is already our chosen model.

---

## 5. The agent loop

Every inbound event (new message, photo, form submission, follow-up timer) wakes the agent on that lead's thread. Each thread is an Agent SDK **session** resumed via `query()`; the SDK runs the loop below and we only supply tools + gates:

```
1. PERCEIVE   resume session (Agent SDK) → lead record (Airtable) + thread history
              + client memory (mem0) + new inbound (channel adapter) + Claude vision on photos
2. REASON     built-in query() loop: case type? what's missing? next best action? which flags trip?
              (thought → tool call → observation → repeat, with auto context compaction)
3. GATE       every tool call passes canUseTool + PreToolUse hooks:
              standard case → allow · flagged case or hard-rule breach → deny → raise_escalation()
4. ACT        allowed tools fire: send reply, request info, qualify, quote range, book, work order
5. PERSIST    update Airtable pipeline stage + write durable facts to mem0 + log the decision (audit)
```

**Idempotency** (safe to retry without double-acting): every outbound action is keyed by `(lead_id, action_hash)`; a `PreToolUse` hook checks "did I already send/book this?" before the tool runs, so a re-trigger never double-books or double-texts.

---

## 6. Pipeline state machine

Lead `status` (single source of truth in Airtable). Agent transitions are deterministic; ambiguous transitions escalate.

```
New Lead → Waiting for Info → Info Received → AI Qualified ─┬─▶ Ready to Schedule → Scheduled → Work Order Created
                                                           ├─▶ Needs Human Review  (escalation queue)
                                                           └─▶ Not a Fit
   (any "Waiting" stage) ──follow-up timers──▶ Lost / No Response
```

| Stage | Entry condition | Agent does |
|---|---|---|
| New Lead | Inbound from any channel | Create record, detect language, send warm first response (§8.1) |
| Waiting for Info | Missing address / photos / frequency | Ask for the specific missing item; arm follow-up timers |
| Info Received | Required fields present | Run qualification + vision |
| AI Qualified | A/B/C assigned + cleanup flag set | Recommend frequency + package + range; pick next branch |
| Ready to Schedule | A-lead, in-area, standard, not flagged | Offer 2 open slots → book on confirm |
| Scheduled | Client confirmed a slot | Create GCal event + Drive folder + work order |
| Work Order Created | Booking complete | Notify office; lead leaves the autonomous loop |
| Needs Human Review | Any escalation flag (§12.2) | Hand to dashboard with a full brief |
| Not a Fit | C-lead criteria | Polite decline (§8), close |
| Lost / No Response | Follow-up sequence exhausted | Close, keep memory for reactivation |

---

## 7. Tool registry (what the agent can call)

Tools are exposed to the Agent SDK as **MCP tools** (registered via `mcpServers`, whitelisted via `allowedTools` so the SDK's default Bash/file tools stay off). Every call is mediated by `canUseTool` + `PreToolUse` (§4.4). **LIVE** = wired for the hackathon demo; **demo** = stubbed/mock for the live run, real post-event.

| Tool | Backed by | Purpose | Autonomy |
|---|---|---|---|
| `send_message(channel, lead_id, body)` | **Telegram Bot API** (LIVE) · Composio Gmail/WhatsApp (demo) | Reply on the lead's channel | auto |
| `read_inbound(lead_id)` | **Telegram** (LIVE) · adapter (demo) | Pull latest message + attachments | auto |
| `analyze_yard_photos(urls)` | **Claude native vision** (LIVE) | Condition score, overgrowth/weeds/leaves, cleanup-needed bool, detected extras | auto |
| `geo_qualify(address)` | **custom** (LIVE) | In/out of SF service area + zone tag | auto |
| `quote_range(case)` | **custom** pricing engine §9 (LIVE) | Rule-based price range for standard residential | auto (range only) |
| `score_lead(case)` | **custom** (LIVE) | A/B/C + risk level from rubric | auto |
| `find_open_slots(duration)` | internal slot table (LIVE) · Composio GCal (optional) | Read availability | auto |
| `book_evaluation(slot, lead)` | internal slots (LIVE) · Composio GCal (optional) | Create the evaluation event | auto (standard only) |
| `create_drive_folder(lead)` | Composio Google Drive (demo) | Per-lead folder, attach photos | auto |
| `upsert_lead(fields)` | **Airtable** (LIVE) | Write pipeline record | auto |
| `create_work_order(lead)` | **custom** → Airtable (LIVE) | Generate the crew work order | auto |
| `remember(lead_id, facts)` / `recall(lead_id)` | mem0 (optional) · Airtable fallback | Durable client/thread memory | auto |
| `schedule_followup(lead_id, when)` | **custom** queue (LIVE) | Arm 1h/24h/3d/7d timers | auto |
| `raise_escalation(lead_id, reason, brief)` | **custom** → dashboard (LIVE) | Hand to human queue | auto trigger |
| `run_pricing_research(scope)` | Tavily §9.3 (demo beat) | Refresh market rate card | human-triggered |

---

## 8. Conversation design & tone

The agent's voice is governed by the **Master Prompt** (the client-communication standard already written for Go Green) compiled into the system prompt: professional, warm, premium, honest, no-drama; mirror the client's language (EN/ES); short paragraphs; always end on a clear next step. Hard "never say" list enforced (no "we're cheap", no final prices, no "the crew can just do it", no guarantees).

### 8.1 Canonical first response (EN)
> "Hi [Name], thank you for reaching out to Go Green Landscape. We'd be happy to help with your garden maintenance. To better understand the scope, could you please send us the property address, a few photos or videos of the areas, and how often you're looking for service: weekly, biweekly, or monthly?"

(ES mirror per Master Prompt §4.3.)

### 8.2 Required intake fields (no scheduling without these)
`name · phone · email · property address · property type · service requested · desired frequency · photos/videos · access notes · urgency · language`
**Hard rule:** no address → no scheduling. No photos/visit → no specific price.

### 8.3 Scope-protection reflexes (auto)
Maintenance ≠ irrigation repair / tree trimming / planting / mulch / deep cleanup / hauling / hardscape. When a client requests these, the agent acknowledges + flags as a **separate quoted item**, never "included."

---

## 9. Pricing engine + pricing-research workflow

The hinge for autonomous quoting. Per the interview, **there is no existing rate card** — so we (1) generate a **proposed V1 rubric from market research**, and (2) ship a repeatable **pricing-research workflow** to keep it current.

### 9.1 Pricing engine (deterministic, range-only)
A pure function the agent calls; never a free-form LLM guess:

```
quote_range(case) = f(yard_size_bucket, frequency, package_tier, cleanup_required, zone)
                  → { low, high, currency, assumptions[], confidence }
```

Inputs come from vision (`yard_size_bucket`, `cleanup_required`) + intake (`frequency`, `package_tier`) + `geo_qualify` (`zone`). Output is a **range with explicit assumptions**, plus the standard caveat that final pricing needs an on-site review. Anything outside the rubric's coverage → escalate (no autonomous range).

### 9.2 Proposed V1 rate card — *market-researched, premium SF positioning*

> Figures below are the **Go Green premium tier** (15–35% above SF median), cross-referenced across ≥2 sources each (LawnBySeason SF, BidMaker CA, HousecallPro, CostWhale SF, Stackrows, 2026). SF Bay Area runs **~55% above the national average**; premium positioning is defensible via native-plant expertise, water-rebate navigation (EBMUD/SFPUC, $2–4/sq ft), steep-lot capability, and bilingual crews. All ranges; final price always needs on-site review.

**Recurring maintenance — price per visit (Go Green premium, SF residential):**

| Yard size | Weekly | Biweekly | Monthly |
|---|---|---|---|
| Small (<0.1 ac) | $70–$85 | $95–$115 | $120–$145 |
| Medium (0.1–0.25 ac) | $115–$140 | $155–$190 | $210–$260 |
| Large (>0.25 ac) | $210–$260 | $290–$370 | $420–$540 |

*Monthly-equivalent for biweekly = per-visit × 2.17. Minimum service charge $150–$200/visit covers travel + setup.*

**Initial cleanup (premium):** solo $85–$110/hr · 2-person crew $155–$190/hr · 3+ crew $210–$260/hr. Typical jobs — small $280–$700, medium $650–$1,500, large $1,300–$3,000 (depending on overgrowth). Minimum charge $150–$200. **First-cut surcharge** for overgrown recurring clients: +$25–$50 (2–3 wks overdue), +$75–$150 (4–6 wks), reprice as cleanup if 6+ wks.

**Add-ons (always quoted separately, premium):**

| Add-on | Range | Unit |
|---|---|---|
| Mulch installation | $116 / $175 / $233 (low/med/high) | per yd³ installed |
| Irrigation inspection | $120–$300 | per job (often credited to repair) |
| Irrigation repair | $150–$300 zone · $400–$1,200 job | per zone / job |
| Seasonal planting | $8–$15 / flat · $300–$800 / bed | flat / bed |
| Fertilization | $65–$120 app · $400–$800 annual (4–6) | per app / year |
| Tree trimming | small $150–$350 · med $400–$900 · large $900–$1,800+ | per tree |
| Pressure washing | $0.10–$0.25/sq ft · $300–$800 typical job | sq ft / job |
| Drainage / French drain | $25–$75 | per linear foot |
| Debris bagging & haul-away | $20–$50 | per visit add-on |

**Packages (recommended 3-tier, anchored to push the middle):**

| Tier | Monthly | Annual | Adds over prior tier |
|---|---|---|---|
| **Essential Care** | $250–$400 | $3,000–$4,800 | mow/edge/blow weekly, seasonal cleanup, basic weed control, monthly irrigation spot-check |
| **Signature Care** *(push — target 60–70%)* | $500–$750 | $6,000–$9,000 | + fertilization program, monthly fine gardening, annual mulch refresh, irrigation inspection + minor repairs, seasonal color |
| **Premium Plus** *(anchor)* | $1,000–$1,500 | $12,000–$18,000 | + biweekly fine gardening, tree trimming 2–3×, pressure washing, drainage + lighting checks, priority 24h response, 2-yr plant warranty |

*Tier deltas (~+50–100% each step) mirror real premium operators (Clean Peak, Seville Bay Area). Essential filters price-shoppers; Signature is the margin sweet spot; Premium exists mainly to make Signature feel smart. Offer 5–10% discount for 12-month contracts.*

### 9.3 Pricing-research workflow (`run_pricing_research`) — agentic, repeatable
A dedicated workflow (human-triggered, e.g. quarterly or on demand):

```
1. Tavily search: "SF Bay Area residential garden maintenance pricing 2025–2026"
   (frequency × yard-size; cleanup; add-ons; competitor tier packaging)
2. Tavily extract: pull rate tables from Jobber/Angi/Thumbtack/HomeGuide/Lawn Love + local comps
3. Claude synthesizes → low/median/high, premium markup over median, cited sources
4. Write proposed rubric → dashboard for ONE human approval
5. On approve → commit to Airtable `pricing_rules` table → live in the engine
```

This satisfies "propose a pricing structure based on market research, triggered as its own workflow" and keeps pricing a living, auditable artifact rather than a hardcoded guess.

---

## 10. Memory (mem0 — additive; Airtable fallback)

mem0 powers the returning-client "welcome back" beat. It's additive — if cut, the same facts live in Airtable and `recall()` reads from there.

| Memory type | Examples | Used for |
|---|---|---|
| Per-client (durable) | name, address, property type, language, past services, package, known access/parking notes, prior escalations, sensitivities | recognizing returning clients, skipping re-asks, personalization, reactivation |
| Per-thread (conversational) | what's already been requested, what's still missing, last agent action | preventing repeat questions, idempotent follow-ups |
| Operational learnings | which photo patterns mean "cleanup needed", which zones run long | improving qualification + duration estimates over time |

Returning client → agent `recall()`s history and greets with continuity instead of cold intake.

---

## 11. Human-in-the-loop dashboard (Next.js)

The human's entire surface. Built on Vercel, reads/writes Airtable.

**Views:**
- **Review Inbox** — escalation queue; each item shows the full brief (client, channel transcript, photos, AI recommendation, why it escalated) + **Approve / Edit / Reject** actions. Approving a price or booking lets the agent resume autonomously.
- **Pipeline board** — leads by stage (§6), live.
- **KPI tiles** — new leads today · waiting on info · qualified A-leads · ready to schedule · scheduled · needs review · high-risk · autonomy rate · median first-response time.
- **Shadow-mode panel** (rollout phase) — agent's proposed action vs. human's actual, side by side, to grow eval data.

**Approval actions write back as agent-resumable events** — the human never has to leave the dashboard or touch Airtable raw.

---

## 12. Escalation & guardrails

### 12.1 Hard rules (enforced as `PreToolUse` hooks — code-level, not prompt-level)
Each rule is a deterministic hook that inspects the pending tool call and returns `deny` before it runs, so no prompt trick can bypass it:
- No scheduling without a confirmed **address**.
- No **specific/final price** sent autonomously — range-only, with on-site-review caveat.
- No promising extras are "included."
- No guarantees (plant survival, exact duration, availability) without confirmation.
- Idempotent actions only (no double-book, no double-send).

### 12.2 Escalation flags (any one → `raise_escalation` → human queue)
HOA · property manager · commercial property · upset/aggressive client · complaint · refund/discount request · legal or warranty mention · damage report · out-of-area address · extreme urgency · large install / hardscape / drainage / retaining wall / major tree work / complex irrigation · multiple decision-makers · VIP / high-value · unclear or contradictory scope · low vision-confidence on photos · pricing outside rubric coverage.

Mechanically, a flag makes `canUseTool` return `deny` for the client-facing/booking tool and fire `raise_escalation` instead. The agent writes a complete brief on escalation so the human has zero re-investigation cost.

---

## 13. Vision / photo analysis (Claude native)

Claude is multimodal — it reads the client's yard photos directly inside the agent loop, so V1 needs **no separate vision service** (Nebius is only worth adding later for cheap bulk/at-scale inference). `analyze_yard_photos` returns a structured assessment:
```
{ condition_score: 0–10, overgrowth: low|med|high, weeds: low|med|high,
  leaf_litter: low|med|high, green_waste_volume: est,
  cleanup_required: bool, detected_extras: [irrigation?|mulch?|tree?|drainage?],
  yard_size_estimate: small|medium|large, confidence: 0–1 }
```
Drives the **"initial cleanup required before recurring"** rule and feeds the pricing engine's size bucket. **Low confidence → escalate or ask for clearer photos**, never guess.

---

## 14. Eval-driven development & shadow mode

We ship accuracy we can prove.

- **Golden set:** the 10 simulation scenarios from the MVP doc (biweekly homeowner, price-shopper, neglected yard needs cleanup, property-manager multifamily, one-time pre-event cleanup, dying-plants/irrigation, out-of-area, existing-client extra request, upset-after-visit, good-lead-goes-quiet) encoded as automated test conversations.
- **Eval metrics:** qualification accuracy (A/B/C vs. human label), correct cleanup detection, correct escalation (precision + recall), scope-protection (did it wrongly include an extra?), tone compliance (never-say list), no-address-no-schedule enforcement.
- **Promotion gate:** a case-type only graduates from shadow → autonomous once it clears the eval bar on the golden set + accumulated live shadow data.
- **Regression:** every production miss becomes a new eval case before the fix ships.

---

## 15. Build plan (hours-to-demo, then production)

**Phase 0 — Live hackathon demo (functional end-to-end):** a real, working thin slice on the load-bearing stack — **Claude Agent SDK** `query()` loop driving: **Telegram** inbound (text + a yard photo) → Claude intake reply → qualify A/B/C → **Claude-vision** photo analysis → autonomous **range quote** off the researched rate card → offer 2 slots from the internal slot table → **book** + create work order → **Airtable** updates live → **Next.js dashboard** shows the lead move across stages. The Agent SDK's `canUseTool` gate + `PreToolUse` hard-rule hooks are wired from the first commit, with **one escalation path** (e.g. an HOA/complaint message) `deny`-ed and routed to the review inbox for human approve/reject. Tools registered as a single MCP server (`allowedTools` scoped to business tools only). Demo beats (if time): mem0 returning-client recall; Tavily live rate-card rebuild. WhatsApp/email shown via mock thread to prove the adapter swap.

**Phase 1 — Shadow (week 1):** add real channels (Composio Gmail; WhatsApp once it clears); agent drafts everything, human sends from dashboard; collect eval data; confirm the rate card with the owner via the pricing-research workflow.

**Phase 2 — Supervised:** auto-send intake + info requests; human approves bookings + ranges.

**Phase 3 — Autonomous (target):** standard residential cases run end-to-end; human only works the escalation queue. Then phase the next pipeline stages (routing, post-service reports, billing, design/build intake).

---

## 16. Data model (Airtable — `Leads` table, core fields)

`name · phone · email · address · zone · property_type · language · source(form|email|whatsapp) · service_requested · desired_frequency · photos[] · vision_assessment(json) · condition_score · cleanup_required(bool) · detected_extras[] · lead_score(A|B|C) · risk_level · ai_recommendation · suggested_package · price_range · status(§6) · escalation_reason · followup_next_at · visit_at · assigned_to · drive_folder_url · calendar_event_url · work_order(json) · memory_ref · internal_notes · created_at · first_response_at`

Companion tables: `pricing_rules` (engine source), `work_orders`, `escalations`, `events` (audit log).

---

## 17. KPIs & instrumentation (built in, not bolted on)
Every agent decision logs `{lead_id, action, inputs, tool_calls, latency, autonomous?, escalated?, eval_label?}`. Dashboard reads this for the §2.3 metrics. The audit log is also the regression-eval feedstock.

---

## 18. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Bad autonomous price → margin loss | Range-only + rubric guardrails + escalate-outside-coverage + human-approved rate card |
| Wrong cleanup call from blurry photos | Confidence threshold → ask for better photos or escalate |
| Over-escalation kills the autonomy value | Tune flags on shadow data; track escalation precision |
| WhatsApp API approval / Baileys ban-risk on a live stage | Channel-agnostic adapter; **Telegram is the live channel**, WhatsApp is a config-swap added post-event once Cloud API clears |
| Double-booking / double-texting on retries | Idempotency keys on every outbound action |
| Tone/brand slip | Master Prompt compiled in + never-say enforced + tone eval in golden set |
| Returning client treated as cold lead | mem0 `recall()` on every thread |

---

## 19. Open questions (to confirm with Go Green)
1. Crew calendar: who/how many evaluation slots/day are bookable, and standard evaluation duration?
2. WhatsApp Business: existing verified number, or do we provision one?
3. Website "Request Service" form: can it post to our webhook (or do we poll the inbox)?
4. Office/owner: who staffs the dashboard review queue, and in which language?
5. Confirm the SF service-area zone list (zips) for `geo_qualify`.
6. Sign-off on the research-finalized rate card before autonomous quoting is enabled.

---

*Guiding principle (Go Green's own): "No lead goes unanswered. No appointment gets scheduled without qualification. No crew visits a property without a clear work order."*
