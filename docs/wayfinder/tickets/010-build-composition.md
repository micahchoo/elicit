---
title: "Plan and build: the composition slice"
labels: [wayfinder:task]
status: open
assignee: claude (omp exec, composition)
blocked_by: [087]
---

> UNBLOCKED 2026-08-02: 009-grill-composition closed.

## Question

> SCOPE LOCKED 2026-08-02 by the composition grill (Q-37..Q-42). Build BOTH
> passes; user directed "both".
>
> PASS 1 (zero LLM, ships complete on its own): manual initiation from
> chosen snippets; ONE deterministic chronological Arrangement; reorder /
> remove / write-new-prose (becomes a Snippet with composition provenance,
> Q-40) / insert-Gap (mints exactly one queued question, Q-39); export to
> markdown with pinned snippet versions inlined; manual set-down (Q-41).
> Storage: markdown in the vault (Q-3), Arrangement = ordered list of
> snippet@version pins + Marginalia only, no agent prose, no titles (Q-1).
>
> PASS 2 (model): up to 3 candidate Arrangements under DISTINCT organizing
> principles — chronology / argument / contrast, never shuffles of one
> (Q-38); skeleton Marginalia naming the principle and each snippet's role;
> stale-pin lint (dimmed flag, NEVER auto-repins — Q-39); auto-set-down
> after dormancy, silent and logged.
>
> EXCLUDED from this ticket: agent-initiated Piece offers (Q-37) — licensed
> by citation-cluster density, which needs Claims. Lands with/after the
> Clerk slice (008).
>
> UI law: docs/interface-references.md document rule — the arrangement IS
> the draft, paragraphs reorder by dragging the paragraph itself (no cards,
> no handles), a Gap is a thin rule offering "ask me?", export is a margin
> word. See board `elicit-interface`, screen "A Piece".

> SCOPE LOCKED 2026-08-02 by the composition grill (Q-37..Q-42). Build BOTH
> passes; user directed "both".
>
> PASS 1 (zero LLM, ships complete on its own): manual initiation from
> chosen snippets; ONE deterministic chronological Arrangement; reorder /
> remove / write-new-prose (becomes a Snippet with composition provenance,
> Q-40) / insert-Gap (mints exactly one queued question, Q-39); export to
> markdown with pinned snippet versions inlined; manual set-down (Q-41).
> Storage: markdown in the vault (Q-3), Arrangement = ordered list of
> snippet@version pins + Marginalia only, no agent prose, no titles (Q-1).
>
> PASS 2 (model): up to 3 candidate Arrangements under DISTINCT organizing
> principles — chronology / argument / contrast, never shuffles of one
> (Q-38); skeleton Marginalia naming the principle and each snippet's role;
> stale-pin lint (dimmed flag, NEVER auto-repins — Q-39); auto-set-down
> after dormancy, silent and logged.
>
> EXCLUDED from this ticket: agent-initiated Piece offers (Q-37) — licensed
> by citation-cluster density, which needs Claims. Lands with/after the
> Clerk slice (008).
>
> UI law: docs/interface-references.md document rule — the arrangement IS
> the draft, paragraphs reorder by dragging the paragraph itself (no cards,
> no handles), a Gap is a thin rule offering "ask me?", export is a margin
> word. See board `elicit-interface`, screen "A Piece".

> SCOPE LOCKED 2026-08-02 by the composition grill (Q-37..Q-42). Build BOTH
> passes; user directed "both".
>
> PASS 1 (zero LLM, ships complete on its own): manual initiation from
> chosen snippets; ONE deterministic chronological Arrangement; reorder /
> remove / write-new-prose (becomes a Snippet with composition provenance,
> Q-40) / insert-Gap (mints exactly one queued question, Q-39); export to
> markdown with pinned snippet versions inlined; manual set-down (Q-41).
> Storage: markdown in the vault (Q-3), Arrangement = ordered list of
> snippet@version pins + Marginalia only, no agent prose, no titles (Q-1).
>
> PASS 2 (model): up to 3 candidate Arrangements under DISTINCT organizing
> principles — chronology / argument / contrast, never shuffles of one
> (Q-38); skeleton Marginalia naming the principle and each snippet's role;
> stale-pin lint (dimmed flag, NEVER auto-repins — Q-39); auto-set-down
> after dormancy, silent and logged.
>
> EXCLUDED from this ticket: agent-initiated Piece offers (Q-37) — licensed
> by citation-cluster density, which needs Claims. Lands with/after the
> Clerk slice (008).
>
> UI law: docs/interface-references.md document rule — the arrangement IS
> the draft, paragraphs reorder by dragging the paragraph itself (no cards,
> no handles), a Gap is a thin rule offering "ask me?", export is a margin
> word. See board `elicit-interface`, screen "A Piece".

writing-plans then omp execution for the grilled composition design. Slice hypothesis: stacked snippets plus visible gaps produce a finished piece the user recognizes as their own writing.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-composition-slice.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-composition-slice.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.

> PLAN APPROVED 2026-08-02: docs/superpowers/plans/2026-08-02-composition-slice.md — written and
> carried through adversarial reviewer rounds to approval. Execution authorized
> by Micah 2026-08-02, order 058 → 010 → 012, after the fix chain and the Clerk
> RESULTS run. Seeds DAG (sd create per task) still to materialise at dispatch.

## Resolution (2026-08-02)

