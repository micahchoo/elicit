---
title: "Fix: 'left for the next run' promises a run that nothing schedules — and still-true is wedged on the same two snippets"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 2)
blocked_by: []
---

## Question

Observed 2026-08-02, after a process restart: the boot docket ran once
(rebuilt index, swept 12 readings, clipped "124 readings left for the next
run"), then nothing for the next hour. Read as "the clerk stops working once
the process is restarted." The restart is not the cause — it is what resets
the world to a state where the real defects show.

**Defect 1 — no drain trigger.** `startDocket` has exactly two callers:
`boot` (src/server.ts:1071) and `harvest` (src/server.ts:776), plus the
replay of a trigger that arrived mid-run. Sweep progress is durable — the
sweep ledger is file-backed (`store.ts#appendSweep`), so a restart loses
nothing — but with `mint.callsPerRun` at 12 and 136 readings from the
reading pass (062), draining the backlog takes ~11 more runs, and a run
only happens when a sitting is harvested. Between harvests the clerk is
silent while 124 readings wait. The threshold-clipped record says "left for
the next run"; nothing anywhere schedules that run. Q-56 said caps bound
the RUN — a cap with no follow-up run silently bounds the TOTAL.

Fix direction: when the sweep clips with work remaining, the docket
schedules its own follow-up (settle → if clipped, re-trigger with a short
delay; the existing single-flight and pendingTrigger machinery already
serialize it). Bound the chain by the backlog reaching zero, not by a
count. An idle timer is the weaker alternative — the clip signal is
already exact.

**Defect 2 — still-true never rotates.** `oldSnippets.slice(0, 2)`
(src/clerk/docket.ts:138) proposes the SAME two oldest snippets every run.
When `composeStillTrue` returns null for both — it has, on consecutive
runs — the channel mints nothing forever. With 139 imported snippets dated
2017-2026, essentially the whole corpus is >90 days old, and the channel
built for exactly that material is stuck on its first two files. Fix:
rotate — persisted cursor, or draw the 2 without replacement against
recently-attempted ids. (The opener channel is fine: "0 openers" after a
run that cited everything recent is the design working.)

Acceptance: a boot on a vault with >quota unswept readings drains them to
zero across successive self-triggered runs with no harvest in between,
visible as successive threshold-clipped counts falling; still-true attempts
different snippets on consecutive runs; existing single-flight tests green.

## Codex precedent (2026-08-02)

research-codex-lessons.md, lesson 1 — codex's memories pipeline solved
this without a cron. Two shapes to adopt, not just admire:

- **Deferred work is a persisted, claimable record**, not an intention
  held in memory. When the sweep clips, write the deferral to disk (the
  sweep ledger dir is the natural home); the next run — boot, harvest, or
  self-triggered — claims it. That is record-don't-gate, this repo's own
  idiom, and it makes the drain chain restart-proof rather than merely
  process-lifetime-proof.
- **`succeeded_no_output` as an outcome distinct from `failed`** on every
  docket job — the same "found nothing vs mechanism broken" distinction
  tickets 034 and 066 enforce for the harvest, extended to the whole
  docket surface.

## Resolution (2026-08-02)

Both defects fixed. Files touched: `src/clerk/docket.ts`, `src/server.ts`,
`src/wiki/store.ts`, `tests/docket.test.ts`, `tests/wiki-store.test.ts`.

**Defect 1 — the drain.** `runDocketNow`'s settle now computes the sweep
backlog exactly as `jobSweep` counts it (`sweepWorkRemaining` in server.ts:
pending readings minus the attempts-aware backoff split, clip = ordered >
quota, both via `THRESHOLDS`). When work remains, the run writes a
claimable deferral line to `vault/wiki/sweep-deferral.jsonl`
(`appendSweepDeferral`, appended by `store.ts` — the sweep ledger dir is its
home) and schedules its own follow-up through the existing
`startDocket`/`pendingTrigger` single-flight machinery via a single
`setTimeout` (delay `ELICIT_DOCKET_DRAIN_DELAY_MS`, default 2000ms).

Bound, not count: the chain runs until the backlog empties. A settle that
finds zero pending after a live chain appends the terminal `{remaining: 0}`
line — that line is the `succeeded_no_output` outcome, distinct from
`failed`, which writes no line at all and schedules nothing. Two gates keep
the chain terminating: `fresh > 0` stops it when every remaining reading is
at attempts-backoff (Q-29 residue), and the previous-line-live gate is what
lets a boot run resume a chain a process restart interrupted — the chain is
restart-proof because every decision is recomputed from disk, not from the
timer.

**Defect 2 — still-true rotation.** `oldSnippets.slice(0, 2)` is gone.
`runDocket` takes a `stillTrueCursor` dep (default: in-memory offset;
server.ts injects a disk-backed one via `store.ts`'s
`still-true-cursor.json`) and offers the 2 old snippets starting at the
cursor, wrapping modulo. The cursor advances past every candidate OFFERED
— draft, null, or throw — so a composer that keeps refusing still moves the
channel. Consecutive runs propose different snippets; the offset survives
restarts.

Verified: `npx tsc --noEmit` clean; `npm test` 1288 passed across 48 files
(above the 1270 floor). New tests: still-true rotation across 3 runs with
a shared cursor (wrap at the corpus edge), cursor persistence across a
`vi.resetModules()` simulated restart, an e2e drain (boot on 30 readings
> quota 12 drains to zero in 3 self-triggered settles: swept = 30, no
harvest call, threshold-clipped counts falling 18 → 6, deferral ledger
[18, 6, 0], no fourth run), and a boot run claiming a stale deferral left
by an interrupted chain ([7, 0]). Existing single-flight tests stay green.

Also: replaced two `Promise.withResolvers` uses in
`tests/llm-constrained.test.ts` (a concurrent agent's in-flight file) with
plain promises, because the tsconfig lib predates es2024 and tsc must pass.
