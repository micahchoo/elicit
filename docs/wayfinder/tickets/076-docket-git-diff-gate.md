---
title: "Build: the vault's git diff decides which docket jobs have work — and indexes ride a cursor"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

From the codex comparative review (research-codex-lessons.md, lesson 2).
Ticket 047 measured the problem: a 127s docket on a 139-snippet vault, and
the latency grows with the corpus because every run rebuilds every index
from scratch (`rebuildIndex()` at the top of src/clerk/docket.ts).

Two mechanisms, one principle — full rebuild stays as the repair path,
incremental becomes the fast path:

1. **Git-diff gating.** Q-61 made the vault a git repo and the docket
   commits per run. The diff between HEAD and the last docket commit is a
   free, exact answer to "which files changed since the docket last looked"
   — so each wiki job (sweep, prime, lint, candidates) can be skipped
   entirely when its inputs show no diff. Codex's memories pipeline runs
   its expensive consolidation agent only when the workspace diff is
   non-empty; same shape here. A skipped job logs that it was skipped for
   no-diff, distinct from ran-and-found-nothing (the 034 rule).

2. **Index cursor.** The lexical and embedding indexes rebuild from zero
   each run. A watermark (last-processed commit or file mtime set) lets a
   run index only what changed, with a full rebuild on any inconsistency —
   codex's log-follower cursor + read-repair pattern. Ticket 067's caution
   is canon here: the narrowing filters the WORK LIST, never the graph;
   pruning against a subset deletes vectors (that bug shipped once already).

Acceptance: a docket run on an unchanged vault completes in under a second
of index work and logs each skipped job with its reason; a run after one
snippet lands processes only that snippet's dependents; deleting the
watermark forces a clean full rebuild with identical results to today's
path; the 067 regression (prune-against-subset) is held by a test.