**Status: OPEN — blocked on ticket 087.** Pass 1 (zero-LLM) landed complete and
verified green; pass 2's model half (T11, T12) landed; the pass-2 zero-LLM half
(T10) and the pass-2 acceptance e2e (T13) are BLOCKED: `src/wiki/thresholds.ts`
and `docs/superpowers/plans/2026-08-02-the-clerk.md` carry ticket 087's
uncommitted changes at every dispatch check (`git status`), and the dispatch
rule for this execution stops a task whose Files list includes a
foreign-dirty file. T10 stopped at dispatch (its Files list names
`src/wiki/thresholds.ts`); T13 is transitively blocked — its flow asserts the
stale-pin sweep and the dormancy auto-set-down that only T10's docket jobs
perform. T14 (real-model run + RESULTS) needs Micah, the real vault and a live
model, and the hard rules forbid writing `./vault`; it is a human remainder.
The ticket stays open until 087 lands and T10 + T13 + T14 complete.

**What landed per wave (commits on main):**

- Wave 0 — T1 (shared contract: `Provenance.kind += 'composition'`,
  `Provenance.piece?`/`gap?`, `QueueEntry.source += 'gap-declared'|'gap-fill'`,
  `QueueEntry.gap?`, `Turn.gap?`, `CutProposal.gap?`, `isUserDeclaredWeight` at
the draw sort and runChain rung 2, `gap` round-trip under guard, both source
labels, and the four-hop gap link end to end with the arrival test
`tests/gap-link.test.ts`) — 6410f38. T2 (`src/piece/contract.ts`: Principle /
Pin / Gap / ArrangementEntry / Marginalia / Arrangement / Piece / PieceStore
plus the five guards noProse, noTitle, pinsResolve, samePinSet,
distinctPrinciples) — 11ba5e05.
- Wave 1 — T3 (`src/piece/store.ts`, pieces as markdown under vault/pieces/,
empty bodies, set-down reversible, nothing deletes) — e52e0c9. T4
(`src/piece/arrange.ts`, `chronological()` dated by the sitting, deterministic)
— b60c82b. T5 (`src/piece/export.ts`, `toMarkdown()` — the person's words and
nothing else) — 1930fbe.
- Wave 2 — T6 (eleven piece routes in `src/server.ts`: POST /api/piece, GET
/api/pieces, GET /api/piece/:id, reorder, remove, prose (Q-40 composition
snippet with its own session), gap (Q-39 exactly-one-mint, idempotent on the
client-minted gap ULID), gap/accept (offer join on `provenance.gap`, 400
otherwise), set-down / pick-up, export; the `readVersion` pinned-version
resolver; eight pass-1 log kinds with format sentences + EMITTED samples;
ticket 081 filed) — d50528a. T7 (material + piece screens in `web/main.ts`/
`web/style.css`: the arrangement is the draft, drag-reorder on the paragraph,
the ask-me? gap seam, the trailing composer, set down / pick up / export margin
words; browser-verified live by the driver) — 219d7e4. T8 (pass-1 e2e in
`tests/piece-e2e.test.ts`, throwing Complete, zero model calls, disk-state
assertions) — 985dbd1.
- Wave 3 — T9 (`src/piece/stale.ts`, `stalePins()` add-only lint, zero-LLM)
— 05abe56; registry chore (stalePins declared unwired, honest debt with a name)
— 3c70694. **T10 BLOCKED at dispatch.**
- Wave 4 — T11 (`src/clerk/arrangements.ts`, `proposeArrangements()`: the one
CLERK model call, the eight-check boundary in code, model-stamped candidates
with fresh per-candidate entry ids, gap-cap via an injected bound, its own log
sink emitting arrangements-proposed / arrangement-rejected; ticket 082 filed)
— 5171c71. T12 (POST /api/piece/:id/arrangements + /choose with choose-time
gap-fill minting and set-down suppression, the `other orders?` margin word, the
principle switcher, the marginalia column; the arrangement-chosen log kind) —
9a9faa4. **T13 BLOCKED (transitive on T10).**
- Wave 5 — T14 not run; human + real-vault remainder.

**Deliberate behavior changes and recorded deviations:**

- The material screen orders snippets by `captured`, not by sitting date:
`/api/snippets` carries no sitting date and T7's fence forbade server changes.
The load-bearing Q-59 ordering happens in `chronological()` at pinning time,
which is correct. Presentational only; revisit when a sitting-date field
serves the chooser.
- `proposeArrangements` takes two optional params beyond the plan's listed
four: `log` (the module emits its own kinds — the emitted-kinds sweep fails a
sentence for a kind nothing emits, so T11 had to be the emitter) and
`modelName` (Q-34 stamp). `thresholds.gapsPerCandidate` arrives as a parameter
because the register entry is blocked; T12's route passes `{ gapsPerCandidate:
3 }` with a comment, to switch to `THRESHOLDS.piece.gapsPerCandidate` when T10
lands.
- T7's gap entry point is a trailing `ask me?` seam; a new gap lands at the end
and drag placement moves it. Existing gap rules are static (re-POSTing the
same gap id is an idempotent no-op).
- Plan checkboxes for T10 / T13 / T14 remain unticked in the plan file; all
completed tasks are ticked.

**Verification:** `npx tsc --noEmit` clean at every commit; full suite green at
HEAD — 75 files, 1613 passed, 3 skipped; `npx vite build` clean; pass-1 e2e
passes with a throwing Complete. The foreign canon.test.ts red that appeared
mid-run (087's contract.ts reindent) cleared when 087's in-flight edits
settled; it was never in a commit here.

**Remainders when 087 lands:** T10 (dormancy predicate, the two register
entries incl. the clerk-plan table rows, the two guarded docket jobs, the two
runDocket thunks, the through-createApp wiring test, the two log kinds), then
T13 (pass-2 e2e append + additive check), then T14 (real-model run + RESULTS
file naming a rejection rate).
