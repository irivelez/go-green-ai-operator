# Go Green Web Funnel — Locked Build Decisions (2-hour ship)

**Every session reads this first. It supersedes ambiguity in spec.md for this build.**
Scope pivot: from Telegram chat (prior scaffold) → **web funnel + Stripe checkout**.
Reuse the prior pure logic ([escalation.ts](./src/escalation.ts), [store.ts](./src/store.ts),
[qualify.ts](./src/qualify.ts) geo, [prompt.ts](./src/prompt.ts) voice). Rewrite pricing for flat tiers.

---

## 0. The product (one line)
A bilingual web funnel where a standard-residential customer describes their yard, uploads
photos, gets an AI-recommended tier + add-ons, and **pays now (Stripe) then books a slot** —
fully autonomous for clean cases, escalated to a human for everything flagged.

## 1. Locked decisions (the coding agent's Round-1 forks — all DEFAULTS, do NOT re-ask)

| # | Decision | Locked value |
|---|---|---|
| A1 | Pricing model | **Flat-final** per-visit for standard residential. Accept variability risk inside the gates. |
| A2 | In-tier modifiers | **None at launch.** Flat $199 / $299 / $399. No invented surcharges. Revisit after 10–15 real leads. |
| A3 | Charge shape | **Monthly Stripe subscription**, first month charged now to lock the booking. `monthly = per_visit × freq_multiplier` (weekly 4.33, biweekly 2.17, monthly 1.0). |
| B1 | Add-ons | **Fixed-price add-ons → autonomous checkout. Open-ended add-ons → human quote, no auto-charge** (capture lead). Classification rule in §3. |
| B2 | Cleanup gating | Vision high-confidence "neglected" → **require** one-time cleanup add-on in cart before recurring. Uncertain → **recommend**. |
| C1 | Tier selection | **AI recommends, customer confirms** the tier. AI owns cleanup + add-on detection + tier sanity-check. |
| C2 | Photos | **Required for autonomous checkout.** No usable photos → capture contact, route to human, no charge. |
| D1 | Scheduling | **Pay first → then pick a real slot.** 4 slots/day, Thursday onward. The slot is a paid first service. |
| D2 | Capacity / can't-serve | If no slot within **N = 14 days** → **waitlist, do NOT charge.** |
| E1 | UX | **Hybrid**: guided multi-step flow (need → space+photos → recommended tier+add-ons → quote → pay → schedule) **with a conversational assistant alongside** for questions. Not a bare chatbox. |
| E2 | Identity capture | Capture name/email/phone/**address** at the pricing step (mid-flow). Address mandatory. |
| F1 | Autonomy line | **Autonomous checkout ONLY for clean standard-residential A-cases** inside the 3 tiers + whitelisted add-ons. Anything flagged → no auto-charge → human. |
| F2 | Mismatch guarantee | **First-visit satisfaction guarantee**: if property doesn't match, re-quote or refund the first charge before continuing. Recurring locks only after a successful first visit. |
| G1 | Brand prompt | **Rebuild the prompt for the web-funnel context** — productized, transparent, premium, no-pressure. |
| G2 | Language | **Full EN/ES**, mirror the customer. |

## 2. Flat price book (from the Price Book doc — "starting at", productized to flat for launch)
- **Essential Care** — $199 / visit
- **Signature Care** — $299 / visit
- **Estate Care** — $399 / visit
Tiers differ by **level of care**, not yard size (Estate = priority scheduling, quarterly
inspections, white-glove, reports). Subscription = tier × freq multiplier; first month now.

## 3. Add-on classification rule (do NOT invent prices)
Extract the full add-on catalog from `GO GREEN LANDSCAPE — MASTER PROMPT FOR CLIENT
COMMUNICATION.docx` + the Price Book. Classify each:
- **Fixed single price** (e.g. fertilization $95, one-time cleanup $350, leaf removal $199,
  pressure washing $250) → **whitelisted for autonomous checkout.**
- **Per-unit / per-hour / "+ parts" / "+ plant cost"** (e.g. sod $12/sq ft, hand weeding
  $95/hr, plant replacement $150 + plant, irrigation repair $150 + parts) → **open-ended →
  human quote, NO auto-charge.**
If a price is not in the documents, it does not exist. Never invent a number.

## 4. Two-layer architecture (the core principle — reliability vs intelligence)
**Deterministic GATES (code-level, cannot be prompt-jailbroken):**
- No address → no scheduling.
- Flat tier only — no modifier math invented at runtime.
- Photos required for autonomous checkout.
- Escalation flag (HOA · property manager · commercial · complaint · refund · legal/warranty ·
  damage · hardscape/large install · out-of-area · extreme urgency · open-ended add-on ·
  low vision confidence · contradictory scope) → human queue, **no charge.**
- No slot within N=14 days → waitlist, **no charge.**
- Idempotency on charge + book — never double-charge, never double-book.
- Cleanup add-on forced into cart when vision high-confidence neglected.

**Reasoning SURFACE (agent intelligence — Claude):**
- Conversation, EN/ES mirroring, premium no-pressure voice (Master Prompt).
- Detect what's missing; ask only for that; **one ask at a time; know when to stop**
  (stop = has tier + address + photos + frequency + identity → ready to price+pay).
- Recommend tier; sanity-check chosen tier vs photos; suggest add-ons; detect cleanup.
- Route edge cases to the escalation gate with a complete brief.

## 5. Stack (load-bearing)
- **Funnel + dashboard**: Next.js (App Router) on **Vercel** (you're authed as irivelez). Vercel AI SDK for the streaming assistant.
- **Brain + vision**: Claude (Agent SDK or `@anthropic-ai/sdk`) — native photo vision, no separate service.
- **Payments**: **Stripe TEST mode** for the build (no verification needed). Subscription + first-month-now.
- **Record**: reuse [store.ts](./src/store.ts) JSON stand-in for the demo; Airtable post-event.

## 6. Definition of "shippable in 2 hours" (happy path + 1 escalation, end to end)
A real browser flow: land → describe need → upload a yard photo → AI recommends a tier +
detects cleanup/add-ons → confirm → enter identity+address → **Stripe test checkout** →
pick a slot → confirmation + work order written → lead visible moving through stages.
Plus: one flagged case (HOA / out-of-area / neglected-forces-cleanup) correctly **not charged**
and routed to human. EN and ES both demoed on one example each.

## 7. Explicitly stubbed for the 2-hour cut (staged, not faked)
Real Airtable · WhatsApp/email channels · route optimization · the full 60-add-on catalog
beyond the whitelist · production Stripe (test mode only) · mem0 (Airtable fallback).
