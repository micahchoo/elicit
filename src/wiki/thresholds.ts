/**
 * Shadow-first thresholds — Q-35 turned into data.
 *
 * Q-35: every selection mechanism runs in log-only shadow from day one,
 * writing what it WOULD have decided to the Activity Log (Q-23, free
 * evidence), and graduates to live one at a time when its own record earns
 * it. No global calendar, no graduation day.
 *
 * That rule survives only if it is cheaper to follow than to skip, so a
 * threshold's value, its liveness and the evidence that would graduate it sit
 * on one line here. Two invariants follow, and both are load-bearing:
 *
 * - No threshold value is read anywhere except through `THRESHOLDS`. A bare
 *   numeric literal in a wiki module is a review failure — it is a mechanism
 *   acting on a number nobody decided.
 * - Every entry carries a `graduatesWhen` sentence, required by the type. A
 *   threshold whose graduation condition is unrecorded can never honestly
 *   graduate, because nobody will remember what evidence was meant to
 *   justify it, and "it seemed fine" will stand in for the record.
 *
 * The precedent is `src/queue/facet-balance.ts`, which runs the same way for
 * the Q-13 draw filter: compute always, log always, act only when licensed.
 */

export type Threshold = {
 name: string;
 value: number | boolean;
 /** False means: compute, log what you would have done, change nothing. */
 live: boolean;
 /**
  * The evidence that would license this threshold to act — prose, never a
  * date. For an entry that already acts, this records the licence it acts
  * under, so demoting it is as reviewable as promoting it.
  */
 graduatesWhen: string;
};

/**
 * The Activity Log sink, narrowed to the one actor this slice writes.
 * Structurally identical to `src/clerk/docket.ts`'s `log` dependency, whose
 * `actor` is the wider `string` — so the Docket's own logger is assignable
 * here, and so is the `LogFn` the wiki contract declares. This module imports
 * nothing on purpose: the registry every other wiki module reads must not be
 * able to fail to load.
 */
export type ThresholdLogFn = (e: {
 at: string;
 actor: 'clerk';
 kind: string;
 detail: string;
 refs?: string[];
}) => void;

/**
 * The single declaration site. `satisfies` rather than a `Record` annotation
 * keeps the keys literal, so `THRESHOLDS['lint.godNodeFanout']` is a
 * `Threshold` and not `Threshold | undefined` under
 * `noUncheckedIndexedAccess`, while `value` and `live` still widen to their
 * declared types — a consumer may compare `live` against either boolean.
 *
 * `value` admits a boolean because two entries are switches rather than
 * numbers (`clash.oppositionGate`, `status.readLogDiscount`). A `1` standing
 * in for "on" would be a magic number pretending to be a measurement.
 */
