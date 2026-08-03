---
title: "Plan and build: the Seeding slice"
labels: [wayfinder:task]
status: closed
assignee: claude (omp exec, seeding)
blocked_by: [013-grill-seeding]
---

## Question

writing-plans then omp execution for the grilled Seeding design.

> PLAN APPROVED 2026-08-02: `docs/superpowers/plans/2026-08-02-seeding-slice.md`
> — 15 tasks, 6 waves, four reviewer rounds (9+4+1 blocking resolved; one
> author disagreement upheld on evidence: the registry sweep demands no web/
> entries). Execution notes that must survive the wave boundary:
> (1) THE WAVE 3 GATE IS THE ONE THAT MATTERS — a full import driven only
> through the routes must leave `provenance.authorship` on a snippet on disk;
> every other authorship test injects `regionFor` directly and passes over a
> dead route. Never skip this gate.
> (2) Waves 3–5 are gated on 058 dispatch 2 (`src/import/commit.ts`, the
> `/api/import` routes, `web/import-entry.ts`/`import-review.ts` do not exist
> yet). Waves 0–2 are file-disjoint and may start earlier if sequencing
> allows. Gate check: `test -f src/import/commit.ts && grep -c "api/import"
> src/server.ts`.
> Execution order per the ruled sequence: after 058 → 010 → 012.

> PLAN APPROVED 2026-08-02: `docs/superpowers/plans/2026-08-02-seeding-slice.md`
> — 15 tasks, 6 waves, four reviewer rounds (9+4+1 blocking resolved; one
> author disagreement upheld on evidence: the registry sweep demands no web/
> entries). Execution notes that must survive the wave boundary:
> (1) THE WAVE 3 GATE IS THE ONE THAT MATTERS — a full import driven only
> through the routes must leave `provenance.authorship` on a snippet on disk;
> every other authorship test injects `regionFor` directly and passes over a
> dead route. Never skip this gate.
> (2) Waves 3–5 are gated on 058 dispatch 2 (`src/import/commit.ts`, the
> `/api/import` routes, `web/import-entry.ts`/`import-review.ts` do not exist
> yet). Waves 0–2 are file-disjoint and may start earlier if sequencing
> allows. Gate check: `test -f src/import/commit.ts && grep -c "api/import"
> src/server.ts`.
> Execution order per the ruled sequence: after 058 → 010 → 012.

> PLAN APPROVED 2026-08-02: `docs/superpowers/plans/2026-08-02-seeding-slice.md`
> — 15 tasks, 6 waves, four reviewer rounds (9+4+1 blocking resolved; one
> author disagreement upheld on evidence: the registry sweep demands no web/
> entries). Execution notes that must survive the wave boundary:
> (1) THE WAVE 3 GATE IS THE ONE THAT MATTERS — a full import driven only
> through the routes must leave `provenance.authorship` on a snippet on disk;
> every other authorship test injects `regionFor` directly and passes over a
> dead route. Never skip this gate.
> (2) Waves 3–5 are gated on 058 dispatch 2 (`src/import/commit.ts`, the
> `/api/import` routes, `web/import-entry.ts`/`import-review.ts` do not exist
> yet). Waves 0–2 are file-disjoint and may start earlier if sequencing
> allows. Gate check: `test -f src/import/commit.ts && grep -c "api/import"
> src/server.ts`.
> Execution order per the ruled sequence: after 058 → 010 → 012.

## Execution blocker (2026-08-03, session start)

**No task can run: the tree is mid-merge and the merge owns the plan's
foundation files.** Verified on disk before Wave 0:

- `MERGE_HEAD = 23bd81b3` — a merge of the verb-redesign branch into `main`
  is in progress and uncommitted.
