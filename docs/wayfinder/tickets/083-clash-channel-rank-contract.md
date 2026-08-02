---
title: "Build: ClashChannel returns rank, not a filtered set — and same-sitting pairs rank below (Q-65)"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 4)
blocked_by: []
---

## Question

Ruled 2026-08-02 in the grill of [064](064-embedding-cross-sitting-ceiling.md);
the ruling is Q-65 and the supporting measurements are in that ticket and
ticket 007's resolution.

Change the `ClashChannel` contract from a threshold-filtered set to an
**ordered list, bounded by the judgment quota** (top-N by rank). Three
independent measurements force it: an absolute cosine does not port between
corpora (0.60 = 97.5th percentile on the fixture, 99.51st on the real
corpus); rank recall beats the best threshold 7/8 vs 3/8; and the endpoint
is nondeterministic across batch compositions (±0.003 on identical text),
so near-threshold pairs flip between docket runs while a rank is invariant.

Within the ordering, apply Q-65: cross-sitting pairs rank strictly above
same-sitting pairs, whatever their cosines — drift fills the quota first,
within-document incoherence only when room remains. `clash.embeddingCosine`
stops being the gate; whatever residual floor survives (if any) is a sanity
bound, not the selection mechanism, and its removal or retention is recorded
with a reason.

Per ticket 007's watch-item: the shadow record for every proposed pair must
state whether it joins two sittings, so the graduation evidence shows the
channel doing the job it was rebuilt for.

Acceptance: `ClashChannel` implementations return ordered lists; the pool
respects Q-65 ordering (test: a 0.80 same-sitting pair ranks below a 0.60
cross-sitting pair); on the real-corpus fixture the pooled candidates
include cross-sitting pairs joining different years (the 064 measurement
made that impossible before); batch-size nondeterminism cannot reorder
results across the quota boundary in the test fixture; existing contradiction
pipeline tests updated, suite green.

## Resolution (2026-08-02)

Files: `src/wiki/clash.ts` (contract + pool), `src/wiki/embedding.ts` (the
channel), `src/wiki/contract.ts` (`ClashCandidate` field),
`src/wiki/thresholds.ts` (floor value), `src/wiki/store.ts` (persistence),
`src/clerk/wiki-jobs.ts` (quota wiring + mint site), `src/registry.ts`
(`sameSitting` declaration), `tests/wiki-clash.test.ts`,
`tests/wiki-embedding.test.ts`, `tests/wiki-jobs.test.ts`,
`tests/wiki-store.test.ts`, and the plan ledger
`docs/superpowers/plans/2026-08-02-the-clerk.md` (the conformance test in
`tests/wiki-thresholds.test.ts` reads that file and pins the table to it).
`src/server.ts` is deliberately UNTOUCHED: the channel wiring and the
`poolCandidates` dependency injection are unchanged, and the quota is passed
inside `wiki-jobs.ts`. (Footprint note: the task brief named `src/clerk/`,
`src/server.ts`, `src/types.ts`, `src/registry.ts` and tests — the
`ClashChannel` contract actually lives in `src/wiki/clash.ts`, so the wiki
slice was touched instead of `src/server.ts`; `src/types.ts` never held the
contract type. Nothing outside that set plus the plan ledger was edited.)

**The contract change.** `ClashChannel.candidates(graph)` returns an ORDERED
list, best first, instead of a threshold-filtered set. The embedding channel
ranks by Q-65: cross-sitting pairs (the two claims draw on different
sittings) strictly above same-sitting pairs whatever their cosines, then
cosine desc, then the sorted claim-id pair key — a total order, so batch-size
nondeterminism (T18's ±0.003) cannot reorder. `poolCandidates` now takes the
judgment quota (`OPPOSITION_QUOTA`, `clash.judgmentsPerRun` = 3, live — a
bound, so it ships live per Q-56) as a fifth parameter, stamps every admitted
pair with `joinsTwoSittings`, and cuts the ordered, filtered union to its
top-N. The clip is recorded through `shadowDecision` with the same
`threshold-clipped` shape the loop used to write, and `clash-checked` now
reports `pool=` after the cut, so the log number is the pool the caller
receives (`WikiReport.pool.size`).

**`clash.embeddingCosine` is a sanity floor, not the gate — retained at
0.5, reason recorded.** Selection is now rank + quota; the register entry
only keeps near-orthogonal pairs off the judgment quota when the corpus is
small. It sits below the measured cross-sitting ceiling of 0.640 (ticket
064) with margin, so it cannot re-create the ceiling that made the channel
measure essay coherence instead of drift; it sits high enough that a
cosine-0.1 pair cannot spend the quota. Retention is recorded in the
register's `graduatesWhen` and in the plan ledger. The channel STAYS in
shadow (Q-35): this ticket rebuilt the channel and its record; graduation is
a separate decision when the record earns it.

**Ticket 007's watch-item, at every seam.** `PooledPair` and the persisted
`ClashCandidate` carry `joinsTwoSittings` (computed by the pool from the
graph, never by a channel; optional on the record type because pre-083
records lack it, always written for new ones), and each shadow-decision line
names it: `pool <a>+<b> cosine=… joinsTwoSittings=true|false`, emitted in
rank order. The `excludeSameSitting` option is GONE — Q-65 pools same-sitting
pairs and ranks them below, it never excludes.

**Acceptance, as tested.** (1) `a 0.80 same-sitting pair ranks below a 0.60
cross-sitting pair` — `tests/wiki-embedding.test.ts`, the Q-65 block, with
the isolated four-claim fixture. (2) `batch-size nondeterminism cannot
reorder across the quota boundary` — `tests/wiki-clash.test.ts` (pool cut
stability under a swapped near-boundary pair) and `tests/wiki-embedding.test.ts`
(a pair scored 0.600 vs 0.596 stays at the same rank). (3) Cross-year
candidates in the pool — new test in `tests/wiki-clash.test.ts` driving the
real `embeddingChannel` through `poolCandidates`: two 2018↔2024 pairs fill
the quota, every pair `joinsTwoSittings`. (4) The watch-item at the pipeline
seam — `tests/wiki-jobs.test.ts` asserts the written candidate carries the
stamp; `tests/wiki-store.test.ts` round-trips it present and absent. (5)
Existing contradiction-pipeline tests updated and green.

**Deliberate behavior changes, recorded.** (1) A run whose pool exceeds the
quota now cuts in `poolCandidates` instead of the judgment loop; the loop's
own bound stays as a safety net for injected pools. (2) The pool is bounded:
`report.pool.size` ≤ 3 by construction. (3) The plan ledger's threshold row
moved 0.70 → 0.50 with the reasoning; T18's wave note carries a supersession
clause rather than rewritten history. (4) The hash-fixture recall test in
`tests/wiki-embedding.test.ts` now records `falsePairs: 1` at the 0.5 floor
(one more pair above the floor than at 0.7) — intent preserved, number
updated. `src/index/semantic.ts`'s comment referencing `excludeSameSitting`
was left untouched per the footprint.

Verified: `npx tsc --noEmit` clean; `npm test` 1371 passed, 2 skipped,
57 files. No commit (per instruction).
