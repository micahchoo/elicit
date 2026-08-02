# Claim review — the first error-discovery pass (ticket 085)

Micah reviewed 40 claims of 144 (the diverse sample) on 2026-08-02, leaving
free-text notes in his own words; no category list existed. This document is
the open-coding of those notes. Notes are quoted verbatim; the modes are
named after what the notes actually say, not after a prior taxonomy.
Raw notes: `tools/claim-review/notes.jsonl`. Dataset:
`tools/claim-review/dataset.json`.

**Headline: 20 of 40 skipped — half the graph reads clean.** A skip was the
instructed "nothing wrong here" verb. The other 20 carry notes, coded into
five modes below. Counts are of noted claims; one note can carry two modes.

## The modes

### 1. The evidence unit is weak, not the claim — 6 notes (30%)

> "not a good snippet" (×3) · "this is not a good snippet, no context" ·
> "ephemeral, not a snippet" · "this is not a good snippet"

The Clerk read faithfully; what it read was thin. Exemplars: *"The four
years mostly bought me a clearer picture of the problem"* (a fragment whose
referents live elsewhere), *"Archie is my attempt at those four parts in one
window"* (**"those four parts" is a dangler** — 074's measured class,
meeting its consequence: the claim minted from it is opaque), *"I know his
name, because I pay him every two months on Google Pay"* (trivia), *"I was
immediately struck by how gentle and mudra-like it seemed"* (Micah:
**ephemeral** — an observation that was never meant to be durable evidence).

These cuts were each approved once, at import review, reading the piece
whole (Q-58). Re-met as the sole evidence under a wiki claim, they look
different. That is not a review failure — it is the difference between "fine
in its source" and "strong enough to carry a claim alone."

### 2. Referent misidentified — 3 notes, one severe

> "not my mother, Ruksaana madam" · "not a binder, its a github repo called
> binder" · "not viewing experiences- institutional archives"

The severe one: the prose says *"ma'am would translate"* and the claim says
**"asked their mother"** — the model resolved "ma'am" to a relation that
appears nowhere in the prose. This is fabrication at the referent level, the
exact thing Q-32 forbids the registry to do by merge, done instead inside a
claim sentence. "A binder" (physical object) for *Clement Valla's Binder*
(a named work) is the same move at lower stakes: a proper noun read as a
common noun.

### 3. Modality wrong — did / intends / wants — 3 notes

> "i did build it, its called Archie" · "intended to, and then did it, past
> tense" · "atleast i want it to be"

Two claims file completed work as intention (`facet: intention` on things
that were *done*, and one — Archie — that visibly exists in this very
corpus); one states an aspiration as fact (*"This cannot be done alone"*
becomes "considers their work inherently collaborative" — Micah: "atleast i
want it to be"). The claim's verb-mode must match the prose's: built ≠
building ≠ wants-to-build. Note the facet is wrong too in the first two —
this mode corrupts the facet distribution 037 worked to fix.

### 4. Agency overreach — 3 notes

> "it was not my research project" · "i incorporated in the past something
> that already existed" · "it was not just me who decided"

The prose hedges ownership — *"as far as I saw it"*, *"a conscious unspoken
decision"* (collective) — and the claim flattens it to "They conducted",
"The user consciously decided". The hedge IS the content: an observer role
and a collective decision are different facts about a person than authorship
and sole agency.

### 5. Reading misses the surrounding truth — 4 notes

> "the framing is wrong" · "rehearsing futures, helps arrive at a shared
> understanding when there is none" · "the surrounding words have more
> context that were not taken into the claim" · "I struggle with breaking
> things down in a systematic way"

The garbled exemplar: *"values the confirmation of structural support
through an embodied rehearsal of the future"* — word-salad where the
person's point was (their words) "rehearsing futures helps arrive at a
shared understanding when there is none." The last note is subtler: the
claim states the person's theory accurately but silently — the lived
counterpoint ("I struggle with…") was next to it and the one-cite claim
carries none of that tension. One range note belongs here too: "range was
from the start of my interest in participatory methodologies" against a
claim ranged `throughout their life` — the over-broad range RESULTS §16.2
predicted, met in the wild.

## What this changes

- **Modes 2, 3, 4 go to ticket 087** (mint-prompt + lint corrective),
  which this review amends with measured counts and exemplars: referent
  discipline (never resolve a referent beyond the prose — "ma'am" stays
  "ma'am"), modality fidelity (the claim's verb-mode matches the prose's),
  hedge preservation (observer/collective hedges survive into the claim or
  the range). All three are prompt correctives plus lint flags — never op
  rejections, per 087's standing constraint.
- **Mode 1 is upstream** and partially already ticketed: two of six are
  074's danglers meeting their consequence. New lint candidate recorded in
  087: a claim whose only cite is a labelled dangler gets a dimmed
  weak-evidence note (mechanical — the 074 label set exists).
- **Mode 5's context case** is 073/080's context window doing its job at
  review time (Micah could see the surrounding words — that is how he
  caught it) but not at mint time; graph-bounded minting context is ticket
  033's territory and this is the first field evidence toward it.
- **The skip rate is the counterweight:** half the sample reads clean, and
  the wrongness found is concentrated in reading fidelity, not invention —
  no claim asserted something with no basis at all; every error is a
  distortion of real prose. The verbatim-substring gate holds; what drifts
  is interpretation.

Unreviewed remainder: 104 claims. A second sitting is licensed whenever —
the app stays at tools/claim-review/, server restartable via
`python3 tools/claim-review/server.py`.