- Unresolved conflicts: `UU src/queue/source-label.ts` (Task 1 must edit it;
  conflict markers were on disk during this session's first read), `UU
  web/main.ts` (Task 14 must edit it; 5 conflict markers still on disk).
- Staged as part of the merge: `src/types.ts` (Task 1), `src/server.ts`
  (Task 12), `web/style.css` (Tasks 13-14), `src/wiki/contract.ts`,
  `src/wiki/store.ts`, `tests/wiki-clash.test.ts`, the two verb plan docs,
  `tests/claim-verbs.test.ts`.
- The merge began AFTER initial reconnaissance (status went from 0 staged to
  10 staged + 2 conflicts between two checks minutes apart) — the tree is
  changing under the executor.

Consequences:
1. Per-task commits are impossible: `git commit` during a merge commits the
   merge, sweeping the person's half-resolved verb work into the task commit.
2. Task 1 is merge-owned: it must edit `src/queue/source-label.ts` (unmerged)
   and `src/types.ts` (staged merge side). Editing an unmerged file picks
   sides in the person's merge.
3. Every wave depends on Task 1, so no task is unaffected.

RESOLVED: the merge concluded at `5eb1caa` (verb-redesign, committed
2026-08-03 while this section was being written). It landed
`src/queue/source-label.ts` (+18), `web/main.ts` (+256), `src/types.ts` (+3,
the new `claim-challenged` queue source), `src/server.ts` (+31) and
`web/style.css` (+133) — every file this plan's Tasks 1, 12, 13 and 14 edit.
The executor re-verified all anchors against the merged content before
Wave 0 (recorded in the plan's checkboxes). Nothing was modified, staged or
committed by the executor during the merge; the only executor edit to the
tree is this section.

## Resolution (2026-08-03)

All 15 tasks across 6 waves landed, one commit per task (T1 `3c43dbc` …
T15 `750217d`), the wave-3 gate proven through the routes, and the closeout
gate green: `npx tsc --noEmit` clean, `npx vitest run` 104 files / 1877
passed / 3 skipped (baseline at claim: 94 files / 1772), `npm run build`
green. Plan checkboxes all ticked. A real-server smoke on a temp vault
(`ELICIT_LLM=fake`, port 4571) exercised survey → region → scan → reach →
decline against the running process; the server on :4517 was never touched.

### Per wave
- Wave 0: T1 the three types; T2 the region store (`slugFor` live at birth,
  `createRegionStore` unwired until T12).
- Wave 1: T3 dating + scan rework + the committed fixture (6 files,
  manifest); T4 survey (3 unwired entries); T5 still-true ages by
  written-when (parseable-date guard, `still-true-undateable`).
- Wave 2: T6 region-bounded store; T7 extraction clause + mechanical
  stance guard; T8 Link characterization (4 tests, no source change).
- Wave 3: T9 commit stamp (read off disk); T10 repair (Bud-per-dangler,
  ledger, `repair.liveCap`); T11 reach (path-segment terms); T12 the four
  routes + `?region=` + the three seams, eight registry entries flipped
  `live`, no `src/import/` entry left `unwired`.
- Wave 4: T13 the map + declaration (pure seams; no DOM env); T14 the
  offer line + `isReadPath` exact match for `/api/reach`.
- Wave 5: T15 the eleven acceptance tests over one undated vault run.

### The wave-3 gate (standing order 1)
A full import driven ONLY through the routes — declare, scan, docket,
next, decisions — leaves `provenance.authorship: 'other'` on the snippet on
disk, asserted in `tests/seeding-routes.test.ts` ('THE GATE'). The
extraction and commit seams (`regionFor` twice) and `runImportRepair` are
called from the server's actual `runDocketNow` and the decisions route;
`runImportJobsNow` passes `regionFor` and the gate test drives the docket
through `startDocket` → `runDocketNow` (no direct module call).

### Deviations (all recorded in the plan's checkboxes where they landed)
1. **Threshold conformance pin**: `tests/wiki-thresholds.test.ts` pins
   `THRESHOLDS` keys to the CLERK plan's table
   (`docs/superpowers/plans/2026-08-02-the-clerk.md`) — the seeding plan's
   own threshold rows are not read. T10/T11 therefore appended `repair.liveCap`
   and `reach.nameOverlapMinTerms` rows to that ledger (089/087 precedent).
2. **T3's `import-refused-by-rule` EMITTED sample** deferred to T12: the
   sweep forbids a sample for a kind with no emitter; the emitter is the
   region-wired scan route (T12), which emits it and carries the sample.
3. **T11 node terms are path segments only**: the landed `SurveyNode`
   carries no file names (the plan's T4 contract) and T12 forbids reach
   re-reading the folder — the plan's own test 1 resolves via folder names
   (`therapy-sessions`).
4. **T13 has no DOM environment**: pure seams (`mapLines`, `canSave`,
   `AUTHORSHIP_CHOICES`, `nextPath`, `declareFlow`) carry the 8 tests per
   the plan's Step 3 note; the declaration's rule feedback is
   post-declaration (no preview endpoint; the survey has no file names).
5. **T14 wires the survey route for POST** (`/api/import/survey` dual
   registration, 058's `/api/import/next` pattern) — the web `api()`
   helper POSTs paths outside its read list. `navTo`'s opts gained
   `folder` (the offer's survey root) so `reach it` can open the map at
   the region it named; the offer seams live in new `web/reach-line.ts`
   (main.ts touches the DOM at import).
6. **Landed-bug fix outside the plan's file list**: `composeStillTrue`
   rejected every imported snippet — `question.includes('')` is vacuously
   true when `provenance.question` is `''` (all imports) — so the Confirm
   licence could never serve seeded material (the entire point of Task 5).
   Fixed in `src/clerk/composed.ts` with a regression test
   (`tests/composed.test.ts`); without it the plan's acceptance criterion
   10 could not hold. Commit `0b7e67d`.
7. **T12's gate test** waits on the docket's settle signal re-checking the
   store (the drain splits 8 items over several runs; settle counting alone
   is racy), and the bounded-queue test gives region B distinct prose
   (identical copies dedupe by Q-59 content hash).
8. **web/style.css**: the person's parallel edits were committed in the
   verb-redesign merge before Wave 4; T13/T14 appended their rules at the
   end normally. The person's later `ia-redesign` and waiting-page commits
   (landed mid-execution) kept the `.reach-offer` line and the suite green.
9. **format.ts**: 058's foreign unstaged hunks were already committed, so
   standing rule 7's hunk-by-hunk staging was moot — each task's format.ts
   hunk was the only unstaged change and was staged whole.

### Remainders (human steps, named plainly)
- The plan's by-use browser runs (T13 Step 5, T14 Step 2: open the app,
  point it at the fixture, read the tree / the offer line on screen). The
  route-level behaviour they assert is covered by tests and the real-server
  smoke; the visual pass is Micah's.
- No real-model run was made (all model calls in the suite are scripted or
  fake); the clerk/elicitor role assignments (Q-48) are unchanged.
- The plan's Open Questions resolved by default remain: `machine-assisted`
  treated as non-authored (T7), question-text as the live Direction
  stand-in (T11), under-detecting mechanical dangler rule (T10).
