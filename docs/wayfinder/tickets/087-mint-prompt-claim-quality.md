---
title: "Fix: claim quality at the mint prompt and lint — person drift and contentless ranges, never op rejection"
labels: [wayfinder:task]
status: closed
assignee: claude (omp wave 6)
blocked_by: []
---

## Question

From RESULTS §16.2 (2026-08-02-the-clerk.RESULTS.md). Measured on the first
real claim graph (144 claims): subject drift — "The user" 59, "The person"
28, "The author" 2 — and contentless ranges (`generally` ×7; shortest range
7 chars). The Clerk cannot improve a reading (§3: 144 facets in, 144 out,
zero drift), so the correctives are the mint prompt (fix the grammatical
person; one subject form) and lint (flag a Range that names no occasion).

HARD CONSTRAINT from RESULTS: this must NOT become an op rejection. A claim
with a weak Range is still a claim (Q-29's contract is untouched); the
corrective belongs in the prompt and in the zero-LLM lint layer (Q-31:
lint may add annotations and questions, never remove or restructure).

Acceptance: mint prompt names the subject form; a lint finding for
occasionless ranges with a dimmed note (034: zero renders as words);
measured re-run on the existing 144 claims recorded in the ticket; no
change to applyOps/rejection paths; suite green.

## Amended by the 085 review (2026-08-02)

The first error-discovery pass (docs/claim-review-2026-08-02.md, 40 claims,
20 noted) measured this ticket's scope into five modes. Three land here:

- **Referent discipline (3 noted, one severe):** the mint prompt must never
  resolve a referent beyond the prose — "ma'am" became "their mother", a
  fabricated relation; "Clement Valla's Binder" became "a binder". Prompt
  clause + exemplar; consider a lint comparing claim proper-noun/relation
  vocabulary against the cited prose (mechanical, add-only per Q-31).
- **Modality fidelity (3 noted):** did / intends / wants must match the
  prose; two completed works filed as `facet: intention`. This corrupts the
  facet distribution as well as the sentence.
- **Hedge preservation (3 noted):** "as far as I saw it" and "a conscious
  unspoken decision" (collective) flattened to sole agency. The hedge is
  content; it survives into the claim body or the range.
- **Weak-evidence lint (6 noted, upstream):** a claim whose only cite is a
  labelled dangler (074's set) gets a dimmed weak-evidence note. Mechanical.

Original scope (person drift, occasionless ranges) stands; the over-broad
range mode was met in the wild ("throughout their life"). All correctives
remain prompt + lint — never op rejection.

## Resolution (2026-08-02)

Done. Every acceptance item held; the measured re-run is recorded below.

### Files touched

- `src/clerk/mint.ts` — four prompt clauses (see below), plus tests.
- `src/wiki/lint.ts` — two new findings, the mechanical predicate and the
  074 dangler set; header now says seven findings.
- `src/wiki/contract.ts` — LintFinding union append only:
  `occasionless-range`, `weak-evidence`.
- `src/wiki/thresholds.ts` — two entries arrive SHADOWED (Q-35),
  `lint.occasionlessRange` and `lint.weakEvidenceDangler`, both boolean
  switches with `live: false`.
- `docs/superpowers/plans/2026-08-02-the-clerk.md` — two rows in the
  threshold table (the conformance test forces code and ledger together).
- `src/queue/source-label.ts` — the wiki note-rendering site (the
  LINT_NOTES map that `lintNote` serves; traced from 'orphan-claim' to the
  page, per the fence). Two dimmed notes added. This is the one file inside
  the fence's blanket "do not touch src/queue/*" that the fence's own
  note-rendering-site grant names; no other queue file was touched.
- `scripts/remeasure-087-mint.ts` + `data/eval-087-mint/output.jsonl` —
  the measurement (below). Read-only over the vault.
- `src/registry.ts` — NO appends were needed: every new mechanism is
  module-private (the predicate, the word sets, the dangler set), so there
  is no new export for the 077 registry to declare. The registry cross-check
  passes unchanged.
- Note: the concurrent composition slice's commit `6410f38` swept the
  source-label.ts edit into its own commit (the file was uncommitted when
  that agent committed); the LINT_NOTES entries are in HEAD and correct,
  and this ticket neither commits nor adds anything.

### The mint prompt (src/clerk/mint.ts, SYSTEM_PROMPT Rules)

Four clauses, each carrying its measured exemplar:

- **Subject form**: every body names the one person the same way —
  "The user". Never "The person", never "The author", never a bare "They"
  where the subject can be named. (RESULTS 16.2: 59 / 28 / 2.)
- **Referent discipline**: name referents exactly as the prose does; never
  resolve a word to a relation or object the prose does not state. "ma'am"
  stays "ma'am", never "their mother"; "Clement Valla's Binder" stays a
  named work, never "a binder" (085 review, mode 2).
- **Modality fidelity**: the claim's verb-mode matches the prose's — did,
  intends and wants stay distinct; completed work is never filed as
  facet "intention" (085, mode 3).
- **Hedge preservation**: observer and collective hedges survive —
  "As far as I saw it" stays an observer's view; a decision the prose
  describes as shared stays shared (085, mode 4).

### The lint (zero-LLM, add-only per Q-31, both shadowed per Q-35)

- **`occasionless-range`** — a live claim whose Range names no occasion.
  Mechanical predicate in lint.ts: strip function words, then flag the
  measured classes (general adverbs, lifetime/deictic nouns) when no
  content word survives. Validated on the existing corpus before shipping:
  it flags exactly `generally` x7, `in general`, `currently` x2,
  `throughout their life`, `early on`, `previously`, `after that point`,
  `during that time` (15/151 claims) and nothing else.
- **`weak-evidence`** — a claim whose ONLY cite is one of the 96 labelled
  danglers (074's set, docs/dangler-labels-2026-08-02.md). Mechanical: one
  cite, id in the set. A conformance test runs the mechanism against all
  139 doc rows (96 yes flag, 43 no do not).
- Both render as dimmed notes via LINT_NOTES: "this holds everywhere, and
  nowhere in particular" / "the single piece of evidence behind this points
  at something said elsewhere". Never a rejection: applyOps and every
  rejection path are untouched (no change to src/wiki/ops.ts).

### Measured re-run (037 discipline, before numbers from RESULTS 16.2)

SOURCE command:

    npx tsx scripts/remeasure-087-mint.ts

SOURCE output: `data/eval-087-mint/output.jsonl` (151 lines, one per
reading, each stamped `model=qwen3.6:35b`). The script runs the shipped
sweep path — `proposeOps` per reading with the lexical-resonance
related-claims lookup — against the standing clerk endpoint
`http://192.168.0.229:11434/v1` (qwen3.6:35b, the src/llm.ts clerk
default), read-only over the vault. Related claims exclude the reading's
own claims via `Claim.fromReadings`, replicating the drain condition where
a reading never saw its own claim (verified: without the exclusion every
measured reading KEEPs against its own claim and nothing gets measured).
The corpus is 151 readings — the RESULTS before-numbers were over 144;
seven readings were added by the composition slice after RESULTS, so the
corpus is restated. Wall: ~1.5h under shared-host contention with the
concurrent composition slice; 0 call failures.

Subject-form distribution, before → after:

| Form | Before (144) | After (147 minted + 2 updated) |
|---|---|---|
| "The user" | 59 | 147 MINT bodies, all of them; both UPDATE bodies too |
| "The person" | 28 | 0 |
| "The author" | 2 | 0 |
| bare "They" | most of the rest | 0 |

147 of 147 minted bodies open with "The user" — zero drift across the
whole corpus. The corrective holds on the real model. The mint also used
UPDATE twice (it saw related claims from other readings and sharpened
them) and produced two dropped-shape ops (one ARCHIVE without a claim, one
MINT without a range — dropped by the same Q-29 shape gate as in
production, 0 rejections, 0 call errors).

Occasionless-range findings, before → after (lint flipped live for the
after-number; the shipped register keeps it shadowed):

| Measure | Before | After |
|---|---|---|
| contentless ranges | `generally` x7, `in general` (RESULTS 16.2); `throughout their life` (085) | **19 of 147** — `generally` x8, `currently` x3, `in general` x2, and one each of `at that time`, `during that time`, `early on`, `always`, `previously`, `after that point` |

Honest read: the prompt clause fixed the grammatical person but did NOT
reduce contentless ranges — the count drifted up slightly. That is exactly
why the corrective is prompt AND lint: the range clause stays advisory in
the prompt, and the shadowed lint now names every occasionless range as a
dimmed note. The shadow record for the 15 existing-corpus findings and the
19 re-run findings is what the `graduatesWhen` sentence points at.

Weak-evidence (extra observation, same live flip): 91 of 147 re-minted
claims rest on a single labelled dangler; on the existing corpus the same
mechanism flags 95 of 151. Mode 1 of the 085 review is not a corner case.

### Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` (full `npm test`) — final run: 75 files, 1613 passed,
  3 skipped, 0 failed (earlier runs passed at 1539 and 1585 while the
  concurrent composition slice kept adding tests; no failure at any point
  was in the owned area — no foreign failures occurred).
- `npx vite build` — clean.
- Zero-model grep on `src/wiki/lint.ts` — no model-calling identifier
  (Complete / temperature / systemPrompt) anywhere in the new code; the
  word "model" appears only in pre-existing HEAD comments.
- No `git commit`, no `git add`; no writes to `./vault` (the measurement
  script is read-only over it).

### Remainders

- The referent-discipline lint the amendment floated as "consider" was NOT
  built: a claim body is agent prose in its own words, so a mechanical
  vocabulary diff against the cited prose would flag every claim. The
  exemplars are caught by the prompt clause; a lint that catches them
  without drowning in noise is an LLM-free open question (and a
  zero-LLM-lint constraint makes one hard). Recorded here, not silently
  dropped.
- Graduating `lint.occasionlessRange` / `lint.weakEvidenceDangler` is the
  Q-35 record's call, now that the record exists (15 and 95 on the
  existing corpus; 19 and 91 on the re-run).
- The wiki-note surface tension: `src/queue/source-label.ts` sits inside
  the fence's blanket "do not touch src/queue/*" but IS the site the fence
  names ("the wiki note-rendering site"). Only LINT_NOTES was touched.
