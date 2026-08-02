---
labels: [wayfinder:map]
title: "Elicit — the build map"
created: 2026-08-01
---

# Elicit — the build map

## Notes

Elicit: local-only agentic elicitation → human-shaped wiki from the user's
verbatim prose. The domain model is CANON in `CONTEXT.md` (36 terms) and
`docs/decisions/elicit.md` (Q-1..Q-39); no ticket re-opens a locked decision
without an explicit escalation. Slice 1 (interview loop) is built; slice 2
("it remembers you") is executing via the approved plan
`docs/superpowers/plans/2026-08-01-it-remembers-you.md`.

Standing preferences for every session working this map:
- Build execution uses `omp -p --auto-approve` subagents (user-approved),
  orchestrated per executing-plans; plans get reviewer rounds before dispatch.
- All inference local: chat `192.168.0.229:11434/v1` (qwen3.6:35b), embeddings
  `192.168.0.229:11434/v1` (qwen3-embedding / nomic). Never a hosted API.
- Harness-testing runs go FAST (Micah, 2026-08-02): any ticket that tests the
  harness itself — plumbing acceptance, end-to-end smoke, drain mechanics —
  runs bonsai-27b (`192.168.0.229:8088/v1`) as BOTH elicitor and clerk
  (`ELICIT_CLERK_BASE_URL=http://192.168.0.229:8088/v1
  ELICIT_CLERK_MODEL=bonsai-27b`). Exception, by construction: a measurement
  ABOUT the clerk model (op-contract rate, parse-rate ratchet, RESULTS runs)
  keeps qwen3.6:35b — the number names the model it measures, and a bonsai
  number does not transfer.
- Markdown is truth; invariants are enforced in code and tests, not prompts.
- Skills: /grilling + /domain-modeling for design tickets; /writing-plans +
  /executing-plans for build tickets; /research for research tickets.
- Slice hypotheses are checked by Micah's real sessions, recorded in
  RESULTS.md files — record, don't gate.
- Staged mechanisms live in `docs/backlog.md`; tickets absorb them by slice.

Tracker: local markdown (this dir). Tickets in `tickets/NNN-*.md`; claim =
`assignee` field; blocking = `blocked_by` frontmatter list; frontier = open,
unassigned, all blockers closed.

