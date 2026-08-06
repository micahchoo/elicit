# Prompt: make the three dead gates fire — Soundings, Coach, Expeditions

## The problem, in one paragraph

Three subsystems produced structural zeros across 49 sittings and 5 vaults
(usability report 2026-08-05, §7): Soundings — 0 offers in 216 license
evaluations; Coach — 63 evaluations, all `directions=0 qualified=0
offered=none`; Expeditions — 0 minted, ever. These are not conversational
failures. Each is a mechanical gate whose conjuncts cannot be simultaneously
true under real usage. The shared root cause: every gate constant was chosen
against *imagined* usage, and each later re-derivation tuned a *marginal*
pass-rate without validating the *joint*. Your job is to make each gate
demonstrably able to fire — or to prove, with measurement, that it cannot
fire until something upstream changes, and name that something.

## What already changed (do not redo this)

The working tree already holds partial repairs. Start from them:

- **Sounding** (`src/sounding/license.ts`): `SUSTAINED_THRESHOLD` re-derived
  0.15 → 0.10 from 957 window evaluations (ticket 142); `late` re-derived to
  `questionCount >= 9`. Instrument: `scripts/analyze-sounding-license.ts`.
- **Coach** (`src/coach/license.ts`): Q-110 seeding doors —
  `clusterClaimsByTheme` seeds un-coached DirectionRecords through the docket
  (door 1) and the wiki verb (door 2); Q-112 re-offers parked seeded
  Directions at +3 claims.
- **Expedition** (`src/clerk/composed.ts:763`): the whole-session
  episode-facet veto is gone; the veto is per-candidate (ticket 140).

## Shared method — applies to all three gates

1. **Measure the joint, never the marginal.** The 0.15 threshold was chosen
   without measurement; the 0.10 replacement was derived from windows in
   which `late` was false every time — a constant tuned on a conditional
   slice. For every gate, produce the joint pass-rate table of all conjuncts
   over the archived vaults before touching any constant.
2. **Data lives in `archives/`** (six vaults, 2026-08-04 through 2026-08-06).
   License evaluations are already logged per-evaluation — the logs are your
   instrument. Trust disk over the eval diary (report §0: the diary's archive
   table is wrong).
3. **License functions stay mechanical.** No LLM call, no emotional-state
   read (sounding header contract); no elapsed-time predicate in coach
   (Q-77). Offers only — a license may propose, never auto-enter (Q-62).
4. **Constants change only with a derivation comment** citing the
   measurement, in the pattern of the `SUSTAINED_THRESHOLD` comment.
5. **Deliverable per gate:** a measured base-rate table, the chosen constants
   with derivation, and a test that pins the *joint* firing shape — a
   real-shaped transcript producing a licensed offer, not four unit tests
   that each pass one conjunct.

## Gate 1 — Sounding: `late ∧ sustained` were never simultaneously true

**Symptom.** 0 offers / 216 evaluations. `sustained` (old bar) passed 3/147;
in all three, `late` was false.

**Mechanism.** `licensed = late && energy && sustained && unoffered`. `late`
needs `questionCount >= 9`; most archived sittings ended at turn 1. Both
re-derived constants still bake in the stated assumption "real sittings last
5+ turns" — an assumption the corpus contradicts.

**Task.** Compute the joint distribution of (`late`, `sustained`) per turn
index across all archived sittings. State the sitting length at which offer
probability becomes material. Then decide where the fix belongs, and treat
these as rival hypotheses to discriminate, not options to pick by taste:
(a) the gate is miscalibrated for real sittings, or (b) the gate is correct
and *starved* — sittings end at turn 1 because they have no ending (report
§3), so the prerequisite is sitting length, not gate math.

**Discriminating test.** Replay every archived sitting with ≥8 user turns
through `licenseSounding` and count offers. If the archives contain no such
sittings, that absence *is* the finding: the gate cannot be tuned from this
data, and the report's item 1 (endings) is a dependency of this ticket.

**Done when** a licensed offer is demonstrated on a real-shaped transcript,
or a written finding states the minimum sitting length at which the current
constants fire and names sitting length as the blocking dependency.

## Gate 2 — Coach: the bootstrap cycle may have moved, not opened

**Symptom.** 63 evaluations, all `directions=0 qualified=0 offered=none`.
Candidates are un-coached DirectionRecords, which historically existed only
after a prior offer; the queue arm is dead by its own docstring.

**Mechanism, post-Q-110.** Seeding now enters through claim clusters — which
makes the coach downstream of the wiki. Three of five eval personas ended
with **zero claims after 27 sittings** because the sweep is clipped
(`mint.callsPerRun=12`, report §4). A door that opens onto a starved room is
still a closed door.

**Task.** Trace the full fresh-vault chain: empty vault → sittings → claims
→ `clusterClaimsByTheme` → seeded Direction → `evaluateOffer` qualified →
offer rendered. Find the first link that yields zero. Measure
`THRESHOLDS['coach.offerMinClaims']` against real per-theme claim counts
(the Tomas re-run vault: 117 claims → 14 themes, top clusters 16/5/4).
Check whether sweep throughput, not coach math, is now the binding
constraint — if so, this ticket depends on report item 4 (unclip the sweep).

**Discriminating test.** Run door 1 against the two real vaults (Ilse: 52
claims; shared: 34). Does at least one Direction get seeded *and* qualify?

**Done when** a fresh vault reaches a coach offer within N sittings using
only the automatic loop — N stated and measured, not asserted.

## Gate 3 — Expedition: nobody knows if ≥2 asked citations ever happens

**Symptom.** Never minted in 49 sittings, before or after the veto fix.

**Mechanism.** `isExpeditionCandidate` requires a fact/construct reading AND
≥2 queue entries with `status: 'asked'` citing the same `snippet@version`.
The queue is FIFO and mints one follow-up per fragment — it is unmeasured
whether any snippet ever accumulates two asked citations. The cite key is
version-pinned, so a snippet revision may silently zero its citation count.

**Task.** Measure the distribution of asked-citations per snippet@version
across all archives. If the maximum is 1, the threshold is a gate that
cannot mathematically open — derive a new threshold from the measured tail,
or change the counting unit (citations per snippet across versions, or per
lexical region) with the same rigor. Also report how often the facet gate
and the citation gate are jointly true.

**Discriminating test.** One script over archived queue entries — this is a
grep-shaped measurement, hours not days.

**Done when** the candidate base rate is stated (candidates per 100
snippets) and one expedition is minted from real archive data through
`composeExpedition`.

## Guardrails

- Per the improvement-loop constitution (Q-87..Q-91): paired trials for any
  behavioral change; canon before loop code.
- Interface work is out of scope. These gates get no UI presence until they
  can fire (a door that never opens is worse than no door). The report's §10
  items 1 and 4 may be *dependencies* of gates 1 and 2 — if measurement says
  so, say so and stop at the boundary rather than fixing them here.
- The failure mode to not repeat, stated once more because it happened
  twice: a constant tuned on a conditional slice of the data. Measure the
  joint.
