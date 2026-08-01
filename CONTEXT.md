# Elicit

An agentic elicitation tool that interviews a person to build a human-shaped wiki — a model of their beliefs, contradictions, knowledge, and skills. Emergent outputs (a written Piece, a learned skill, a built capability) grow out of that model. All interaction is textual; all inference is local (ADR-0001).

## Language

### Invariants

**Sole Authorship**:
Every word in a Piece is written by the user. The agent contributes questions, placement, and Marginalia — never body text, transitions, or titles. An architectural guarantee that makes misattribution impossible by construction — not a claimed accuracy technique.

**Marginalia**:
Agent annotations attached alongside a composed Piece or a Snippet — seam warnings, stale-pin flags, skeleton labels, drift readings. Never part of the Piece text itself.
_Avoid_: comments, suggestions, edits

### The corpus

**Snippet**:
The atomic evidence unit: a verbatim passage of the user's own prose that passes the admissibility test — (1) verbatim, (2) standalone-interpretable without its Transcript (hard gate), (3) carries at least one Facet reading, (4) carries a Stance (which gates evidentiary weight, not admission), (5) has a typed Question-Form in Provenance, (6) is capture-timestamped. Fluency, vividness, specificity, and confidence are forbidden as quality signals. Versions are immutable: an edit creates a new version; old versions are evidence of a past self. Pieces pin versions; Wiki claims cite versions.
_Avoid_: answer, note, card, zettel

**Bud**:
A verbatim fragment that fails one or more admissibility tests, held with its failures recorded. Each failure is a targeted question; answering matures the Bud into one or more Snippets. Not citable by Wiki claims, not placeable in Pieces. A Bud the user declines to develop stays dormant — itself signal.
_Avoid_: draft, candidate, fragment

**Facet**:
What kind of person-knowledge a Snippet evidences: Episode (specific, dateable), General Event, Lifetime Period, Fact, Construct, Intention, Value, Causal Theory. Open set. A Construct is a triple — pole, contrast pole, range of application; one pole alone is half a construct. Causal Theory is always collected and always flagged: evidence of the person's theory of themselves, never of the cause. Skill is deliberately absent — see Wiki.

**Stance**:
The person's relation to a Snippet's content: avowal, self-observation, report-of-fact, pole-preference, commitment, uncertainty-marked, superseded. Stance carries tense — about-when and written-when are distinct anchors.

**Provenance**:
How a Snippet came to exist: the eliciting question with its typed Question-Form (deliberative → avowal; theoretical → self-observation; why-question → causal theory), the Transcript or prose it was harvested from, or unprompted entry. Capture time included.

**Transcript**:
The full record of one elicitation exchange: agent probes interleaved with user fragments. Append-only, never edited, retained as Provenance; the Wiki's intrastitial readings may rest on it, not just on the kept Snippet. Any agent summary of a Transcript is agent prose — Marginalia-class, structurally barred from Pieces.

**Harvesting**:
Breaking prose — pre-written text or a Transcript — into Snippets by cutting at concept boundaries. The agent proposes cuts (the user's words only, exact substrings); the user approves, trims, discards, or restates. The agent never rewords. Fragments that fail admissibility become Buds, not edits.
_Avoid_: import, splitting

**Restatement**:
The ever-present alternative to approving a harvest: the user rewrites the fragment as one clean thought. The product's hidden pedagogy — writing practice in doses too small to trigger the blank-page fear. A long Restatement chain is a drift signal: the Wiki reads successive versions as a changing self-narrative, not as approximations to a fixed truth.

**Seeding**:
Harvesting a pre-existing corpus (journals, vault notes, old drafts) incrementally — a region at a time, when a Direction reaches toward it, never bulk. Seeded Snippets carry dated past-self Provenance. A Wiki claim resting only on seeded material stays unconfirmed and feeds the question queue.

### The Wiki

**Wiki**:
The agent-authored, continuously revised model of the user. It emerges in the spaces interstitial and intrastitial to Snippets — the links and tensions between them, the interpretations within them. Every claim cites the Snippet versions it rests on — except skill claims, which must cite Emergent Outputs (performance evidence): skills are expressed through performance, not recollection, so self-report can only ever ground a self-model of capability. Not the primary interface; the user can read and edit it. Wiki text never enters a Piece.
_Avoid_: profile, notes

**Contradiction**:
A recorded tension between claims or Snippets, typed: synchronic (both assert the present — genuine tension, generates a resolution question) or diachronic (the person changed — the tension is the finding, no resolution sought). A Contradiction between A and B invalidates only claims citing both; claims resting on A alone or B alone stay live. First-class Wiki material, resolvable only by elicitation — never by silent agent judgment.

**User-Attested Claim**:
A Wiki claim the user has edited. The agent may never silently rewrite it; it may open a Contradiction against it and elicit.

**Propagation**:
Every user edit to a Wiki claim becomes a Snippet (it is the user's prose), so the claim acquires evidence and stays falsifiable — mandatory, or the Wiki silts up with unassailable premises. Optionally the edit also cascades into the cited Snippets as new user-authored versions.

### Elicitation

**Direction**:
A line of inquiry the agent is pursuing. Born three ways: declared by the user, emergent from Snippet analysis, or injected by the Randomizer.

**Randomizer**:
The serendipity mechanism: it injects questions outside every active Direction, sampled to reach old and forgotten material, so the Wiki does not overfit to well-trodden territory.

**Protocol**:
A question's category, defined by what it takes to answer well: the answerer's prerequisites (time, sources, reflective state — episodes need a 30-second retrieval budget, not just an episodic question), the elicitation technique (five-slot episode probe, triadic construct elicitation then laddering, critical decision method, momentary state probe), and the Q&A screen's presentation. Techniques differ in yield, not in access: Protocol selection is a measurement question — track kept-Snippets-per-exchange, switch when yield drops. Open set; Protocols are data, not an enum.
_Avoid_: category, question type

**Mode**:
The user's self-declared current state — time available, energy, setting. A constraint on what is askable now, never the objective: comfort does not predict yield, and low-effort Modes bias the corpus toward abstraction, so Facet distribution is tracked per Mode. Deferring a question to a fitting Mode is a first-class move.
_Avoid_: mood, context

### Composition

**Emergent Output**:
Anything grown from the Wiki: a written Piece, a learned skill, a built capability — an open-ended set. For skill claims, the Emergent Output is the evidence.

**Piece**:
A document composed by stacking Snippets. The agent proposes; the user reviews and rearranges. One kind of Emergent Output. May hold several candidate Arrangements of the same material until the user settles.

**Arrangement**:
One ordering of pinned Snippet versions — the same Snippets can stack as chronology, argument, or contrast. Carries skeleton Marginalia naming the role of each Snippet. Structurally just an ordered list, so alternatives are cheap.

**Gap**:
An explicit empty slot in an Arrangement where no Snippet bridges a leap. Visible in the reviewer; backed by a queued question. Never filled by agent prose.
