# HANDOFF — Elicit

Updated: 2026-08-02.

## What a page is

Two planes, one repository. The **Snippet** is the atomic unit: a verbatim
passage of the user's prose, standalone-interpretable without its transcript
(hard gate, Q-1), carrying one Facet reading and one Stance. Versions are
immutable (Q-5); an edit creates v(N+1). The **Wiki** is the agent-authored
model of the person — Claims citing `snippet@version`, interleaved Readings,
Contradictions, and a referent registry. Snippet files hold only prose plus
Provenance; Facet/Stance/reading live in separate `wiki/readings/*.md` files
(Q-4). Pieces compose Snippet versions; all user prose in the system is a
Snippet (Q-40). Everything is markdown under `vault/` (Q-3).

## Who is allowed to write in your voice

Sole Authorship (Q-1): the agent never writes Snippet or Piece prose. Harvest
cuts are exact substrings of the user's text, verified in code — the model
proposes; the substring check drops fabrications without patching them. The
agent contributes questions, Marginalia (seam warnings, stale-pin flags,
skeleton labels, drift readings), and Wiki claims — never body text, never an
edit to the user's words. Q-12 mirrors this on the question side: a composed
question must contain the user's quoted fragment as an exact substring. The
guarantee is about wording, not origin: text pasted from elsewhere is
admissible material the system cannot distinguish from reflection — and the
capture channel that COULD distinguish it is ticket 048.

What may become corpus at all is a separate, structural gate
(`src/harvester/admissibility.ts`, ticket 044), and it runs upstream of the
model's own `standalone` boolean. A refusal, a deflection, or a comment on the
question is lineage: it stays in the transcript and never becomes a Snippet or
a Bud. The gate is deliberately conservative — a false reject destroys words
the person will never see again, so when a case is ambiguous it admits.

## Storage

Plain markdown in `vault/`, editable directly. Immutable Snippet versions
(Q-5) provide the belief-change record. Three layers (ADR-0002): vault truth,
derived indexes (lexical now, embeddings staged — Q-17), and bounded-context
Cover summaries (Marginalia-class, model-stamped). Deleting a derived layer
costs recomputation, never data. Vault is gitignored from the project repo
(ADR-0003 — code and corpus are separate); backup rides the user's existing
file-backup infrastructure. Access is password-gated (scrypt at
`vault/.auth.json`, set from loopback on first run). No environment variable
for the password.

## How questions get chosen

