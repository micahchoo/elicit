---
title: "Fix: a quoted pole must be a complete clause — mechanical, on the fragment"
labels: [wayfinder:task]
status: open
assignee: claude (omp wave 5)
blocked_by: []
---

## Question

From RESULTS §16.5. The one re-measure minted in the T16 run quoted
`worked on making` — an exact substring that passes Q-46's verbatim check
and is not a proposition. Q-46 stays (the alternative is model self-report,
which is worse). The corrective is narrower: the quoted pole in a
re-measure/juxtaposition must be a complete clause — a mechanical check on
the fragment (finite verb + subject reachable, or the existing sentence
segmenter's boundary test), not a judgment about it.

Acceptance: the composeRemeasure path rejects a non-clause fragment and
falls back to a longer enclosing span (verbatim rule intact); the T16 case
(`worked on making`) is a fixture that now produces a clause; suite green.
