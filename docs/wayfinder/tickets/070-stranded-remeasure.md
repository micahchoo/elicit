---
title: "Fix: the sweep can strand its own re-measure, permanently and silently"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 1)
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

## Resolution (2026-08-02)

Chose option 1 — judge an answered re-measure **before** the sweep runs — with the
following reasoning:

**Why 1 over 2 (snapshot held-sittings at mint time).** Snapshotting `held` at
mint time is semantically fragile: Q-53's predicate reads the *current* cites of
both claims because the whole point is that a confirmation must come from a
sitting neither claim rests on. Freezing the window at mint time would let a
later run add a cite from a new sitting that then gets excluded from `held`
because it wasn't there at mint time — the exact loophole Q-53 exists to close,
just shifted to a different phase. Option 2 is not "the cheapest" when you
account for the invariant it weakens.

**Why 1 over 3 (exclude the re-measure's own reading from `held`).** Option 3
would require `confirmingReadings` to carry the candidate's
`remeasureQueueId` through to the filter and special-case it. That puts
confirmation logic in the wrong layer — `confirmingReadings` is a pure function
over the graph, and injecting candidate state breaks that. It also risks
re-admitting the lability-under-questioning loophole (Q-53 §rationale) if the
exclusion is not perfectly gated.

**Implementation.** Added `jobPresweepConfirmation`, structurally identical to
`jobConfirmation`, placed BEFORE `jobSweep` in `runWikiJobs` via `guard`.
The pre-sweep pass judges any `pending-remeasure` candidate whose queue entry is
`answered`, against the PRE-SWEEP graph — where the answer's cite is not yet on
any pole. Q-53 passes because the answer's sitting is genuinely distinct from
both claims' sittings. `jobConfirmation` (job 5) still runs after the sweep as a
safety net; it skips any candidate this pass already judged because the status
is no longer `pending-remeasure`.

The job order is unchanged for the rest of the run: the pre-sweep pass runs
first for answered re-measures only (normal candidates whose entry is still
`asked` are skipped), then the sweep, then everything else unchanged.

**Files changed:**
- `src/clerk/wiki-jobs.ts`: added `jobPresweepConfirmation` function and its
  `guard` call before `jobSweep` in `runWikiJobs`.
- `tests/e2e.test.ts`: characterization test flipped from asserting the defect
  (0 confirmations, 0 contradictions, stranded candidate) to asserting the
  corrected behavior (1 confirmation, 1 contradiction, candidate `confirmed`).

**Verified:** `npx tsc --noEmit` (clean), `npm test` (1257/1257 passed,
including the flipped characterization test).

**Q-53 intact.** The existing test at lines ~1555 — *"a re-measure answered
from inside one claim's sitting opens nothing"* — still passes. The answer's
own sitting is still refused by `confirmingReadings` when it genuinely overlaps
with a pole's original sitting. What changed is only that the answer's sitting
is no longer *falsely* held because the sweep absorbed the cite first.
