---
title: "Research: embedding channel eval on the real corpus"
labels: [wayfinder:research]
status: open
assignee: 
blocked_by: []
---

> UNBLOCKED 2026-08-02: 002-slice2-results closed.

> DEFERRED BY CHOICE 2026-08-02, not blocked: the vault holds ~4 snippets
> and a recall comparison needs roughly 50 to mean anything. The measuring
> stick already exists — `tests/resonance-paraphrase.test.ts` (ticket 036)
> records today's recall at zero and fails loudly if anyone claims semantic
> recall without it working. Run this when the corpus is big enough.

## Question

With a real vault: measure qwen3-embedding (4096d) vs nomic-embed-text (768d) at 192.168.0.229:11434 for clash-detection recall on disjoint-vocabulary pairs, vs the lexical channel baseline. MMR/diversity dedupe per the loudest-thought rule. Output: a findings doc + a default-model recommendation for the Clerk plan.
