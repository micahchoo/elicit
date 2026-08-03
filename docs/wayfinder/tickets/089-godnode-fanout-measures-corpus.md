---
title: "Fix: lint.godNodeFanout measures corpus size, not fan-out"
labels: [wayfinder:task]
status: open
assignee: claude (omp wave 7)
blocked_by: []
---

## Question

From RESULTS §16.8. `lint.godNodeFanout=12` fires on every facet exceeding
12 claims — but facets are a closed vocabulary of eight, so every common
facet exceeds 12 on any real corpus. The shadow record measures corpus
size, not fan-out. Either scope the fanout to referents (where a god-node
is a real risk — T11's open question) or scale the threshold with corpus
size. Decide with the shadow record in hand; record the reasoning in the
threshold register (graduatesWhen).

Acceptance: the facet-fanout false-positive class is gone from the shadow
log on the 144-claim corpus; the register entry's reason updated; suite
green.
