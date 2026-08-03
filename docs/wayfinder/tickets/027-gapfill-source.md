---
title: "Build: Gap-fill question source — Buds and half-Constructs mint questions"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 8)
blocked_by: [008-build-clerk]
---

## Question

CONTEXT.md calls Gap-fill "the default" question source: a Bud failure, a
half-Construct (pole without contrast), or an Arrangement Gap each back a
targeted question. Buds are saved with recorded failures TODAY, but nothing
ever mints their questions — Buds are currently a dead letter box. Audit
gap found 2026-08-01.

Build (docket job): sweep Buds → one question per recorded failure
(answering matures the Bud); sweep Constructs missing a contrast pole;
Arrangement Gaps arrive with the composition slice. Batched per Seeding's
Repair discipline — never a queue flood.

## Resolution (2026-08-02)

Built and closed. The Arrangement-Gap third of the source was verified on
disk first (server.ts `/api/piece/:id/choose` mints `source: 'gap-fill'`,
`license: 'arrangement-gap'` at gap-insertion) and NOT duplicated; this
ticket builds the other two: the Bud sweep and the half-Construct sweep,
as ONE zero-LLM docket job.

### What landed

- **`src/clerk/gap-fill.ts`** (new) — `runGapFillSweep`, the docket job.
  Zero-LLM by construction: the module never references or receives the
  model call (a source-grep test pins it). One `vault.rebuildIndex()` per
  run reads the three planes it needs: Buds, readings, snippets.
  - **Bud sweep** (dead-letter box first, oldest captured first): one
    question per recorded failure. Templates quote the fragment verbatim
    (Q-12) and never accuse (Q-15): `mid-sentence` → "this picks up
    mid-thought. What were you saying?"; `label` → "what kind of thing is
    this for you?"; `standalone` and any unknown literal → "what were you
    saying with this?". Entry shape mirrors the arrangement-gap path
    (`source: 'gap-fill'`, `questionForm: 'deliberative'`, `sharpness:
    'weak'`, `horizon: 'session'`) plus the new join keys `bud` and
    `failure`.
  - **Half-Construct sweep**: readings with `facet: 'construct'` are half
    a construct by CONTEXT's own definition (a pole without its contrast —
    the 2026-08-02 persona eval measured 0/6 construct-tagged cuts with a
    stated contrast pole, so there is no measured contrast-pole class to
    detect mechanically). One question per cited snippet — "what is the
    opposite of this for you?" — quoting the snippet's current prose
    verbatim, carrying the join key `snippet` and `cites
    [snippetId@version]`.
