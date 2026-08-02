---
title: "Grill: the degradation ladder — which constraint drops first when the pool empties"
labels: [wayfinder:grilling]
status: open
assignee: 
blocked_by: []
---

## Question

From the 2026-08-02 HANDOFF review, and live in the code today.

Q-13 is constraints-then-chance: hard filters, then top-k uniform random,
never argmax. `QueueStore.draw()` now stacks status, modeNeeds, sharpness,
horizon and Target (045), with the Q-13 facet-balance filter behind it in
shadow (042). Stack five hard filters and the candidate set is sometimes
empty or singular — at which point "never argmax" is nominal and the behavior
is whatever the code happens to do. Today that behavior is `return null` and
the caller falls through to its own opener: defined, but not chosen, and not
logged.

The review's point is that the drop ORDER is a values statement. Which
constraint yields first says what the system is willing to be wrong about.
That belongs in the register with a Q-number, not in the sequence a function
happens to apply its filters in.

Grill: the ladder, each rung logged when it is used; whether a rung ever
drops below "one uniform-random pick from what is left"; and whether the
fall-through to a composed opener is a rung or the floor.
