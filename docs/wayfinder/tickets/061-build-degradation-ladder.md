---
title: "Build: the degradation ladder — two rungs, a composing floor, every rung logged"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Q-55 fixed the ladder. This builds it in `QueueStore.draw()`
(`src/queue/queue.ts:163`), where five hard filters currently stack and an empty
pool silently `return null`s at line 207.

### What changes

1. **Rung 1 already exists structurally** — facet balance runs after line 207,
   so it can never empty the pool. Keep the ordering; add the log line.
2. **Rung 2 is new.** When the post-filter pool is empty, re-run the filter
   chain admitting entries whose `source === 'user-declared'` past the sharpness
   and modeNeeds filters only. `status`, `horizon` and `Target` still apply.
   If that pool is non-empty, top-k uniform-random over it exactly as the normal
   path does — chance still runs inside the constraints (Q-13).
3. **The floor stays `return null`.** The caller's composed opener is the
   correct outcome and needs no change. What it needs is to be *visible*: today
   the fall-through is "defined but not chosen, and not logged."

### Logging — the point of the ticket

One `queue-rung` event per rung actually used, carrying the relaxed constraint
and the pool size before and after. Plus one event when the floor is reached,
naming which filter emptied the pool — computable by re-running the chain and
recording the first step whose output was empty. Without that, "five filters
made the pool empty" stays a hypothesis, and Q-55's claim that a long cascade is
unnecessary has no evidence behind it either way.

This is the same observability lesson as tickets 036 and 059: a mechanism whose
non-firing is indistinguishable from its absence cannot be evaluated.

### Watch for

`draw()` is now nine steps and about to be eleven. The filter chain wants
extracting into a named list of `(name, predicate)` pairs so the ladder is data
rather than control flow — that is also what makes "which filter emptied the
pool" a two-line computation instead of a re-implementation. Do not add the
rungs as more inline `if` blocks.

## Acceptance

- A pool emptied only by the sharpness filter, holding one `user-declared`
  entry, draws that entry and emits one `queue-rung` event naming `sharpness`.
- The same pool holding only agent-minted entries draws nothing and emits a
  floor event naming `sharpness` as the emptying filter.
- A `user-declared` entry excluded by `Target` is NOT re-admitted.
- An `answered` entry is never drawn at any rung.
- Existing `draw()` tests pass unchanged — the normal path is untouched.
