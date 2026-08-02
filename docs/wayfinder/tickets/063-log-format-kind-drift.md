---
title: "Fix: the activity feed's kind list claims to be complete and is not"
labels: [wayfinder:task]
status: closed
assignee: claude
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

## Resolution (2026-08-02) — commit `c18a6f6`

The ticket named four unrendered kinds. **The derived oracle found 26**, out of
48 distinct kinds across 57 emit sites — including four that landed *while the
agent was working*, caught unprompted as red tests. That is the ticket
answering its own question about whether a hand-maintained list can hold.

**Enforcement is a sweep (`tests/emitted-kinds.ts`), not the compile-time
`EventKind` union — and that is availability, not preference.** A union only
enforces anything if every emitter imports it, and the emitters live in five
directories the agent was forbidden to edit. Recorded as the follow-up for
whoever holds them.

### The scanner's own blind spot, fixed rather than papered over

Found by the ticket-026 agent: the scanner tracked quote parity **without
skipping comments**, so a single apostrophe in a comment made an entire file
vanish from the sweep silently. That is this ticket's own failure — a false
completeness claim — reproduced inside the fix, and it would have been *more*
trusted than the comment was, because it looks derived.

`blank()` now erases comments, strings, templates and regex bodies. Two
independent guards stand behind the heuristic, because the heuristic can be
wrong and the guards cannot:

- **bracket balance per file**, which on first run caught four files nobody
  anticipated — all regex character classes containing an apostrophe
  (`src/elicitor/guards.ts` holds `/[\s>"''.,;:!?…—-]/u`). Same bug class,
  different costume.
- **per-file minimums**, so a file-wide collapse fails loudly instead of
  reporting success.

Both were proved to bite: re-introducing the bug produced five failures
including the verbatim `src/server.ts: 2 kinds, expected at least 8`; a planted
fake kind and a dynamic `kind: FAKE_KINDS[i]` produced three more, naming the
dynamic site as an unreadable hole. `src/log/format.ts` was confirmed
byte-identical afterward.

### What the sweep cannot see, stated rather than implied

1. Runtime-assembled kinds — reported as `unreadable` and failed, never dropped.
2. Two hops of indirection (one hop is followed).
3. Anything outside `src/`.
4. A `detail` more than six lines from its `kind` — the one residual silent
   hole; the floors catch a file-wide collapse, not a single missed site.
5. The regex-vs-division rule is a heuristic; bracket balance is what catches it
   going wrong.

### Passed on, not fixed here

- **The wiki's `LogFn` has no production wiring to `appendEvent`** — verified.
  Every `shadow-decision` and `threshold-clipped` currently reaches whatever the
  caller passes, and in production no caller exists. Q-35's graduation evidence
  and Q-56's clip records both depend on it. T12 has been told to make `log` a
  required dep and to assert the seam; T13/T14 must wire it.
- `shadow-decision`'s `would=` and `threshold-clipped`'s `clipped=` are written
  in field syntax and reach the reading surface verbatim — the last jargon left.
- `mint-parse-failed` carries `raw="<model output>"`, deliberately dropped from
  the rendering: raw model output on a reading surface is what ticket 038
  removed.
