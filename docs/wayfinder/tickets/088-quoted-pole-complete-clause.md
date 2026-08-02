---
title: "Fix: a quoted pole must be a complete clause — mechanical, on the fragment"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 5)
blocked_by: []
---

## Question

From RESULTS §16.5. The one re-measure minted in the T16 run quoted
`worked on making` — an exact substring that passes Q-46's verbatim check
and is not a proposition. Q-46 stays (the alternative is model self-report,
which is worse). The corrective is narrower: the quoted pole in a
re-measure/juxtaposition must be a complete clause — a mechanical check on
the fragment (finite verb + subject reachable, or the existing sentence
segmenter's boundary test), not a judgment about it.

Acceptance: the composeRemeasure path rejects a non-clause fragment and
falls back to a longer enclosing span (verbatim rule intact); the T16 case
(`worked on making`) is a fixture that now produces a clause; suite green.

## Resolution (2026-08-02)

**Files touched.** `src/clerk/clause.ts` (new), `src/clerk/contradiction.ts`
(`composeRemeasure`), `src/clerk/wiki-jobs.ts` (deps type + call site),
`src/registry.ts` (append-only: two `live` entries), `tests/clause.test.ts`
(new), `tests/clerk-contradiction.test.ts` (fixtures + four new tests).
Nothing else. `src/server.ts`, `web/`, `src/import/`, `src/harvester/` and
`src/wiki/lint.ts` were not touched.

**Mechanism.** `widenToClause(fragment, prose)` widens the quoted pole to
the smallest enclosing clause inside the person's prose, decided entirely in
code — never a model call. Two arms, both mechanical: a finite verb with a
reachable subject (closed verb/auxiliary tables plus `ed`/`s` suffix rules,
same posture as `admissibility.ts`), and the segmenter's boundary test (a
span that coincides with the repo's sentence boundaries — `. ! ?` + space +
uppercase, the harvester's own rule — IS a clause). `composeRemeasure`
runs the widening on `poleA` at the top of the path, prompts and checks
against the widened pole, and stores it as `quotedFragment`. The widened
span is always an exact substring of the prose; a fragment not verbatim in
it is left untouched (Q-46's verbatim rule intact). A widened clause longer
than the 300-char excerpt budget returns null — the candidate waits, the
same outcome the pre-existing clip/check mismatch produced implicitly.

**Deliberate behavior changes.** (1) The T16 shape now quotes the full
clause: `worked on making` inside its sentence becomes the whole sentence,
so the minted question quotes a proposition, not a verb phrase. (2) The
check is conservative about subjects: only auxiliaries and past forms
trust a bare noun-head subject (`the mechanism worked`); base and 3sg stems
do not (`the final report` stays a non-clause), and a nominative pronoun
anywhere before the verb licenses any class. (3) `cover` and `graduate` are
absent from the base-verb table on purpose: the mechanism-registry caller
scan reads a same-named key as a call site, and those two mechanisms are
declared unwired — a false caller fails the conformance test. The collision
class is documented in `registry.ts`. (4) Sentence-aligned spans pass on the
boundary test alone (so `No exceptions.` — a fragment-sentence with no
finite verb — is quotable; the ticket's failure was mid-sentence
fragments, and this arm is the ticket's own "segmenter's boundary test").

**Scope boundary, recorded.** The ticket's question names "re-measure/
juxtaposition"; the acceptance pins the deliverable to the composeRemeasure
path, and that is what shipped. The live juxtaposition path
(`composeJuxtaposition` in `src/clerk/composed.ts`) quotes `sharedPhrase`,
a two-text overlap from the trigram index; widening an overlap inside one
text breaks its containment in the other, so the clause rule does not
apply there without a different mechanism. Left as a deliberate remainder.

**Verification.** `npx tsc --noEmit`: clean for every touched file (the
only errors are in untracked `tools/` WIP owned by a concurrent agent).
`npm test`: 1451 passing, 2 skipped; the only 3 failures are concurrent
agents' uncommitted WIP (`tests/canon.test.ts` against a reformatted
`src/wiki/contract.ts`; `tests/log-format.test.ts` against a new
`undiscriminated-range` kind from `src/wiki/lint.ts`) — both files pass at
pristine HEAD (107/107 in a detached worktree). My files: 120/120
(`clause`, `clerk-contradiction`, `mechanism-registry`, `wiki-jobs`). The
T16 fixture is exercised three ways: unit (`widenToClause`), end-to-end
(`composeRemeasure` mints the full-clause question), and the verbatim
invariant (widened span is a substring of the prose).

**Remainders.** The juxtaposition path above. The `proseA` parameter
records which text the pole was quoted from; `proseB` is deliberately
absent because poleB never reaches the prompt or the draft — only the
nested-containment check, which is text-membership, not clause-ness.
