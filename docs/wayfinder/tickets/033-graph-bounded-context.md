---
title: "Build: graph-bounded context for the Clerk and Resonance"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: [008-build-clerk]
---

## Question

Import 4.2 from `research-loops-to-graphs.md`: build the Clerk's per-turn
and minting context from the Wiki's citation graph instead of flat vault
search — entities in the last utterance → their Snippets and Claims → one
hop along citations and Contradictions → contested and recent first →
token-budget cutoff → stable IDs attached for citation. ADR-0001 makes
small contexts a permanent constraint, so this matters more here than in
the source paper.

Deliberately deferred (research doc §5): an architecture change to
retrieval — build it when there is EVIDENCE that flat search is failing
(Resonance misses, or minting context overflowing n_ctx), not before.
