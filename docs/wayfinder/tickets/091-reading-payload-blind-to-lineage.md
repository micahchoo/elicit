---
title: "Fix: the harvester reads each turn bare — the stored question and context never enter the payload"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 6)
blocked_by: []
---

## Question

Caught live by Micah mid-sitting, 2026-08-02, minutes after the 085 review
coded it as mode 5 ("reading misses the surrounding truth", 4 of 20 notes):

> Q: "What does it mean to be alive to each other?"
> A: "I think it means to be responsive to each other in the ways that they live."
> Reading: "The user asserts that mutual responsiveness in daily life
> constitutes the core meaning of **something**."

The "something" is "being alive to each other" — present in the eliciting
question, absent from the reading. Micah's words: "the surrounding context
is not being considered by the harvester."

Mechanism: `propose()` sends ONE turn per model call
(`src/harvester/harvester.ts` — `complete(SYSTEM_PROMPT, [turn])`), so the
model cutting and reading a turn sees neither the question that drew it nor
the preceding turns. 073 put `Provenance.question` and `Provenance.context`
on every snippet — capture-side. No reading-side payload ever consumes them.
The 085 taxonomy's mode-5 exemplar ("values the confirmation of structural
support…", word-salad) is the same blindness on the imported corpus.

Build: inject the stored lineage into the model payloads that interpret
prose, using 074's typed-marker discipline (`<question>…</question>`,
`<context>…</context>`, `<snippet>…</snippet>` — the boundary stays textual
and greppable):

1. **Harvest chunks**: the per-turn payload carries the eliciting question
   (the agent turn preceding it) and the prior user turn's tail — the cut
   boundaries stay verbatim-substring-gated exactly as today (context
   informs the reading and the facet/stance, never widens what may be cut
   from OTHER turns).
2. **The clerk's reading/mint path**: wherever a snippet's prose is sent
   for reading or claim minting, its `provenance.question` and
   `provenance.context` ride along, typed-marked.

Invariant (073, unchanged): lineage is never corpus — the question/context
must be impossible to cite, cut, or quote into a claim's evidence; only the
snippet's own prose is citable. A test proves a cut proposal whose text
lies in the `<context>` block is rejected by the existing verbatim gate
against the turn.

Sequencing: `src/harvester/harvester.ts` may be touched by the running 058
dispatch — check `assignee`/fences before dispatch. Measurement discipline
(037): re-run the ratchet corpus before/after the harvest-payload change —
this changes what the model sees, so the parse-rate and facet numbers must
be re-measured, not assumed (078's ratchet now supports response_format;
per the map preference this measurement is ABOUT the clerk model and stays
on qwen).

Acceptance: the live example's shape becomes a fixture (question carrying
the referent, answer with a bare "it") and the reading names the referent;
085 mode-5 count re-measured on the next review pass; lineage-not-corpus
held by test; ratchet before/after recorded; suite green.

## Resolution (2026-08-02)

