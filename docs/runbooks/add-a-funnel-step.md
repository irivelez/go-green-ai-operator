# Runbook — Add a funnel step

A *funnel step* = one LLM-callable tool whose result renders as an interactive card in the `/agent` chat. This is the
repo's main extension point. `src/agent-tools.ts` is a **barrel**: the `run*` handlers, their result interfaces, and their
lifted `*ArgsSchema` Zod consts live in per-stage modules under `src/agent-tools/` (`qualify.ts`, `measure.ts`,
`price.ts`, `checkout.ts`, `schedule.ts`, `escalate.ts`, `photos.ts`, `shared.ts`); the barrel `export *`s them and
`buildTools(ctx)` registers each as a tool. The skeletons below are traced from `recommend_tier` (in
`src/agent-tools/price.ts`); copy their shapes.

> **Two truths to hold the whole time:** (1) the deterministic engine **re-derives every number** — a tool reads
> `args` for *intent*, never for a price/sqft; (2) tools auto-expose to the model, but ***when* to call one lives in the
> prompt** (`funnel-agent-prompt.ts` · `agentSystemPrompt`), which the evals lock — see the sync trap below.

## The 6 edit sites

| # | Site | File · symbol | What |
|---|---|---|---|
| 1 | handler + Result type + ArgsSchema | `src/agent-tools/<stage>.ts` · `run*` / `*ArgsSchema` | the lifted `z.object` schema, `XResult` interface, and `async (ctx, args) => Promise<XResult>`; args typed `z.infer<typeof XArgsSchema>` |
| 2 | barrel registration | `src/agent-tools.ts` · `buildTools` | re-export is automatic (`export * from "./agent-tools/<stage>"`); add a `name: tool({...})` key in `buildTools(ctx)` |
| 3 | **flow order ⚠️** | `src/funnel-agent-prompt.ts` · `agentSystemPrompt` | the numbered step list — *when* the model calls your tool |
| 4 | card | `app/agent/components/cards.tsx` · `XCard` | reads the tool **result**; buttons call back, don't call the next tool |
| 5 | dispatch + copy | `app/agent/components/GenerativeChat.tsx` · `renderTool` | a `case`, a `ToolResultMap` entry, a `runningLabel`, and `COPY` en/es |
| 6 | tests | `src/agent-tools.test.ts` (+ `src/agent-evals.ts`) | unit asserts output **and** lead state; eval asserts the tool fires |

## Worked skeletons

**1 — handler + Result type + ArgsSchema** (a stage module, e.g. `src/agent-tools/price.ts`, modeled on
`runRecommendTier`). The schema is **lifted to a const** so the handler's `args` type is `z.infer` of it — one source of
truth shared between the handler signature and `buildTools`:
```ts
import { z } from "zod";
import { upsertLead, getLead } from "../store";
import { type ToolContext } from "./shared";

export interface MyStepResult { status: "ok"; /* display fields, derived server-side */ }

export const MyStepArgsSchema = z.object({ reason: z.string().describe("one warm sentence") });

export async function runMyStep(
  ctx: ToolContext,
  args: z.infer<typeof MyStepArgsSchema>,
): Promise<MyStepResult> {
  const existing = await getLead(ctx.leadId);              // read state
  // ... derive the decision from PRICE_BOOK / pricePerVisit / confirmed_sqft / slope — NEVER from args numbers
  await upsertLead({ lead_id: ctx.leadId, channel: existing?.channel ?? "form", /* persist */ });
  return { status: "ok" };
}
```
A brand-new stage = a new file under `src/agent-tools/`; reuse an existing module if your tool belongs to that stage.

**2 — barrel: re-export + register** (`src/agent-tools.ts`). The re-export line is **mechanical** — the barrel already
does `export * from "./agent-tools/<stage>"` for every stage module, so adding your symbols to an existing module needs
no barrel edit; a NEW module needs one new `export *` line (and a matching `import` at the top, if `buildTools` calls the
handler). Then add the tool key inside `buildTools(ctx)` (the Zod `parameters` is the lifted schema):
```ts
my_step: tool({
  description: "What this does + WHEN to call it (the model reads this).",
  parameters: MyStepArgsSchema,
  execute: async (args) => runMyStep(ctx, args),   // ctx captured from the buildTools closure
}),
```
Every key in the object returned by `buildTools` becomes a callable tool — it is passed wholesale to
`streamText({ tools: buildTools(ctx), maxSteps: 8 })` in `app/api/funnel/agent/route.ts`. **No registration step is
needed beyond adding the key** — but the model only knows *when* to call it from the prompt (site 3). There are 11 tools
today: `qualify_lead`, `analyze_photos`, `validate_address`, `measure_property`, `confirm_area`, `recommend_tier`,
`compute_exact_price`, `propose_checkout`, `offer_slots`, `confirm_booking`, `raise_escalation`.

