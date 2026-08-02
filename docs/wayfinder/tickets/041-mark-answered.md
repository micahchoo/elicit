---
title: "Fix: queue entries are never marked answered (live gap)"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Found by the Clerk plan review (blocker B1), and it is a bug in the RUNNING
app, not only in the plan: `QueueStore.markAnswered` is defined
(`src/types.ts`, `src/queue/queue.ts`) and called by NOTHING. `queue.draw()`
sets an entry to `asked`; it then stays `asked` until `expire()` deletes it
at 30 days. Nothing records that the user actually answered the question the
entry opened.

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
