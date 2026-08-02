---
title: "Build: ClashChannel returns rank, not a filtered set — and same-sitting pairs rank below (Q-65)"
labels: [wayfinder:task]
status: open
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
