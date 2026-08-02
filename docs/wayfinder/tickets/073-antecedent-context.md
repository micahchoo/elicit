---
title: "Build: antecedent context — capture at ingest, backfill the vault, render beside the snippet"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 1)
blocked_by: []
---

## Question

Layers 1 and 2 of [072](072-dangling-referents.md): every snippet carries what
it points at, mechanically, and the surfaces show it.

**Type.** `Provenance` in `src/types.ts` gains `context?: string` — the
verbatim sentence(s) immediately preceding the cut in its source turn (for
imported pieces: the preceding paragraph when the cut opens a paragraph).
Absent means "cut opened its source and the eliciting question is the only
antecedent" — `Provenance.question` already carries that.

**Invariant, in code:** context is LINEAGE, not corpus. The person's words,
but never approved in review — so display-only. The Clerk must not mint from
it, resonance must not index it, no Piece may include it, no Reading may cite
it. State this where the field is declared, and hold it with a test.

**Capture.** In the harvest save path: the cut is already a code-verified
exact substring of its source turn, so its offset is computable. Take up to
two preceding sentences by simple boundary split; the plan pins the exact
rule. No model call anywhere in this path.

**Backfill.** A script over the existing vault: for each snippet, locate its
source turn in the stored sitting transcript by exact substring search —
ticket 024's mechanism, earliest turn wins, logged — and stamp `context` the
same way. Idempotent; never overwrites a present value; logs the snippets it
could not locate instead of guessing.

**Render.** The eliciting question and the context window appear dimmed
beside the snippet on the reading surfaces (wiki, randomizer draw) and on the
harvest review card. On the review card the cut's own boundary is marked
inside its context — Q-58's reasoning for imports, applied to conversation:
the reviewer needs the surrounding text to judge excision, and the marked
boundary keeps the stranger's-eye view of what the snippet alone says.

**Acceptance.** Unit tests: offset math incl. a cut that opens its turn; a
cut appearing in two turns → earliest wins, logged; backfill round-trips a
vault snippet and leaves an already-stamped one untouched. Invariant test:
clerk mint path and resonance index never read `context`. Existing suites
stay green.

## Resolution (2026-08-02)

Built by Claude (omp wave 1) across 6 parallel subagent slices.

### What was built

**Types** (`src/types.ts`):
- `Provenance.context?: string` — verbatim preceding sentence(s) from the
  source turn, mechanically extracted. Comment states the lineage-not-corpus
  invariant.
- `CutProposal.context?: string` — carries context through the review card.

**Capture** (`src/harvester/harvester.ts`):
- `extractContext(turnText, cutText): string | undefined` — finds the cut
  offset via `indexOf`, splits preceding text on sentence boundaries
  (`. `, `! `, `? ` + uppercase), returns up to last 2 sentences. Returns
  `undefined` when the cut opens its turn.
- Wired into `propose()`: computes context from `turn.text` and `cut.text`,
  spreads into `CutProposal`.
- Wired into `decide()`: spreads `proposal.context` into `Provenance` for
  `approve` and `trim`. Restatement provenance deliberately excluded.

**Render** (`web/main.ts` + `web/style.css`):
- Harvest review card (`renderProposal`) shows eliciting question (up-arrow
  prefix) and context window dimmed in `--dim` color, smaller font, with a
  left border. Context ends with em-dash marking the cut boundary.
- New CSS: `.proposal-provenance`, `.proposal-question`, `.proposal-context`.

**Backfill** (`scripts/backfill-context.ts`):
- Standalone script: `npx tsx scripts/backfill-context.ts [--dry|--apply]`.
- Same `backfillContext` algorithm. Reads all harvest snippets from the vault,
  locates each in its transcript by earliest-turn substring search (ticket
  024's mechanism), stamps `context` into frontmatter. Idempotent: re-reads
  before writing, never overwrites an existing value. Logs unlocatable
  snippets. Exports functions for testability; CLI guard prevents
  side-effects on import.

**Tests** (3 new files, additions to harvester.test.ts):
- `tests/harvester.test.ts`: 5 new tests — context extraction mid-turn,
  cut opens turn (undefined), context survives propose-to-decide-to-provenance,
  restatement excludes context, caps at 2 sentences.
- `tests/backfill-context.test.ts`: 6 tests — earliest-turn-wins,
  parseUserTurns, round-trip stamp-to-read, idempotent (stamp returns false
  on already-stamped), candidate predicate, vault scanner round-trip.
- `tests/invariant-context.test.ts`: 2 tests — verifies zero `.context`
  accesses in 17 protected files (clerk/, wiki/, index/); sanity-check
  that allowed files (types.ts, harvester.ts, backfill script) reference
  "context".

### Remainder

- **Wiki surface and randomizer draw rendering** were not touched — those
  surfaces live in files owned by other agents (`src/wiki/`, `src/clerk/`,
  `src/server.ts`). Rendering context on those surfaces should follow the
  same dimmed pattern shown on the harvest review card.
- **Backfill not run against the real vault** — per instruction, this is
  Micah's to run.

### Verified

- `npx tsc --noEmit`: clean, no errors.
- `npx vitest run`: 46/46 test files pass, 1270/1270 tests pass (includes
  all 11 new context tests).
