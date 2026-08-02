---
title: "Fix: queue draws ignore Target and topic — domain sittings open on self material"
labels: [wayfinder:task]
status: open
assignee: claude (in flight)
blocked_by: []
---

## Question

From `docs/eval-2026-08-02-personas.md` (Persona 3): a sitting declared
`target: domain, topic: sourdough bread baking` opened with a composed
question minted from unrelated self material, because `startSession()`
prefers a Queue draw over the topic-templated opener, and
`QueueStore.draw()` filters only on status, modeNeeds, sharpness and
horizon. `QueueEntry` has no `target` and no `topic` field at all.

Consequence beyond the test rig: once ANY composed entries exist, every
declared domain sitting can be hijacked by self-target material — which is
a direct, mechanical cause of the self-reflection bias measured in ticket
042 (25 construct, 0 episodes), and it defeats Q-19's whole workshop-and-
mirror correction.

Fix: `target` (and topic where known) travels on the QueueEntry from the
draft that minted it, and `draw()` filters on the declared sitting's target
— hard filter, before the top-k random pick (Q-13). A domain sitting draws
domain entries or falls through to the topic-templated opener; it never
serves self material. Pairs with ticket 042's facet-balance filter.
