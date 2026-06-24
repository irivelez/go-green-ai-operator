# Phase 13 — agent-legibility research (fact-checked, cited)

Goal: ground the Phase-14 onboarding doc in current best practice. Claims tagged **[OFFICIAL]** (Anthropic /
agents.md standard) vs **[COMMUNITY]** (blogs — directional only).

## What makes a good agent-onboarding file

- **[OFFICIAL]** CLAUDE.md is read at the **start of every conversation**; it carries persistent context Claude
  *can't infer from code*. Keep it **short and human-readable**. Litmus per line: *"Would removing this cause Claude
  to make mistakes? If not, cut it."* Bloated files cause Claude to **ignore** instructions. (code.claude.com/docs/best-practices)
- **[OFFICIAL]** INCLUDE: bash commands Claude can't guess · test runner / how to verify · repo etiquette (branch/PR)
  · architecture decisions specific to the project · env-var quirks · common gotchas / non-obvious behaviors.
  EXCLUDE: anything inferable from code · standard conventions · file-by-file descriptions · long tutorials ·
  detailed API docs (link instead) · frequently-changing info. (same)
- **[OFFICIAL]** "**Give Claude a way to verify its work**" — a test/build/lint gate it can run — is the single
  highest-leverage practice; it closes the agent's loop without a human. (same)
- **[OFFICIAL]** CLAUDE.md supports `@path/to/file` **imports**. ⚠️ **CORRECTION (see `agent-legibility-research.md`):**
  `@`-imports load the file **in full AT LAUNCH** — they are NOT lazy/progressive-disclosure and do NOT save context.
  True on-demand loading comes only from **nested subdirectory CLAUDE.md** files. So large deep docs (`spec.md` etc.)
  should be **plain links**, not `@`-imports; `@`-import only small, always-relevant content. (same)
- **[OFFICIAL]** `/init` scaffolds a starter from the codebase; then refine by hand. Emphasis ("IMPORTANT"/"YOU MUST")
  improves adherence. Check it into git. (same)
- **[OFFICIAL — agents.md]** AGENTS.md is "a README for agents": plain Markdown, any headings; include project
  overview, build/test commands, code style, testing, security. It **complements** README (README = for humans).
  The standard makes **no mention of CLAUDE.md** — they are separate conventions; Claude Code's native file is
  CLAUDE.md. (agents.md)
- **[COMMUNITY]** Soft length budget ≈150–200 lines / instructions; frontier models reliably follow a limited
  instruction count. Directional, not an official number. (humanlayer.dev/blog/writing-a-good-claude-md)

## Application to THIS repo (the Phase-14 plan)

This repo already has a strong **AGENTS.md** (project memory + Engineering Constitution) and an authoritative
**spec.md** — but **no CLAUDE.md**, so a Claude Code agent landing here gets *no auto-loaded onboarding* (Claude Code
loads CLAUDE.md, not AGENTS.md). AGENTS.md is also dense/philosophy-heavy — the wrong shape for the always-loaded slot.

**Plan:** author a **lean `CLAUDE.md`** (~1 screen) that:
1. One-line product description + the load-bearing idea ("model proposes; deterministic gates dispose").
2. **The gate** (highest-leverage): `npm run typecheck` + **all** `src/*.test.ts` (NOT just `npm test` = core+operator);
   the `npm ci` fails → use `npm install` gotcha; binaries via the npm scripts.
3. Key commands (dev, agent, test, typecheck, build) + the two-surface architecture in 3–5 lines.
4. The hard invariants (LLM never charges; server re-derives area; idempotency; address gate) — non-obvious, load-bearing.
5. Boundaries/gotchas: frozen serialized fields (Lead/LeadStatus/tool names/env vars), `STORE_BACKEND`, the known gaps.
6. **Progressive disclosure** via links: `@AGENTS.md` (constitution), `@spec.md` (contract), `@HANDOFF.md`,
   `@notes/registries.md` (this pass's hazard map).

Also fix the **stale README** (deferred from Phase 12): its "Claude Agent SDK / `query()` loop" claim contradicts
`AGENTS.md:28` + `package.json` (dep dropped; `agent.ts` uses the Messages API).

Verification (Phase 14): a **fresh-context comprehension eval** — zero-context `Explore` agents answer onboarding
questions from CLAUDE.md alone; pass = correct answers via a *few* targeted reads (not a whole-tree crawl). Plus a
critic that runs the live gate to fact-check the doc's claims.

## Sources
- https://code.claude.com/docs/en/best-practices  (Anthropic, official)
- https://agents.md/  (AGENTS.md open standard)
- https://www.humanlayer.dev/blog/writing-a-good-claude-md  (community)
