---
title: "Grill: how opposition is detected at all — the polarity blind spot"
labels: [wayfinder:grilling]
status: open
assignee: 
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
