# app/ — Next.js App Router surface (global rules in ../CLAUDE.md)

A thin deterministic surface over `src/`. The chat is LLM-driven, but numbers and money stay isolated server-side.

- **Generative-UI dispatch.** Each tool result renders a card via `renderTool` in `agent/components/GenerativeChat.tsx`.
  Adding a funnel step = a `run*` handler/tool in `src/agent-tools.ts` + a card in `agent/components/cards.tsx` + a
  matching `case` in the `renderTool` switch. **Worked example: `../docs/runbooks/add-a-funnel-step.md`.**
- **The model never sees the polygon or the charge.** The drawn area is POSTed to `api/funnel/confirm-area` (server
  re-derives sqft via `computePolygonSqft`); the Stripe URL is built server-side by `propose_checkout`. On-screen sqft is
  display-only — never price off a client number.
- **Route conventions** (`api/funnel/agent/route.ts`): a 503 no-key prod guard (no silent keyword fallback) + a `maxSteps`
  turn cap; Zod-validate request bodies; set `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- **Known security gap — don't blindly patch.** No auth on `api/leads/*` and no `middleware.ts` (tenant isolation); only
  the unguessable `web-<uuid>` lead id protects records. See `../notes/registries.md` (E) / root §Boundaries before touching.