Built by Claude (omp wave 6). The 058 dispatch had closed before this
session (git log: "import: dispatch 2 execution log — T6-T13 committed,
ticket 058 closed"), so `src/harvester/harvester.ts` was free to touch.

### What was built

**Harvester** (`src/harvester/harvester.ts`):
- `buildHarvestPayload(turn, probe, priorTail)` — the per-chunk payload now
  wraps the turn in `<snippet>…</snippet>` (the only cuttable block), with
  the eliciting probe in `<question>…</question>` and the prior user turn's
  tail in `<context>…</context>` when they exist (074's typed-marker
  discipline). A turn with no antecedent sends only its `<snippet>` block.
- `tailSentences(text, n)` — the prior turn's tail is its last up-to-two
  sentences, the same window the capture side stamps as
  `Provenance.context` (073). The sentence splitter was factored out of
  `extractContext` into `splitSentences` so both windows share one rule.
- `propose()` computes probe and prior tail before the model call and reuses
  the probe at the proposal site. The verbatim gate is untouched: it still
  checks `turn.text.includes(cut.text)`, so a cut lifted from either lineage
  block fails by construction.
- `SYSTEM_PROMPT` — describes the block structure and rules "Cut ONLY from
  the <snippet> block"; the fabricate line names the `<snippet>` block as
  the only source.

**Clerk mint** (`src/clerk/mint.ts`):
- `snippetPart()` — each cited snippet now carries its
  `provenance.question` and `provenance.context`, typed-marked, with the
  prose inside `<snippet>…</snippet>`. Lineage precedes the prose so a
  floor-cut loses prose tail, never the markers. Unprompted snippets (empty
  question, no context) ride without lineage blocks.
- `snippetFloor()` — the part floor is fixed overhead + `SNIPPET_FLOOR`, so
  a truncated snippet stays a closed block and lineage survives budget
  pressure.
- `SYSTEM_PROMPT` — new rule: `<question>`/`<context>` are lineage, never
  evidence; never quote, cite, or echo them into a body or range.

**Invariant (073, unchanged) — how it is now held:**
- The structural scan (`tests/invariant-context.test.ts`) keeps all sixteen
  other clerk/wiki/index files banned from reading `provenance.context`.
  mint.ts leaves the banned list (091 sanctions its payload read) and gains
  a marker-bound check: every provenance lineage access in mint.ts must sit
  on a `<question>`/`<context>` marker line.
- Harvest verbatim gate: a cut whose text lies in the `<context>` or
  `<question>` block is rejected as fabrication (the two LINEAGE-NOT-CORPUS
  tests).
- Mint cite resolution: a cite naming the question text resolves to no
  written snippet version and the op dies whole.

### Tests

- `tests/harvester.test.ts` — the live example as a fixture (question
  carries the referent, answer uses a bare "it", the reading names the
  referent); prior-turn tail as `<context>`; no-probe turn sends only
  `<snippet>`; two LINEAGE-NOT-CORPUS rejection tests; the referent-naming
  reading survives propose → decide → vault.
- `tests/harvest-chunked.test.ts` — per-chunk payload-shape assertions; the
  scripted completer decodes the `<snippet>` block.
- `tests/clerk-mint.test.ts` — lineage typed-marked in the payload;
  floor-cut keeps lineage; unprompted snippet rides bare; prompt names
  lineage; a question-text cite is rejected; truncation test adjusted for
  the lineage overhead.
- `tests/invariant-context.test.ts` — re-scoped as above.

### Ratchet measurement (037) — qwen3.6:35b @ http://192.168.0.229:11434/v1, `--constrained`

Identical command for both runs:

```
npx tsx scripts/ratchet/run.ts --mode harvest --role clerk --constrained --timeout 600
```

| metric | before | after |
|---|---|---|
| totalCuts | 47 | 43 |
| fabricationRate | 0 | 0 |
| meanProposalCount | 15.67 | 13.0 |
| parseRate | 1.0 | 1.0 |
| parseModes | json ×3 | json ×3 |
| erroredExchanges | 0 | 0 |
| facet fact | 10 | 2 |
| facet general-event | 6 | 8 |
| facet causal-theory | 7 | 4 |
| facet episode | 6 | 8 |
| facet construct | 15 | 16 |
| facet value | 3 | 1 |
| buds | 0 | 4 |

SOURCES:
- before: `docs/wayfinder/ratchet/091-before.json` (stderr empty, logged at
  `docs/wayfinder/ratchet/091-before.err`)
- after: `docs/wayfinder/ratchet/091-after.json` (stderr empty, logged at
  `docs/wayfinder/ratchet/091-after.err`)

Reading: parse rate held at 1.0 and fabrication stayed at 0 with the
lineage blocks in the payload — the verbatim gate never fired, so lineage
never widened what may be cut. The facet mix moved (fact 10→2, episode
6→8, general-event 6→8): with the question and prior turn visible, the
model stopped labelling plain statements as `fact` and anchored episodes
and habits instead — the direction 037's episode priority wants. The
earlier 078-constrained baseline (45 cuts, fact 7 / episode 8 / construct
12) sits between the two 091 runs, so run-to-run variance is real; the
robust claims are the invariants (parse 1.0, fabrication 0), not the exact
counts.

### Acceptance

- [x] live example as a fixture; the reading names the referent
- [x] lineage-not-corpus held by test (verbatim gate + marker-bound scan +
      cite resolution)
- [x] ratchet before/after recorded, with command and sources above
- [x] suite green — `npx tsc --noEmit` clean; `npx vitest run` 66/66 files,
      1492 passed, 3 skipped
- [ ] 085 mode-5 count re-measured on the next review pass — deferred by
      the ticket's own wording; the payload that makes the re-measurement
      meaningful is now shipped. Remainder, below.

### Remainders

- 085 mode-5 ("reading misses the surrounding truth") must be re-counted on
  the next claim-review pass — with the mint payload carrying lineage, the
  mode-5 class should shrink or shift.
- The reading-side benefit only reaches snippets whose stored provenance
  has material: pre-073-backfill imports have no `context`, and
  `unprompted` snippets have no question — those payloads ride bare, as
  they must.

### Verified

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 66/66 files pass, 1492 tests pass, 3 skipped.
- Both ratchet runs: model host reachable, `erroredExchanges` 0.
