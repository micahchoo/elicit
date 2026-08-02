---
title: "Fix: the embedding channel is one run behind, and it biases the shadow record"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Found by T13 while wiring the docket, and recorded before it can be forgotten —
because the window in which it matters closes the moment
`clash.embeddingCosine` graduates.

`runWikiJobsNow` awaits `embedding.prime(graph)` **before** calling
`runWikiJobs`. But job 1 of `runWikiJobs` is the sweep that MINTS claims. So a
claim created during a run has no vector until the next run, and
`candidates()` — which is cache-only and synchronous by design — simply skips
it.

This is never an error and never a fabricated pair. `candidates()` cannot
invent a vector it does not hold, so the failure mode is silence, not a wrong
answer.

### Why it still matters

**It biases the shadow record against fresh claims.** Q-35 graduates
`clash.embeddingCosine` on what the shadow record shows, and the record is
currently built from a pool that structurally excludes everything minted in the
same run. On a vault accreting steadily that is a small, uniform lag. On the
**first run over the imported corpus** — 139 snippets, all their claims minted
in one sweep — it means the embedding channel contributes *nothing at all* to
the first pool, and the record for that run says the channel found nothing when
what happened is that it was never asked.

Ticket 007 already established that this channel's honest evaluation is
delicate: 0.82 was inert and looked exactly like "no contradictions exist". A
second mechanism that produces the same silence for a different reason makes
that record harder to read, not easier.

### The fix, and why T13 did not make it

Prime again **after** the sweep, inside `runWikiJobs`, before the candidate
pool. That is `src/clerk/wiki-jobs.ts` — T12's file, which T13 did not own.

It is a small change with one real question attached: a second prime costs
another pass over the embedder, so it should prime **only the claims minted
this run** rather than re-priming everything. `prime` is currently
whole-graph; a `prime(graph, onlyIds?)` narrowing is the shape.

### Watch for the interaction with T13's other constraint

`candidates()` must stay **synchronous and cache-only** — `poolCandidates`
depends on it being pure and deterministic. The fix is a second `prime` call,
never an await inside `candidates()`.

## Acceptance

- A run that mints a claim and then pools candidates can pair that claim in the
  same run.
- `candidates()` is still synchronous, still cache-only, still deterministic.
- The second prime embeds only what the sweep added — asserted by counting
  embedder calls, not by inspection.
- A test drives two consecutive runs and shows the first run's pool now
  contains a pair it previously could not have contained.
