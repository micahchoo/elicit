---
title: "Fix: the 044 gate's own counter has never reached a line — and that is why it stayed inert"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: []
---

## Question

Found by the ticket-066 agent, in the same function it was fixing, and it is
the sharpest instance of this week's recurring failure because it is
**causal** rather than merely similar.

`src/server.ts#harvestDetail` still omits three `HarvestDiagnostics` fields:
`cutsSeen`, `inadmissibleDrops`, `contentFreeSkips`.

**`inadmissibleDrops` is the 044 admissibility gate's own count.**

Ticket 037 measured that gate against 295 hand-marked real cuts and found it
rejects **0 of 295** — not zero of the hard cases, zero of everything,
including all nine fragments. It was built against `"dunno"` and `"This
question makes no sense."`, which nine years of published prose does not
contain. It had been inert on real material since the day it shipped, with
every one of its tests passing.

**That inertness would have been legible from the first sitting if this
counter had ever reached a line.** `inadmissibleDrops=0`, every run, forever,
in plain sight. Instead it took a hand-marked 295-cut corpus and a dedicated
ticket to discover.

Same file, same function, same week, same shape — and this one is not an
analogy. The unsurfaced counter is *why* the inert gate survived.

### The work

- Add `cutsSeen`, `inadmissibleDrops` and `contentFreeSkips` to
  `harvestDetail` and give them a rendering in `src/log/format.ts`.
- Follow 066's three rules, which are now load-bearing:
  - **zeros render as English, not silence** — a check that renders as nothing
    at zero cannot be told from a check that is not running;
  - **absent is not zero** — a line written before the field existed must not
    be rendered as a measurement nobody made;
  - **keep the numbers**; the fallback renderer strips `key=value`, which is
    what made ticket 063 necessary.
- `inadmissibleDrops` deserves the most legible sentence of the three. It is
  the only number that says whether the gate is doing anything at all.

### Related, and worth doing in the same pass

**`EPISODE_ANCHOR` undercounts its own denominator.** In 066's live run, the
turn *"The first loaf I baked that was actually good came out the week my
father died"* scored `episodeAnchoredTurns=0`, because the regex requires a
calendar word. That is a dateable episode by any human reading.

So the shadow record for 037's episode fix measures it only on turns anchored
by **date**, never on turns anchored by **event**, and will systematically
report a smaller denominator than the phenomenon has. A fix that looks like it
holds may simply not have been asked about the harder half.

That lives in `src/harvester/harvester.ts`.

**Minor:** a cut that is both mid-sentence *and* badly labelled increments two
counters and produces one Bud, so the counters count reasons rather than buds.
066's sentence survives it; a reader summing them would over-count.

## Acceptance

- A harvest line names how many cuts were seen and how many the gate rejected.
- A gate rejecting nothing is visible in one line, without a special run.
- `EPISODE_ANCHOR` counts an event-anchored turn, with the "father died"
  sentence as a test case.
