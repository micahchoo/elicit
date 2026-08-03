---
title: "export the quote gate"
labels: [wayfinder:task]
status: open
assignee: claude (omp exec, composition)
blocked_by: []
---

## Question

`checkQuotesSource` is module-private in `src/clerk/composed.ts`. The
composition slice (ticket 010, Task 11) reimplements the same verbatim-quote
rule locally in `src/clerk/arrangements.ts`, because `composed.ts` is outside
the plan's ownership table and the plan refused to edit it. Two call sites now
each compose the same security-relevant check — a question the agent wrote
must set off the person's words verbatim (Q-12) — from the same shared span
helpers, and nothing keeps the two compositions from drifting apart. That is
exactly the drift Q-1 exists to prevent.

**Risk:** one path tightens or loosens the rule (minimum phrase length, the
set-off requirement, the adjacency reading) and the other keeps the old
behaviour, silently admitting or refusing questions the other path would not.

## Resolution target

Export `checkQuotesSource` (or a named equivalent — e.g. `questionQuotesSource`)
from `src/clerk/composed.ts`, and converge both call sites on it. The shared
helpers in `src/elicitor/guards.ts` (`setOffSpans`, `quotesFragmentSetOff`)
stay where they are; the composition of them is what moves. Files to touch
when it lands: `src/clerk/composed.ts`, `src/clerk/arrangements.ts`, and the
tests that pin each site's behaviour (`tests/composed.test.ts`,
`tests/clerk-arrangements.test.ts`).
