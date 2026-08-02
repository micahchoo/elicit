---
title: "Build: the protocol ratchet — keep-or-revert prompt tuning"
labels: [wayfinder:task]
status: done
assignee: 
blocked_by: []
---

## Result

HARNESS BUILT (2026-08-02). Five files:

- `scripts/ratchet/corpus.ts` — loads vault/transcripts/*.md, selects 3 most substantive, snapshots to `corpus.json`
- `scripts/ratchet/run.ts` — replays corpus against real model via `makeComplete()`; emits metrics JSON for harvest mode (fabrication rate, proposal count, facet distribution) and probe mode (distinct-frame clustering, repeat/echo/conversation-reference rates)
- `scripts/ratchet/compare.ts` — two metrics JSONs → keep-or-revert verdict per anti-gaming guard (facet-distribution proxy regression vetoes)
- `scripts/ratchet/corpus.json` — frozen eval corpus (3 synthetic exchanges, 4635 user chars)
- `tests/ratchet.test.ts` — 18 pure-function tests (frame extraction, content words, echo rate, conversation reference, repeat rate, verdict: keep, revert fabrication, revert facet bias, no yield gain → keep, echo regression, conv-ref regression; no model calls)

Verification: `npx tsc --noEmit` clean, `npx vitest run tests/ratchet.test.ts` 18/18, `npx tsx scripts/ratchet/run.ts --mode harvest` against bonsai-27b → 0% fabrication rate, 16 proposals, mean 5.33/exchange.

### Blocked src change (NOT made — src/ is not mine today)

`propose()` in `src/harvester/harvester.ts` hardcodes `SYSTEM_PROMPT` as a module-level `const`. To test harvest prompt variations, add parameter `promptOverride?: string` to `propose()` and use `promptOverride ?? SYSTEM_PROMPT` in the `complete()` call (line 130).

