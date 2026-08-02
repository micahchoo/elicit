---
title: "Fix: the harvest's five new diagnostics reach nobody"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

## Question

Ticket 037 added five diagnostic counters to the harvester and then said the
quiet part: `src/server.ts#harvestDetail` logs none of them.

- `episodeAnchoredTurns` / `episodeBlindTurns` — the shadow record for the
  episode fix, and the only way to know whether 6% → 30% holds on new prose or
  was a property of the twelve turns it was measured on.
- `fragmentBuds` — cuts lifted mid-sentence and routed to Buds instead of
  dropped.
- `outOfVocabularyLabels` — a facet or stance outside the union. This one was
  reaching **disk** before 037: `propose()` cast facet unchecked, so a stance
  value landed in the facet field and the Clerk would mint a Claim off it.
- `supersessionCorrections` / `unmarkedIntentions` — the structural overrides
  firing.

### Why this is not a logging chore

Two of these are **Q-35 shadow records**. A mechanism graduates on its record,
and a record nobody can read is not a record. 037's episode fix is exactly the
kind of change that should have to earn its place: it was measured on twelve
turns of one person's published writing, and whether it generalises is an open
empirical question that these counters answer — if anyone can see them.

This is the same shape as the finding in ticket 063 (26 event kinds rendering
as two context-free words) and the Wave-4 note in the Clerk plan (the wiki's
`LogFn` reaching nothing). Three separate mechanisms this week have produced
evidence that stops before the surface. That recurrence is the actual problem;
this ticket is one instance of it.

### The work

- Extend `harvestDetail` in `src/server.ts` to carry the five counters.
- Give each a sentence in `src/log/format.ts` — and note that ticket 063's
  derived oracle (`tests/emitted-kinds.ts`) will fail if a new kind arrives
  without one, so this is now enforced rather than remembered.
- Numbers must survive to the reader. The fallback renderer strips
  `key=value` fields, which is what made 063 necessary.

### Also outstanding from 037

`scripts/accept-044-047.ts:136` asserts REAL_MARKERS appear in **proposals**. A
mid-sentence cut now lands in **buds** instead, so that acceptance script needs
a live re-run and probably a changed assertion. It is a real-model script, so
running it costs model time — worth doing once, deliberately, rather than
leaving an acceptance that no longer describes the system.

## Acceptance

- A harvest run's activity line names all five counters with their values.
- `tests/emitted-kinds.ts` passes, and would fail if a counter arrived without
  a sentence.
- `scripts/accept-044-047.ts` passes against the real model, or its assertion is
  updated with a recorded reason.

## Resolution (2026-08-02) — commit `de74c3f`

All six counters reach the activity line, rendered as English clauses with the
numbers intact. Live, from the real model:

```
proposed 3 snippets and 3 buds; held 2 cuts lifted mid-sentence and 1 label
outside the vocabulary as buds; corrected 1 stance to superseded and found 2
cuts labelled intention with no want, plan or goal in the words; 1 turn named
when something happened, and 1 produced no episode cut
```

**Three rendering rules, all now load-bearing:**

- **Zeros render as English, not silence.** A check that renders as nothing at
  zero cannot be told from a check that is not running — which is exactly how
  the 044 gate stayed inert for a month with green tests.
- **"No dated turn" reads differently from "every dated turn caught."**
  Conflating them makes the shadow record unable to distinguish "the fix held"
  from "nothing tested it".
- **Absent is not zero.** A `harvest-proposed` line written before this change
  carries none of the fields, and `num()` reads absent as 0 — the renderer
  would otherwise have claimed a measurement nobody made, on every historical
  line.

### The defect found while re-running the acceptance

`scripts/accept-044-047.ts` handed `createApp` one `makeComplete()` — **the
ELICITOR, `bonsai-27b`** — while printing the clerk's model id beside it. So
ticket 044's acceptance ran the harvest on the model `src/llm.ts` records as
collapsing on long structured payloads, under a banner naming `qwen3.6:35b`.
Now wired with both roles and both printed; re-run live, ALL PASS.

**That compounds with 037.** The 044 gate rejected 0 of 295 real cuts, *and*
its acceptance was measuring a different model than it claimed. Two independent
reasons the same closure was not what it looked like.

The `:136` assertion was not wrong, only fragile, so it was **split rather than
relaxed**: material-not-destroyed (proposals ∪ buds) plus the original stronger
claim kept, with a per-marker landing report.

11 mutations, 11 caught — but only 3 of 5 on the first pass, because the seam
test had every counter at 1 and any swap was invisible. Rebuilt with a distinct
value per counter.

**Passed on:** see [the 044 gate's own counter](069-inadmissible-drops-unsurfaced.md).
