---
title: "Build: harvest runs behind the sitting — proposals land in a review queue, not a spinner"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 4)
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

## Resolution (2026-08-02)

Shipped live per Q-62: the queue is offer-only, so no gating was needed.

### Files touched

- `src/harvester/pending.ts` — new: the review queue on disk (`<vault>/harvest/pending/<sessionId>.json`), the 075 deferral pattern applied to the harvest seam. `writePendingHarvest`, `readPendingHarvest`, `listPendingHarvests` (newest first), `removePendingHarvest`; session ids gated against path traversal before any file read (the queue endpoints are unauthenticated like all /api routes).
- `src/server.ts` — `/end` and `/unprompted` now return `{ status: 'harvesting', sessionId }` and run `propose()` behind the response via `startBackgroundHarvest` (setImmediate, the `startDocket` shape). Finished runs write the record (parseMode `json`, including zero proposals) then emit `harvest-proposed`; an all-chunks-failed run emits `harvest-failed` and writes no record; a thrown run emits `harvest-failed` with `session=<id>` only. New `GET /api/harvest-queue` (summaries) and `GET /api/harvest-queue/:sessionId` (full record, 404 on missing or unsafe id). `/harvest` reads the disk record first with the in-memory Map as migration fallback, resolves channels and origin from the record (sitting `turnChannels` by sourceTurn; unprompted `unpromptedChannel`), and removes the record plus the Map entry after deciding.
- `src/registry.ts` — the four pending-store exports declared `live`.
- `src/log/format.ts` + `tests/log-format.test.ts` — sentences and samples for `harvest-started` and `harvest-failed` (harvest-failed reuses the parsed=false rendering; the throw case reads 'could not finish the harvest').
- `web/main.ts` + `web/style.css` — new `reviews` screen listing pending harvests (relative date, protocol, proposal count); clicking opens the existing review cards unchanged (decisions still POST `/harvest`). `renderMode` shows a quiet 'N harvests ready for review' count in the nav row when the queue is non-empty. The end-sitting button and the unprompted done button route to the reviews screen with a quiet 'harvest running' line and a 2s poll until the record lands (timer guarded by screen check, cleared on re-entry). The saturated turn branch now POSTs `/end` and routes to the queue instead of rendering a stale empty card — the sitting's harvest actually lands.
- `tests/e2e.test.ts`, `tests/unprompted.test.ts`, `tests/capture-channel.test.ts`, `tests/llm-roles.test.ts`, `tests/log-format.test.ts` — flow tests updated honestly: /end and /unprompted assert `{ status: 'harvesting', sessionId }`, and every proposals assertion waits on the queue via a `waitForProposals` GET poll. The gated-docket test waits for the record while the gate is open; the unreadable-vault test waits before flipping the vault. The log-format seam test polls the `harvest-proposed` line off the log. Capture-channel tests are the regression pin that the channel survives the disk round-trip.
- `tests/mechanism-registry.test.ts` — scanner fix, see below.
- `tests/harvest-queue.test.ts` — new: three tests (restart-proof list+decide with channel persistence across a fresh app instance; failed-vs-empty logging per the 034 rule; decided harvest leaves the queue and the disk).

### Mechanism

Background harvest behind the response; finished proposals persist to a claimable disk record; recovery from an unfinished harvest is a re-run from the transcript, never a resume (no record is written mid-run).

### Deliberate behavior changes

- `/end` and `/unprompted` response shapes changed from synchronous proposals to `{ status: 'harvesting', sessionId }` — the ticket's whole point.
- A saturated sitting now ends through `/end` and lands in the queue instead of showing the stale empty review card.
- `harvest-failed` is a new activity kind, distinct from `harvest-proposed` with `proposals=0` (ran-and-found-nothing is reviewable; did-not-run is logged as failure).
- `tests/mechanism-registry.test.ts` `templateExprSpans`: the scanner broke on backslash escapes inside strings (`'listening\u2026'`), desyncing it so every template after the STT section read as caller-less. The web slice's added lines shifted `sourceLabel`'s only call site past the derail point, surfacing it. Fixed by skipping the escaped character inside string skips (outer, `${}` body, and nested-template); the repo's own `\uXXXX` convention is now scanned correctly.

### Verification

- `npx tsc --noEmit` — clean.
- `npm test` — 59 files, 1389 passed, 2 skipped.
- `npx vite build` — clean.
- No git commit (per ticket instruction). The running T16 measurement server was not started, killed, or touched; no writes to `./vault`.

### Remainders

- The in-memory `sessionProposals` Map is kept as a migration fallback for a harvest proposed before this build; it can be removed once no pre-084 records matter.
- The reviews screen polls the queue while a just-ended harvest is missing; a failed harvest (harvest-failed) never lists, and the quiet line persists until the user leaves the screen — the activity log carries the failure reason.
