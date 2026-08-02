---
title: "Grill: the embedding channel has a cross-sitting ceiling — it pools essays, not years"
labels: [wayfinder:grilling]
status: open
assignee: 
blocked_by: []
---

## Question

Measured by ticket 007 against the real 139-snippet corpus, and it outranks the
threshold it was looking for.

| qwen3-embedding | |
|---|---|
| Highest cosine, pair **within** one sitting | **0.808** |
| Highest cosine, pair **across** two sittings | **0.640** |

There is a hard ceiling at 0.640: **every pair above it is two sentences of the
same document.** 68.5% of all 9,591 corpus pairs join two different sittings, so
this is not a sampling artifact — cross-sitting pairs are the majority of the
space and they all sit below the intra-document ones.

The consequence is that no single threshold does both jobs:

- **quota-sized** (a pool T12's 3 judgments can work through) needs **≥ 0.65**
- **any cross-sitting pair at all** needs **≤ 0.64**

At the recommended 0.70 the channel proposes 6 pairs and **all six are
intra-document**. So the embedding channel, as it currently pools, measures how
tightly an essay stays on topic. It does not measure how a belief moved across
nine years — which is the thing Q-30 exists to find and the reason the corpus
was imported with real dates at all (Q-50).

### The decision

**Should `poolCandidates` exclude same-sitting pairs?**

Excluding them makes **0.60** operative: 9 cross-sitting pairs, still
quota-shaped, and every one of them joins two different years of writing.

**Recommendation: yes, exclude.** The argument is Q-50's, one layer up. Q-50
rules that two cites from one sitting are one thought said twice and must not
promote a claim to `evidenced`. The same reasoning applies to pooling: two
opposed sentences inside one essay are a rhetorical move — a concession, a
setup, a position being argued against — far more often than they are a person
holding two views. And Q-53 already requires a *different sitting* to confirm
any candidate, so a same-sitting pair must reach outside its own document
before it can become a Contradiction regardless. Excluding it at stage 1 spends
the judgment quota on pairs that can actually finish.

**The counter-argument, which is real.** Within-document opposition is a
genuine phenomenon and it is not the same as drift: it is incoherence held at
one moment, which may be the more interesting finding of the two. The 2020
capstone is the live example — it argues for the fragile voluntary mode,
records the author's own disbelief in it, and then burns out of it, all in one
document. That contradiction is *in* the corpus, it is real, and this exclusion
would make the channel blind to it.

A middle path exists: pool same-sitting pairs but **rank them below**
cross-sitting ones, so the quota is spent on drift first and incoherence only
when there is room.

### The deeper finding, recorded so it is not lost

**An absolute cosine does not port between corpora.** 0.60 is the 97.5th
percentile of the fixture background but the 99.51st of the real corpus. Ranking
is much stronger than thresholding — 7/8 by nearest-neighbour versus 3/8 at the
best precision-preserving cut.

The durable fix is therefore **top-N by rank, bounded by the quota**, not a
better constant. That is a change to what a `ClashChannel` returns (an ordered
list rather than a filtered set), so it is a contract change and belongs in its
own ticket rather than in a threshold tweak. Flagged, not made.

### A third argument for rank over threshold, added after T18

T18 measured that the endpoint is deterministic only for a **fixed batch
composition**: the same text scored 0.7606 in a batch of 8 and 0.7631 in a batch
of 16. A pair within ~0.003 of the cut can therefore flip between docket runs
based on how many claims happened to need embedding. A rank is invariant to
that; an absolute cut is not.

### A third argument for rank over threshold, added after T18

T18 measured that the endpoint is deterministic only for a **fixed batch
composition**: the same text scored 0.7606 in a batch of 8 and 0.7631 in a batch
of 16. A pair within ~0.003 of the cut can therefore flip between docket runs
based on how many claims happened to need embedding. A rank is invariant to
that; an absolute cut is not.

### A third argument for rank over threshold, added after T18

T18 measured that the endpoint is deterministic only for a **fixed batch
composition**: the same text scored 0.7606 in a batch of 8 and 0.7631 in a batch
of 16. A pair within ~0.003 of the cut can therefore flip between docket runs
based on how many claims happened to need embedding. A rank is invariant to
that; an absolute cut is not.

## Acceptance

- A ruling on same-sitting pairs: exclude, rank-below, or keep.
- If excluded or ranked, `clash.embeddingCosine` is re-set accordingly and the
  shadow record shows whether any proposed pair joins two sittings — which is
  the specific thing to watch, per ticket 007.
- The rank-not-threshold question is either taken up or explicitly deferred with
  a reason.
