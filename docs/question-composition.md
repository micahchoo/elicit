# Question composition — current state and target state

Written 2026-08-02, after slice 2 and the probe-freedom fix (ticket 031).
This is the synthesis the register holds in pieces: how a follow-up
question is made today, what the composer cannot yet see, and what the
locked decisions say it becomes. Cited Q-Ns live in
`docs/decisions/elicit.md`; terms in `CONTEXT.md`.

## Current state (as of commit 289c227)

At turn time the elicitor walks a fixed priority chain:

1. **Resonance → Juxtaposition.** Lexical search of the vault for a
   ≥3-content-word echo of the user's utterance. A hit licenses a
   juxtaposition: past snippet and present words quoted side by side.
2. **Red Light → composed follow-up.** One model judgment over the five
   licensed features (odd term, unexplored referent, abstraction with no
   episode, pole without contrast, cause without event). A light licenses
   a composed question that must contain the user's phrase verbatim
   (Q-12, code-checked, retry-then-null).
3. **Generic probe.** The repertoire prompt (ticket 031): understand
   first, then one of seven "ways in" — go smaller, go larger, find the
   edge, shift time, name the cost, follow the image, connect. Quoting
   available, not required.

Code guards wrap all three rungs (Q-36): content-free answers pivot to a
fresh queue/bank draw instead of drilling; echoes, near-repeats, and
conversation-referential questions get one guarded retry, then a fallback
draw. Between sittings the Clerk mints composed openers and still-true
questions (age-triggered, always asked differently — Q-14) into the
Queue; drawing is filtered (status, Mode needs, phase, horizon) with
user-declared entries first (Q-20).

## What the composer is blind to today

- **The wiki.** No claims exist yet (Clerk slice unbuilt), so no
  licensing situation can come from what the model of you lacks.
- **Facet balance per Mode** (Q-7): readings exist on disk but are not
  aggregated; low-energy sittings can silently starve episode facets.
- **Exposure history**: `markAsked` records, nothing consults.
- **Question-Form as a choice**: `deliberative` is used near-universally,
  though form targets stance (deliberative → avowal, theoretical →
  self-observation) — the mapping exists only in Provenance's definition.
- **Buds** (ticket 027): failures are recorded and never asked — the
  Gap-fill source, called "the default" in CONTEXT, is a dead letter box.
- **Disjoint-vocabulary clashes**: juxtaposition hears only lexical
  echoes until the embedding channel lands (Q-17 stage 2; deliberately
  waiting for ~50 snippets, ticket 007).
- **Randomizer draws** (Q-18, ticket 026) and **Expeditions**
  (ticket 025): specified, unbuilt.

## Target state (what the register already commits to)

Composition becomes **selection over the seven licensed Question Sources**
(CONTEXT.md — Question Source), governed by Q-13: hard filters first
(license, Mode, Facet balance, weak-early ordering, exposure control),
then top-k uniform random. Never argmax; never scored by fluency.

The licensing situations richen as the Clerk's wiki grows:

- A contradiction candidate licenses exactly ONE ask-differently
  re-measure (Q-30) — the only gate to opening a Contradiction.
- A half-Construct licenses its contrast-pole question; a Bud failure
  licenses its maturing question (ticket 027).
- A well-cited interest the wiki cannot deepen from self-report licenses
  an Expedition (ticket 025).
- An aged avowal licenses a still-true on a graduated horizon (FSRS-shaped
  once earned — Q-35).
- Dry spells and stale regions license Randomizer draws — shuffle, never
  invent (Q-18).
- Question-Form is chosen deliberately for the stance the wiki needs.
- Instruments are data with per-protocol yield tracking (ticket 028);
  technique follows knowledge type (the Hoffman finding).

Every new selection mechanism arrives shadow-first (Q-35): it logs what
it WOULD have asked until its record earns it the right to act. Every
artifact is model-stamped (Q-34). Every draw is inspectable in the
Activity Log (Q-23).

## The through-line (Q-36)

Freedom in generation, rigidity in validation. The trajectory gives the
model ever more context — the wiki, thread history, declared Mode — and
ever fewer instructions, while every invariant lives in code at the
boundary. The current composer is a good interviewer with amnesia and no
case file; the target composer has read the file, and is still forbidden
from putting words in your mouth.
