---
title: "Build: the vault's git diff decides which docket jobs have work — and indexes ride a cursor"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 3)
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

## Resolution (2026-08-02) — both mechanisms, one new module

Files: `src/index/watermark.ts` (new — both gates), `src/clerk/wiki-jobs.ts`,
`src/log/format.ts`, `src/registry.ts` (declarations), `tests/watermark.test.ts`
(new), `tests/wiki-jobs.test.ts`, `tests/log-format.test.ts`.
`src/clerk/docket.ts` is deliberately UNTOUCHED: its step-1 scan and lexical
build are the floor (its own jobs — openers, still-true, expedition — need the
snippets), while the wiki layer's SEVEN per-job `rebuildIndex()` calls collapse
to one gate scan. `src/server.ts` untouched; its seam is a remainder below.

**Mechanism 1 — the git-diff gate.** `vaultDiff(root)` finds the last commit
authored `elicit-clerk <clerk@localhost>` (Q-61) and unions two git lists into
the changed-path set: `git diff --name-only -z <commit>` (every TRACKED change
since the last docket commit — staged or not, any author) and
`git ls-files --others --exclude-standard -z` (every UNTRACKED file — the
app's own writes are uncommitted until 049's hook lands, and a gate that
missed them would skip exactly the work it exists to schedule). The two
docket-commit requirements from Q-61 hold: `vault/.gitignore` keeps `/index/`,
the embedding cache and `.auth.json` out of the answer, and the docket's own
bookkeeping — `log/`, `wiki/sweep-log.jsonl`, `wiki/sweep-deferral.jsonl`,
`wiki/still-true-cursor.json` — maps to NO job's input class, so a run's own
writes never gate the next run back into work. `changedIn(diff, prefixes)`
matches repo-relative paths against each job's input classes; the queue-driven
jobs (presweep-confirmation, remeasure, confirmation) and the sweep gate on
it. A skipped job logs `wiki-job-skipped` with `job=` and
`reason=no-diff since=<hash>` — a third outcome beside ran-and-found-nothing
(the 034 rule) and failed, exactly the 075 `succeeded_no_output` shape.

**Mechanism 2 — the index watermark.** `vault/index/watermark.json` (derived,
gitignored, Q-3/Q-61) records a fingerprint of the vault state the index
passes completed against: id → content hash for snippets, readings, claims,
referents, contradictions AND candidates (the candidate records shape T11's
anti-repetition filter, so they count). The claim hash excludes `readLog`
(appends on every wiki read — noise) and the timestamps/stamps, whose effects
(status, supersede, cites) are themselves hashed. The graph-derived passes
(prime, lint, candidates) gate on it alone — no git needed:

- fingerprint matches → index is current → skip (`reason=index-current at=`),
  which is what makes a non-git vault fast too;
- fingerprint differs → run; `jobPrime` narrows the embedding WORK LIST to
  `touched ∪ claimDelta(watermark, claims)` — a claim hand-edited between runs
  is re-embedded even though the sweep never touched it;
- watermark missing/corrupt → the full rebuild that is today's path, and the
  results are identical to it by construction.

The watermark is written AFTER the candidates pass and BEFORE remeasure and
confirmation. That ordering is load-bearing: a candidate dissolved or minted
by the queue-driven jobs lands after the watermark, so the next run's
fingerprint differs and the candidates pass re-runs — Q-53's one reproposal
after an expiry depends on exactly that. A quiet run (everything skipped)
rewrites nothing.

**Ticket 067's rule, held by a test.** The delta (work list) is a separate
argument from the graph: `prime(graph, onlyIds)` keeps the WHOLE post-sweep
graph, and `persist` prunes to the live claims of that whole graph — the
cache never loses an untouched claim's vector. The new test drives a
watermark run, hand-edits one claim body, re-runs, and asserts the embedder
saw exactly that one body while the untouched claim's vector survived.

**Deliberate behavior changes, recorded so they were decided:** (1) rejection
recovery is now event-driven — a reading that failed once waits for the next
reading/snippet change instead of being re-attempted every run, which is what
S11's backoff existed to stop; (2) on an unchanged vault the pool is no longer
recomputed every run — the skip is logged, never silence, and two existing
tests were updated to assert the skip + the channel cache's retention instead
of the recomputation.

**Cross-slice courtesy:** the mechanism-registry test (077) requires every
new export to be declared, so `src/registry.ts` carries the eight watermark
exports as `live`, plus the `src/import/scan.ts` and `src/import/adopt.ts`
entries that were missing while 077's wave was mid-flight.

Verified: `npx tsc --noEmit` clean; `npm test` 1348 passed across 55 files;
`npx vite build` ok. New tests: 19 in `tests/watermark.test.ts` (gate unit
behaviour incl. the untracked-file case) and 5 in `tests/wiki-jobs.test.ts`
(skip-everything on an unchanged vault, one-new-reading, no-git watermark,
the 067 regression, deleted-watermark full rebuild).

### Remainders for the `server.ts` owner (the seam this ticket could not touch)

1. **049's commit-per-docket-run hook is still unwired.** `runDocketNow`
   must stage and commit at the end of a run, and at boot when the tree is
dirty. Until it lands, the git gate's diff includes everything since the last
MANUAL clerk commit — correct, never skipping work it should not, but coarse;
the watermark carries the fast path in the meantime. This is the same
remainder 049 left; 076 makes it the difference between "fast" and "very
fast", not between "correct" and "incorrect".
2. **`ELICIT_QUEUE_DIR` outside the vault** makes queue-only changes
   (expiry, draw status) invisible to the gate; a re-measure ANSWER still
   arrives as a vault reading/snippet and gates correctly. The default
   (queue in the vault) is fully covered.
3. 067's leftover comment in `runWikiJobsNow` — "prime MUST run before the
   pool" — is now half the story; the in-run jobPrime is the other half.
   One sentence pointing at `jobPrime` closes it.
