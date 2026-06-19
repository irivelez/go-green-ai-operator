# Handoff — Go Green V1 autonomous ad→pay→book pipeline

**Date:** 2026-06-18 · **Branch:** `feat/v2-autonomous-pipeline` (22 commits ahead of `main`, NOT pushed) · **Authority:** [`spec.md` §A](./spec.md)

---

## 1. Where we are (one paragraph)

The full spec §A pipeline is **built, reviewed, and green** but **not pushed and not yet runnable end-to-end** because the Google geo keys aren't set. A 5-agent `review-work` audit caught two real blockers (a price/charge mismatch and a security cluster) — both fixed, re-reviewed, and now PASS. The next session's job: **swap the geo/slope layer for the better tools/APIs Irina is providing**, wire the real keys, test end-to-end, then open the PR (gated on Irina's go-ahead).

## 2. State of the work

- **Branch:** `feat/v2-autonomous-pipeline`, 22 commits, 49 files (+4411/−434).
- **Gates (all green):** `npm run typecheck` exit 0 · `npm run build` exit 0 · 16 test suites / 351 assertions / 0 failures · `npm run eval` 77/0 with `ANTHROPIC_API_KEY`, clean SKIP without.
- **Review:** all 5 `review-work` lanes PASS (Goal, QA, Code Quality, Security, Context Mining) after fixes.
- **Working tree:** clean except 2 untracked files `src/composio.connect.ts` + `src/composio.probe.ts` — these are pre-existing Gmail-OAuth temp probes from another session, **NOT part of this work, leave untouched**.
- **NOT done (deliberately):** `git push` + PR — irreversible/shared, gated on Irina's explicit go-ahead.

### Commit list (newest first)
```
0ae3784 fix(security): filter LLM photoUrls + clear stale price on area re-draw (review follow-ups)
a23726a fix(security): unguessable lead ids, bounded HITL input, data-URI photos, clamped confirm-area, gated calendar PII (blocker B)
405920c fix(pricing): Stripe charges the measured area×slope price, not the flat tier price (blocker A)
4820d76 eval: realign stale scenarios to measure-flow + deterministic invariants (T15 follow-up)
3315112 eval: 5 measure-flow scenarios + import live agentSystemPrompt (drift fix) (T15)
d40e983 fix(agent-tools): runConfirmArea must not double-raise slope on re-confirm
34a49ec ui: GenerativeChat dispatches address/area/confirm/price cards end-to-end (T14)
998cf4a ui: AddressConfirm + SlopePhotoPrompt + ExactPrice cards (T12)
7086abd route: accept intent ad-param + measure-before-price step order (T13)
98041fa test: normalize area-card-logic summary line
c5b88f9 ui: AreaConfirmCard satellite map + Drawing/Geometry polygon confirm (T11)
7ce084a agent-tools: validate_address/measure_property/confirm_area/compute_exact_price + calendar wire (T10)
8a27136 hitl: structured reason_code + corrected_value capture via events log (T8)
ce1f2a5 geo: free-first address-validate + Solar/heuristic measure + Elevation slope + computePolygonSqft (T7)
21b8c2a calendar: Composio GOOGLECALENDAR_CREATE_EVENT crew handoff (T9)
7fecb1f vision: replace yard_size_estimate with slope_signals (T4)
f555072 pricing: area buckets × slope multiplier; deprecate YardSize keys (T5)
24af8e3 store: add events log + extended Lead measurement fields (T1)
a67e186 feat(intent): decode UTM/ad params to service intent (T6)
0af8649 stripe: gate live keys behind STRIPE_LIVE_OK=1
858fa0b feat(env): declare Google + Calendar + Stripe-live + heuristic keys (T2)
41fcd81 docs(landscape): spec v2 — free-first autonomous ad→pay→book pipeline
```

## 3. Architecture (what to know before changing anything)

**The pipeline:** Meta-ad lead (intent in URL param) → validate address → free-first auto-measure (Solar roof bbox + lot-coverage heuristic → estimated sqft) → customer confirms/redraws polygon on a satellite map (their polygon is authoritative + is the price consent) → coarse slope tier → exact per-visit price = `f(area_bucket, frequency, slope_tier)` → live-Stripe pay-first → pick slot → confirm_booking → Google Calendar crew handoff → owner HITL events loop.

**Hard invariants (enforced in code, do not break):**
- The LLM **never** charges Stripe (`propose_checkout` only stages a URL; `confirm_booking` refuses until paid).
- Customer-confirmed polygon area is re-derived **server-side** (`computePolygonSqft`) — the client number is display-only.
- The Stripe charge **equals** the quote (measured area×slope price), not the flat tier price — fixed in `405920c`.
- Idempotent actions `(lead_id, action_hash)`.
- Live Stripe gated behind `STRIPE_LIVE_OK=1`; calendar PII gated behind `CREW_CALENDAR_ENABLED=1` (both OFF by default).
- Slope photo cross-check can only **raise** the tier, never lower, and never double-raise on re-confirm.

## 4. THE GEO/SLOPE LAYER — the next session's main job

> **UPDATE (2026-06-19): THIS IS NOW DONE.** The geo/slope swap below was completed + committed — spec co-design `669e495`, code rewire `a120089`, live-test bugfix `7ba57ed`. `src/geo.ts` now has `measureFromAddress` (DataSF parcel `acdm-wktn` − footprint via EAS `ramy-di5m`, condo detect via `mapblklot≠blklot`), `runMeasureProperty` is DataSF-first + escalates stacked condos, and the UI pre-draws the real parcel ring. Verified live against real SF addresses. The remaining work is **wire the real API keys + run the live `/agent` walkthrough**, not the swap. The table below is historical context for how it was built.

**All geo/slope logic lives in [`src/geo.ts`](./src/geo.ts)** (the single module to swap). It exports 5 functions, all consumed ONLY by `src/agent-tools.ts` (lines 26-30, 348, 393-404, 458):

| Function | Current implementation (free-first) | Returns |
|---|---|---|
| `validateAddress(input)` | Google Address Validation API | `{ok, verdict: VALIDATED\|CORRECTED\|UNVALIDATABLE, standardized:{address,lat,lng,accuracy}, didYouMean?}` |
| `autoMeasureRoofBbox(lat,lng)` | Google Solar `buildingInsights:findClosest` (roof bbox) | `{ok, roof_bbox:{sw,ne}, roof_area_m2}` |
| `estimateLotSqft(roof_area_m2)` | pure: `roof/LOT_COVERAGE_RATIO − roof`, ×10.7639 | `{estimated_sqft, area_confidence}` |
| `slopeGradeTier(lat,lng)` | **Google Elevation API, 3×3 grid → max adjacent grade%** | `{ok, slope_tier: flat\|moderate\|steep, max_grade_pct, sampled}` |
| `computePolygonSqft(path)` | pure spherical-excess (server authority) | `number` (sqft) |

**Current slope thresholds** ([`geo.ts:243`](./src/geo.ts)): `<5% flat`, `5–12% moderate`, `>12% steep`. Grid offset `SLOPE_OFFSET_DEG = 0.000225` (~25m). **This is the coarse Elevation-API approach Irina wants to improve.**

**Key contract for the swap (CRITICAL):** Each function is **key-guarded** — missing key returns `{ok:false, reason:"no_key"}` and **NEVER throws** (so tests + the zero-key dev path stay green). Any replacement MUST preserve:
1. The exact **return shapes** above (so `agent-tools.ts` doesn't change), OR update both together.
2. The **never-throw / key-guarded** contract.
3. The test files: `src/geo.test.ts` (21 cases, mock `fetch`).

**Env keys the geo layer reads** ([`src/env.ts`](./src/env.ts)): `GOOGLE_MAPS_API_KEY` (server), `LOT_COVERAGE_RATIO` (default 0.45), `AREA_CONFIDENCE_THRESHOLD` (default 0.6). Client map uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` ([`AreaConfirmCard.tsx`](./app/agent/components/AreaConfirmCard.tsx)).

## 5. The mode for this session: CO-DESIGN the spec by interviewing Irina

This session is **collaborative spec-building, not insight-ingestion.** Irina wants the agent to **ask her** about expected behavior, features, and the UX/UI experience she's creating — and to build the §A.2/§A.3 (geo + slope) specification *together* from her answers, before writing any code.

**Two distinct inputs Irina brings (treat them differently):**
1. **Research she already did** on the right tools/APIs for the geolocalization + slope features, available in **`/Users/irina/AI-driven-OS/autonomous/landscape/research/`** (markdown files). This is *evidence to engage with critically*, NOT a directive to implement blindly. Read that folder, then **evaluate it against the current free-first stack** (Google Address Validation + Solar roof bbox + Elevation 3×3 grid + lot-coverage heuristic), surface tradeoffs (cost/lead, accuracy, latency, coverage, the SF-terraced-backyard slope failure), and decide **swap vs augment vs keep** *together with her* — challenge it where her research and the current approach conflict, don't just accept it.
2. **The actual API keys** for whichever tools win.

The entry point is the **interview**, not a paste of her research. Use the `Question`/ask tool (the same one that produced the original §A interview — see git history of `spec.md`). Ask hard, specific questions about UX behavior, the research tradeoffs, and edge cases; don't ask obvious ones. Keep interviewing until the geo/slope behavior + UX + chosen tooling are fully pinned, THEN update `spec.md`, THEN build. See §8 for the exact workflow.

## 6. How to test (once keys are in)

```bash
cd /Users/irina/AI-driven-OS/autonomous/landscape
npm run dev   # → http://localhost:3000/agent (funnel) + http://localhost:3000 (dashboard)
```
- **Works with zero new keys:** dashboard (pipeline/review-inbox/HITL), agent chat up to the address step. `ANTHROPIC_API_KEY` + `STRIPE_SECRET_KEY` + `COMPOSIO_API_KEY` are already set in `.env.local`.
- **Needs the Google keys** (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` + `GOOGLE_MAPS_API_KEY`): satellite map render + address-validate + auto-measure + slope. Without them the funnel degrades to a static fallback (no crash).
- **Do NOT run a real Stripe payment** until the rate card is signed off (`STRIPE_LIVE_OK` stays unset). Test mode is fine.

## 7. Carried-forward items (documented, not blockers for the market test)

From the review (all in [`spec.md §A.10`](./spec.md) + AGENTS.md known-gaps):
- **Full `/api/leads/*` owner-session authz** — the documented tenant-isolation KNOWN GAP. Mitigated for now (unguessable UUIDs, live-Stripe + calendar-PII gated OFF, bounded inputs). **Must close before flipping `STRIPE_LIVE_OK=1` or `CREW_CALENDAR_ENABLED=1` in prod.**
- **Reprice-visit-2 hook (§A.5)** — the on-site re-measure → reprice margin-safety net is doc-only, no code scaffolding yet.
- **Google Places Autocomplete typeahead (§A.2 row 1)** — not implemented; address goes straight to validation.
- **Rate card v2 sign-off (§A.10)** — area-bucket prices (105/173/330) + slope multipliers (1.0/1.15/1.35) + `LOT_COVERAGE_RATIO`/`AREA_CONFIDENCE_THRESHOLD` need owner sign-off before live charging.
- **Stale `README.md`** — still describes the V1 Telegram product; needs a V2 rewrite.
- **Meta pixel/CAPI conversion tracking on the pay event (§A.10)** — not wired.

## 8. How to update spec.md (INTERVIEW FIRST, THEN edit, THEN code)

The spec is the **contract**: tests + commits reference it (`Refs: spec.md §A.x`), and review agents check code *against* it. For THIS session the spec is co-designed with Irina — so the order is: **interview → write spec → classify impact → code.**

**Step 0 — INTERVIEW Irina to co-design the behavior + UX (use the `Question`/ask tool, no code yet):**
- The goal is to pin down §A.2 (geo-measurement) + §A.3 (slope) AND the customer-facing UX/UI of the measure→confirm→price flow, *from her answers* — not to assume.
- Ask hard, specific questions; skip obvious ones. Cover at minimum:
  - **Measurement UX:** what does the customer SEE and DO at the address→map→confirm step? Pin-drop, draw-polygon, or just confirm an auto-outline? How much effort is acceptable? What does "good enough" area accuracy feel like to her?
  - **Slope UX + data:** how is slope surfaced to the customer (if at all)? Which terrain/slope source does she want (vs the current coarse 3×3 Elevation grid)? How many tiers, and what does each mean to pricing?
  - **Failure/edge UX:** what happens when auto-measure is low-confidence, the address is ambiguous, the lot is a condo/multi-unit, or the customer draws something implausible? What does the screen say?
  - **Trust + consent:** the confirmed polygon is the price consent — how should that moment feel? What reassurance does the customer need before they see a price / pay?
  - **Scope:** which of these are V1-must-have vs later? (Map her answers to §A.8 def-of-done vs §A.10 open items.)
  - **Research review:** Irina's research lives in **`/Users/irina/AI-driven-OS/autonomous/landscape/research/`** (markdown files) — read it first, then walk through the findings WITH her: what each tool gives (accuracy, cost/lead, latency, coverage), how it compares to the current free-first stack (§4), and where it solves the known failures (coarse slope grid mis-reads terraced SF lots; lot-coverage heuristic is a guess). Push back where her research and the current approach genuinely conflict — your job is to co-decide swap/augment/keep, not to rubber-stamp.
- Ask in small batches, reflect her answers back, keep going until the geo/slope behavior + UX + chosen tooling are unambiguous. THEN write the spec.
- Inputs she brings: (1) her RESEARCH findings on slope/geo tooling in `research/` — evidence to evaluate together, not implement blindly; (2) the actual API keys for whatever tools win. Distinguish the two: reconcile the research into the §A.2/§A.3 spec decisions first; the keys only matter once the tooling is chosen.

**Step 1 — once the interview settles, classify each agreed decision before editing:**

| Type | Test | How to update |
|---|---|---|
| **Refines an OPEN decision** (listed in §A.10 sign-off, or never implemented) | "Was code+tests built against this?" → NO | Edit §A.2/§A.3 in place; remove/resolve the matching §A.10 item. Free to change — still a proposal. |
| **Changes a LOCKED decision** (already built, tested, committed) | → YES | Add a dated **`Supersedes`** note (don't silently overwrite). The spec edit MUST land in the **same commit** as the code+test change, or you create drift. |
| **Net-new** | n/a | New subsection (§A.11) or a new row in the §A.2 table. |

**Step 2 — the locked-vs-open rule is the whole game.** Before editing a line, check whether `geo.ts`/`pricing.ts`/tests already implement it. Open → edit freely. Locked → spec + code + tests move together or not at all. (We hit this once: the T13 prompt change silently invalidated 5 eval scenarios — see commit `4820d76`.)

**Step 3 — agentic-specific trap: THREE sync points, not two.** This system's runtime agent reads the flow indirectly via `src/funnel-agent-prompt.ts`. A spec change to the **funnel flow / tool order / what the agent asks the customer** must sync ALL THREE: (1) `spec.md`, (2) code + `*.test.ts`, (3) `src/funnel-agent-prompt.ts` + `src/agent-evals.ts`. Pure geo/slope *measurement* changes usually touch only (1)+(2); flow changes touch all three.

**Step 4 — carry the WHY, write declarative truth.** The spec states current truth + reasoning, never a changelog ("changed X to Y" = the AI-memo anti-pattern the hooks reject). Reasoning matters more here because the next session is a fresh agent with zero memory — "use 1m LiDAR DEM" is useless without "...because the 3×3 Elevation grid false-reads terraced SF backyards as flat (§A.3 known failure)."

**Step 5 — mechanics:** follow the existing v1→v2 supersede pattern (top-of-file "READ THIS FIRST" banner + `Supersedes:`/`Carries over:` lines). Bump the `Version:`/`Status:` header. One commit per logical spec change, message `spec: <change> (§A.x)`.

## 9. The PR (final step, gated)

When Irina says go: `git push -u origin feat/v2-autonomous-pipeline` + `gh pr create` to `main`. Remote: `github.com/irivelez/go-green-ai-operator`. `gh` is authed as `irivelez`. **Never push to main directly; PR only.** Write a PR body covering the commits, the 2 blockers caught+fixed, and the carried-forward items.

## 10. Useful references

- Authoritative spec: [`spec.md`](./spec.md) §A (read §A.2 geo-measurement, §A.3 slope, §A.4 pricing, §A.5 money/handoff, §A.8 def-of-done, §A.10 open items).
- Project memory + Engineering Constitution: [`AGENTS.md`](./AGENTS.md).
- Prior build decisions: [`BUILD-DECISIONS.md`](./BUILD-DECISIONS.md).
- Full working notepad (every finding, all session history): `/tmp/ulw-current-note-path.txt` → points to the ultrawork notepad.