- **Dedupe — ever-minted, any status.** The queue is the single memory of
  what was offered (Q-39), keyed like `claim`/`gap`: a gap-fill entry with
  `bud`+`failure` (or `snippet`) already present in ANY state blocks the
  candidate. This deliberately differs from lint's stale-citation re-mint
  after expiry (jobLint's S8 shape): an expired question is the person
  declining to develop the Bud — dormancy is signal (Q-24/Q-41/Q-72), so
  the sweep never re-offers, and an answered question means the Bud
  matured. Three consecutive docket runs mint each question exactly once.
- **Batching — the cap.** `GAPFILL_MINT_CAP_PER_RUN = 3` (module-private
  const, ANNOTATION_RUN_CAP's precedent), combined across both sweeps.
  **Cap reasoning:** it is a BOUND, and Q-56 ships bounds live from day
  one — a shadowed cap writes "I would have stopped at 3" while the
  mechanism mints without limit, which is worse than no cap. The value is
  provisional, sized against the sibling run quotas (still-true mints 2
  per run, expedition 1 per run): three gap-fill questions per run stays
  comfortably inside a 10-20 question sitting, so the queue can never
  flood no matter how deep the dead-letter box is; the backlog drains
  oldest-first across runs. The scan continues past the cap so
  `gap-fill-clipped` reports the TRUE held-back backlog (the
  `threshold-clipped` shape), not a flag. It is a const, NOT a
  `THRESHOLDS` entry: the thresholds register is conformance-pinned to the
  clerk plan's ledger table, and 074's annotation cap set the precedent
  that a per-run quota with no tuning surface stays a named const.
- **Wiring — the production docket.** `runDocket` gains the optional
  structural dep `gapFillSweep` (job 9, before the wiki jobs, guarded:
  a throw logs `gap-fill-failed` and is one job's failure). The server
  passes the thunk at the ONE production call, `runDocketNow`
  (server.ts): `gapFillSweep: () => runGapFillSweep({ vault, queue,
  log })`. The through-createApp wiring test (below) proves the boot
  docket runs it — 012's deviation (c) is not repeated. `report.gapFill`
  carries `{ minted, budQuestions, constructQuestions }`.
- **No new source literal.** `'gap-fill'` already exists in the
  `QueueEntry.source` union (the composition slice landed it) and CONTEXT
  defines Gap-fill as "a Bud failure, half-Construct, or Arrangement Gap
  — the default"; the composition plan (2026-08-02-composition-slice.md)
  says the literals ARE the vocabulary, not a coinage. Adding a fourth
  literal would have split one CONTEXT source into two for no behavioral
  difference. The source-label comment was widened to name all three
  kinds; the label itself already reads "from your own words" (S3).
- **Expiry semantics** — consistent with the other clerk sources:
  `expire(30)` reaches these entries on the normal rule (pending,
  non-`user-declared`); an expired gap-fill entry is never re-minted
  (dormancy, above).
- **Registry/log** — `runGapFillSweep` declared live in
  `src/registry.ts`; three log kinds with sentences and EMITTED samples:
  `gap-fill-minted` ("minted N gap-fill questions into the queue"),
  `gap-fill-clipped` ("enforced the gap-fill cap at N and clipped: M"),
  `gap-fill-failed` ("could not run the gap-fill sweep").

### Tests

- `tests/gap-fill.test.ts` (new, 14 tests, real vault + real queue store):
  per-failure minting with verbatim-quote assertions, disk round-trip of
  the join keys, three-run dedupe, ever-minted blocking for
  asked/expired/answered, multi-failure Buds, mixed held/new Buds,
  half-Construct mint + fact-facet silence, one-question-per-snippet for
  two construct readings, missing-snippet skip, the cap across runs
  (including `clipped=2` for a 5-Bud backlog — the true-cut count), log
  details, empty vault, and the zero-LLM source-grep.
- `tests/gap-fill-wiring.test.ts` (new, 2 tests): the SEEDED-BEFORE-
  createApp boot run IS the run under test (010 T10's shape) — a Bud and
  a construct reading in the vault produce exactly the two gap-fill
  entries and a `gap-fill-minted` event after the production boot docket;
  a second createApp over the same root mints nothing new. This is the
  012-deviation-(c) gate.
- `tests/docket.test.ts` — the injected thunk is called once and reported;
  a throwing thunk logs `gap-fill-failed` and does not fail the run.
- `tests/log-format.test.ts` — three EMITTED samples.
- **Regression owned:** `tests/e2e.test.ts`'s clerk-slice fixture seeded
  its sittings with `facet: 'construct'` readings — which ARE
  half-Constructs, so the new sweep legitimately minted contrast
  questions and the scripted sittings drew them instead of the re-measure
  (7 failures). The fixture's readings now seed `facet: 'fact'` with a
  comment: the pipeline under test (claim → candidate → re-measure →
  confirmation) does not care what facet the seed carries, and the
  scripted router cannot absorb an extra draw. The sweep's behavior is
  the correct one; the fixture was the accident.

### Remainder — Bud maturation on answer

The answer path that matures a Bud IS the ordinary answer flow: any answer
to the open queue entry marks it `answered` (`src/elicitor/elicitor.ts`,
ticket 041) and the harvest review turns the prose into Snippets — the
Bud's question reaching `answered` is what blocks any re-offer. What does
NOT exist is a Bud-lifecycle surface: no "matured" marker on the Bud file,
no link from the answer-Snippet back to the Bud it matured, no Bud list
anywhere. Wiring that would require new vault write surface and new UI,
which the ticket forbade inventing — recorded here as the remainder. A
later ticket that wants Buds visible (the ideal-state board's "held, and
later minted" line is the only promise) starts there.

### Files touched

`src/clerk/gap-fill.ts` (new), `src/types.ts`, `src/queue/queue.ts`,
`src/queue/source-label.ts`, `src/clerk/docket.ts`, `src/server.ts`,
`src/registry.ts`, `src/log/format.ts`, `tests/gap-fill.test.ts` (new),
`tests/gap-fill-wiring.test.ts` (new), `tests/docket.test.ts`,
`tests/log-format.test.ts`, `tests/e2e.test.ts` (the fixture regression).
No git commit; the working tree carries everything plus the person's own
parallel edits (README.md, docs/interface-references.md, web/style.css,
data/annotations/, docs/superpowers/plans/2026-08-02-verb-grammar-collisions.md),
which were not touched.

### Verification

- `npx tsc --noEmit`: clean.
- `npm test`: 93 files, 1768 passed, 3 skipped (pre-existing skips).
- `npx vite build`: ok.
