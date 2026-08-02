---
title: "Fix: the activity feed's kind list claims to be complete and is not"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Found by the agent building ticket 061, which is the only reason it was found:
it went to add two event kinds and read the comment above the list.

`tests/log-format.test.ts:12` calls its list **"Every kind the codebase actually
emits"**. It is not. `facet-balance-shadow` and `facet-balance-applied` have
been emitted since ticket 042 and appear neither in that list nor in
`src/log/format.ts`'s `SENTENCES`. Ticket 061 added `queue-rung` and
`queue-floor`, which fall to the same fallback.

The fallback renders a kind by stripping its `key=value` fields, so
`queue-rung rung=2 relaxed=sharpness before=0 after=1` reaches the activity feed
as the words **"queue rung"** and nothing else. Every number the event carries —
which is the entire point of Q-55's logging requirement, and of ticket 042's
shadow record — is dropped on the floor between the log and the reader.

### Why this matters more than a formatting nit

Q-23 makes the Activity Log the mechanism by which background autonomy is
trustworthy: *"transparency is structural, not optional"*. Q-35 makes shadow
records the mechanism by which a threshold earns the right to act. Both depend
on a human being able to READ what was recorded. A shadow decision that renders
as two context-free words is logged and not legible, which satisfies neither.

Ticket 038 already fixed one version of this ("activity stream leaks ULIDs into
a reading surface"). This is the same class: the log is written for a reader and
rendered for nobody.

### The part that will keep happening

A test comment asserting completeness that nothing enforces is a claim that
decays silently. Three kinds have drifted past it already. Either the list is
derived from the emitters, or the comment stops claiming to be exhaustive — a
third option, where a human keeps them in sync by hand, is the one that has
already failed.

## Acceptance

- Every kind the codebase emits has a `SENTENCES` entry, verified by a test
  that DERIVES the emitted set rather than restating it — a grep over
  `appendEvent`/`serverEmit` call sites, or an exported constant the emitters
  must use.
- `queue-rung`, `queue-floor`, `facet-balance-shadow` and `facet-balance-applied`
  render with their numbers intact.
- Adding a new kind without a sentence fails a test, rather than degrading
  quietly to two words.
