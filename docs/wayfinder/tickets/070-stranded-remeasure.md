---
title: "Fix: the sweep can strand its own re-measure, permanently and silently"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Found by T15, reproduced, and characterized by a test that flips when it is
fixed (`tests/e2e.test.ts`, *"the sweep can strand its own re-measure (DEFECT,
characterized)"*).

**The order of jobs inside one docket run defeats Q-53.**

Job 1 sweeps the re-measure's answer into Claims before job 5 judges it. If the
op the model proposes is an `UPDATE` adding that answer's cite to either pole —
**which is the natural op for an answer about the very construct the pair is
about** — then job 5's held-sittings set

```
held = sittingsOfCites(a.cites) ∪ sittingsOfCites(b.cites)
```

grows to include the re-measure's *own* sitting. Q-53 then correctly refuses
the only reading that could ever confirm the pair, because it now appears to
come from a sitting one of the claims already rests on.

### Why it is permanent rather than a delay

Every recovery path is closed, and each for a good local reason:

- the queue entry reads `answered`, so `expire()` never touches it;
- job 4 skips the candidate because `remeasureQueueId` is set;
- `poolCandidates`' verdict refuses any pair at `pending-remeasure` (B9).

So the pair sits at `pending-remeasure` forever, having been answered, and
**nothing counts it**. This is the drawn-and-abandoned leak the Clerk plan
records under Open Questions — reached through a far more likely door, because
it needs no abandonment at all. It only needs the model to do the obvious thing.

### Shape of the fix, not yet decided

Three candidates, none obviously right:

1. **Judge before sweeping.** Move confirmation ahead of job 1 for candidates
   that already have an answered re-measure. Cleanest semantically — the
   confirmation is about the answer *as the person gave it*, before the wiki
   absorbs it — but it reorders a run whose isolation guarantees are load-bearing.
2. **Snapshot the held-sittings set when the re-measure is minted**, not when it
   is judged. `remeasureAskedAt` already establishes the precedent of freezing
   the window at mint time.
3. **Exclude the re-measure's own reading from the held set** by construction,
   since it is by definition the reading being judged.

(2) is probably right and cheapest. (3) risks re-admitting the confirmation
loophole Q-53 exists to close, and needs care.

### Related, and cheap to add whichever fix lands

Nothing anywhere counts a stranded candidate. A `WikiReport` field —
`candidatesStranded`, or a lint finding over candidates whose queue entry is
`answered` but whose status is still `pending-remeasure` — would make the class
visible even if this particular door is closed. See ticket 071: the report's
existing counters do not reach a surface either.

## Acceptance

- A re-measure answered with an `UPDATE` that cites the answer to a pole still
  opens the Contradiction.
- The characterization test in `tests/e2e.test.ts` flips, and its comment is
  rewritten to describe the fixed behaviour rather than the defect.
- Q-53 still refuses a confirmation from inside a pole's own *original* sitting
  — both directions, as T15 asserted them.
