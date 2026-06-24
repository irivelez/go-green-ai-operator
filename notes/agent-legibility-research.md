# Agent-legibility research — CLAUDE.md structure & repo layout (cited)

Durable rationale behind the CLAUDE.md / nested-files / no-reorg decisions. From a deep-research pass (18 sources, 85
claims, 25 adversarially verified — 21 confirmed, 4 refuted). Claims tagged **[OFFICIAL]** (Anthropic docs / arXiv) vs
**[STUDY]** / **[COMMUNITY]**. Primary anchor: <https://code.claude.com/docs/en/memory> (verified live 2026-06-23).

## CLAUDE.md loading semantics (the load-bearing facts)
- **[OFFICIAL]** CLAUDE.md files **at or above** the working directory load **in full at launch**, concatenated root→cwd
  (closer-to-cwd read last). Files in **subdirectories below** cwd load **on demand** — only when Claude reads a file in
  that subtree. (3-0)
- **[OFFICIAL] `@path` imports load AT LAUNCH — they do NOT save context / are NOT lazy.** *"Splitting into @path imports
  helps organization but does not reduce context, since imported files load at launch."* True progressive disclosure comes
  ONLY from nested subdirectory CLAUDE.md files. (3-0) — **This is why this repo's deeper-doc references are plain links,
  not `@`-imports.**
- **[OFFICIAL]** Import parsing **skips markdown code spans / fenced blocks** — a backticked `` `@spec.md` `` or
  `` `@anthropic-ai/sdk` `` is literal text, not an import. (3-0)
- **[OFFICIAL]** Target **< 200 lines** per file; "longer files consume more context and reduce adherence." Files load in
  full regardless of length (this is an adherence target, not truncation). (3-0)
- **[OFFICIAL]** Concatenation + recency ordering, **not** formal precedence. The claim that deeper files "take precedence"
  was **REFUTED (0-3)**. CLAUDE.md is "context, not enforced configuration."
- **[OFFICIAL]** Claude Code reads **CLAUDE.md, not AGENTS.md**; AGENTS.md is **not** an auto-read fallback (REFUTED 0-3).
  Bridge with `@AGENTS.md` *or* a plain link. (We chose a plain link — minimal eager context; AGENTS.md duplicates ~half
  of the root CLAUDE.md.)
- **[CAVEAT]** Nested on-demand loading is the documented design but has had client bugs (#3529 Jul-2025; VS Code
  v2.1.39 #24987) — so **must-know rules stay in the root file**; nested files only reinforce/add local detail.

## Why short + layered beats one big dump
- **[STUDY] "Context rot" is real and non-linear.** Across 18 frontier models (Chroma), reliability degrades as input
  grows even on simple tasks; **placement matters more than mere inclusion** (mid-context accuracy drops 30+ pts).
  <https://research.trychroma.com/context-rot>. The downstream "short CLAUDE.md → better outcomes" inference is
  well-motivated but not itself directly benchmarked.
- **[STUDY]** ETH Zurich (arXiv 2602.11988): "unnecessary requirements from context files make tasks harder; human-written
  files should describe only **minimal requirements**." (3-0) — bias to trim, not expand.

## Folder / file organization
- **[OFFICIAL/Next.js]** Colocation-first (components/logic inside their route segment) reduces context-switching and aids
  navigation; avoid >3–4 nesting levels. <https://nextjs.org/docs/app/getting-started/project-structure>. (3-0)
  **But this evidence is about App Router routes/components — NOT a domain core.**
- **Benchmark honesty:** arXiv 2601.20404 found AGENTS.md ≈ −29% runtime / −17% tokens — but **Codex-only,
  correlational, n=10, ≤100 LoC tasks, not a correctness test** (2-1). 2602.11988 found **no clear task-success benefit**.
  Do NOT conflate "saves time/tokens" with "improves correctness."
- **[OPEN QUESTION — unanswered by any source]** Does reorganizing a ~45-file **flat** deterministic `src/` core into
  feature folders improve agent comprehension? No source addressed flat-vs-nested for a domain core.

## Decisions for this repo (applied)
1. **Root `CLAUDE.md`:** deeper-doc references are **plain links, not `@`-imports** → eager context per session ~1,144 → ~74
   lines. Body (gate, commands, architecture, invariants, where-to-look) kept inline (the must-know, can't-guess content).
2. **Nested `src/CLAUDE.md` + `app/CLAUDE.md`:** real on-demand area rules; must-know stays in root (client-bug caveat).
3. **`src/` kept FLAT — no reorg.** No evidence it helps agents (open question); colocation evidence is routes-only; it's
   the widest-blast-radius change (legibility-pass Phase 11 deliberately left structure alone). The root `CLAUDE.md`
   "where to look" table already solves navigation at ~zero risk.

## Refuted claims (do not repeat these framings)
- "AGENTS.md reduces task success vs no context" — REFUTED (1-2; only the narrower minimal-requirements guidance survived).
- "Most agents (Claude Code/Cursor/Copilot) auto-read root AGENTS.md at launch" — REFUTED (0-3).
- "Deeper CLAUDE.md formally takes precedence" — REFUTED (0-3); it's concatenation + recency, not override.
- "Subfolder CLAUDE.md files are completely ignored even when working in them" (#3529) — REFUTED (1-2); a client
  regression, not the documented design.

## Sources
Official: <https://code.claude.com/docs/en/memory> · <https://nextjs.org/docs/app/getting-started/project-structure> ·
<https://nextjs.org/docs/app/guides/ai-agents>. Studies: <https://research.trychroma.com/context-rot> ·
<https://arxiv.org/abs/2602.11988> · <https://arxiv.org/abs/2601.20404>. Community (corroborated by official docs):
humanlayer.dev, morphllm.com, buildcamp.io.
