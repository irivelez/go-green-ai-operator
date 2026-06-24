# Runbook — Add a funnel step

A *funnel step* = one LLM-callable tool whose result renders as an interactive card in the `/agent` chat. This is the
repo's main extension point. The skeletons below are real (traced from `recommend_tier`); copy their shapes.

> **Two truths to hold the whole time:** (1) the deterministic engine **re-derives every number** — a tool reads
> `args` for *intent*, never for a price/sqft; (2) tools auto-expose to the model, but ***when* to call one lives in the
> prompt** (`funnel-agent-prompt.ts`), which the evals lock — see the sync trap below.

## The 6 edit sites

| # | Site | File · symbol | What |
|---|---|---|---|
| 1 | handler + Result type | `src/agent-tools.ts` · `run*` | `async (ctx, args) => Promise<Result>`; read `getLead`, write `upsertLead`, derive from the contract |
| 2 | tool registration | `src/agent-tools.ts` · `buildTools` | `name: tool({ description, parameters, execute })` |
| 3 | **flow order ⚠️** | `src/funnel-agent-prompt.ts` · `agentSystemPrompt` | the numbered step list — *when* the model calls your tool |
| 4 | card | `app/agent/components/cards.tsx` · `XCard` | reads the tool **result**; buttons call back, don't call the next tool |
| 5 | dispatch + copy | `app/agent/components/GenerativeChat.tsx` · `renderTool` | a `case`, a `runningLabel`, and `COPY` en/es |
| 6 | tests | `src/agent-tools.test.ts` (+ `src/agent-evals.ts`) | unit asserts output **and** lead state; eval asserts the tool fires |

## Worked skeletons

**1 — handler + Result type** (`src/agent-tools.ts`, modeled on `runRecommendTier`):
```ts
export interface MyStepResult { status: "ok"; /* display fields, derived server-side */ }

export async function runMyStep(ctx: ToolContext, args: { reason: string }): Promise<MyStepResult> {
  const existing = await getLead(ctx.leadId);          // read state
  // ... derive the decision from PRICE_BOOK / pricePerVisit / geo — NEVER from args numbers
  await upsertLead({ lead_id: ctx.leadId, channel: existing?.channel ?? "form", /* persist */ });
  return { status: "ok" };
}
```

**2 — register in `buildTools(ctx)`** (the Zod `parameters` must match `args` exactly):
```ts
my_step: tool({
  description: "What this does + WHEN to call it (the model reads this).",
  parameters: z.object({ reason: z.string().describe("one warm sentence") }),
  execute: async (args) => runMyStep(ctx, args),   // ctx captured from the buildTools closure
}),
```
Every key in the object returned by `buildTools` becomes a callable tool — it is passed wholesale to
`streamText({ tools: buildTools(ctx), maxSteps: 8 })` in `app/api/funnel/agent/route.ts`. **No registration step is
needed beyond adding the key** — but the model only knows *when* to call it from the prompt (site 3).

**4 — card** (`cards.tsx`, modeled on `TierOptionsCard`; note: cards read the **result**, props are `{ lang, r }`, some
cards name it `result`):
```tsx
export function MyStepCard({ lang, r, onPick }: { lang: Lang; r: MyStepResult; onPick?: (x: string) => void }) {
  const t = L[lang];
  return <Shell>{/* render r; a button calls onPick(...) */}</Shell>;
}
```

**5 — dispatch** in `renderTool` (`GenerativeChat.tsx`) — buttons re-enter intent as natural language via `send`, so the
single agent loop stays authoritative (it does **not** call the next tool directly):
```tsx
case "my_step":
  return <MyStepCard key={key} lang={language} r={res as MyStepResult}
           onPick={(x) => send(c.myStepIntent(x))} />;
```
Also add `runningLabel` (the spinner text) and `myStepIntent` / labels to both `en` and `es` in `COPY`. (`send(text)`
calls `append({ role: "user", content: text }, …)`.)

**6 — unit test** (`agent-tools.test.ts`, modeled on the `recommend_tier` block) — assert output **and** the lead write,
no keys, `resetStore` first:
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
   numbered list at the right position, and add/adjust a scenario whose `expectInclude`/`expectExclude` names your tool.

A pure measurement/utility tool the model calls opportunistically usually touches only sites 1–2 + 4–6; a tool that
changes *what the agent asks the customer and when* touches all three. `npm run eval` is the drift alarm.

## Invariants you must not break
- **Numbers are server-derived:** price from `PRICE_BOOK` / `priceCart` / `pricePerVisit`; area from
  `computePolygonSqft(args.path)` (the client number is display-only). Tool params take coords/ids/text, never a price or sqft.
- **The LLM never charges:** `propose_checkout` only stages a Stripe URL; `confirm_booking` refuses until paid.
- **Idempotent + escalate:** keep actions idempotent `(lead_id, action_hash)`; route non-standard cases to `raise_escalation`.
- **Frozen names:** tool names + their Zod keys, `Lead` fields, `LeadStatus` values are serialized — see `../../notes/registries.md` (A).

## Verify
```bash
npx tsx src/agent-tools.test.ts        # unit — no keys; must pass
npm run typecheck                       # tsc 0 errors
# with ANTHROPIC_API_KEY: npm run eval  # end-to-end; catches flow drift
```

> Docs lag code. If a skeleton here disagrees with the current source, **the source wins** — verify against the file.