The destination this map drives toward is drawn as a workflow board —
human, machine and vault lanes with the jargon spelled out in place:
`docs/ideal-state-board.md` (in-repo record; live copy at
http://localhost:3002/?board=elicit-ideal-state).

## Decisions so far

- [Fix: the corpus is 90% construct](tickets/042-facet-balance.md) — facet
  intent on questions, an episode deck (193) beside the construct deck, the
  Q-13 balance filter in shadow mode, and a target default that stops
  defaulting inward. The agent-built "you" filter that caused half the bias
  is gone.
- [Grill: composition](tickets/009-grill-composition.md) — Q-37..Q-42:
  passive offers, distinct-principle arrangements, annotate-never-act gaps
  and pins, user prose in a Piece becomes a Snippet, Pieces are set down
  never finished, and the slice ships zero-LLM first.
- [Grill: Soundings](tickets/011-grill-soundings.md) — Q-43..Q-47: consented
  entry, an always-present gate with no inferred distress, ladders parked
  whole and resumed compacted, structural endings, and the descent becoming
  the rest of the sitting with the close reserved.
- [Fix: resonance honesty](tickets/036-resonance-honesty.md) — README now
  says what the trigram index actually does ("what matches is the phrasing,
  not the meaning"); tests/resonance-paraphrase.test.ts holds the pairs the
  embedding channel must start catching and records today's recall: zero.
- [Fix: activity stream reads as sentences](tickets/038-activity-legibility.md) —
  render-layer formatter; ULIDs stay in the JSONL audit trail, never on the
  reading surface.
- [Adversarial self-eval](../eval-2026-08-02-claude-adversarial.md) (not a
  ticket — a peer Claude session's red-team of the whole app) — found the
  canon-string drift, harvest silent failure, validator gaps, and the
  resonance honesty problem. Tickets 034-037 carry the fixes; the
  canon-conformance test (tests/canon.test.ts) closes the class of bug
  where the test and the implementation share a wrong oracle.

- [Finish slice-2 execution](tickets/001-finish-slice-2.md) — landed green
  through four fix waves; the practice of live-diagnosing Micah's real
  sittings found every load-bearing bug the tests missed.
- [Slice-2 hypothesis check: real sessions and RESULTS](tickets/002-slice2-results.md) —
  invariants 8/8 on real data; composed openers now dominate session
  starts; no template fallback needed; embedding eval (007) waits for
  ~50 snippets.
- [Fix: probe freedom — loosen generation, tighten validation](tickets/031-probe-freedom.md) —
  repertoire prompt + code guards (no-repeat, no conversation-refs);
  real-model verified: four distinct frames, zero echoes.
- [Fix: wire the Cover memory layer](tickets/030-wire-cover.md) —
  ADR-0002 layer 3 live: content-bearing consolidation summaries,
  model-stamped (Q-34), failure-isolated.
- [Grill: the Clerk slice — claim pipeline and contradiction detection](tickets/006-grill-clerk.md) —
  eight decisions locked as Q-28…Q-35: immediate minting, the six-op write
  contract with mechanical Status, the re-measure-gated contradiction
  pipeline, add-only lint, three-tier identity registry, six editing verbs,
  model stamps with lazy re-annotation, shadow-first calibration.
- [Voice input: in-process Parakeet STT for sittings](tickets/018-voice-input.md) —
  shipped: sherpa-onnx child process (omp's stack, omp's model cache) +
  mic → auth-gated /api/transcribe → editable textarea; ratify-by-editing
  preserves Sole Authorship; spoken flag lives on the transcript Turn.
- [Persona eval](../eval-2026-08-02-personas.md) (not a ticket) — a peer
  session ran five personas through the whole app and found what the
  adversarial pass missed: refusals harvested as evidence, domain sittings
  opened on self material, pasted Dickens filed as a personal philosophy, and
  a docket whose latency grows with the vault. Tickets 044–047 are its issue.
- [Fix: harvest proposes refusals as evidence](tickets/044-harvest-semantic-filter.md)
  — a structural admissibility gate upstream of the model's own `standalone`
  boolean. Deflections, refusals and comments on the question stay lineage;
  content-free turns are never sent for extraction at all.
- [Fix: queue draws ignore Target](tickets/045-queue-target-filter.md) — Target
  travels from the sitting that minted a question, read back from the session
  transcript, and `draw()` filters on it hard before the top-k pick. Absent
  stays absent and serves either sitting.
- [Honesty: authorship vs wording](tickets/046-authorship-vs-wording.md) — Sole
  Authorship guarantees that no agent wrote or reworded your words. It does
  not guarantee you are the author: pasted text is indistinguishable from
  reflection, and CONTEXT.md and the README now say so.
- [Fix: the docket ran inside /harvest](tickets/047-async-docket.md) — it now
  runs behind the response, single-flight with one replayed trigger. Measured
  against the real model: 1ms response, 127s docket.

- [Grill: the polarity blind spot](tickets/052-grill-polarity-channel.md) —
  Q-52: the clash channels retrieve ABOUTNESS; polarity is judged one layer
  down by `judgeOpposition` against verbatim poles. Negation-blindness is what
  makes an opposed pair a near-neighbour, so it is the mechanism, not the bug.
  The real gap is precision and observability: instrument the pool before
  adding an NLI channel.

- [Grill: re-measure separation](tickets/054-grill-remeasure-separation.md) —
  Q-53: a re-measure counts only from a different SITTING, and the confirming
  reading's session must differ from both claims' sessions. The frame, not the
  clock — lability lives in a continuous conversation, which a session boundary
  ends and elapsed time does not track. `remeasure-expired` is the one outcome
  that earns the pair a second attempt.

- [Grill: context-dependence](tickets/055-grill-context-dependence-instrument.md)
  — Q-54: it is a RANGE refinement, not a third Contradiction type; Q-21 made
  Range mandatory precisely so the boundary is expressible, and SUPERSEDE
  already narrows it. The dissolution branch currently throws the boundary
  away. Two doors, and the zero-LLM lint door ships first so the highest-value
  output does not hang on the flakiest machinery.

- [Grill: the degradation ladder](tickets/050-grill-degradation-ladder.md) —
  Q-55: two rungs and a composing floor. Drop facet balance, then re-admit
  `user-declared` entries; never relax status, Target, modeNeeds or horizon.
  The floor is not a failure state — a freshly composed question beats a stale
  banked one, so a long cascade makes the system worse at every rung. The
  system drops its own inferences before the person's declarations.

- [Grill: the degradation ladder](tickets/050-grill-degradation-ladder.md) —
  Q-55: two rungs and a composing floor. Drop facet balance, then re-admit
  `user-declared` entries; never relax status, Target, modeNeeds or horizon.
  The floor is not a failure state — a freshly composed question beats a stale
  banked one, so a long cascade makes the system worse at every rung. The
  system drops its own inferences before the person's declarations.

- [Grill: the degradation ladder](tickets/050-grill-degradation-ladder.md) —
  Q-55: two rungs and a composing floor. Drop facet balance, then re-admit
  `user-declared` entries; never relax status, Target, modeNeeds or horizon.
  The floor is not a failure state — a freshly composed question beats a stale
  banked one, so a long cascade makes the system worse at every rung. The
  system drops its own inferences before the person's declarations.

- **Q-56 — Q-35 governs selection, bounds ship live.** A shadowed cap is not a
  cap: it writes "I would have stopped at 2" while the system mints without
  limit, which is worse than no mechanism, because the mechanism generated the
  work. Caps, quotas and rate limits are live at birth and owe a
  `threshold-clipped` record instead. Amends Q-35 in scope rather than carving
  a per-threshold exception. (No ticket — ruled directly, 2026-08-02.)

- **Q-56 — Q-35 governs selection, bounds ship live.** A shadowed cap is not a
  cap: it writes "I would have stopped at 2" while the system mints without
  limit, which is worse than no mechanism, because the mechanism generated the
  work. Caps, quotas and rate limits are live at birth and owe a
  `threshold-clipped` record instead. Amends Q-35 in scope rather than carving
  a per-threshold exception. (No ticket — ruled directly, 2026-08-02.)

- **Q-56 — Q-35 governs selection, bounds ship live.** A shadowed cap is not a
  cap: it writes "I would have stopped at 2" while the system mints without
  limit, which is worse than no mechanism, because the mechanism generated the
  work. Caps, quotas and rate limits are live at birth and owe a
  `threshold-clipped` record instead. Amends Q-35 in scope rather than carving
  a per-threshold exception. (No ticket — ruled directly, 2026-08-02.)

- **Q-57 — the importer has one door: a folder of files.** The app never opens
  a socket; Leaflet and Pixelfed become export scripts. Not ADR-0001 —
  separability: a feed hands over rendered HTML, and the quotations that nearly
  entered the corpus were catchable only in markdown source. Dates come from
  frontmatter or the file is refused. (Resolves two of ticket 058's opens.)

- **Q-58 — the import review IS the harvest review**, pointed at an imported
  piece: same surface, three verbs (approve / trim / discard), no `restate`.
  One change forced by the source — the piece renders whole with cuts marked
  in place, because misleading excision is the only failure a review can catch
  and judging it needs the surrounding text. Per-item, resumable, no batch
  accept. Extraction runs ahead in the docket. (Resolves ticket 058's design
  question and its long-running open.)

- **Q-58 — the import review IS the harvest review**, pointed at an imported
  piece: same surface, three verbs (approve / trim / discard), no `restate`.
  One change forced by the source — the piece renders whole with cuts marked
  in place, because misleading excision is the only failure a review can catch
  and judging it needs the surrounding text. Per-item, resumable, no batch
  accept. Extraction runs ahead in the docket. (Resolves ticket 058's design
  question and its long-running open.)

- **Q-58 — the import review IS the harvest review**, pointed at an imported
  piece: same surface, three verbs (approve / trim / discard), no `restate`.
  One change forced by the source — the piece renders whole with cuts marked
  in place, because misleading excision is the only failure a review can catch
  and judging it needs the surrounding text. Per-item, resumable, no batch
  accept. Extraction runs ahead in the docket. (Resolves ticket 058's design
  question and its long-running open.)

- **Q-59 / Q-60 — imported item identity.** Identity is the content hash; a
  changed file is a NEW dated sitting, never a new snippet version, because
  versioning would date 2027 prose to 2018 and corrupt Q-50 at the root — the
  edited post becomes its own evidence of drift instead. Imported items carry
  no Target: Q-55 made Target un-relaxable, so wrong is permanent and absent
  serves both. (Ticket 058's open questions are now all ruled.)

- [Task: git init the vault](tickets/049-vault-git-history.md) — Q-61: done,
  first commit `6198cec` as `elicit-clerk`. History, not backup; ticket 017's
  no-offsite-copy risk still stands. Done now because initialising an empty
  vault costs one command while doing it after the import makes the first
  commit a witness that saw nothing. The docket commits per run; a dirty tree
  at boot is committed, never refused. Deletion is now hard — decided, not
  discovered.

- [Task: git init the vault](tickets/049-vault-git-history.md) — Q-61: done,
  first commit `6198cec` as `elicit-clerk`. History, not backup; ticket 017's
  no-offsite-copy risk still stands. Done now because initialising an empty
  vault costs one command while doing it after the import makes the first
  commit a witness that saw nothing. The docket commits per run; a dirty tree
  at boot is committed, never refused. Deletion is now hard — decided, not
  discovered.

- [Task: git init the vault](tickets/049-vault-git-history.md) — Q-61: done,
  first commit `6198cec` as `elicit-clerk`. History, not backup; ticket 017's
  no-offsite-copy risk still stands. Done now because initialising an empty
  vault costs one command while doing it after the import makes the first
  commit a witness that saw nothing. The docket commits per run; a dirty tree
  at boot is committed, never refused. Deletion is now hard — decided, not
  discovered.

- [Build: ingest nine years of published writing](tickets/057-ingest-published-writing.md)
  — 139 snippets across 19 dated sittings, 2017-2026, in the vault. 295 cuts
  proposed, 139 kept; seven were other people's words (Mol, Ahmed, Shreyas) and
  drove Q-51's cut-level rule into code. No Readings — the dry run kept text
  only, so Claims wait on a reading pass.
- [Fix: queue entries never marked answered](tickets/041-mark-answered.md) —
  closed by the Clerk plan's T17. `answeredAt` is written beside the status and
  the elicitor is its caller; status and time are one fact.

- [Build: ingest nine years of published writing](tickets/057-ingest-published-writing.md)
  — 139 snippets across 19 dated sittings, 2017-2026, in the vault. 295 cuts
  proposed, 139 kept; seven were other people's words (Mol, Ahmed, Shreyas) and
  drove Q-51's cut-level rule into code. No Readings — the dry run kept text
  only, so Claims wait on a reading pass.
- [Fix: queue entries never marked answered](tickets/041-mark-answered.md) —
  closed by the Clerk plan's T17. `answeredAt` is written beside the status and
  the elicitor is its caller; status and time are one fact.

- [Build: ingest nine years of published writing](tickets/057-ingest-published-writing.md)
  — 139 snippets across 19 dated sittings, 2017-2026, in the vault. 295 cuts
  proposed, 139 kept; seven were other people's words (Mol, Ahmed, Shreyas) and
  drove Q-51's cut-level rule into code. No Readings — the dry run kept text
  only, so Claims wait on a reading pass.
- [Fix: queue entries never marked answered](tickets/041-mark-answered.md) —
  closed by the Clerk plan's T17. `answeredAt` is written beside the status and
  the elicitor is its caller; status and time are one fact.

- **Standing for this campaign (2026-08-02):** work the map to exhaustion.
  Dispatch agents on disjoint files, verify each against the tree rather than
  its own report, commit at milestones. Do not stop between waves.

- **Standing for this campaign (2026-08-02):** work the map to exhaustion.
  Dispatch agents on disjoint files, verify each against the tree rather than
  its own report, commit at milestones. Do not stop between waves.

- **Standing for this campaign (2026-08-02):** work the map to exhaustion.
  Dispatch agents on disjoint files, verify each against the tree rather than
  its own report, commit at milestones. Do not stop between waves.

- [Build: render sitting cadence](tickets/056-cadence-on-the-waiting-surface.md)
  — one dimmed sentence on the waiting surface, composed server-side so the
  Q-24 wording is testable. Imported sittings are excluded: 19 transcripts
  dated 2017-2026 would otherwise report a last sitting nobody sat for.

- [Build: render sitting cadence](tickets/056-cadence-on-the-waiting-surface.md)
  — one dimmed sentence on the waiting surface, composed server-side so the
  Q-24 wording is testable. Imported sittings are excluded: 19 transcripts
  dated 2017-2026 would otherwise report a last sitting nobody sat for.

- [Build: render sitting cadence](tickets/056-cadence-on-the-waiting-surface.md)
  — one dimmed sentence on the waiting surface, composed server-side so the
  Q-24 wording is testable. Imported sittings are excluded: 19 transcripts
  dated 2017-2026 would otherwise report a last sitting nobody sat for.

- [Build: the degradation ladder](tickets/061-build-degradation-ladder.md) —
  Q-55 in code; the filter chain is data, so rung 2 and "which filter emptied
  the pool" are one function rather than two. Rung 1 turned out to be a log
  line: facet balance already refuses to empty a pool.

- [Research: embedding channel eval](tickets/007-embedding-eval.md) — measured
  on the real 139-snippet corpus. **0.82 was inert, not imprecise**: max cosine
  over 9,591 pairs is 0.808, so it admitted zero pairs and scored 0/8 —
  the lexical baseline through a slower mechanism. Now 0.70 on
  `qwen3-embedding`, 3/8 at 100% precision, still shadow. Q-52 confirmed on
  real data: rephrased oppositions and genuine paraphrases are one population.

- [Research: embedding channel eval](tickets/007-embedding-eval.md) — measured
  on the real 139-snippet corpus. **0.82 was inert, not imprecise**: max cosine
  over 9,591 pairs is 0.808, so it admitted zero pairs and scored 0/8 —
  the lexical baseline through a slower mechanism. Now 0.70 on
  `qwen3-embedding`, 3/8 at 100% precision, still shadow. Q-52 confirmed on
  real data: rephrased oppositions and genuine paraphrases are one population.

- [Research: embedding channel eval](tickets/007-embedding-eval.md) — measured
  on the real 139-snippet corpus. **0.82 was inert, not imprecise**: max cosine
  over 9,591 pairs is 0.808, so it admitted zero pairs and scored 0/8 —
  the lexical baseline through a slower mechanism. Now 0.70 on
  `qwen3-embedding`, 3/8 at 100% precision, still shadow. Q-52 confirmed on
  real data: rephrased oppositions and genuine paraphrases are one population.

- [Build: Randomizer draws](tickets/026-randomizer-build.md) — deck shuffle and
  depth-stratified resurfacing in `src/randomizer/`, with Q-18 enforced by the
  absence of any model handle. Stratification is band→sitting→snippet because
  76 of 139 snippets are one sitting; snippets are dated by their sitting, not
  by capture, or the whole import would read as "recent".

- [Build: Randomizer draws](tickets/026-randomizer-build.md) — deck shuffle and
  depth-stratified resurfacing in `src/randomizer/`, with Q-18 enforced by the
  absence of any model handle. Stratification is band→sitting→snippet because
  76 of 139 snippets are one sitting; snippets are dated by their sitting, not
  by capture, or the whole import would read as "recent".

- [Build: Randomizer draws](tickets/026-randomizer-build.md) — deck shuffle and
  depth-stratified resurfacing in `src/randomizer/`, with Q-18 enforced by the
  absence of any model handle. Stratification is band→sitting→snippet because
  76 of 139 snippets are one sitting; snippets are dated by their sitting, not
  by capture, or the whole import would read as "recent".

- [Fix: the activity feed's kind list](tickets/063-log-format-kind-drift.md) —
  the emitted set is now DERIVED from the tree, not restated. It found 26
  unrendered kinds where the ticket guessed four, and caught four more that
  landed mid-task. Its own scanner had the same blind spot it was built to fix
  — one apostrophe in a comment hid a whole file — now closed with two guards
  that were proved to bite.

- [Fix: harvester drops episodes and mislabels facet](tickets/037-harvest-facet-bias.md)
  — measured against the 295 hand-marked cuts before anything changed. **The 044
  gate rejected 0 of 295** — inert on real prose since it shipped, with all its
  tests passing. `episode` 6% → 30%, marker-less `intention` 6 → 0, three cuts
  carrying a stance in the facet field (reaching disk) → 0. `world`/`log` is 76%
  of the junk and was NOT fixed: six predicates measured, best 74% precision at
  18% recall against a 53% baseline. The numbers are in the code.

- [Build: semantic resonance for snippets](tickets/053-embeddings-before-the-clerk.md)
  — 7/8 recall by RANK against the incumbent's 0/8. It ranks rather than
  thresholds because every caller already wants the best few, so the caller's
  own k is the bound. It could not share T18's cache file: that prune would
  have deleted every snippet vector on the first docket run. Not yet wired —
  ticket 068 names every call site.

- [Fix: the embedding channel is one run behind](tickets/067-embedding-one-run-lag.md)
  — a second prime between the sweep and lint, narrowed to what the sweep
  changed. The narrowing filters the work list, never the graph: pruning
  against a subset would have deleted every vector the first prime wrote.

- [Fix: the harvest diagnostics reach nobody](tickets/066-harvest-diagnostics-surface.md)
  — six counters now reach the activity line as English with the numbers kept.
  Zeros render as words, because a check that renders as nothing at zero cannot
  be told from a check that is not running. Also found that ticket 044's
  acceptance ran on the ELICITOR while printing the clerk model's name.

- [Build: the reading pass](tickets/062-reading-pass-imported-corpus.md) — 136
  of 139 read; the corpus is wiki, not just evidence. 037's episode fix
  generalises to 18.4%. Three interrogatives resist a proposition-extracting
  prompt, and `episodeAnchoredTurns: 0` across all 136.

- [Fix: WikiReport's measurements reach no surface](tickets/071-wikireport-reaches-no-surface.md) — surfaced WikiReport counters on a new `wiki-run` Activity Log line and added a `contradiction-opened` event kind so T16's RESULTS can be written from a real run.

- [Grill: the embedding channel's cross-sitting ceiling](tickets/064-embedding-cross-sitting-ceiling.md) —
  Q-65: same-sitting pairs rank BELOW cross-sitting in the candidate pool,
  pooled never excluded — drift fills the judgment quota first, incoherence
  stays findable. Rank-not-threshold taken up as ticket 083 (ClashChannel
  returns an ordered quota-bounded list; three measurements force it).

- [Grill: snippets that point outside themselves](tickets/072-dangling-referents.md) —
  all three layers ruled in: render the stored eliciting question, stamp a
  mechanical `Provenance.context` window (backfillable via 024's
  locate-by-substring), and a model-resolved referent annotation last,
  evaluated before it ships. Context is lineage, never corpus. Builds are
  tickets 073 and 074 (074 blocked on 073).

- [Fix: the 044 gate's own counter has never reached a line](tickets/069-inadmissible-drops-unsurfaced.md)
  — `cutsSeen`, `inadmissibleDrops`, `contentFreeSkips` now reach the
  activity line, rendered by 066's rules (zeros as words).

- [Fix: the sweep can strand its own re-measure](tickets/070-stranded-remeasure.md)
  — an answered re-measure is judged BEFORE the sweep runs; Q-53's
  predicate keeps reading current cites rather than a mint-time snapshot.

- [Build: antecedent context](tickets/073-antecedent-context.md) —
  `Provenance.context` captured at ingest (mechanical 2-sentence window),
  backfilled onto 99/139 vault snippets by locate-by-substring, rendered
  dimmed on the harvest-review card. Lineage, never corpus.

- [Fix: "left for the next run" promises a run that nothing schedules](tickets/075-docket-has-no-next-run.md)
  — restart-proof drain chain via claimable deferral records on disk, and
  the still-true rotation rides a persisted cursor instead of re-slicing
  the same two snippets.

- [Build: a mechanism-exposure registry](tickets/077-mechanism-exposure-registry.md)
  — `src/registry.ts` declares live|shadow|unwired for every exported
  mechanism; a test sweep fails any undeclared export, so wiring drift is
  a red suite, not a memory.

- [Fix: a probe the guard rejected twice is emitted anyway](tickets/079-twice-rejected-floor.md)
  — a fixed, zero-LLM floor probe from the protocol's own material replaces
  the twice-rejected text when the fallback draw is empty.

- [Build: wire semantic resonance into the surfaces that use resonate()](tickets/068-wire-semantic-resonance.md)
  — `resonateHybrid` live in the turn endpoint, semantic index built at
  boot and primed in background; a semantic juxtaposition quotes only the
  snippet's own words (053's recommendation, adopted).

- [Build: antecedent context on the wiki surface and randomizer draw](tickets/080-context-on-reading-surfaces.md)
  — the wiki quote block and the resurfaced draw now render the dimmed
  question and context; the draw's lineage rides the session response and
  never outlives the opener exchange.

- [Build: ClashChannel returns rank, not a filtered set](tickets/083-clash-channel-rank-contract.md)
  — ordered lists cut to the judgment quota; Q-65 ordering inside;
  `clash.embeddingCosine` demoted to a 0.5 sanity floor; every pair
  stamped `joinsTwoSittings`.

- [Build: record the capture channel on every Snippet](tickets/048-capture-channel.md)
  — all three capture paths set `typed | spoken | pasted`; pasted wins on
  strict character majority; absent stays absent on disk, and nothing
  filters on it.

- [Build: harvest runs behind the sitting](tickets/084-harvest-review-queue.md)
  — /end and /unprompted return in milliseconds; proposals persist to a
  claimable disk record (restart-proof) and wait in a review queue with a
  quiet count; failed is logged distinct from empty.

- [Plan and build: the Clerk slice](tickets/008-build-clerk.md) — CLOSED on
  T16's real-model RESULTS
  ([the document](../superpowers/plans/2026-08-02-the-clerk.RESULTS.md)):
  144/144 ops accepted but all MINT (five branches never exercised — corpus
  shape, not model skill); 144/144 `unconfirmed` is Q-50 working; the wiki
  is a pile until claims share evidence — the correctives are seeding and
  the embedding channel's graduation, not the Clerk; the one live-gate
  opposition is a lexical false positive absorbed by Q-30's person-gate at
  the cost of one queue entry; an 84-minute runaway generation mid-drain
  became ticket 086, fixed before the drain ended. Follow-ups 087/088/089.
  Unblocked: 014-plan-done, 016, 027, 033, 060, 085.

- [Grill: the Seeding slice](tickets/013-grill-seeding.md) — seven rulings,
  Q-66..Q-72: weak prior deleted (Q-50 stands; Confirm is a licence);
  per-region mechanical dating; the review gate survives scale by bounding
  regions (folder subtrees); Reach is offer-only, live; per-region
  authorship, three values; a Link is no new object; repairs are capped
  Buds with no repair surface. Unblocks the Seeding build.

- [Design the Coach (capability outputs)](tickets/016-design-coach.md) — six
  rulings, Q-73..Q-78: coached is user-declared (agent offers only); quests
  are offered as alternative sets, no deadlines, Marginalia-class; returns
  are ordinary capture with quest provenance, no completion rates; one page
  per Direction, no global tab; advice event-licensed with one unread note;
  artifacts are declared pointers whose descriptions harvest — the model
  never opens one. Build is ticket 090 (plan-first).

- [Design the Coach (capability outputs)](tickets/016-design-coach.md) — six
  rulings, Q-73..Q-78: coached is user-declared (agent offers only); quests
  are offered as alternative sets, no deadlines, Marginalia-class; returns
  are ordinary capture with quest provenance, no completion rates; one page
  per Direction, no global tab; advice event-licensed with one unread note;
  artifacts are declared pointers whose descriptions harvest — the model
  never opens one. Build is ticket 090 (plan-first).

- [Design the Coach (capability outputs)](tickets/016-design-coach.md) — six
  rulings, Q-73..Q-78: coached is user-declared (agent offers only); quests
  are offered as alternative sets, no deadlines, Marginalia-class; returns
  are ordinary capture with quest provenance, no completion rates; one page
  per Direction, no global tab; advice event-licensed with one unread note;
  artifacts are declared pointers whose descriptions harvest — the model
  never opens one. Build is ticket 090 (plan-first).

## Fog

- **The outer loop's experience** — re-reading practice, meeting past selves.
  Purpose now LOCKED (Q-27): self-recognition primary; orientation and
  material-mining are side effects. The design still waits for months of real
  claims; when that session comes, it designs FOR drift-watching.
<!-- graduated 2026-08-01: "Emergent outputs beyond essays" → ticket
     "Design the Coach (capability outputs)" after grilling; advice
     constitution locked as Q-24 -->>
- **Wiki-editing UX** — Propagation flow, user-attested claims on screen. The
  mechanics are locked (Q-4, Q-21); the *experience* hangs on the Clerk slice
  producing claims to edit.
- **Selection maturation from usage data** — FSRS as the still-true horizon,
  uptake-as-signal, calibration period. All need weeks of Activity Log and
  queue history before they can be tuned honestly.
- **Model lifecycle** — when qwen3.6:35b gets upgraded: re-annotation batch jobs
  over reading stamps, prompt re-tuning, whether the null-rate on composed
  questions demands the template-assembly fallback. Hangs on slice-2 RESULTS.
<!-- cleared 2026-08-01: "Vault custody" resolved by grilling → Q-25
     (interface password lock rides slice-2 Task 7; vault stays gitignored;
     backup = user's existing file-backup infra, flagged as their action) -->
<!-- cleared 2026-08-01: "Phone-sized sittings" resolved by grilling -> Q-26
     (second-class supported: LAN browser + password gate + phone-width pass
     riding slice-2 Task 7; no app, no sync, no offline) -->
