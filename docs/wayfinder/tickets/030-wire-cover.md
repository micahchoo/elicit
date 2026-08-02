---
title: "Fix: wire the Cover memory layer — ADR-0002's third layer is dormant"
labels: [wayfinder:task]
status: closed
assignee: claude
resolution: >
  Wired at ec511ca (worked personally, not via omp): server injects
  nextConsolidation/saveSummary/loadSummaries + a new readTranscript helper
  and modelName (Q-34 stamp) at both runDocket call sites. The consolidation
  prompt now carries actual transcript content (capped 4k/transcript, 12k
  total) instead of the contentless stub, output tolerated as non-string,
  the job is try/catch-isolated with consolidated / consolidation-failed
  log events. 2 new tests; 236 total green.
blocked_by: []
---

## Question

ADR-0002 commits to three memory layers; the third (Cover tiling —
transcript summaries consolidated over session ranges, clean-room from the
OptMem spec) is BUILT (`src/memory/cover.ts`, tested) but never invoked:
`docket.ts` exposes optional `nextConsolidation`/`saveSummary`/
`loadSummaries` hooks and `server.ts` injects none of them. Verified by
grep 2026-08-01: no import of memory/cover anywhere in src/ outside the
module itself.

Fix: inject the cover functions at the server boot path (docket deps),
confirm summaries land in `vault/marginalia/transcript-summaries/` after
enough sessions accumulate, and add one e2e asserting the docket runs a
consolidation when the tiling says one is due. Summaries are agent prose —
Marginalia-class, never shown at close (Q-20), never in Pieces.
