---
title: "Fix: queue entries are never marked answered (live gap)"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

> ABSORBED 2026-08-02 into the Clerk plan as **T17 "The answered turn"**
> (Wave 1), which owns both `src/queue/queue.ts` and
> `src/elicitor/elicitor.ts` and whose verification asserts `markAnswered`
> has a caller at all. Kept open as the standalone record; close it when
> T17 lands, or execute it early if the Clerk slice slips — the bug is live
> today regardless of that slice.

## Question

Found by the Clerk plan review (blocker B1), and it is a bug in the RUNNING
app, not only in the plan: `QueueStore.markAnswered` is defined
(`src/types.ts`, `src/queue/queue.ts`) and called by NOTHING. `queue.draw()`
sets an entry to `asked`; it then stays `asked` for good, because `expire()`
skips every entry whose status is not `pending`. Nothing records that the user
actually answered the question the entry opened.

Consequences today: no uptake signal (Q-13's exposure control and Q-35's
shadow metrics have no input), still-true and opener entries look identical
whether they landed or were ignored, and the Activity Log cannot tell
"asked and answered" from "asked and abandoned".

Consequence for the Clerk slice: Q-30 stages 3-5 (confirm a contradiction
from the re-measure's answer) are unreachable in production — the test would
pass only by staging the state by hand, which is exactly the shared-oracle
failure the adversarial eval named (finding #2, learning #3).

Fix: when a turn answers the question a drawn queue entry opened, mark that
entry `answered` and record `answeredAt`. Owner must hold BOTH
`src/elicitor/elicitor.ts` and `src/queue/queue.ts`. Also record
`remeasureAskedAt` on candidates when the Clerk mints them (needed by the
Clerk slice). Related: `saveReading` persists no timestamp, so "readings
harvested since the question was asked" is not computable — either persist
`at` on readings or derive it from the ULID prefix; pick one and record it.

## Resolution (2026-08-02)

Closed by the Clerk plan's **T17**, committed in `5628693` (Wave 1).
`markAnswered` now writes `answeredAt` beside `status = 'answered'`
(`src/queue/queue.ts:309`), the field round-trips through `#write`/`#parseEntry`
as a string, and `src/elicitor/elicitor.ts` is its caller: `startSession` seeds
`openQueueEntryId` from a queue opener, `drawFallback` sets it on every
mid-session draw, and `userTurn` marks-and-clears before any branch.

Status and time are one fact — a horizon that reads `answered` with no date has
nothing to measure from.

**Residual, not blocking:** `src/server.ts` holds `SessionState` in an in-memory
`Map`, so the question↔entry pairing survives across requests but not across a
server restart mid-sitting; that entry stays `asked` for good. Same class as the
drawn-and-abandoned leak `expire()` already declines to touch.

## Resolution (2026-08-02)

Closed by the Clerk plan's **T17**, committed in `5628693` (Wave 1).
`markAnswered` now writes `answeredAt` beside `status = 'answered'`
(`src/queue/queue.ts:309`), the field round-trips through `#write`/`#parseEntry`
as a string, and `src/elicitor/elicitor.ts` is its caller: `startSession` seeds
`openQueueEntryId` from a queue opener, `drawFallback` sets it on every
mid-session draw, and `userTurn` marks-and-clears before any branch.

Status and time are one fact — a horizon that reads `answered` with no date has
nothing to measure from.

**Residual, not blocking:** `src/server.ts` holds `SessionState` in an in-memory
`Map`, so the question↔entry pairing survives across requests but not across a
server restart mid-sitting; that entry stays `asked` for good. Same class as the
drawn-and-abandoned leak `expire()` already declines to touch.

## Resolution (2026-08-02)

Closed by the Clerk plan's **T17**, committed in `5628693` (Wave 1).
`markAnswered` now writes `answeredAt` beside `status = 'answered'`
(`src/queue/queue.ts:309`), the field round-trips through `#write`/`#parseEntry`
as a string, and `src/elicitor/elicitor.ts` is its caller: `startSession` seeds
`openQueueEntryId` from a queue opener, `drawFallback` sets it on every
mid-session draw, and `userTurn` marks-and-clears before any branch.

Status and time are one fact — a horizon that reads `answered` with no date has
nothing to measure from.

**Residual, not blocking:** `src/server.ts` holds `SessionState` in an in-memory
`Map`, so the question↔entry pairing survives across requests but not across a
server restart mid-sitting; that entry stays `asked` for good. Same class as the
drawn-and-abandoned leak `expire()` already declines to touch.
