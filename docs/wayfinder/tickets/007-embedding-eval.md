---
title: "Research: embedding channel eval on the real corpus"
labels: [wayfinder:research]
status: closed
assignee: claude
blocked_by: []
---

> UNBLOCKED 2026-08-02: 002-slice2-results closed.

> DEFERRED BY CHOICE 2026-08-02, not blocked: the vault holds ~4 snippets
> and a recall comparison needs roughly 50 to mean anything. The measuring
> stick already exists — `tests/resonance-paraphrase.test.ts` (ticket 036)
> records today's recall at zero and fails loudly if anyone claims semantic
> recall without it working. Run this when the corpus is big enough.

## Question

With a real vault: measure qwen3-embedding (4096d) vs nomic-embed-text (768d) at 192.168.0.229:11434 for clash-detection recall on disjoint-vocabulary pairs, vs the lexical channel baseline. MMR/diversity dedupe per the loudest-thought rule. Output: a findings doc + a default-model recommendation for the Clerk plan.

## Resolution (2026-08-02)

Findings doc: [`docs/eval-2026-08-02-embedding-channel.md`](../../eval-2026-08-02-embedding-channel.md).
Measured against the real corpus — 139 imported snippets, 2017-2026 — which is
the corpus this ticket had been waiting for since it was written.

### The headline: 0.82 was inert, not imprecise

| | qwen3 | nomic |
|---|---|---|
| Highest cosine, all 9,591 corpus pairs | **0.808** | 0.798 |
| Corpus pairs admitted at 0.82 | **0** | **0** |
| Fixture recall at 0.82 | **0/8** | **0/8** |

The provisional threshold sat **above the entire distribution**. Shipping it
would have reproduced the lexical baseline exactly — 0/8 — through a slower
mechanism and a 52 MB cache, and nobody would have seen anything wrong, because
"no contradictions found" is what the pipeline says when it works too. This is
eval finding #8's lesson a third time, and it is the argument for ticket 059.

Sharper: the only pairs anywhere that clear 0.82 are minimal negations, and
`resonate()` already finds **8/8** of those. At 0.82 the channel was strictly
redundant with the one it exists to supplement.

**Recommendation, taken: `clash.embeddingCosine = 0.70`, `qwen3-embedding`,
still shadow.** 3/8 fixture recall at 100% precision (0 false positives over 80
non-pairs), 6 pairs of 9,591 on the real corpus — quota-shaped. qwen3 beats
nomic on every axis (AUC 0.952 vs 0.853; NN recall 7/8 vs 6/8; length confound
0.032 vs 0.147). **Q-17's provisional default survives contact with
measurement**; only its number changes.

### Q-52 confirmed on real data, hard

Rephrased oppositions score 0.429-0.729. Genuine paraphrases score 0.507-0.761.
**They are one population** — cosine cannot distinguish "same belief restated"
from "opposite belief restated". One fixture pair's nearest neighbour is the
distractor stating the *opposite* belief (0.697), ahead of its own paraphrase
(0.507). That is Q-52's mechanism, measured. Nothing here argues for the NLI
channel Q-52 declined: a cross-encoder would separate the poles rather than pool
them.

### Operational, for T18

The first call against an unloaded `qwen3-embedding` took **370 seconds and then
returned HTTP 500**. Warm: 100-120ms. An `embedding-unavailable` path that only
handles a refused connection will not survive a slow 500.

### What this ticket could not settle

See [the embedding channel's cross-sitting ceiling](064-embedding-cross-sitting-ceiling.md).
