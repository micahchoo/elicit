---
title: "Grill: the degradation ladder — which constraint drops first when the pool empties"
labels: [wayfinder:grilling]
status: closed
assignee: micah
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

## Resolution (2026-08-02) — Q-55

The ticket asks for a drop order across five stacked filters. The design wants a
much shorter ladder than that, and the reason is at the FLOOR rather than the
top.

When `draw()` returns null (`src/queue/queue.ts:207`) the caller composes an
opener fresh, with full context — transcript, resonance, Mode — under Q-36's
freedom-in-generation. That is not a failure state. A question fitted to THIS
sitting is usually better than a banked agent-minted candidate from three weeks
ago that only fits because a filter was relaxed to let it through.

So the ladder is not choosing between a good outcome and a degraded one. It is
choosing between **stale-but-banked** and **fresh-but-unbanked**, and fresh
usually wins — which makes a five-rung cascade actively harmful. Every rung past
the first makes the system worse, not gracefully worse.

### The ladder

- **Rung 1 — drop facet balance.** Already shadow, and it is the system's
  inference about corpus shape rather than anything the person said. It already
  cannot empty the pool: line 207 returns before it runs, and that ordering is
  correct.
- **Rung 2 — re-admit excluded `user-declared` entries.** If sharpness or
  modeNeeds excluded an entry whose source is `user-declared` — the Q-20
  bookmark, "where should we pick up?" — admit it. The person asked for that
  question by name.
- **Floor — compose fresh.** Not a rung. The floor, and a good one.

### Never relaxed

`status` (asking an answered question is incoherent, not a trade-off), `Target`
(045 exists because one composed self entry hijacks a declared domain sitting),
and `modeNeeds`/`horizon` for agent-minted entries — there is no version of "the
pool is thin" that justifies a twenty-minute question in a ten-minute sitting
when composing is available.

**The principle, which is the values statement the ticket asked for:** the
system drops its own inferences before it drops the person's declarations, and
when it runs out of inferences to drop it composes rather than compromises.

Build: [The degradation ladder](061-build-degradation-ladder.md).

### Left open

Whether Rung 2 should apply in the NORMAL path rather than only on degradation —
re-admitting `user-declared` entries before the top-k pick, which is arguably
what Q-20 already meant by "outranking agent-minted candidates". The risk it
addresses: a bookmark can sit unasked for weeks while the elicitor improvises
around it. Deferred until the `queue-rung` log says how often Rung 2 fires.