**4 — card** (`cards.tsx`, modeled on `TierOptionsCard`; cards read the **result**. Prop shapes vary — most use
`{ lang, r }`, some name it `result` (`ExactPriceCard`, `AddressConfirmCard`); match a neighbor):
```tsx
export function MyStepCard({ lang, r, onPick }: { lang: Lang; r: MyStepResult; onPick?: (x: string) => void }) {
  const t = L[lang];
  return <Shell>{/* render r; a button calls onPick(...) */}</Shell>;
}
```
Money/slot formatting goes through `money(n, { round })` and `fmtSlotTime` (`app/components/format.ts` /
`cards.tsx`) — don't hand-format currency. (Note: there is no `QuoteCard` — it was removed; `ExactPriceCard` is the price
surface.)

**5 — dispatch** in `renderTool` (`GenerativeChat.tsx`). First add your tool to the `ToolResultMap` type so the typed
`toolResult(tp, "my_step")` seam narrows `tp.result` (typed `unknown` off the wire) to `MyStepResult` — use that, **not**
a blind `res as MyStepResult` cast:
```ts
type ToolResultMap = {
  // ...existing entries...
  my_step: MyStepResult;
};
```
```tsx
case "my_step":
  return <MyStepCard key={key} lang={language} r={toolResult(tp, "my_step")}
           onPick={(x) => send(c.myStepIntent(x))} />;
```
Buttons re-enter intent as natural language via `send(text)` (which calls `append({ role: "user", content: text }, …)`),
so the single agent loop stays authoritative — the card does **not** call the next tool directly. Also add a
`runningLabel` case (the spinner text, keyed off `c.*`) and the `myStepIntent` / label keys to **both** `en` and `es` in
`COPY`.

**6 — unit test** (`agent-tools.test.ts`, modeled on the `recommend_tier` block — `S4`) — import `runMyStep` from
`"./agent-tools"` (the barrel re-exports it), `resetStore([])` first, assert output **and** the lead write, no keys:
```ts
{ resetStore([]);
  const r = await runMyStep(ctx("L1"), { reason: "…" });
  ok("status ok", r.status === "ok");
  ok("persisted to lead", (await getLead("L1"))?.someField === expected);
}
```

## ⚠️ The three-sync-points trap

If your step joins the **ordered flow** (most do), a flow change must move together across **three** places or the evals
drift:
1. **`spec.md`** — the contract (§A funnel).
2. **code + `src/agent-tools.test.ts`** — handler, registration, unit test.
3. **`src/funnel-agent-prompt.ts` (`agentSystemPrompt`) + `src/agent-evals.ts` (`SCENARIOS`)** — insert your step in the
   numbered step list at the right position, and add/adjust a scenario whose `expectInclude`/`expectExclude` names your
   tool. `agent-evals.ts` imports `agentSystemPrompt` directly, so a prompt change flows into the evals automatically —
   the scenario set is what you still have to update by hand.

A pure measurement/utility tool the model calls opportunistically usually touches only sites 1–2 + 4–6; a tool that
changes *what the agent asks the customer and when* touches all three. `npm run eval` (needs `ANTHROPIC_API_KEY`; skips
clean without one) is the drift alarm.

## Invariants you must not break
- **Numbers are server-derived:** price from `PRICE_BOOK` / `priceCart` / `pricePerVisit`; area from
  `computePolygonSqft` on the customer's polygon (`runConfirmArea`) — the client number is display-only. Tool params take
  coords/ids/text, never a price or sqft. `compute_exact_price` reads `confirmed_sqft` + `slope_tier` off the lead and
  refuses (`missing_measurement`) if unmeasured.
- **The LLM never charges:** `propose_checkout` only stages a Stripe URL (the `execute` in `buildTools` calls
  `createSubscriptionCheckout`); the handler itself never charges. `confirm_booking` refuses (`payment_required`) until
  the lead is in `PAID_STATES` **AND** carries `lead.paid_at` — the proof-of-charge marker set ONLY by
  `handleStripeEvent` (`src/stripe.ts`). Gating on status alone is a bypass (operator/HITL set "Ready to Schedule"
  without a charge).
- **Idempotent + escalate:** keep actions idempotent; route non-standard cases to `raise_escalation`.
- **Never edit a test to make code pass; never delete a failing test** (Constitution §9).
- **Frozen names:** tool names + their Zod keys, `Lead` fields, `LeadStatus` values are serialized — see
  `../../notes/registries.md` (table A) before renaming.

## Verify
```bash
npm run typecheck && npm run test:all   # tsc 0 errors + all 16 src/*.test.ts suites pass (no keys; fetch mocked)
# with ANTHROPIC_API_KEY: npm run eval  # end-to-end; catches flow drift
```
`test:all` runs every `src/*.test.ts` via `scripts/test-all.mjs` (plain `npm test` only runs core+operator).

> Docs lag code. If a skeleton here disagrees with the current source, **the source wins** — verify against the file.
