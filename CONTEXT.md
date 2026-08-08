# Elicit

An agentic elicitation tool that interviews a person to build a human-shaped wiki — a model of their beliefs, contradictions, knowledge, and skills. Emergent outputs (a written Piece, a learned skill, a built capability) grow out of that model. All interaction is textual; all inference is local (ADR-0001).

The ideal-state workflow — how the terms below connect once all mapped work is complete — is drawn in `docs/ideal-state-board.md` (human, machine, and vault lanes; live board at http://localhost:3002/?board=elicit-ideal-state).

## Language

### Invariants

**Sole Authorship**:
Every word in a Piece was submitted by the user and stands unaltered. The agent contributes questions, placement, and Marginalia — never body text, transitions, or titles. Two halves live in the name and only one of them is a guarantee. The agent's non-authorship is architectural: agent prose cannot enter a Piece and no agent may reword a Snippet, which makes misattribution of *wording* impossible by construction — not a claimed accuracy technique. The user's authorship is assumed, not verified: a Snippet is the user's own words in the sense that the user submitted them, never in the sense that the user composed them. Text pasted from elsewhere is admissible material the system cannot tell from reflection. Only a Provenance the user declares can carry that distinction; detecting it is not a move the agent has.

**Marginalia**:
Agent annotations attached alongside a composed Piece or a Snippet — seam warnings, stale-pin flags, skeleton labels, drift readings. Never part of the Piece text itself.
_Avoid_: comments, suggestions, edits

**Two Planes**:
Lineage and knowledge are different planes, connected only by typed, cited edges. Lineage is what happened: Transcripts, Snippet versions, the Activity Log, read-logs. Knowledge is what is claimed on evidence: the Wiki. A lineage observation (a Restatement chain, a re-reading pattern) may become Wiki material only as a claim that cites the lineage it reads — the moment it is written without those citations, the planes have collapsed and the claim is unfalsifiable.

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
How a Snippet came to exist: the eliciting question with its typed Question-Form (deliberative → avowal; theoretical → self-observation; why-question → causal theory), the Transcript or prose it was harvested from, or unprompted entry. Capture time included. Questions carry Provenance of their own — a curated Question Bank source, agent generation from a Direction, or the user's declared topic — and it travels with the Snippet.

**Question Bank**:
A curated pool of opener questions, each with Provenance (e.g., an are.na channel and block id). Lives in `data/`; curated by the user, drawn from by the agent.

**Transcript**:
The full record of one elicitation exchange: agent probes interleaved with user fragments. Append-only, never edited, retained as Provenance; the Wiki's intrastitial readings may rest on it, not just on the kept Snippet. Any agent summary of a Transcript is agent prose — Marginalia-class, structurally barred from Pieces.

**Harvesting**:
Breaking prose — pre-written text or a Transcript — into Snippets by cutting at concept boundaries. The agent proposes cuts (the user's words only, exact substrings); the user approves, trims, discards, or restates. The agent never rewords. Fragments that fail admissibility become Buds, not edits.
_Avoid_: import, splitting

**Restatement**:
The ever-present alternative to approving a harvest: the user rewrites the fragment as one clean thought. The product's hidden pedagogy — writing practice in doses too small to trigger the blank-page fear. A long Restatement chain is a drift signal: the Wiki reads successive versions as a changing self-narrative, not as approximations to a fixed truth.

**Seeding**:
Harvesting a pre-existing corpus (journals, vault notes, old drafts) incrementally — a region at a time, when a Direction reaches toward it or the user drops material in directly; never bulk. Seven agent jobs: Survey (coarse map of the unharvested corpus, no deep reading), Reach (region selection), Cut (batch harvest with approval), Anchor (written-when and about-when; ambiguity becomes a dating question, never a guess), Repair (dangling referents become batched Bud questions, not a queue flood), Link (retellings are linked, never silently deduplicated — drift between tellings is evidence), Confirm (seeded readings hold weak priors until touched by live elicitation). Seeded Snippets carry dated past-self Provenance.

### The Wiki

**Wiki**:
The agent-authored, continuously revised model of the user. It emerges in the spaces interstitial and intrastitial to Snippets — the links and tensions between them, the interpretations within them. Every claim cites the Snippet versions it rests on — except skill claims, which must cite Emergent Outputs (performance evidence): skills are expressed through performance, not recollection, so self-report can only ever ground a self-model of capability. Not the primary interface; the user can read and edit it. Wiki text never enters a Piece.
_Avoid_: profile, notes

**Claim**:
The Wiki's unit: one sentence of agent prose with a mandatory Range (the context where it holds — "the user is X" without a range is malformed), mandatory citations (Snippet versions; Emergent Outputs for skill claims), a Status (unconfirmed / evidenced / user-attested / contested), and a read-log (Snippets answered after the user read a claim carry weaker evidence for it). No confidence numbers anywhere — Status transitions are auditable events, and coreness is computed from the citation graph, never stored.

**Contradiction**:
A recorded tension between claims or Snippets, typed: synchronic (both assert the present — genuine tension, generates a resolution question) or diachronic (the person changed — the tension is the finding, no resolution sought). A Contradiction between A and B invalidates only claims citing both; claims resting on A alone or B alone stay live. First-class Wiki material, resolvable only by elicitation — never by silent agent judgment.

**User-Attested Claim**:
A Wiki claim the user has edited. The agent may never silently rewrite it; it may open a Contradiction against it and elicit.

**Propagation**:
Every user edit to a Wiki claim becomes a Snippet (it is the user's prose), so the claim acquires evidence and stays falsifiable — mandatory, or the Wiki silts up with unassailable premises. Optionally the edit also cascades into the cited Snippets as new user-authored versions.

### Elicitation

**Sitting**:
One engagement from Mode declaration to Closing — a single conversation that may vary in depth without changing sittings: it can descend into a Sounding, spawn an Expedition mid-thread, and resurface. The human-facing unit of the practice ("session" is the code-side name). Skips, deferrals, and refusals within a Sitting are recorded signal — never weaponized.

**Closing**:
The two-move end of a Sitting, inside the question budget: the open door ("anything else we didn't touch?" — volunteered answers are the highest-signal material the corpus gets), then the bookmark ("where should we pick up?" — the answer becomes a user-declared Queue entry that outranks agent-minted candidates). Agent summaries at close are forbidden: reading the agent's frame of you just before harvest review contaminates the evidence.

**Waiting Surface**:
The interface region where background work waits: pending questions, open Expeditions, parked Soundings, the Activity Log. The replacement for notifications — the user walks in; nothing walks out.

**Direction**:
A line of inquiry the agent is pursuing. Born three ways: declared by the user, emergent from Snippet analysis, or injected by the Randomizer.

**Randomizer**:
The serendipity mechanism: it injects questions outside every active Direction so the Wiki does not overfit to well-trodden territory. Random means shuffle, never invent — draws come only from the user's own forgotten Snippets (resurfacing, weighted toward the untouched) or from user-curated decks. The agent may not generate random questions and may not veto a draw.

**Protocol**:
A question's category, defined by what it takes to answer well: the answerer's prerequisites (time, sources, reflective state — episodes need a 30-second retrieval budget, not just an episodic question), the elicitation technique (five-slot episode probe, triadic construct elicitation then laddering, critical decision method, momentary state probe), and the Q&A screen's presentation. Techniques differ in yield, not in access: Protocol selection is a measurement question — track kept-Snippets-per-exchange, switch when yield drops. Open set; Protocols are data, not an enum.
_Avoid_: category, question type

**Mode**:
The user's self-declared current state — time available, energy, setting — plus a Target. A constraint on what is askable now, never the objective: comfort does not predict yield, and low-effort Modes bias the corpus toward abstraction, so Facet distribution is tracked per Mode. Deferring a question to a fitting Mode is a first-class move.
_Avoid_: mood, context

**Target**:
What a sitting maps, declared with Mode: the self, or a Domain the user knows. The Target licenses the Protocol family — Soundings and life-story instruments for the self; Critical Decision Method, laddered grids, and concept sorting for Domains. Declared explicitly because an open "what's on your mind?" defaults inward.

**Domain**:
A region of the user's knowledge or craft treated as first-class Wiki territory — a technology, practice, or field. Domain Snippets are knowledge in the user's words; Domain Contradictions hone the user's technical model; Domain Pieces are documentation, courses, essays. Skill claims still cite performance (Emergent Outputs), never self-report.

**Question Source**:
Where a question comes from; its Provenance and its license. Seven sources, each licensed by a situation: Bank draw (openings, unmapped territory — deliberately first, weak-early), Composed follow-up (a Red Light in the live thread; must quote the user verbatim), Gap-fill (a Bud failure, half-Construct, or Arrangement Gap — the default), Instrument step (a Sounding or structured procedure; suspends selection while active), Randomizer draw (dry spell or stale region; the agent may not veto it), Still-true revisit (aged avowal or seeded claim — always asked a different way; one flipped answer is noise, not a Contradiction), Verification (mostly forbidden — show the claim in the open Wiki instead).

**Red Light**:
A feature of the user's last utterance that licenses a composed follow-up: an odd or loaded term, a referent named but unexplored, an abstraction with no episode under it, a pole without its contrast, a cause claimed without its event.

**Resonance**:
The every-turn search of the vault for past Snippets that echo or clash with what the user just said. The archive participates in the live conversation; a clash is the strongest available signal.

**Juxtaposition**:
The question a Resonance clash licenses: present utterance and past Snippet quoted verbatim, side by side — "same thing?" A live convergence check; its answer feeds Contradiction detection in the open rather than silently.

**Emit Form**:
The gate on what shape a question may take before it enters the Queue: every composed question must quote a verbatim substring of the turn that licensed it (except the lexical channel, whose shared phrase is the connection), must not parrot the turn back, must not be conversation-referential, and must not be a degenerate composition. Enforced at compose/mint time by one predicate pipeline in `src/language/` — every composed path runs the same gate through one helper, so a question that violates it never reaches the person. `queue.add()` is not the gate: it only elides disfluencies, and the gate needs the asked-context the queue does not hold. The gate and the form it enforces live together in `src/language/` — the question's shape is a language property, not a queue concern.

**Queue**:
The durable store of pending questions, surviving sessions. Holds deferred questions, open Expeditions, and parked Soundings (depth kept). Each entry carries its Source license, Mode needs, sharpness, Direction, and horizon. Drawing is filtered by Mode needs, sharpness, horizon, Target, and exposure/engagement — parked pointers never draw — then Facet-balanced, then picked top-k at random (never argmax). License is not a draw filter: it gates sourcing at the mechanism level (sounding/license.ts, randomizer/license.ts).

**Engagement**:
The sitting-policy ledger the draw consults: when a sitting started and how the person has been replying. A fresh sitting draws without penalty; a thread that got two disengaged replies in a row is deferred rather than pushed again. The ledger is the Queue's own state (`src/queue/engagement.ts`), not a transcript read — the draw decides from policy, the archive records what actually happened.

**Clerk**:
The agent's background role: it works the Docket continuously, between and during sittings. Single writer to the Wiki — parallel helpers never write.

**Docket**:
The Clerk's standing task queue, always populated: re-reading new Snippets against the Wiki, writing readings, detecting Contradictions, minting questions, proposing Arrangements, rebuilding indexes. Finished work waits on the interface; no task ever contacts the user. The user contacts the agent by opening the app — agent initiative ends at the app's edge.

**Activity Log**:
The append-only stream of everything the system does — deterministic events (index rebuilt, entries expired, files written) and agentic events (question minted, cut proposed, fabrication dropped) — visible on the interface. The system's pulse and the user's audit trail: every agent act is inspectable after the fact, which is what makes background work trustworthy.

**Expedition**:
A question with an external-research prerequisite and a days-long horizon: it sends the user out to read or investigate, then asks for the reflection — what surprised you, what does it change — because only the reflective turn is person-bearing. Licensed by a well-cited interest the wiki cannot deepen from self-report. Sits open and visible until answered.

**Sounding**:
A consent-gated descent: a chained line of questions where each answer becomes the next question's rung, reaching beliefs, epistemics, and the user's own categories. Stops at convergence or 8–12 rungs. Discomfort triggers a consent gate — continue, park (depth kept), or another day — and is recorded as coreness signal, never weaponized. Belongs late in a session.

### Composition

**Emergent Output**:
Anything grown from the Wiki: a written Piece, a learned skill, a built capability — an open-ended set. For skill claims, the Emergent Output is the evidence.

**Coach**:
A per-capability role the agent plays: half log (quests, artifacts, and sessions gathered per Direction — doubling as skill-claim performance evidence), half advice. Next steps are minted doing-quests; follow-ups are composed questions licensed by a quest's return; reflection on learning is elicited and harvested like anything else. Advice is Marginalia-class, in-app only, choice-expanding (options, never prescriptions), and guilt-free by construction — no streaks, no shaming; dormancy stays signal, never debt.

**Piece**:
A document composed by stacking Snippets — and only Snippets: prose the user writes while composing is harvested like any other prose, so a Piece never contains words that lack evidentiary standing. The agent proposes; the user reviews and rearranges. One kind of Emergent Output. May hold several candidate Arrangements of the same material until the user settles. A Piece is never finished — it is **set down**, reversibly: minting from its Gaps stops, the Arrangement stays editable, and picking it up resumes. Dormancy is signal, never debt.

**Arrangement**:
One ordering of pinned Snippet versions — the same Snippets can stack as chronology, argument, or contrast. Carries skeleton Marginalia naming the role of each Snippet. Structurally just an ordered list, so alternatives are cheap.

**Gap**:
An explicit empty slot in an Arrangement where no Snippet bridges a leap. Visible in the reviewer; backed by a queued question. Never filled by agent prose.
