---
title: "Grill: how opposition is detected at all — the polarity blind spot"
labels: [wayfinder:grilling]
status: closed
assignee: micah
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review. The strongest finding in it.

Q-30 stage 1 draws contradiction candidates from the lexical and embedding
channels. Neither can see polarity. Lexical cannot see paraphrase at all —
`tests/resonance-paraphrase.test.ts` records 0 of 8 as a standing fixture.
Embeddings see paraphrase and are close to blind to negation: "estimates are
for coordination" and "estimates are not for coordination" sit almost on top
of each other in vector space. So the pipeline that opens Contradictions
cannot, as specified, tell agreement from opposition — and since stage 2's
re-measure only fires on a candidate, a candidate that never forms means the
whole pipeline never runs.

Two routes the review names, both compatible with what is already locked:

(a) A third structural channel: a small local NLI cross-encoder, where
    entailment / neutral / contradiction IS this problem. A 300M-class model
    runs beside Ollama for nothing, and `ClashChannel` is already an
    interface with a fourth implementation costing nothing structurally.
    onnxruntime is already in the tree via sherpa-onnx (STT).

(b) Route opposition through DISPLAY: show the user both poles and let their
    reaction be the verification. Compatible with Q-15 — showing a claim and
    watching what happens is not a quiz.

These are not exclusive: (a) generates candidates, (b) verifies them. Grill
which, and whether a model-judged `opposed` boolean is permitted anywhere
given the standing rule that a model's self-reported boolean is never a gate.

## Resolution (2026-08-02) — Q-52

The premise is a category error. The three channels answer *aboutness*, not
polarity: lexical (shared phrase), referent (shared registry entity, no shared
vocabulary needed), embedding (cosine). Polarity is judged one layer down by
`judgeOpposition`, whose `poleA`/`poleB` must be exact substrings of the cited
quotes — code-verified, non-conforming poles drop the candidate. Q-49 already
ships that judgment live.

And the review's own example inverts: embeddings placing "estimates are for
coordination" next to "estimates are not for coordination" is the retrieval
behaviour the pipeline needs. A channel that could see negation would SEPARATE
the two poles and never pool them.

What survives is precision, not recall. An aboutness-only pool spends a bounded
judgment quota (3/run) on pairs that mostly agree, and `WikiReport` cannot
distinguish an empty pool from a pool full of agreement from "no contradictions
exist" — eval finding #8's observability lesson repeating. So:

- **Route (a), the NLI cross-encoder: NOT taken now.** It would add a mechanism
  to fix a failure nobody has observed, which is exactly what Q-35 forbids. It
  gets a record to graduate on once the pool is instrumented.
- **Route (b), opposition through display: rejected as a replacement.** It is
  Q-30 stage 2's re-measure question arrived at from the other side, and it
  would hand the user raw candidate pairs the Clerk has not finished thinking
  about (Q-15).
- **What ships instead:** pool instrumentation — see
  [Instrument the candidate pool](059-instrument-candidate-pool.md).
