# The improvement loop — measurability and verifiability rulings

Grill session, Micah + Claude, 2026-08-04. Scope: the foundational
measurement question under an UNATTENDED agentic loop that continuously
uses Elicit, evaluates it, and recursively improves it. Register rows
Q-87..Q-91 compress these rulings; this document carries the reasoning
and the rejected alternatives.

## The architecture ruled

Each eval agent is a USER, not a test harness. It is seeded with a
dossier (a starting identity), creates its own vault, and lives in
Elicit: declares Modes, answers questions, reviews harvests, descends
Soundings, returns across sittings, elaborating its world as it goes.
From inside that lived use it measures the app. The recursion: the loop
changes a subsystem, spawns fresh agent-users into fresh vaults under
variant A and variant B, compares their lives, keeps what measured
better, and repeats — without a human in the cycle.

The person-plane protections make this safer here than in most systems:
agents live in their own vaults only; the owner's vault receives nothing
from the loop except graduated CODE, and even a badly graduated
mechanism cannot corrupt person-plane evidence (snippets immutable,
transcripts append-only, no agent prose in evidence). The worst
irreversible harm is a bad question the owner experiences — which is
what the guarded-metric tripwire exists to catch.

## Ruling 1 (Q-87) — the four axes, measured from inside use

The truth-bearers of evaluation are four, with distinct roles, never
composited into one number (Q-21 one level up):

- **Constitution obeyed** — a mechanical GATE, not a metric. An
  invariant violation voids the run; no partial credit exists. The
  sentence "+40% yield, two invariant breaches" must be unrepresentable.
- **The wiki got truer** — measured by the persona judging claims about
  itself against what it knows of itself. Its dossier plus its lived
  elaborations ARE the ground truth; the persona is the authority on its
  own model, exactly as the canon says the person is.
- **The archive got richer** — yield, facet/stance distributions, Bud
  maturation, admissibility rates. DIAGNOSTIC ONLY: every one of these
  improves under degeneration (more cuts = thinner cuts), so they are
  admissible as supporting evidence — no-regression clauses — and never
  sufficient alone.
- **The person got better served** — measurable in the loop precisely
  because the person of an eval vault IS the agent: it reports whether
  follow-ups tracked what it said, whether harvests kept what mattered,
  whether a juxtaposition landed or flattened it.

History of this ruling: the first proposal made wiki-truth the sole
optimization target with mechanical marker-recovery scoring and reserved
"served" to the owner alone. Micah overruled: metrics not tied to human
or agentic EXPERIENCE miss the product; the loop's agents measure all
four axes from within their own use. The mechanical-marker scorer was
superseded by judgment-with-citations (Ruling 2).

## Ruling 2 (Q-88) — the paired trial is the unit of measurement

One dossier seed lives twice — once under variant A, once under variant
B. The persona renders per-subsystem verdicts: WHICH life was better
interviewed, and why, citing specific lived moments. **A verdict citing
no lived moment is malformed** — the Wiki's citation discipline applied
to evaluation itself. Behavioral revealed-preference traces (elaboration
length when engaged, restatement rate, gate choices, voluntary returns
to a thread) accompany every verdict as no-regression evidence.

Rejected: absolute anchored scores (1–10 against rubric anchors) — they
drift with model mood and persona temperament, and cross-persona
averaging launders incommensurable experiences into one number.
Rejected: behavioral traces alone — mechanism metrics wearing
experiential clothes.

