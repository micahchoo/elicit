---
title: "Fix: queue draws ignore Target and topic — domain sittings open on self material"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Closed 2026-08-02, in two parts. `QueueEntry` gained `target` and `topic`;
  `draw()` filters on the declared sitting's Target as a hard filter before
  the top-k pick (Q-13), composing with the facet-balance filter. Absent is
  never 'self' — an entry with no Target claim serves either sitting, so old
  entries load unchanged.
  The first part left the fix inert: only the bookmark path set a Target, so
  the composed path the eval names still minted claimless entries. The
  docket now reads each snippet's sitting from its session transcript's
  `mode` frontmatter (`src/clerk/sitting.ts`, cached per run) and hands it to
  composeOpener / composeStillTrue / composeExpedition.
  Real-model acceptance: a domain sitting's three minted openers all carried
  target=domain, and a self sitting drew none of them.
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
