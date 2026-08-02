---
title: "Fix: harvest silent failure — chunked extraction + parse observability"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

CRITICAL, from `docs/eval-2026-08-02-claude-adversarial.md` finding #1: an
adversarial self-run bisected bonsai-27b's harvest prompt and found
instruction-following collapse at 3+ user turns — the model echoes the tail
of the conversation instead of emitting JSON cuts. `propose()`'s parser
correctly fails, `cuts` silently becomes `[]`, and the Activity Log records
`harvest-proposed: proposals=0` — indistinguishable from a genuinely thin
sitting. Since the budget guarantees >=8 questions before a natural close,
a properly-closed sitting can silently keep nothing.

NOTE: not universally reproducible — the orchestrator's evals harvested 5
proposals from a 10-turn sitting and 2 from a 4-turn sitting at later
commits. Treat as content/length-dependent degradation, not a clean
threshold. That makes observability the FIRST fix, not the last.

1. **Observability first.** `harvest-proposed` gains `rawOutputParsed:
   bool` (and raw length). "Parse failed" and "genuinely empty" must never
   log identically again. Same for the fabrication-drop and sourceTurn-
   correction warnings currently going only to console (metrics 3 and 4 in
   the eval).
2. **Chunked extraction.** Replace one whole-transcript call with per-user-
   turn extraction (the model handles 1-2 turns reliably; unprompted entry
   is single-turn and worked 3/3, 2/2, 3/3). Cuts still validate as exact
   substrings of THAT turn; dedupe across chunks (already implemented).
   Keep a whole-transcript pass only if it demonstrably adds cross-turn
   cuts.
3. **Regression fixture.** A recorded long transcript in tests, replayed
   against the real model in the ratchet harness (ticket 032) — not vitest.
   Re-run on any model swap (Q-34).