export const THRESHOLDS = {
 'clash.lexicalMinPhrase': {
  name: 'clash.lexicalMinPhrase',
  value: 3,
  live: true,
  graduatesWhen:
   'Already live, inherited from slice 2 resonance: src/index/lexical.ts requires a 3-word shared phrase today, and this entry only names that number. The plan records no graduation condition, because there is nothing left to earn.',
 },
 'clash.oppositionGate': {
  name: 'clash.oppositionGate',
  value: true,
  live: true,
  graduatesWhen:
   'Ships live by decision, not by record — Q-49, the one deliberate exception to Q-35 in this slice. Q-30 stage 1 defines a candidate AS two claims with model-judged opposed Stances, so a shadowed gate leaves stages 2-5 with no input and therefore no record to graduate on. The evidence Q-35 wants is collected while it acts: WikiReport.oppositionJudged over oppositionOpposed. Reverting it to shadow is a decision about the whole pipeline, not about this line.',
 },
 'remeasure.liveCap': {
  name: 'remeasure.liveCap',
  value: 2,
  live: true,
  graduatesWhen:
   'Already live: a cap that protects the Queue must act from day one, and every clip is logged. PROVISIONAL per Q-30 — the VALUE is unearned, not the liveness. Slice-2 RESULTS set the real number.',
 },
 'lint.staleCitationAgeDays': {
  name: 'lint.staleCitationAgeDays',
  value: 0,
  live: true,
  graduatesWhen:
   'Already live: mechanical, with no tuning surface. Any newer snippet version makes a citation stale, so there is no judgment here to earn and no number to calibrate.',
 },
 'lint.godNodeFanout': {
  name: 'lint.godNodeFanout',
  value: 12,
  live: false,
  graduatesWhen:
   'The shadow record shows the note would fire on a real corpus, not only on a small one. A fanout note that fires because the wiki is young says nothing about the wiki.',
 },
 'registry.mergeCandidateSimilarity': {
  name: 'registry.mergeCandidateSimilarity',
  value: 0.85,
  live: false,
  graduatesWhen:
   'The shadow record shows candidate pairs a human would agree are the same referent. Q-32 keeps the merge itself behind user attestation either way; this threshold only decides what gets shown.',
 },
 'lint.undiscriminatedRangeSimilarity': {
  name: 'lint.undiscriminatedRangeSimilarity',
  value: 0.75,
  live: false,
  graduatesWhen:
   'The shadow record shows pairs a human agrees are two descriptions of one situation (ticket 060). The same normalized-token-overlap function merge-candidate uses, over two claims\' RANGE strings: identical ranges score 1.0 after normalization (case, punctuation and word order discarded), one word of drift in a short range stays above 0.75, and ranges naming clearly different conditions share at most a function word and score far below.',
 },
 'status.readLogDiscount': {
  name: 'status.readLogDiscount',
  value: true,
  live: false,
  graduatesWhen:
   'The shadow record shows the discount changing a status on real data, without demoting a claim the user has since attested (T4). Until then computeStatus applies it to its shadow status only, and logs the delta.',
 },
 'clash.embeddingCosine': {
  name: 'clash.embeddingCosine',
  value: 0.5,
  live: false,
  graduatesWhen:
   'SANITY FLOOR, not the selection mechanism (ticket 083): selection is rank — Q-65 orders pairs with cross-sitting strictly above same-sitting, then by cosine desc, then by the sorted pair key — bounded by the judgment quota (clash.judgmentsPerRun), which cuts the ordered pool to its top-N. The floor keeps near-orthogonal pairs from spending the quota when the corpus is small; 0.5 sits below the measured cross-sitting ceiling of 0.640 (ticket 064) so it can never re-create the ceiling. Graduation evidence remains: the shadow record shows a proposed pair joining TWO SITTINGS.',
 },
 'sweep.attemptsBeforeBackoff': {
  name: 'sweep.attemptsBeforeBackoff',
  value: 3,
  live: true,
  graduatesWhen:
   'Already live: a mechanical liveness rule, not a judgment. A reading that has failed three times stops standing at the head of the sweep — it stays unprocessed, as Q-29 requires — and every demotion is logged.',
 },
 'mint.callsPerRun': {
  name: 'mint.callsPerRun',
  value: 12,
  live: true,
  graduatesWhen:
   'Already live: a quota that protects the docket run must act from day one, or a first run over a large corpus monopolizes every pass. Every clip is logged, and the log is what would resize it.',
 },
 'lint.occasionlessRange': {
  name: 'lint.occasionlessRange',
  value: true,
  live: false,
  graduatesWhen:
   'The shadow record shows the note would fire on a real corpus — a Range that names no occasion (the measured classes: "generally" x7, "in general", the over-broad "throughout their life", RESULTS 16.2 and the 085 review) — and that a human agrees the claim floats free of its occasion (ticket 087). The closed word set the mechanical predicate uses lives in src/wiki/lint.ts; graduating this entry acts on that predicate and nothing else.',
 },
 'lint.weakEvidenceDangler': {
  name: 'lint.weakEvidenceDangler',
  value: true,
  live: false,
  graduatesWhen:
   'The shadow record shows the note firing on claims whose only cite is one of the 96 labelled danglers (docs/dangler-labels-2026-08-02.md), and that a human agrees the single cited snippet cannot carry the claim alone (ticket 087, mode 1 of the 085 review).',
 },
} satisfies Record<string, Threshold>;

export type ThresholdName = keyof typeof THRESHOLDS;

/**
 * The one door every threshold decision passes through. Returns `t.live`:
 * true means the caller is licensed to act, false means it must not.
 *
 * ```
 * if (shadowDecision(THRESHOLDS['lint.godNodeFanout'], 'note god-node on facet=value', log)) {
 *   …act…
 * }
 * ```
 *
 * Graduating a mechanism is then flipping one boolean in the table above, and
 * forgetting to log the road not taken is impossible.
 *
 * `clips` says what KIND of record this call leaves, never whether the caller
 * may act. The plan's three-argument signature cannot tell a gate that ADMITS
 * something (`clash.oppositionGate` pooling a candidate) from a cap that
 * SUPPRESSES something (`remeasure.liveCap` refusing a third re-measure), and
 * only the call site knows which it is. A live gate that logged every
 * admission would bury the clips in noise, and a live cap that logged nothing
 * would hide the only event worth reading — so the caller declares it. It
 * defaults to false, which keeps every three-argument call correct.
 */
export function shadowDecision(
 t: Threshold,
 would: string,
 log: ThresholdLogFn,
 clips = false,
): boolean {
 if (!t.live) {
  // Shadow: the whole point of the call. One line, every time, whether or
  // not the decision would have changed anything downstream.
  log({
   at: new Date().toISOString(),
   actor: 'clerk',
   kind: 'shadow-decision',
   detail: `mode=shadow threshold=${t.name} value=${String(t.value)} would=${would}`,
  });
  return false;
 }

 if (clips) {
  log({
   at: new Date().toISOString(),
   actor: 'clerk',
   kind: 'threshold-clipped',
   detail: `mode=live threshold=${t.name} value=${String(t.value)} clipped=${would}`,
  });
 }

 return true;
}