Registered risk, defended in the rubric: the loop optimizes Elicit for
what LLM-personas experience as being well-interviewed — tireless,
sycophancy-prone readers. The rubric must ask disconfirming questions
("what did the interviewer get wrong about you? which question did you
answer out of compliance?"), never satisfaction questions.

## Ruling 3 (Q-89) — full autonomy, ledger-accountable, prompt-frozen

The loop implements, lands, and graduates changes WITHOUT per-change
human review. The owner is out-of-band: real use, the Activity Log, the
graduation ledger, and a manual demote verb that always works.

- **The ledger**: `data/graduation-ledger.jsonl`, append-only,
  instrument-plane (survives fresh start, like decisions.jsonl). One
  line per graduation, demotion (with the metric numbers that fired),
  and re-graduation (with refs to the new evidence trials). It is both
  the audit record and the loop's own memory against oscillation.
- **Re-graduation after a tripwire demotion is autonomous** — the
  record, not a human gate, is the accountability. (Option "tripwired
  once = human-gated thereafter" was offered and declined.)
- **Freezing is prompt-level only**, by explicit ruling ("part of the
  prompt for the loop, nothing else"). Frozen set: dossier seeds, the
  scoring rubric, the guarded list, the invariant suite. Registered
  disagreement: this repo's own history holds the bypass precedent (111
  amended its own pinning tests; dispatcher review caught it — under
  full autonomy there is no dispatcher). Standing offer, neither
  accepted nor rejected: the loop's cycle report self-discloses a
  `diff --stat` of frozen paths.

## Ruling 4 (Q-90) — the boundary to the real instance

Guarded metrics on the owner's vault — observable by everything,
optimizable by nothing, tripwire-bearing:

1. Skip rate (Q-83's sealed class)
2. Deferral rate (same seal)
3. Refusal rate (same seal)
4. Dormancy — pieces, quests, directions (Q-24/Q-77)
5. Discomfort-gate frequency — park/another-day rates
6. Sitting frequency / return rate (engagement class — optimizing it
   builds a companion app)
7. Sitting length vs declared Mode

Deliberately NOT guarded: Sounding depth — the consent gate is watched
(entry 5); depth itself is diagnostic, and guarding it would blind the
loop to descents dying early (the ladder-regression defect class).

The tripwire is a zero-LLM docket sweep comparing post-graduation
guarded counts against pre-graduation baselines:

- **Event floor** per metric before any judgment; below the floor a
  mechanism sits in a declared `graduated-unconfirmed` state. Sparse
  n=1 data is not pretended into data (Q-14: one flipped answer is
  noise).
- **One-sided test, ties go to shadow** — a false demotion costs the
  loop time; a false pass costs the owner weeks of degraded interview.
- **Batch demotion by recency**: all graduations younger than the
  anomaly demote together. Recency is the only admissible attribution —
  causal attribution at n=1 would require a model of the owner, which
  guarded metrics must never have.
- **Dwell** before re-graduation, so oscillation is bounded.

Demotion means: `live: true → false` — back to shadow, logging,
acting on nothing. Nothing reverted, nothing deleted, one log line.

## Ruling 5 (Q-91) — fixtures and seeds

- Fresh-start archives `data/eval-*` as ruled on 2026-08-04; a manifest
  (`data/eval-fixtures.json`) records the archive path; the loop reads
  real-corpus fixtures READ-ONLY through the pointer and touches nothing
  else under `archives/`. (Real prose lives in one place, under one
  rule.) These fixtures are the outer validity check against
  LLM-prose collusion — mechanisms scoring well on synthetic personas
  must survive real dictated human prose for whatever can be measured
  there without ground truth.
- Dossier seeds are preauthored by Claude to a specification, then
  frozen. The specification is ratified in ONE dedicated grill session
  before any seed is written — the last human fingerprint on the
  measure.

## Open items

Updated after the frontier batch grill (same day, later session):

1. ~~Dossier-seed specification~~ — RULED Q-94, spec in
   `docs/loop-dossier-spec.md`. The rubric's disconfirming-question
   set remains open (ticket "Rubric design").
2. ~~Floors and dwell numbers~~ — RULED Q-95: floor 20 events, dwell
   7 days, baseline trailing-28-days frozen at graduation.
3. ~~The ledger's exact line format~~ — RULED Q-97, format in
   `docs/loop-record-plane-spec.md`. The rubric's
   disconfirming-question set is also closed (Q-98,
   `docs/loop-rubric.md` — frozen).
4. ~~The frozen-paths list as literal prompt text~~ — DRAFTED in
   `docs/loop-prompt.md` (battery, rubric, all loop specs, the prompt
   itself, the guarded list, plus the add-only-tests rule); ratifies
   with the prompt at the shakedown. No open items remain — the
   design phase is complete.
5. ~~`diff --stat` self-disclosure~~ — ADOPTED report-only, Q-96.

Also ruled in the batch grill: the core surface's home (Q-92: `/v2`
on the existing server, per-instance token, projections-only `view`)
and the instance plane (Q-93: real process per instance, prod-model
elicitor, omp-dispatched personas, archive-on-teardown). Standing
intent recorded 2026-08-04: the loop's RUN budget is ONE OR TWO
SESSIONS maximum — the improvement cycles execute as a session-burst,
not a standing daemon. The budget binds the loop's execution, not the
build work. Consequence for cycle design: however many cycles fit in
1–2 sessions IS the campaign; the loop prompt should spend the budget
on few well-evidenced graduations rather than many shallow ones.
