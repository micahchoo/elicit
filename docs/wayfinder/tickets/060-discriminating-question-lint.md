---
title: "Build: discriminating questions from lint — name the boundary without the contradiction pipeline"
labels: [wayfinder:task]
status: open
assignee: 
blocked_by: [008-build-clerk.md]
---

## Question

Q-54's Door 2. The un-drawn boundary between two domains a person is right in
is plausibly the highest-value thing Elicit produces. Door 1 reaches it through
the contradiction pipeline, which means it inherits Q-52's recall problem: no
pooled pair, no named boundary. This ticket reaches it with **no model and no
candidate pool in the path** — so it works on the corpus that exists today,
which is nine years of imported writing with zero contradictions detected.

### The finding

A fifth `LintFinding` kind under Q-31, computed in `src/wiki/lint.ts`, which
`npm test` already asserts can never reach a model:

**`undiscriminated-range`** — two live, non-archived, non-superseded Claims that
share a registry referent and whose `range` strings are identical or
near-identical (the same normalized-token-overlap function T8 already uses for
`merge-candidate`, at its own threshold).

Two competing descriptions of the same situation under the same stated
conditions is exactly the boundary nobody has drawn. It needs no opposition
judgment to notice — the *sameness* of the Ranges is the signal, and sameness is
a string function.

- `subject` — the referent slug (the thing both claims are about).
- `refs` — both claim ids.
- Consequence, per Q-31: **one** minted question, deduped on the sorted claim-id
  pair exactly as T11 dedupes candidate pairs. Lint has no memory, so the dedupe
  belongs to the caller (T12), same handoff as `stale-citation`.
- Threshold `lint.undiscriminatedRangeSimilarity` arrives in **shadow** (Q-35),
  like every other lint threshold. Its graduation condition: the shadow log
  shows pairs a human agrees are two descriptions of one situation.

### The question form

Q-12-composed, both claims' cited prose quoted verbatim, asking for the
discriminating condition — where the first holds, where the second, what tells
them apart. It is a QuestionForm, not a Protocol: one question, drawn from the
Queue like any other. `source: 'lint-undiscriminated-range'`, and it carries
BOTH claim ids so the answer can be routed back to two SUPERSEDEs.

Framing matters more here than anywhere else in the system. This question tells
the user, implicitly, that they hold two views — and Q-15 forbids meeting a
person with an accusation. It must read as an invitation to draw a distinction,
never as "you contradict yourself." The Q-40 quote-framing rule applies: frame
the quotes, never splice them.

### What the answer becomes

Identical to Door 1's tail — one `SUPERSEDE` per claim with a narrowed Range and
reason `range-discriminated:lint:<referentSlug>`, citing both original snippets
plus the answer's. Under Q-50 and Q-53 those refined claims are born
`evidenced`, because the answer necessarily comes from a later sitting than
both.

## Acceptance

- Two claims on one referent with the same Range produce exactly one finding and
  exactly one queue entry, across three consecutive docket runs.
- Two claims on one referent with clearly different Ranges produce none.
- `lint.ts` still passes the zero-model grep.
- An answered discriminating question narrows BOTH claims' Ranges and both
  recompute to `evidenced`.
- The minted question, read aloud, does not accuse.
