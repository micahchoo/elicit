---
title: "Fix: the harvest's five new diagnostics reach nobody"
labels: [wayfinder:task]
status: open
assignee: 
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
