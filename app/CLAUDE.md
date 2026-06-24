# app/ — Next.js App Router surface (global rules in ../CLAUDE.md)

A thin deterministic surface over `src/`. Live surfaces are `/agent` (generative-UI chat) and `/` (ops dashboard).
The chat is LLM-driven, but numbers and money stay isolated server-side.

- **Generative-UI dispatch.** Each tool result renders a card via `renderTool` in `agent/components/GenerativeChat.tsx`,
  which narrows `tp.result` through the `ToolResultMap` + `toolResult(tp, key)` seam (one key-checked cast point).
  Adding a funnel step = a `run*` handler/tool in `src/agent-tools/<stage>.ts` (re-exported by the barrel) + a card in
  `agent/components/cards.tsx` + a matching `case` in the `renderTool` switch. **Worked example: `../docs/runbooks/add-a-funnel-step.md`.**
- **The model never sees the polygon or the charge.** The drawn area is POSTed to `api/funnel/confirm-area` (server
  re-derives sqft via `runConfirmArea` → `computePolygonSqft`); the Stripe URL is built server-side by `propose_checkout`.
  On-screen sqft is display-only — never price off a client number. Live funnel routes: `api/funnel/{agent,confirm-area}`.
- **Route conventions.** `api/funnel/agent/route.ts`: a 503 no-key prod guard on `ANTHROPIC_API_KEY` (no silent keyword
  fallback) + a `maxSteps` turn cap; set `runtime = "nodejs"` and `dynamic = "force-dynamic"`. Owner/dashboard routes
  (`api/operator`, `api/leads/[id]/{approve,reject,override}`) build their body via `api/_helpers.ts` — `withBody` /
  `ownerActionRoute` keep each route byte-identical (per-route `emptyBody`, `invalid`, `coalesceNull` are parameters).
- **Known security gap — don't blindly patch.** No auth on `api/leads/*` and no `middleware.ts` (tenant isolation); only
  the unguessable `web-<uuid>` lead id protects records. See `../notes/registries.md` (E) / root §Boundaries before touching.
