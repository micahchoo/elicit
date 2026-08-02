---
title: "Fix: the embedding channel is one run behind, and it biases the shadow record"
labels: [wayfinder:task]
status: closed
assignee: claude
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

## Resolution (2026-08-02) — commit `2263c1d`

Job 1.5 primes between the sweep and lint, with the post-sweep graph narrowed
to what the sweep changed. `candidates()` untouched — still synchronous,
cache-only, pure.

**The prune edge was the sharp part.** `onlyIds` filters the WORK LIST only;
the graph handed to `persist` stays whole, because `persist` prunes to the live
claims of the graph it receives. Narrowing by subset-graph would have deleted
every vector the first prime wrote — ticket 053's deletion arriving from the
other direction. Two tests hold it.

**The touched-set is a body diff, not a read of `OpResult`.** `applyOps` cannot
report what it minted: a MINT op carries no id, because the id is created
inside the write boundary. The diff also catches an UPDATE that rewrites a body
in place, which a new-ids-only check would miss.

Proven by embedder call counts rather than inspection — run 1 embeds
`[MINTED]` narrowed versus `[MINTED, COLD]` whole-graph; run 2 embeds nothing.
The acceptance drives two consecutive runs and shows run 1's pool holding a
pair it previously could not have contained, and the Q-35 shadow record naming
the fresh claim where it was empty before.

14 mutations. Three survived and were closed with new tests. **One survived and
was deleted instead** — an `isLive` guard no op could reach, since MERGE
archives with bodies untouched and SUPERSEDE leaves the old body. Removed
rather than left as a branch that looks like protection.

**Left for the `server.ts` owner:** `runWikiJobsNow`'s comment says prime "MUST
run before the pool", which is now half the story. One sentence pointing at
`jobPrime`.
