---
title: "Fix: the harvester reads each turn bare — the stored question and context never enter the payload"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

Caught live by Micah mid-sitting, 2026-08-02, minutes after the 085 review
coded it as mode 5 ("reading misses the surrounding truth", 4 of 20 notes):

> Q: "What does it mean to be alive to each other?"
> A: "I think it means to be responsive to each other in the ways that they live."
> Reading: "The user asserts that mutual responsiveness in daily life
> constitutes the core meaning of **something**."

The "something" is "being alive to each other" — present in the eliciting
question, absent from the reading. Micah's words: "the surrounding context
is not being considered by the harvester."

Mechanism: `propose()` sends ONE turn per model call
(`src/harvester/harvester.ts` — `complete(SYSTEM_PROMPT, [turn])`), so the
model cutting and reading a turn sees neither the question that drew it nor
the preceding turns. 073 put `Provenance.question` and `Provenance.context`
on every snippet — capture-side. No reading-side payload ever consumes them.
The 085 taxonomy's mode-5 exemplar ("values the confirmation of structural
support…", word-salad) is the same blindness on the imported corpus.

Build: inject the stored lineage into the model payloads that interpret
prose, using 074's typed-marker discipline (`<question>…</question>`,
`<context>…</context>`, `<snippet>…</snippet>` — the boundary stays textual
and greppable):

1. **Harvest chunks**: the per-turn payload carries the eliciting question
   (the agent turn preceding it) and the prior user turn's tail — the cut
   boundaries stay verbatim-substring-gated exactly as today (context
   informs the reading and the facet/stance, never widens what may be cut
   from OTHER turns).
2. **The clerk's reading/mint path**: wherever a snippet's prose is sent
   for reading or claim minting, its `provenance.question` and
   `provenance.context` ride along, typed-marked.

Invariant (073, unchanged): lineage is never corpus — the question/context
must be impossible to cite, cut, or quote into a claim's evidence; only the
snippet's own prose is citable. A test proves a cut proposal whose text
lies in the `<context>` block is rejected by the existing verbatim gate
against the turn.

Sequencing: `src/harvester/harvester.ts` may be touched by the running 058
dispatch — check `assignee`/fences before dispatch. Measurement discipline
(037): re-run the ratchet corpus before/after the harvest-payload change —
this changes what the model sees, so the parse-rate and facet numbers must
be re-measured, not assumed (078's ratchet now supports response_format;
per the map preference this measurement is ABOUT the clerk model and stays
on qwen).

Acceptance: the live example's shape becomes a fixture (question carrying
the referent, answer with a bare "it") and the reading names the referent;
085 mode-5 count re-measured on the next review pass; lineage-not-corpus
held by test; ratchet before/after recorded; suite green.
