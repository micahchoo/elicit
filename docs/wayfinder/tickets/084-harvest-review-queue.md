---
title: "Build: harvest runs behind the sitting — proposals land in a review queue, not a spinner"
labels: [wayfinder:task]
status: open
assignee:
blocked_by: []
---

## Question

Reported by Micah 2026-08-02: "harvesting currently takes up a lot of time,
it should be added to some sort of user queue for review when it is done."

The measurement agrees. `propose()` makes **one clerk `complete()` call per
user turn** (`src/harvester/harvester.ts:470`, counter comment at :362), and
T15 measured ~29s per clerk call. Both capture paths `await` the whole
harvest inside the HTTP handler before responding:

- `POST /api/session/:id/end` (`src/server.ts:852`) — a 10-turn sitting is
  ~5 minutes of spinner between "end sitting" and seeing the review cards.
- `POST /api/unprompted` (`src/server.ts:934`) — one call, but still ~30s
  blocking a paste.

A latent defect rides the same seam and this ticket fixes it for free:
`sessionProposals` is an **in-memory Map**. A process restart between `/end`
and `/harvest` loses the proposals — the user gets "no proposals — call
/end first" and their sitting's harvest evaporates. This is the restart
class ticket 075 just closed for the docket; the harvest side has it too.

## Design

Q-62 note: this queue is offer-only — it holds proposals for the user's
decision, decides nothing itself — so it ships live with logged evaluations.
The consequence of silence is unchanged (an unreviewed harvest mints
nothing, exactly as an unvisited review card does today).

1. **Fire-and-return.** `/end` and `/unprompted` respond immediately
   (`{status: 'harvesting', sessionId}`); `propose()` runs behind the
   response, same fire-and-forget shape as `startDocket('harvest')` already
   uses at `src/server.ts:903`.

2. **Proposals persist.** A finished harvest writes its proposals to disk
   (vault-adjacent, e.g. `vault/harvest/pending/<sessionId>.json`), the
   075 pattern: restart-proof, claimable. `/harvest` (decide) reads from
   disk, not the Map; deciding removes the record. An *unfinished* harvest
   needs no record — the transcript is already on disk, so a restart can
   re-run `propose()` from it (recovery is a re-run, not a resume).

3. **The review queue surface.** A list of harvests awaiting review:
   sitting date, protocol, proposal count. Opening one shows the existing
   harvest-review cards (`web/main.ts`) unchanged; decisions POST to the
   existing `/harvest` endpoint. The main surface shows a quiet count
   ("2 harvests ready for review") — a line the person reads on a surface
   they chose to open, never outbound contact (Q-22).

4. **Activity Log.** `harvest-started` when the background run begins;
   the existing `harvest-proposed` marks ready. A harvest whose every
   chunk failed logs as failed, distinct from proposed-zero (034 rule:
   ran-and-found-nothing is not did-not-run).

## Sequencing

The build runs through `src/server.ts`, `src/harvester/harvester.ts`, and
`web/main.ts` — the same files as ticket 048 (capture channel, itself
sequenced after 037's decide() shape) and the remaining bulk-import waves of
ticket 058. Do not dispatch while those hold the files. Natural slot:
alongside or immediately after 048, since both rework the capture paths.

## Acceptance

- `/end` returns in under a second regardless of turn count; the harvest
  completes behind it and its proposals appear in the queue.
- Kill the process after `/end` completes its background harvest, restart:
  the pending review is still listed and decidable (the 075 restart test,
  harvest-side).
- Kill the process mid-harvest, restart: the sitting's transcript still
  permits a re-run; nothing is silently lost.
- A decided harvest leaves the queue; an undecided one stays indefinitely
  (silence costs nothing).
- Existing single-harvest flow tests updated; suite green.
