---
title: "Plan and build: the Soundings slice"
labels: [wayfinder:task]
status: open
assignee: claude (omp exec, soundings)
blocked_by: []
---

> UNBLOCKED 2026-08-02: 011-grill-soundings closed.

## Question

> SCOPE LOCKED 2026-08-02 by the Soundings grill (Q-43..Q-47). Build:
> licensed proposal + explicit consent to enter (late in sitting, energy
> mode, 3+ turns on one construct; one offer per sitting, decline recorded
> and never re-asked); rung chaining where each answer becomes the next
> question's foothold; ALWAYS-PRESENT gate (continue / park, depth kept /
> another day) on every rung plus a mechanical halfway checkpoint — NO
> model-inferred distress anywhere; park writes the full ladder to the
> vault and the Queue holds it, resume composes fresh from a COMPACTED
> view (last 1-2 rungs verbatim + Cover-style one-line summary of the
> rest; summaries are Marginalia-class); structural end conditions only
> (rung cap, or convergence detected in code via the lexical echo
> machinery / the existing pivot heuristic); budget: entering converts the
> remaining budget into the rung allowance, capped 8-12, with the two
> close moves reserved beyond it. Tell the user the expected length when
> asking for consent.

> NOT DISPATCHED 2026-08-02, and the reason is scope rather than doubt. The
> ALWAYS-PRESENT gate (Q-44) is a control on every rung, so this slice cannot
> land without `web/main.ts`, which T19 (the wiki reading surface) holds. A
> gate built server-side with no surface to press is inert by construction —
> the failure mode this project has hit five times. Dispatch when T19 lands.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-soundings-slice.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-soundings-slice.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-soundings-slice.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.


## Resolution (2026-08-03)

Executed under docs/superpowers/plans/2026-08-02-soundings-slice.md, waves 1-3 complete, one task remaining.

### Wave 1 — foundations (commits 5d70907, dd28673, 30133e7, dbdad1d, 14501a9, 9986392)
- T1 types: `Rung`, `GateChoice`, `SoundingEnd`, `GateReading`, `SoundingState`, `ParkedLadder`; `QueueEntry.source` + `'parked-sounding'`; `QueueEntry.soundingId?`; `SessionState.sounding?` / `soundingOffer?` / `finishedSounding?`. **Deviation:** T1's first commit dropped the three SessionState fields (replacement bug); fixed in dd28673. Also added the `'parked-sounding'` label to `src/queue/source-label.ts` — the Record keyed by the source union fails to compile without it (types.ts's own obligation), a necessary exception to the plan's "touches no other file".
- T2 license: `licenseSounding` + `contentWordsOf`/`jaccard` wrappers in lexical.ts. Ships LIVE per Q-62 (offer-shaped); `SUSTAINED_THRESHOLD = 0.15` is a plain named constant (data, not swept) — the user's "thresholds arrive shadowed" rule is Q-35's general form, overridden here by the plan's Q-62 ruling, cited in the plan.
- T3 budget (`rungAllowance`/`expectedLengthSentence`), T4 convergence (`descentEnd`), T5 spike (six seams re-verified; plan-time anchors had all moved — recorded as an author row in the plan's Shape Changes).
- Wave gate: 83 files / 1689 passed, tsc clean.

### Wave 2 — the descent and its gate (commits f1351b4, 9035a52, 753f3af, f424903, plus 1a4f228/bd5b79c/dcd9ca3 fake-responder work and e79e1fb)
- T6 ladder: `enterSounding`/`addRung`/`gateStateFor`/`applyGate`; `composeRung` in src/clerk/sounding-rung.ts; the descent branch in `userTurn` after the close branches; `closeDescent` handoff via `finishedSounding`. The plan's expected tsc break (turn route un-handled `checkpoint`) landed and was fixed by T8. T6 also flipped `rungAllowance` to live (the registry ratchet caught `enterSounding` calling it).
- T7 park: ladder markdown round-trip, queue pointer, non-relaxable `sounding` draw filter.
- T8 routes: offer/consent/gate routes + resume shell (501/TODO(T12)); eight log kinds with format cases in the same commit; the shared `finishedSounding` block; the turn route handles `checkpoint`.
- T9 gate UI: offer control, gate row (continue as reading on ordinary rungs), checkpoint block, close from both directions, `.parked-*` classes for T12.
- **The hand walk (plan Step 6 / wave-2 gate) surfaced and fixed three real seams:** (1) the fake responder returned empty red lights, so the descent could not start under `ELICIT_LLM=fake` — the plan's Step-6 drive assumed otherwise; the fake now serves whole-answer phrases with eight second-person frames and a last-half on re-composition, shaped by the near-duplicate guard (commits 1a4f228/bd5b79c/dcd9ca3). (2) The queue store dropped `soundingId` on disk — a parked pointer was a dead entry after any `list()` re-read; persisted in `src/queue/queue.ts` with round-trip tests (e79e1fb). (3) The gate-route `continue` response still reports `checkpoint: true` (the interrupted rung is not yet recorded), which re-locked the textarea and deadlocked the exchange; `pressGate` now lifts the block on any gate-route probe (35b5a20).
- Wave-2 gate verified by hand in a real browser (scratch instance, temp vault): decline once-never-again; accept → three words on every rung; checkpoint at rung 4 blocks; park writes the ladder + pointer and closes door-then-bookmark; a descent answers to its cap with no exit word ever pressed (endedBy: cap; every rung's foothold a verbatim substring of the preceding answer on disk).

### Wave 3 — park, resume, and the background line (commits a9843ce, 39842ba, 2cadf83, 82fd367, ccafa29, d15c88b)
- T10 compaction, T11 ladder summary (clerk model, Marginalia, idempotent job in the docket), T12 resume (module + `composeFromCompacted` + route body + waiting-surface parked section), T13 the two end-to-end walks (cap with no exit word; parked and picked up across sittings with the docket-written summary asserted).
- **Deviations:** (a) T11 added a second log kind `soundings-summary-failed` beyond the plan's kinds table — the guarded docket job must log its throw and the bidirectional kind sweep forces every emitted kind to render (house pattern: wiki-jobs-failed). (b) The plan's UI contract "how many rungs are kept" had no wire source inside the ownership map — GET /api/queue now enriches parked-sounding entries with `rungsKept` via readLadder (read-only map; no other handler touched). (c) T11's job was wired into `runDocket`'s deps but the server never passed it — the production docket silently skipped ladder summaries until the server-side wiring landed (82fd367). (d) `composeFromCompacted` appends the context block to the last kept answer before delegating to `composeRung`; `addRung`'s backwards check is the loud guard against context-quoting drift.

### Verification (final commit)
`npx tsc --noEmit` clean; `npm test` 180 files / 3480 passed / 6 skipped; `npx vite build` OK. One commit per task, each staging only its own files; `tools/claim-review/server.log` never staged. Foreign working-tree edits (README.md, docs/interface-references.md, web/style.css, data/annotations/, docs/superpowers/plans/2026-08-02-verb-grammar-collisions.md) left untouched as the person's parallel work.

### Remainder — T14, the shadow walk
The plan's Wave 4 is a real-model human step: five sittings driven against the local elicitor model (bonsai-27b) reading the descent's wording as a person. Not runnable as an automated step; the ticket stays **open** until the walk is done and its five findings are recorded in the plan's Shape Changes. Wording fixes from the walk are in scope as follow-ups; mechanism changes would return to a grill.
