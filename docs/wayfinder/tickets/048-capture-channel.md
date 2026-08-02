---
title: "Build: record the capture channel on every Snippet"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review, and the honest completion of ticket 046.

046 made CONTEXT.md and the README say the true thing: Sole Authorship
guarantees that no agent wrote or reworded your words, and does NOT guarantee
you are the author. Pasted text is indistinguishable from reflection.

The review's observation is that this is only true AFTER capture. Typed,
spoken and pasted are all distinguishable the moment they arrive — the
transcript Turn already carries `spoken` for voice — and the distinction is
lost forever one tick later. One field added now stops the corpus quietly
filling with other people's sentences.

Build: `Provenance.channel: 'typed' | 'spoken' | 'pasted'`, set at capture on
every path (turn, unprompted, restatement). The client knows a paste from a
keystroke; the server cannot infer it, so it must be sent. Absent stays absent
for every snippet already on disk — this is evidence, not a gate, and nothing
filters on it until a later decision says it should.
