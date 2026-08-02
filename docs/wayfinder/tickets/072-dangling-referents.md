---
title: "Grill: snippets that point outside themselves — dangling referents at ingest and in the vault"
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: []
resolution: >
  Ruled by Micah 2026-08-02: all three layers are wanted. Layer 1 (render the
  already-stored eliciting question) and layer 2 (mechanical context window,
  stamped at ingest and backfilled by the 024 locate-by-substring mechanism)
  are one build — ticket 073. Layer 3 (model-resolved referent as a
  Reading-plane annotation) is ticket 074, blocked on 073 and on the
  hand-labelled dangler set it must be evaluated against. The lineage-not-
  corpus invariant on the context field stands as specified in this ticket.
  The grill questions about detectors and review verbs dissolve: with every
  snippet carrying its context, detection only matters for 074's annotation
  and for a future restate/gap-fill pass.
---

## Question

Observed 2026-08-02: a lot of snippets refer to something that is not in the
snippet — "that's why I stopped", "the biggest issue", "her" — full grammatical
sentences whose antecedent lives in the eliciting question, the previous turn,
or the surrounding paragraph. The snippet passes every gate and is illegible on
every later surface.

What is already known, so nobody re-derives it:

- **A leading-referent structural gate is a measured dead end** on published
  prose: 0 of 9 `frag` caught, 25 of 139 keeps shredded
  (`src/harvester/admissibility.ts`, the absence recorded at the
  `startsMidSentence` comment). Real prose opens sentences with expletive
  "It was…" and discourse "This…" constantly. But that measurement was on
  *imported prose*; conversational answers dangle differently (question
  anaphora: "Mostly the second one"). It does not transfer without a new
  labelled set.
- The model's `standalone` boolean is the intended catcher and grades its own
  homework, defaulting true under uncertainty (eval finding #6). In
  `SYSTEM_PROMPT` it is one bare line — the only label that never got ticket
  037's treatment (a definition carrying the test that separates it from its
  neighbour). 037 proved that treatment moves the needle (`intention` 6→0).
- The non-destructive route exists: `standalone: false` → Bud, "a false
  positive costs a delay, not a loss". Ticket 027 (gap-fill questions from
  Buds) is the machine that turns a dangler into a question whose answer
  names the antecedent — from a different sitting, so under Q-50 the repair
  is *stronger* evidence than the original.
- The antecedent is usually already in the vault: `Provenance.question` holds
  the eliciting probe verbatim; imported snippets sit inside their piece. No
  reading surface renders either next to the snippet today (grep: harvest
  review card, wiki, randomizer all show bare text).
- The harvest review card shows the cut without its context. Q-58 ruled the
  opposite for imports ("misleading excision is the only failure a review can
  catch and judging it needs the surrounding text") — but context also makes
  danglers invisible to the reviewer, who mentally fills the referent. A
  render that marks the cut's own boundary inside its context serves both.

Grill, in order:

1. **Measure first.** Hand-label the current vault (139 imported + the
   conversational snippets) for danglers: rate, and which population —
   question-anaphora vs prose-anaphora. Everything below hangs on this split.
2. **Ingest lever:** give `standalone` its 037 treatment in `SYSTEM_PROMPT` —
   a definition with the discriminating test ("false when a pronoun,
   demonstrative or definite description names something outside the cut"),
   plus the cheaper instruction: *extend the cut to swallow the antecedent
   sentence* (cut boundaries are the model's one free choice; verbatim
   substring holds). Ratchet against the baseline (`scripts/ratchet`), never
   argued for.
3. **Review lever:** should the review card show the eliciting question /
   surrounding turn with the cut's boundary marked — and does harvest review
   want an `extend` verb (trim's inverse, widening within the source turn)?
4. **Vault lever (already-ingested):** flag suspect snippets and route them —
   restate verb, or a gap-fill question in a sitting. A flag's economics
   differ from a gate's (a false flag costs a glance), but any detector still
   needs the labelled set from (1) before it is believed.

## Direction (Micah, 2026-08-02): capture the antecedent in metadata, automatically

Not just flag the dangler — store what it points at, derived from prior turns.
Three layers, ordered by trust; the first two need no model:

1. **Already stored.** `Provenance.question` holds the eliciting probe
   verbatim. For conversational question-anaphora ("mostly the second one")
   the antecedent IS the question, captured since day one. Missing piece is
   rendering, not capture.
2. **Mechanical context window.** The cut is a code-verified exact substring
   of its source turn — so its offset is computable, and the N sentences
   preceding it (or the prior user turn / prior paragraph when the cut opens
   the turn) can be stamped into a `Provenance.context` field verbatim, by
   offset math, no model. Ticket 024 already proved the locate-by-substring
   mechanism (earliest turn wins, logged) — the same mechanism BACKFILLS
   context for every existing snippet from its stored sitting transcript.
   Deterministic at ingest and retroactively.
3. **Model-resolved referent** ("'the biggest issue' = serving images
   performantly") — agent prose. If wanted at all: a model-stamped annotation
   in the Reading plane (Q-34 lazy re-annotation applies), never a gate,
   shipped last, evaluated against the labelled set from (1).

**The invariant that makes layer 2 safe:** context is the person's own words
but was never approved in review — so it is LINEAGE, not corpus. Display-only,
dimmed, on whatever surface shows the snippet. The Clerk must not mint from
it, resonance must not index it, no Piece may include it. Same plane as
`Provenance.question` today. State this in code, not just here.
