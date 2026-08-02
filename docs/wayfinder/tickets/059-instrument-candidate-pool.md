---
title: "Build: instrument the candidate pool — recall and precision must be readable"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: [008-build-clerk.md]
---

## Question

Q-52 declines a fourth NLI clash channel on the grounds that no failure has been
observed. That decision is only honest if the failure would be visible when it
happens. Today it would not be: `WikiReport` cannot tell these three apart —

1. the pool was empty (retrieval found no pairs at all),
2. the pool was full and every pair agreed (retrieval works, opposition rare),
3. no contradictions exist in the corpus (the pipeline is right).

All three read as zero Contradictions. This is eval finding #8's lesson —
`resonate()` scored 0/8 on paraphrase and nothing in the interface said so —
arriving a second time one layer up.

### What to record

Per docket run, in `WikiReport` and rendered by T16's RESULTS:

- `poolSize` — pairs proposed by `poolCandidates` before the judgment quota.
- `poolByChannel` — `{lexical, referent, embedding}` counts, **before** dedupe
  and after, so a channel that only ever confirms what another already found is
  visible as such. The plan's dedupe keeps the first channel in array order, so
  a raw count is the only way to see the second channel's independent yield.
- `oppositionJudged` / `oppositionOpposed` — already in the plan (B10). The
  ratio is stage 1's precision record.
- `poolQuotaClipped` — pairs proposed but never judged because the per-run quota
  of 3 was spent. Without this, a starved pool is indistinguishable from a small
  one, and the quota silently caps recall.

### The decision this instrument feeds

A cross-encoder NLI channel (route (a) of ticket 052) graduates under Q-35 on
this record and not on argument. The condition to state when the numbers exist:
a sustained `oppositionOpposed / oppositionJudged` near zero across runs with a
non-trivial `poolSize` means the pool is aboutness-noise and a polarity-aware
retrieval stage is earning its place. A `poolSize` near zero means the problem
is upstream in retrieval, and the answer is the embedding channel's threshold,
not a new model.

`onnxruntime` is already in the tree via `sherpa-onnx-node`, so route (a) stays
cheap whenever it is called for.

## Acceptance

- A docket run over a vault with a known planted contradiction reports non-zero
  `poolSize` and names the channel that found it.
- A run over a vault with no opposed pairs reports non-zero `poolSize` and zero
  `oppositionOpposed` — the two cases above are distinguishable in the output.
- `poolQuotaClipped` is non-zero on a run with more than 3 candidates.
