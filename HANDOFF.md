# HANDOFF — Elicit

Updated: 2026-08-02 (late — the campaign is still running as this is written).

## Right now — read this before you touch anything

**Nothing has been committed since `bb87680`** ("plans: composition, soundings,
bulk-import — written, twice-reviewed, approved"). Everything below lives in the
working tree only. The next milestone commit gathers it after verification.
Never `git add -A`; the vault is a separate git repo and must not be swept in.

**Agents in flight.** Each owns disjoint files. Confirm a ticket's `assignee`
field before dispatching anything near it.

- **078** grammar-constrained harvest (GBNF, so the model cannot emit a
  malformed cut list). **May return still `open`** — its acceptance needs the
  real model, and it fails honestly rather than faking a pass if the host is
  unreachable.
- **068** wire semantic resonance into every `resonate()` call site, and flip
  the corresponding entries in the exposure registry.
- **076** the vault's git diff decides which docket jobs have work; indexes ride
  a cursor instead of rebuilding from scratch.
- **An execution agent on the bulk-import plan's early waves** — new namespace
  `src/import/`, one commit per task. As of this writing `src/import/` does not
  exist yet and no commit has landed from it. Expect both to appear.

**Closed work sitting uncommitted in the tree.**

- **075** — the docket drain. "Left for the next run" is now a claimable record
  on disk, and the still-true rotation cursor survives restarts
  (`src/wiki/store.ts`, `src/clerk/docket.ts`, `src/server.ts:~406-445`).
- **079** — the twice-rejected floor: a probe the guard rejected twice is no
  longer emitted when the fallback draw is empty (`src/elicitor/elicitor.ts`).
- **077** — the mechanism exposure registry. `src/registry.ts` (untracked) plus
  `tests/mechanism-registry.test.ts`. See *Standing practice* — this is the
  countermeasure to this project's most repeated defect.
- **080** — antecedent context on the wiki surface and the randomizer draw.
  **Its ticket still says `open-with-remainder`, but the remainder has landed**:
  `src/server.ts:694-697` forwards the draw's lineage and `web/main.ts` renders
  `lineageBlock` above the opener. Flip the status when you commit.
- **073's backfill is applied** — 99 of 139 vault snippets now carry a
  mechanical `Provenance.context`. The other 40 open their turn and correctly
  carry none.
- Untracked tests: `tests/fake-responder.test.ts`, `tests/llm-constrained.test.ts`,
  `tests/mechanism-registry.test.ts`.

**The queue, in Micah's order.** Two trains run through it.

The plan train, serialized, authorized today: **058** (bulk import and review,
executing now) → **010** (composition) → **012** (soundings). All three plans are
written, twice-reviewed and approved; do not re-plan them.

The ticket train, after the current waves land: **the RESULTS run** (authorized —
it closes Clerk ticket 008 and unblocks 013, 014, 016, 027, 033, 060), then
**048** (capture channel), **083** (the ClashChannel rank contract from Q-65),
**074** (the model-resolved referent annotation — its labelling stage is done),
**015** (queue usage stamps, which must start recording now to be worth anything
later), and **065 last**, because the EventKind union sweeps every file.

**Standing authorizations from Micah, 2026-08-02.** Execute all three plans,
serialized. Run RESULTS. The context backfill (done). And the campaign order
itself: work the map to exhaustion, dispatch on disjoint files, verify each agent
against the tree rather than against its own report, commit at milestones, do not
stop between waves.

**Hazards.**

- `src/server.ts` and `src/types.ts` are the contention chokepoints. Almost every
  wave wants them. Check assignees first; several tickets deliberately named a
  server seam as a *remainder* rather than touch the file mid-wave.
- `src/registry.ts` now **fails tests when wiring status drifts**. If you wire a
  mechanism, flip its registry entry in the same change or the sweep fails.
- `docs/wayfinder/map.md`'s Decisions-so-far tail has duplicated entries —
  tickets 056, 007 and 026 each appear three times, 041 twice. Cosmetic, but it
  makes the tail unreliable to skim. The ticket files are the truth.

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

**Context is lineage too, and the same rule governs it.** Ticket 072 ruled all
three layers in: render the stored eliciting question, stamp a mechanical
`Provenance.context` window of up to two preceding sentences (073, backfillable
by locate-by-substring), and a model-resolved referent annotation last (074),
evaluated before it ships. None of it is corpus, none of it is ever quoted into
a question, and the randomizer draw carries it display-only.

## Storage

Plain markdown in `vault/`, editable directly. Immutable Snippet versions
(Q-5) provide the belief-change record. Three layers (ADR-0002): vault truth,
derived indexes (lexical now, embeddings staged — Q-17), and bounded-context
Cover summaries (Marginalia-class, model-stamped). Deleting a derived layer
costs recomputation, never data. Vault is gitignored from the project repo
(ADR-0003 — code and corpus are separate) and is itself a git repo the docket
commits (Q-61); backup rides the user's existing file-backup infrastructure.
Access is password-gated (scrypt at `vault/.auth.json`, set from loopback on
first run). No environment variable for the password.

## How questions get chosen

Constraint-then-chance (Q-13): hard filters — license, Mode compatibility,
the declared Target (ticket 045), Facet balance (Q-13, shadow-mode, built by
ticket 042 — NOT Q-42, which is composition's two passes), weak-early
ordering, exposure control — then top-k uniform random. Never argmax; never
scored by fluency or plausibility. What happens when the filters leave an empty
pool is the degradation ladder, Q-55, built as ticket 061: two rungs and a
composing floor, and the floor is usually the *better* outcome, so a long
cascade would be actively harmful. Seven question sources, each licensed by a
situation: Bank draw (openings, weak-early), composed follow-up (Red Light —
must quote verbatim), Gap-fill, Instrument step, Randomizer draw, Still-true
revisit (always asked differently — Q-14), and Verification (mostly forbidden —
show the claim instead — Q-15). The Randomizer draws only from the user's own
forgotten Snippets or curated decks; the agent may not veto a draw (Q-16, Q-18).
Generation follows freedom-in-generation, rigidity-in-validation (Q-36):
code guards at the boundary — no repeats, no conversation references, no
parroting.

## What happens to a contradiction

Three cases, never silently resolved. **Diachronic** (the person changed): the
tension *is* the finding — both versions kept, timestamped, the question is
"what moved you?" **Context-dependent**: both true, and Q-54 rules this is a
**Range refinement**, not a third Contradiction type — one `SUPERSEDE` per pole
with a narrowed Range, reached through a zero-LLM lint door that works on
today's corpus rather than through the flakiest machinery in the system.
**Synchronic** (both assert the present): the pipeline (Q-30) — candidates from
lexical, referent, and embedding channels → exactly one ask-differently
re-measure question → a Contradiction opens only when code-verified evidence
confirms opposition. One flipped answer never opens a Contradiction (Q-14). A
Contradiction invalidates only claims citing both poles; claims resting on one
alone stay live. Tension pages are the most valuable objects in the system.

**Q-53 answers when the re-measure happens**: only from a DIFFERENT SITTING,
because the failure Q-14 exists to prevent is lability under questioning, and
lability is a property of a continuous conversational frame rather than of a
clock. `remeasure-expired` is the one outcome that does not retire a pair —
silence must never stand in for a verdict.

**Q-65 answers what the pool contains.** Same-sitting pairs RANK BELOW
cross-sitting pairs; they are pooled, never excluded. Ticket 007 measured the
reason: cross-sitting cosine tops out at 0.640 on this corpus while
intra-document pairs run to 0.808, so any workable threshold alone yields an
all-same-essay pool — a channel measuring how tightly an essay stays on topic
instead of how a belief moved across years. Cross-sitting drift fills the
judgment quota first; within-document incoherence stays findable. The
implementation is ticket 083: `ClashChannel` returns an ordered, quota-bounded
list rather than a filtered set.

## Placement authority

The Clerk files automatically via the Docket — every harvested reading mints
or updates a Claim on the next run (Q-28). No "where should this go?" prompt.
Every placement is logged to the append-only Activity Log (Q-23).

**Q-35 has now been amended twice, and its exception count is back to zero.**
Q-56: it governs SELECTION mechanisms; BOUNDS (caps, quotas, rate limits) ship
LIVE at birth, because a shadowed cap is not a cap — it writes "I would have
stopped at 2" while the system mints without limit. Q-62: a mechanism whose only
power is to OFFER — one proposal declined in a word, nothing done on decline —
also ships LIVE from day one, logging every evaluation it makes; only a
mechanism that ACTS on its own judgment stays shadow-first. **The dividing line
is the consequence of silence**: if the person ignoring it means nothing
happened, it is an offer; if ignoring it means something happened anyway, it
acts. Both amendments are stated as amendments rather than exceptions, per
Q-56's own form — a principle that accumulates footnotes dies without ever being
overruled.

The Queue carries Direction; Arrangements are proposed, never auto-placed. Q-37:
Piece proposals are passive margin notes licensed by citation-cluster density,
never escalated.

## Belief mode vs. craft mode

Every sitting declares a Target: **self** or **domain** (Q-19). Beliefs come
under direct questioning — Soundings (consent-gated descent, 8–12 rungs,
structural ending — Q-43..Q-47, Q-62..Q-64) and life-story instruments. Craft is
reached through Domain instruments co-equal with self instruments: Critical
Decision Method, laddered grids, concept sorting. Skill claims cite performance
evidence (Emergent Outputs), never self-report — the Coach role (Q-24) logs
quests and artifacts per Direction, offers Marginalia-class advice
(choice-expanding, guilt-free by construction).

Three Soundings rulings landed today, all from the plan's blocking questions.
**Q-62**: the entry license ships live — shadowing it would mean no Sounding is
ever offered and the slice lands as dead code. **Q-63**: a Sounding licensed
with fewer than 8 questions of budget left floors the allowance at 8 and the
sitting grows past its declared minutes; "a Sounding becomes the rest of the
sitting" is taken literally, and the consent ask states the real expected
length, which is what keeps the overrun consented rather than suffered.
**Q-64**: the gate's third word, "another day", writes the full ladder to the
vault and mints NO Queue pointer — three words, three genuinely distinct
outcomes, where two pointer-minting words would differ only in horizon.

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

The approved plan (`docs/superpowers/plans/2026-08-02-composition-slice.md`, 14
tasks) puts the whole zero-LLM half in one namespace, `src/piece/`, where not
one file takes a `Complete`. Agent-initiated Piece offers are excluded
structurally, not punted: Q-37 licenses an offer by citation-cluster density,
claims are the Clerk's product, and until a claim graph exists any offer built
there would be licensed by topic count — which is exactly what Q-37 refuses.

## How writing from outside gets in

One door: a folder of files on disk (Q-57). No socket, no feed fetcher — a feed
hands over rendered HTML, and the three quotations that nearly entered the
2017-2026 corpus were caught only because the markdown *source* preserved
citation structure. Dates come from frontmatter or the file is refused; never
mtime, never inferred, never asked per item, because under Q-50 the date is the
only thing that makes an imported sitting independent evidence.

A file's identity is its content hash, and a changed file is a NEW ITEM rather
than a new version (Q-59) — so an edited old post becomes its own evidence of
drift, two independently dated sittings nine years apart on the same material.
Imported items carry no Target and no control offers one (Q-60): a folder is
heterogeneous, so one batch answer mislabels roughly half. The import review IS
the harvest review pointed at an imported piece (Q-58) — three verbs
(approve/trim/discard, no restate), the piece rendered WHOLE with cuts marked in
place, per-item and resumable, and **no batch accept**, because the one failure
this surface exists to catch — misleading excision, a sentence exactly yours
that means something else lifted out — is invisible without reading.

The plan (`docs/superpowers/plans/2026-08-02-bulk-import-review.md`, 13 tasks)
builds `src/import/` as scan → store → extract → commit. It reimplements
nothing: T8 adopts the 19 sittings `scripts/ingest-posts.ts` already wrote, so
"re-running imports nothing twice" holds on the first real run.

## Friction budget

Session shape: Mode declaration first (time, energy, target — typed as a
sentence, not dropdowns), one question at a time on a focus-mode page,
harvest at close. The Queue persists across sessions; the Waiting Surface
replaces notifications — zero outbound contact (Q-22). Phone sittings are
second-class: LAN browser behind the password gate (Q-26). Voice input via
Parakeet STT in-process (ONNX, ~600 MB, CPU-only). The two close moves (Q-20:
open door + bookmark) are reserved beyond the Mode-declared question budget;
Soundings convert the remaining budget into a capped rung allowance (Q-47),
floored at 8 on late entry (Q-63).

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
composed opener the user meets each sitting, is still a 3-consecutive-word
exact-match index. Ticket 053 built the snippet-level replacement (7/8 by rank
against 0/8); **ticket 068, in flight now, is what makes anyone meet it.**

## What's built vs. what's designed

**Built** (slices 1–2): the interview loop end-to-end — Mode → exchange →
harvest → close, with composed openers, resonance/juxtaposition (lexical
only), durable queue, Cover memory, activity log, voice input, in-app auth,
unprompted entry, defer, expeditions, protocol registry, waiting states,
facet-intent filtering (shadow-mode).

**Built 2026-08-02, the long campaign.** The last full verification inside this
tree — the 080 work — measured 48 test files, 1292/1292 passing, `tsc` clean.
Several waves have landed since; re-run before the milestone commit rather than
trusting that number.

- **The Clerk slice is complete through T19.** Committed: the wiki contract and
  thresholds; `ClaimStore`; mechanical status; zero-LLM lint; reading→ops mint;
  the contradiction judge; the ops executor; the identity registry; the lexical,
  referent and embedding clash channels; the five wiki jobs; the docket
  integration; the wiki routes (T14); the reading surface (T19); and T15
  end-to-end. **Ticket 008 closes on the RESULTS run**, which is authorized and
  next. Plan: `docs/superpowers/plans/2026-08-02-the-clerk.md`.
- **The wiki has routes and a surface.** `GET /api/wiki` (claims grouped by
  facet, ordered by coreness) and `POST /api/wiki/claim/:id/read`. **Lint is
  served from the last completed run, never computed on the route** — two of
  lint's three rules go through `shadowDecision`, so linting on a read path
  would put one shadow record per PAGE VIEW into Q-35's graduation evidence.
- **Your corpus is in the vault, and it is read.** 139 snippets across 19 dated
  sittings, 2017-2026, from nine years of published writing (057); 136 of 139
  carry a Reading (062), so the corpus is wiki rather than only evidence. The
  harvest proposed 295 cuts, triage kept 139, and seven were other people's
  words — four sentences of Annemarie Mol, one of Sara Ahmed, one of Shreyas —
  which drove Q-51's cut-level rule into code.
  `docs/ingest-triage-2026-08-02.md` holds the per-cut marks.
- **Semantic resonance is BUILT and being WIRED right now** (053, `a6c4610`;
  wiring is 068). `src/index/semantic.ts` scores **7/8 by rank** on the standing
  paraphrase fixture where the incumbent `resonate()` scores **0/8**. It ranks
  rather than thresholds because every caller already wants the best few.
- **The exposure registry exists** (077, `src/registry.ts`, uncommitted). Every
  exported mechanism declares `live | shadow | unwired`, and the sweep in
  `tests/mechanism-registry.test.ts` cross-checks the declaration against real
  call sites: a `live` mechanism with no caller outside its own tests fails, a
  `shadow` mechanism that writes no shadow record fails, and an `unwired`
  mechanism that acquires a caller fails. `unwired` is debt with a name.
- Also landed today: the harvest diagnostics surface (066), the embedding
  one-run lag fix (067), inadmissible-drop surfacing (069), the stranded
  re-measure (070), WikiReport's counters reaching the activity line plus a
  `contradiction-opened` kind (071), antecedent context (073/080), the docket
  drain (075), the twice-rejected floor (079), the degradation ladder (061), the
  Randomizer (026), sitting cadence (056), the derived event-kind oracle (063),
  the harvester facet fix (037), the queue answered-turn (041), and the vault as
  a git repo (049).

**The inert-mechanism count is now SIX** (Q-62's reckoning), and the list is no
longer worth maintaining by hand — `src/registry.ts` is the enumeration. What
the six have in common: a parameter no caller passed (045), a method with no
caller (`Registry.mergeCandidates`), a field written to a type but not to disk
(`ClashCandidate.attempts` — Q-53's cap silently did not exist), an
admissibility gate that rejected **0 of 295** real cuts while every one of its
tests passed (044), a prompt-override the ratchet warned did not exist and had
not since ticket 034 — so every harvest A/B compared the default against itself
and reported a verdict — and WikiReport's counters reaching no surface (071).
Each was found by measuring against real data or by an agent checking a seam end
to end. **Assume the next one is live now.**

**Designed, not built**: Composition (010) and Soundings (012), both with
approved plans awaiting their turn behind bulk import.

**Not designed**: the wiki-editing surface (Q-33 — six verbs, Propagation) is
deferred until real claims exist to design against. Seeding (013/014), Coach
(016), gap-fill (027), graph-bounded context (033) and the discriminating-question
lint (060) are blocked on the Clerk's RESULTS.

## What measurement changed, twice

**The polarity finding was answered by measurement, not argument.** The HANDOFF
review said no channel can see polarity, so contradiction candidates may never
form. Q-52 rules this a category error — the channels retrieve *aboutness*, and
`judgeOpposition` is the polarity organ, anchored to verbatim poles. Ticket 007
then measured it on the real corpus: rephrased oppositions score 0.429–0.729 and
genuine paraphrases 0.507–0.761. **They are one population.** One fixture pair's
nearest neighbour is the distractor stating the *opposite* belief, ahead of its
own paraphrase. Negation-blindness is what makes an opposed pair a near
neighbour, which is the mechanism the pipeline depends on. The same eval found
`clash.embeddingCosine = 0.82` was **inert, not imprecise** — above the entire
distribution of 9,591 real pairs, admitting zero and scoring 0/8. Now 0.70,
measured twice independently.

**The dangling-referent worry was also measured before anything was built**
(`docs/dangler-labels-2026-08-02.md`, six parallel labellers, ruled by Micah).
All 139 snippets, labelled conservatively: **96 dangle (69.1%)**. Of those,
**71 (74%) are resolvable from the two-preceding-sentences window alone** — which
is exactly what 073 stamps — and 25 are not, their referents lying beyond the
window or nowhere locatable. **Zero are resolvable only by the eliciting
question**, and that number is 0 by construction: every snippet in this vault is
imported prose with an empty `Provenance.question`, so 072's question-anaphora
case is unmeasured here rather than disproved. That is the evidence 074's
annotation must beat.

## Where the truth lives

- `CONTEXT.md` — the domain language (36 terms, every one decided).
- `docs/decisions/elicit.md` — **Q-1..Q-65**, the constraint register. Today's
  additions after Q-61: **Q-62** offer-only mechanisms ship live (Q-35's second
  amendment). **Q-63** a late Sounding floors at 8 rungs and overruns the
  sitting, consented. **Q-64** "another day" preserves the ladder and mints no
  pointer. **Q-65** same-sitting pairs rank below cross-sitting, pooled never
  excluded.
- `research-codex-lessons.md` — **at the repo root, not under `docs/`.** A peer
  session's comparison against a clone of OpenAI's codex. The inversion it names
  is the useful frame: codex builds fences around an agent, elicit builds an
  agenda and lets a model fill in phrasing — so the transferable lessons are
  mechanisms, never architecture. It fed amendments to tickets 075, 074 and 015,
  and produced tickets 076–079 whole.
- `docs/dangler-labels-2026-08-02.md` — the 074 measurement, above.
- `docs/eval-2026-08-02-claude-adversarial.md` — a peer Claude session's
  red-team. Found the canon-string drift, silent harvest failure, validator
  gaps, resonance overclaim. Its "learnings" section is the most useful page.
- `docs/wayfinder/map.md` + `tickets/` — the build map. The ticket files are the
  truth where the map's tail disagrees with them.
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
  Six instances so far. When a fix adds an optional argument, a method, a field
  or a gate, acceptance is a CALLER exercising it, and for a gate it is a real
  input it is supposed to reject. `tests/*` passing is not that. **This is now
  structural rather than remembered**: declare the mechanism in
  `src/registry.ts` and the sweep enforces the declaration.
- **Test the seam, not the call.** T13's proof that the wiki's LogFn reaches
  the Activity Log is a test that boots the real app and READS THE LOG FILE
  BACK. A test asserting "the code called `log`" would have passed for months
  while every shadow record went nowhere.
- **Verification commands can be vacuous.** This box runs **ugrep 7.5.0**,
  where `grep -q` combined with `-v` exits 1 unconditionally — so the plan's
  `! … | grep -qv …` write-boundary assertion could never fail. A later version
  of the same assertion then failed on COMMENTS containing the word. A grep
  cannot tell code from prose; check that a fix both passes and can fail.
- Q-35, as twice amended: selection mechanisms run shadow-first and graduate
  individually on evidence; bounds and offers ship live.
