---
title: "Build: antecedent context — capture at ingest, backfill the vault, render beside the snippet"
labels: [wayfinder:task]
status: open
assignee:
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