Constraint-then-chance (Q-13): hard filters — license, Mode compatibility,
the declared Target (ticket 045), Facet balance (Q-13, shadow-mode, built by
ticket 042 — NOT Q-42, which is composition's two passes), weak-early
ordering, exposure control — then top-k uniform random. Never argmax; never
scored by fluency or
plausibility. What happens when five hard filters leave an empty pool is
undefined and is ticket 050. Seven question sources, each licensed by a situation: Bank draw
(openings, weak-early), composed follow-up (Red Light — must quote verbatim),
Gap-fill, Instrument step, Randomizer draw, Still-true revisit (always asked
differently — Q-14), and Verification (mostly forbidden — show the claim
instead — Q-15). The Randomizer draws only from the user's own forgotten
Snippets or curated decks; the agent may not veto a draw (Q-16, Q-18).
Generation follows freedom-in-generation, rigidity-in-validation (Q-36):
code guards at the boundary — no repeats, no conversation references, no
parroting.

## What happens to a contradiction

Three cases, never silently resolved. **Diachronic** (the person changed): the
tension *is* the finding — both versions kept, timestamped, the question is
"what moved you?" **Context-dependent**: both true, the missing work is naming
the boundary — probably the commonest case and the most valuable output, and
it has no instrument (ticket 055). **Synchronic** (both assert the present):
the pipeline (Q-30) — candidates from lexical, referent, and embedding
channels → exactly one ask-differently re-measure question → a Contradiction
opens only when code-verified evidence confirms opposition. One flipped answer
never opens a Contradiction (Q-14). A Contradiction invalidates only claims
citing both poles; claims resting on one alone stay live. Tension pages are
the most valuable objects in the system.

**Two known holes in that pipeline, both filed 2026-08-02.** None of the three
channels can see POLARITY — lexical cannot see paraphrase at all (0/8
measured), and embeddings put "estimates are for coordination" and "estimates
are not for coordination" almost on top of each other. So opposition candidates
may never form, and stage 2 only fires on a candidate (ticket 052). And Q-30
does not say WHEN the re-measure happens: asked three minutes later it measures
the interview, not the belief, which is the exact conflation Q-14 exists to
prevent (ticket 054).

## Placement authority

The Clerk files automatically via the Docket — every harvested reading mints
or updates a Claim on the next run (Q-28). No "where should this go?" prompt.
Every placement is logged to the append-only Activity Log (Q-23); every
mechanism graduates from shadow-first to live individually (Q-35). The Queue
carries Direction; Arrangements are proposed, never auto-placed. Q-37: Piece
proposals are passive margin notes licensed by citation-cluster density, never
escalated.

## Belief mode vs. craft mode

Every sitting declares a Target: **self** or **domain** (Q-19). Beliefs come
under direct questioning — Soundings (consent-gated descent, 8–12 rungs,
structural ending — Q-43..Q-47) and life-story instruments. Craft is reached
through Domain instruments co-equal with self instruments: Critical Decision
Method, laddered grids, concept sorting. Skill claims cite performance
evidence (Emergent Outputs), never self-report — the Coach role (Q-24) logs
quests and artifacts per Direction, offers Marginalia-class advice
(choice-expanding, guilt-free by construction).

## Epistemic status vocabulary

Two registers, different planes. **Stance** (7 values on Snippets): avowal,
self-observation, report-of-fact, pole-preference, commitment,
uncertainty-marked, superseded. **Claim Status** (4 values): unconfirmed,
evidenced, user-attested, contested. Status transitions are mechanical (≥2
independent cites → evidenced; Propagation → user-attested; open Contradiction
→ contested), never model-written (Q-29). No confidence numbers anywhere;
coreness is computed from the citation graph and never stored (Q-21).

**"Independent" means CROSS-SITTING** — Q-50, ruled 2026-08-02, ticket 051
closed. Two versions of one snippet are one piece of evidence (Q-5); two
distinct snippets from the SAME sitting are also one piece of evidence, one
thought said twice. Resolved mechanically through `Provenance.session`, never
model-judged. Cites additionally separated by Facet or question source are the
stronger tier and are recorded in `why`, though nothing acts on that yet.

The plan had guessed the weaker rule (distinct snippet ids) and its own open
question named the cost: a single rich sitting then cannot produce an evidenced
claim. That is the intended behaviour. **The corpus today is mostly one long
sitting, so the first Clerk runs will show a wall of `unconfirmed` — that is
the vocabulary working, not failing. Do not "fix" it by loosening the rule.**

## What the essay pipeline actually outputs

Assembly, never drafting. Composition ships in two passes (Q-42): Pass 1 is
zero-LLM — manual initiation, deterministic chronological Arrangement,
reorder/remove/write-new-prose/insert-Gap, export to markdown with pinned
versions inlined. Pass 2 adds model-candidate Arrangements under distinct
organizing principles (chronology, argument, contrast — Q-38), skeleton
Marginalia, stale-pin lint. Agent OFFERS (Q-37) are passive dimmed notes on
the waiting surface; the user initiates. A Piece is set down, never finished
(Q-41) — dormancy is signal, never debt. User prose written inside a Piece
becomes a Snippet (Q-40): one rule, no second class of words.

## Friction budget

Session shape: Mode declaration first (time, energy, target — typed as a
sentence, not dropdowns), one question at a time on a focus-mode page,
harvest at close. The Queue persists across sessions; the Waiting Surface
replaces notifications — zero outbound contact (Q-22). Phone sittings are
second-class: LAN browser behind the password gate (Q-26). Voice input via
Parakeet STT in-process (ONNX, ~600 MB, CPU-only). The two close moves (Q-20:
open door + bookmark) are reserved beyond the Mode-declared question budget;
Soundings convert the remaining budget into a capped rung allowance (Q-47).

## The test for whether it's working

Not page count. Two signals: it asks a question the user cannot answer glibly,
and the user finds a stance they forgot they held. If neither happens in a
month, the question generator is ungrounded — interviewing a generic person
who happens to be nearby. The adversarial eval (2026-08-02) produced exactly
one such moment in a genuine exchange; the Clerk slice's claim graph is the
mechanism that makes drift-watching structural rather than anecdotal. The
standing honesty check: `tests/resonance-paraphrase.test.ts` holds 8
belief/restatement pairs and records that the trigram index catches zero of
them.

Read T18 before assuming it closes that gap. T18 embeds CLAIM BODIES, keyed by
`claimId`, as the third ClashChannel — it is the contradiction channel and
nothing else. `resonate()`, which feeds resonance, juxtaposition and every
composed opener the user meets each sitting, stays a 3-consecutive-word
exact-match index after the whole Clerk slice ships. A snippet-level embedding
channel is ticket 053, and the argument for landing it BEFORE the Clerk is that
until it exists, the built system is a well-made prompt generator and there is
no way to measure how good the prompts are.

## What's built vs. what's designed

**Built** (slices 1–2): the interview loop end-to-end — Mode → exchange →
harvest → close, with composed openers, resonance/juxtaposition (lexical
only), durable queue, Cover memory, activity log, voice input, in-app auth,
unprompted entry, defer, expeditions, protocol registry, waiting states,
facet-intent filtering (shadow-mode).

**Built 2026-08-02, the long campaign.** 1136 tests, tsc clean.

- **The Clerk slice, Waves 0–4 in progress.** Committed: the wiki contract and
  thresholds; `ClaimStore`; mechanical status; zero-LLM lint; reading→ops mint;
  the contradiction judge; the ops executor; the identity registry; the lexical
  and referent clash channels; the embedding channel; the five wiki jobs; and
  the docket integration. **T14 (routes) is in flight; T19 and T15 follow,
  serial.** Plan: `docs/superpowers/plans/2026-08-02-the-clerk.md`.
- **Your corpus is in the vault.** 139 snippets across 19 dated sittings,
  2017-2026, from nine years of published writing (057). Reviewed twice: the
  harvest proposed 295 cuts, triage kept 139, and seven were other people's
  words — four sentences of Annemarie Mol, one of Sara Ahmed, one of Shreyas —
  which drove Q-51's cut-level rule into code. `docs/ingest-triage-2026-08-02.md`
  holds the per-cut marks.
- **The wiki has routes and a surface.** T14 landed `GET /api/wiki` (claims
  grouped by facet, ordered by coreness) and `POST /api/wiki/claim/:id/read`.
  **Lint is served from the last completed run, never computed on the route** —
  two of lint's three rules go through `shadowDecision`, so linting on a read
  path would put one shadow record per PAGE VIEW into Q-35's graduation
  evidence. T19 (the client half) is in flight; T15 (end-to-end) is the last
  task in the slice.
- **Semantic resonance is BUILT and NOT WIRED** (053, `a6c4610`).
  `src/index/semantic.ts` scores **7/8 by rank** on the standing paraphrase
  fixture where the incumbent `resonate()` scores **0/8**. It ranks rather than
  thresholds because every caller already wants the best few. **Ticket 068
  names every call site** — until that lands, the surface a person meets each
  sitting is still trigram matching.
- **The reading pass is RUNNING** (062) — `scripts/read-snippets.ts --apply`,
  detached, ~50s per snippet, writing one Reading per snippet to
  `vault/wiki/readings/`. Until it finishes the corpus is evidence but not
  wiki: the Clerk mints Claims from Readings (Q-28). It is idempotent and
  resumable; re-run it if interrupted.
- Also landed: the degradation ladder (061), the Randomizer (026), sitting
  cadence (056), the derived event-kind oracle (063), the harvester facet fix
  (037), the queue answered-turn (041), and the vault as a git repo (049).

**Five things have shipped INERT on this project. This is the failure mode.**
A parameter no caller passed (045). A method with no caller
(`Registry.mergeCandidates`). A field written to a type but not to disk
(`ClashCandidate.attempts` — Q-53's cap silently did not exist). An
admissibility gate that rejected **0 of 295** real cuts while every one of its
tests passed (044). A prompt-override the ratchet warned did not exist and had
had since ticket 034 — so every harvest A/B compared the default against
itself and reported a verdict. Each was found by measuring against real data or
by an agent checking the seam end to end. **Assume the next one is live now.**

**Designed, not built** (slice 4 — Composition): zero-LLM Arrangement
reviewer, candidate Arrangements, Gap detection, set-down. Plan at
`docs/wayfinder/tickets/010-build-composition.md`.

**Not designed**: the wiki-editing surface (Q-33 — six verbs, Propagation) is
deferred until real claims exist to design against. Seeding (013/014), Coach
(016), gap-fill (027), graph-bounded context (033) are blocked on the Clerk.

## What the 2026-08-02 review changed

A review of this file found three things that block and four that bite, and
produced tickets 048–066. Two of its factual claims were checked and one was
wrong: it said the user never sees the harvest cuts, but `/end` returns
proposals and the review screen takes approve / trim / restate / discard.

**Its strongest finding was answered by measurement, not argument.** It said no
channel can see polarity, so contradiction candidates may never form. Q-52
rules that this is a category error — the channels retrieve *aboutness*, and
`judgeOpposition` is the polarity organ, anchored to verbatim poles. Ticket
007 then measured it on the real corpus: rephrased oppositions score 0.429–0.729
and genuine paraphrases 0.507–0.761. **They are one population.** One fixture
pair's nearest neighbour is the distractor stating the *opposite* belief,
ahead of its own paraphrase. Negation-blindness is what makes an opposed pair a
near-neighbour, which is the mechanism the pipeline depends on.

The same eval found `clash.embeddingCosine = 0.82` was **inert, not
imprecise** — above the entire distribution of 9,591 real pairs, admitting zero
and scoring 0/8, which is the lexical baseline through a slower mechanism. Now
0.70, measured twice independently.

## Where the truth lives

- `CONTEXT.md` — the domain language (36 terms, every one decided).
- `docs/decisions/elicit.md` — **Q-1..Q-61**, the constraint register. The ten
  from 2026-08-02, briefly: **Q-52** the clash channels retrieve aboutness, not
  polarity. **Q-53** a re-measure counts only from a different SITTING — the
  frame, not the clock. **Q-54** context-dependence is a Range refinement, and
  the dissolution branch was throwing the boundary away. **Q-55** the
  degradation ladder is two rungs and a composing floor. **Q-56** Q-35 governs
  *selection*; BOUNDS ship live, because a shadowed cap is not a cap. **Q-57**
  the importer has one door, a folder of files. **Q-58** the import review IS
  the harvest review, cuts marked in place. **Q-59/Q-60** imported item
  identity and no Target. **Q-61** the vault is a git repo and the docket
  commits it.
- `docs/eval-2026-08-02-claude-adversarial.md` — a peer Claude session's
  red-team. Found the canon-string drift, silent harvest failure, validator
  gaps, resonance overclaim. Its "learnings" section is the most useful page.
- `docs/wayfinder/map.md` + `tickets/` — the build map with closed tickets.
- `docs/superpowers/plans/` — approved implementation plans.
- `docs/interface-references.md` — the document rule.

## Hard facts

- **Model**: `qwen3.6:35b` on Ollama, `http://192.168.0.229:11434/v1`.
  Embeddings: `qwen3-embedding` (4096-dim) or `nomic-embed-text` (768-dim)
  on the same host. Never a hosted API (ADR-0001). **The Q-48 role split is
  BUILT** (043, `2cf2085`): elicitor = `bonsai-27b` at `:8088`
  (`ELICIT_LLM_*`), clerk = `qwen3.6:35b` at `:11434` (`ELICIT_CLERK_*`).
  Measured: elicitor 619ms warm, clerk ~40s per harvest chunk. Both local.
  A dead endpoint names which ROLE failed and never falls back silently — a
  silent swap corrupts the Q-34 stamps, which is worse than an error.
- **Run**: `npm start` (local model, builds UI) · `npm run dev` (fake LLM,
  watch) · `npm test`. Port 4517. Host-bound: `ELICIT_HOST=0.0.0.0`.
- **LLM seam**: `@mariozechner/pi-ai`. Every call carries a user-role
  message. Every LLM-touching job is try/catch-isolated.
- **Voice**: Parakeet TDT int8 ONNX via sherpa-onnx in-process.
- **Invariants live in code**, never prompts (Q-1, Q-12, Q-36).

## Standing practice

- Build work → subagents with DISJOINT file ownership. Never `git add -A`.
- Every fix's acceptance includes a REAL-MODEL run. Green tests have twice
  hidden real bugs.
- Tests whose oracle is the implementation prove nothing —
  `tests/canon.test.ts` reads the spec files instead.
- Never trust a model self-reported boolean as a gate (standalone, opposed,
  converged). Structural checks or nothing.
- **A thing that exists and is never invoked reads as done and tests as done.**
  Five instances so far — see the list above. When a fix adds an optional
  argument, a method, a field or a gate, acceptance is a CALLER exercising it,
  and for a gate it is a real input it is supposed to reject. `tests/*` passing
  is not that.
- **Test the seam, not the call.** T13's proof that the wiki's LogFn reaches
  the Activity Log is a test that boots the real app and READS THE LOG FILE
  BACK. A test asserting "the code called `log`" would have passed for months
  while every shadow record went nowhere.
- **Verification commands can be vacuous.** This box runs **ugrep 7.5.0**,
  where `grep -q` combined with `-v` exits 1 unconditionally — so the plan's
  `! … | grep -qv …` write-boundary assertion could never fail. A later version
  of the same assertion then failed on COMMENTS containing the word. A grep
  cannot tell code from prose; check that a fix both passes and can fail.
- Q-35: every mechanism runs shadow-first; graduates individually on evidence.
