---
title: "Fix: WikiReport's measurements reach no surface — and T16's RESULTS depends on them"
labels: [wayfinder:task]
status: closed
assignee: claude
blocked_by: []
---

## Question

Found by T15 while proving the end-to-end flow. **This is the sixth inert thing
on this project**, and unlike the others it blocks a task that has not run yet.

`src/clerk/wiki-jobs.ts` fills every one of these on `WikiReport`:

`contradictionsOpened` · `remeasuresMinted` · `remeasuresExpired` ·
`candidatesDissolved` · `oppositionJudged` / `oppositionOpposed` · `stuck` ·
`pool` (size, per-channel, suppressed, reproposed)

`src/clerk/docket.ts:223` puts them on `DocketReport.wiki`. Then
`src/server.ts:370-393` reads `report.index`, `report.minted` and
`report.expired` — **and drops the rest.** A `grep -rn` shows every field above
is written in `wiki-jobs.ts` and read nowhere else in `src/`.

There is also **no `contradiction-opened` event kind anywhere in `src/`.**
Opening a Contradiction — the single most consequential thing the Clerk does —
writes two `claim-status-changed` lines and nothing that names the event.

### What this makes unobtainable

From T16's RESULTS Step 3 list, all of the following cannot be got from a real
run today:

- **the stage-1 precision record.** `oppositionJudged` / `oppositionOpposed` is
  the ratio Q-49 acts under. Q-49 ships the opposition gate LIVE on the argument
  that "the evidence Q-35 wants is collected while it acts". It is being
  collected and then discarded.
- the dissolution-reason ratio (which of the five outcomes, how often);
- re-measures minted and expired;
- contradictions opened;
- the stuck set — readings that have failed three times and sorted to the back;
- the pool instrumentation ticket 059 exists to add to, which turns out to be
  already computed and already thrown away.

Only `lastLint` survives, and only in memory.

### Why this one is worse than the other five

The other inert things were mechanisms that did nothing. This one is a
mechanism that works, produces exactly the evidence a locked decision promised
to collect, and drops it on the floor at the last hop. **Q-49's justification
for shipping live is that the record accrues while it acts.** That justification
is currently false, and nobody would discover it from a passing test.

### The work

- `harvestDetail`'s sibling for the docket: surface the wiki counters on the
  `docket-run` activity line, or a `wiki-run` line beside it.
- Follow ticket 066's three rules, which are now house style: **zeros render as
  English, absent is not zero, keep the numbers.**
- Add a **`contradiction-opened`** event kind with the two claim ids and the
  candidate. `tests/emitted-kinds.ts` will demand a sentence — that is 063's
  oracle working.
- Ticket **059** should be folded into this or closed as a duplicate: it asked
  for pool instrumentation that already exists and merely never surfaces.

## Acceptance

- A docket run that opens a Contradiction says so in one line a person can read.
- `oppositionJudged` / `oppositionOpposed` appear in the Activity Log, so Q-49's
  precision record accrues where Q-35 can read it.
- A run that judges nothing and a run that judges three and opposes none read
  differently.
- T16's RESULTS can be written from a real run without reading the source.

## Resolution (2026-08-02) — done in one session

Two new Activity Log events. Both render as human sentences; both carry their ids
in `refs` so the surface stays clean.

**`wiki-run`** — emitted at the end of every `runWikiJobs`, carrying all
`WikiReport` counters except pool (already on `clash-checked`): swept, applied,
rejected, unprocessed, oversized, stuck, oppositionJudged, oppositionOpposed,
remeasuresMinted, remeasuresExpired, contradictionsOpened,
candidatesDissolved. Zeros render as English; absent is not zero; the sentence
keeps every number. A zero run reads:

> swept 0 readings, applied 0 edits, rejected 0 updates; judged 0 pairs, none
> opposed; minted 0 re-measures, expired 0 re-measures; opened 0
> Contradictions, dissolved 0 candidates

**`contradiction-opened`** — emitted from `jobConfirmation` right after
`writeContradiction`, carrying the same `at` and `model` as the opened record.
The type (`synchronic`/`diachronic`) is in the detail; claim and candidate ids
are in `refs`. Renders as e.g. "opened a synchronic Contradiction".

Q-49's precision record (`oppositionJudged`/`oppositionOpposed`) now accrues on
the Activity Log where Q-35 can read it. T16's RESULTS can be written from a
real run without reading the source.

Ticket 059 was already closed as a duplicate of this one (T15 found the pool
instrumentation exists and is merely never surfaced).
