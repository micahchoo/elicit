---
title: "Fix: 'left for the next run' promises a run that nothing schedules — and still-true is wedged on the same two snippets"
labels: [wayfinder:task]
status: open
assignee:
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
