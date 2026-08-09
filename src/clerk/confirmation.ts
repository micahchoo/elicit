/**
 * The Clerk's confirmation slice — the answered-question half of the wiki
 * run, extracted whole from `wiki-jobs.ts` (Wave B1) so the run orchestrator
 * could shed its longest tails.
 *
 * What lives here:
 *
 *   - `confirmAnsweredRemeasures` (Q-30 stages 3-4, Q-53, ticket 070) judges
 *     answered re-measures, once per slot in the run;
 *   - `jobRangeDiscrimination` (ticket 060, Q-31's handoff) routes an answered
 *     discriminating question back to two SUPERSEDEs with narrowed Ranges;
 *   - the helpers the two passes share: `confirmingReadings` (Q-53's
 *     held-sittings filter), `juxtaposition`, `recomputeStatus`, `dissolve`,
 *     and `recoverPoles` (the re-measure job's pole re-ask, homed with its
 *     siblings);
 *   - `loadWorld` — the run's world snapshot (graph, claims, queue entries)
 *     that every wiki job opens with.
 *
 * Everything here ran inside `wiki-jobs.ts` before the extraction; the
 * function bodies are byte-identical, and the run reads the same artifacts in
 * the same order (presweep-confirmation, then discriminated-answer, then —
 * after the sweep — confirmation).
 *
 * Dependency direction: this module imports `WikiJobDeps`/`WikiJobsReport`
 * TYPE-ONLY from `wiki-jobs.ts`. The run orchestrator and the re-measure job
 * import its functions, and `wiki-jobs.ts` re-exports `RANGE_DISCRIMINATED`
 * and `dissolutionOutcome` so its own importers stay untouched.
 *
 * The tiny helpers `nowIso`, `JOB_FAILED`, `firstProse`, `byId` and `bound`
 * are deliberate local twins of the ones that remain in `wiki-jobs.ts`: every
 * staying job there uses them too, and importing them back would close a
 * module cycle for the sake of five one-liners. Keep the two copies
 * identical.
 */

import { ulid } from 'ulid';
import { citeSnippetId, sittingsOfCites } from '../wiki/status.js';
import { THRESHOLDS, readNumber } from '../wiki/thresholds.js';
import type { Threshold } from '../domain/thresholds.js';
import { readingTime } from '../wiki/contract.js';
import type {
 Claim,
 ClaimGraph,
 ClashCandidate,
 ClashOutcome,
 Contradiction,
 LogFn,
} from '../wiki/contract.js';
import { recomputeStatus as opsRecomputeStatus } from '../wiki/ops.js';
import { isLive } from '../wiki/clash.js';
import { composeNarrowedRanges } from './composed.js';
import { UNVERIFIED_CONFIRMATION, type ConfirmResult } from './contradiction.js';
import type { QueueEntry, Reading } from '../types.js';
import type { WikiJobDeps, WikiJobsReport } from './wiki-jobs.js';

// ---------------------------------------------------------------------------
// Small helpers — the slice's private twins (see the header)
// ---------------------------------------------------------------------------

const nowIso = (): string => new Date().toISOString();

/** Every per-job failure and the lock refusal, under one kind. Detail says which job. */
const JOB_FAILED = 'wiki-jobs-failed';

/**
 * The prose of the first resolving cited snippet, or the empty string.
 *
 * The one quoting lookup in this slice: the discriminated-answer pass and
 * `recoverPoles` quote through it, as the twin in `wiki-jobs.ts` serves the
 * staying jobs. Keep the two copies identical.
 */
function firstProse(claim: Claim, graph: ClaimGraph): string {
 for (const cite of claim.cites) {
  const snippet = graph.snippets[citeSnippetId(cite)];
  if (snippet) return snippet.prose;
 }
 return '';
}

function byId<T extends { id: string }>(a: T, b: T): number {
 return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A numeric bound from the register. A non-numeric value is a misconfigured
 * entry, and 0 is the safe direction for a cap or a quota: it does less work,
 * never more.
 */
function bound(t: Threshold): number {
 return readNumber(t, 0);
}

// ---------------------------------------------------------------------------
// The run's world
// ---------------------------------------------------------------------------

/**
 * The run's world, loaded once per job.
 *
 * The opening every wiki job shares: the graph snapshot, the claims indexed
 * by id, and the queue entries indexed by id. Five jobs used to spell these
 * reads out at their own top; now every job — the staying ones in
 * `wiki-jobs.ts` and both passes here — opens with one call and destructures
 * what it needs.
 */
export function loadWorld(
 deps: WikiJobDeps,
 graphOf: () => ClaimGraph,
): { graph: ClaimGraph; claims: Map<string, Claim>; entries: Map<string, QueueEntry> } {
 const graph = graphOf();
 const claims = new Map(graph.claims.map((c) => [c.id, c]));
 const entries = new Map(deps.queue.list().map((e) => [e.id, e]));
 return { graph, claims, entries };
}

// ---------------------------------------------------------------------------
// The closed union — the sentinel and the reason mapper
// ---------------------------------------------------------------------------

/**
 * Q-54's sentinel, on the same channel `UNVERIFIED_CONFIRMATION` uses: a
 * dissolving `reason` set to exactly this string means the answer named a
 * discriminating condition rather than denying the tension. No function in
 * `src/clerk/contradiction.ts` writes it yet — that arm is the deferred half —
 * and the day one does, the outcome and its persistence are already here.
 */
export const RANGE_DISCRIMINATED = 'range-discriminated';

/**
 * Which closed-union outcome a dissolving confirmation earned.
 *
 * The reason is a channel as well as prose: `judgeConfirmation` already writes
 * `UNVERIFIED_CONFIRMATION` there when its structural checks refused the
 * evidence, and counting that apart from an honest "no" is the direct
 * measurement of what the self-reported boolean was worth (T16 reads the
 * ratio). `RANGE_DISCRIMINATED` joins it on the same channel for Q-54.
 */
export function dissolutionOutcome(reason: string): ClashOutcome {
 if (reason === UNVERIFIED_CONFIRMATION) return 'unverified-confirmation';
 if (reason === RANGE_DISCRIMINATED) return 'range-discriminated';
 return 'dissolved-on-answer';
}

// ---------------------------------------------------------------------------
// Re-measure pole recovery (Q-30 stage 1 re-ask, Q-53)
// ---------------------------------------------------------------------------

/**
 * Recover the poles of a candidate written by an earlier run.
 *
 * `ClashCandidate` carries no poles — it is a suspicion, and the poles are a
 * property of the judgment that made it. So a candidate whose compose failed
 * on the run that judged it has no question, no queue entry and no way back:
 * job 5 waits for an answer that was never asked for, and T11 will not
 * re-propose the pair. That is a stranding of exactly the shape B9 named, and
 * it is closed by asking stage 1 again, under the same quota and counted in the
 * same precision record. A pair the model no longer calls opposed retires
 * honestly as `not-opposed` rather than waiting forever.
 */
export async function recoverPoles(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 log: LogFn,
 spend: { opposition: number },
 candidate: ClashCandidate,
 a: Claim,
 b: Claim,
 graph: ClaimGraph,
): Promise<{ poleA: string; poleB: string } | null> {
 if (spend.opposition >= bound(THRESHOLDS['clash.judgmentsPerRun'])) return null;

 const quotes = { a: firstProse(a, graph), b: firstProse(b, graph) };
 if (quotes.a === '' || quotes.b === '') return null;

 spend.opposition++;
 try {
  const judgment = await deps.judgeOpposition(a, b, quotes, deps.complete);
  if (!judgment) return null;
  report.oppositionJudged++;
  if (!judgment.opposed) {
   dissolve(deps, candidate, 'not-opposed');
   report.candidatesDissolved++;
   return null;
  }
  report.oppositionOpposed++;
  return { poleA: judgment.poleA, poleB: judgment.poleB };
 } catch (err) {
  log({
   at: nowIso(),
   actor: 'clerk',
   kind: JOB_FAILED,
   detail: `job=repole candidate=${candidate.id} ${err instanceof Error ? err.message : String(err)}`,
  });
  return null;
 }
}

// ---------------------------------------------------------------------------
// Answered re-measure confirmation (Q-30 stages 3-4, Q-53, ticket 070)
// ---------------------------------------------------------------------------

/**
 * Judge answered re-measures, in one pass per slot in the run.
 *
 * The pass IS the ordering (ticket 070): `presweep` runs BEFORE the sweep, so
 * the answer's cite is not yet absorbed into a pole claim and Q-53's
 * held-sittings check can pass; `confirmation` runs after the sweep as a
 * safety net and skips anything the presweep pass already judged. The only
 * behavioral difference between the passes is the log detail that names them.
 *
 * Ticket 070's failure mode: job 1 (sweep) absorbs the re-measure answer's
 * cite into a pole claim via UPDATE. When job 5 then judges,
 * `confirmingReadings` computes the held-sittings set from both claims' cites
 * — which now INCLUDES the answer's own sitting. Q-53 correctly refuses every
 * reading from that sitting, and the candidate is stranded permanently at
 * `pending-remeasure`. Running the presweep pass first, against a graph where
 * the cite is not yet on any pole, ensures the answer's sitting is always
 * admissible.
 */
export async function confirmAnsweredRemeasures(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 graphOf: () => ClaimGraph,
 log: LogFn,
 model: string,
 pass: 'presweep' | 'confirmation',
 invalidateGraph: () => void,
): Promise<void> {
 const { graph, claims, entries } = loadWorld(deps, graphOf);
 const job = pass === 'presweep' ? 'presweep-confirmation' : 'confirmation';

 for (const candidate of deps.store.listCandidates()) {
  if (candidate.status !== 'pending-remeasure') continue;
  const queueId = candidate.remeasureQueueId;
  const askedAt = candidate.remeasureAskedAt;
  if (queueId === undefined || askedAt === undefined) continue;

  // A candidate whose entry still reads `asked` is skipped. That is the
  // normal state, not a leak: an unanswered drawn entry never expires.
  if (entries.get(queueId)?.status !== 'answered') continue;

  const a = claims.get(candidate.pair[0]);
  const b = claims.get(candidate.pair[1]);
  if (!a || !b) continue;

  const readings = confirmingReadings(graph, askedAt, a, b);
  // No admissible reading is not a dissolution — the answer may not have been
  // harvested yet, and retiring the pair here would spend it on a run that
  // learned nothing.
  if (readings.length === 0) continue;

  try {
   const result = await deps.judgeConfirmation(
    candidate,
    { readings, snippets: graph.snippets },
    { a, b },
    deps.complete,
   );
   if (!result) continue;

   if (!result.confirmed) {
    dissolve(deps, candidate, dissolutionOutcome(result.reason));
    report.candidatesDissolved++;
    continue;
   }

   // Confirmed AND structurally verified — T7 did the verifying, and this
   // job never inspects the boolean itself.
   const at = nowIso();
   const contradiction: Contradiction = {
    id: ulid(),
    type: result.type,
    claims: [a.id, b.id],
    candidate: candidate.id,
    remeasureQueueId: queueId,
    evidence: result.evidence,
    status: 'open',
    model,
    modelAt: at,
    opened: at,
    updated: at,
    body: juxtaposition(a, b, result),
   };
   deps.store.writeContradiction(contradiction);
   // The graph now contains a Contradiction the memo predates — drop it so
   // the recomputation below reads the one just written (Q-29's mechanical
   // `contested` depends on `computeStatus` seeing it).
   invalidateGraph();
   log({
    at,
    actor: 'clerk',
    kind: 'contradiction-opened',
    detail: pass === 'presweep' ? `type=${result.type} presweep` : `type=${result.type}`,
    refs: [a.id, b.id, candidate.id],
   });
   deps.store.writeCandidate({ ...candidate, status: 'confirmed' });
   report.contradictionsOpened++;

   // Both claims go `contested` MECHANICALLY (Q-29). Nothing here writes a
   // status by hand; `computeStatus` reads the graph the Contradiction is
   // now part of and answers.
   recomputeStatus([a.id, b.id], deps, graphOf, log, at, model);
  } catch (err) {
   log({
    at: nowIso(),
    actor: 'clerk',
    kind: JOB_FAILED,
    detail: `job=${job} candidate=${candidate.id} ${err instanceof Error ? err.message : String(err)}`,
   });
  }
 }
}

// ---------------------------------------------------------------------------
// Discriminated-answer confirmation (ticket 060) — between presweep and sweep
// ---------------------------------------------------------------------------

/**
 * Route an answered discriminating question back to two SUPERSEDEs, one per
 * claim, each with a narrowed Range (Q-54's consequence, Q-31's handoff).
 *
 * Must run BEFORE the sweep, for ticket 070's reason: the sweep would absorb
 * the answer's cite into a claim via UPDATE, and then the Q-53 held-sittings
 * check in `confirmingReadings` would reject the answer's own sitting.
 * presweep-confirmation is the precedent.
 */
export async function jobRangeDiscrimination(
 deps: WikiJobDeps,
 graphOf: () => ClaimGraph,
 log: LogFn,
 model: string,
 invalidateGraph: () => void,
): Promise<void> {
 const { graph, claims } = loadWorld(deps, graphOf);
 const compose = deps.composeNarrowedRanges ?? composeNarrowedRanges;

 for (const entry of deps.queue.list({ source: 'lint-undiscriminated-range' })) {
  if (entry.status !== 'answered') continue;
  if (entry.answeredAt === undefined) continue;
  const pair = entry.claims;
  if (!pair || pair.length !== 2) continue;
  const [aId, bId] = pair;
  if (!aId || !bId) continue;
  const a = claims.get(aId);
  const b = claims.get(bId);
  if (!a || !b) continue;
  // Idempotence: once a claim is superseded the pair is gone from the live
  // map, and the pair never discriminates again.
  if (!isLive(a) || !isLive(b)) continue;

  // The boundary can be named only while both claims still share a referent;
  // the lexicographically-first shared slug is the reason of record.
  const sharedSlug = a.referents.filter((s) => b.referents.includes(s)).sort()[0];
  if (sharedSlug === undefined) continue;

  // Exactly the Q-53 filter: readings after the answer, from sittings that
  // are neither claim's.
  const readings = confirmingReadings(graph, entry.answeredAt, a, b);
  // No admissible reading is not a resolution — the answer may not have been
  // harvested yet, and retiring the pair here would spend it on a run that
  // learned nothing (mirrors the confirmation comment).
  if (readings.length === 0) continue;

  const prose = { a: firstProse(a, graph), b: firstProse(b, graph) };
  if (prose.a === '' || prose.b === '') continue;

  try {
   const refined = await compose({ a, b }, prose, readings, deps.complete);
   // null is not a failure that retires anything; the pair waits.
   if (!refined) continue;

   const answerCites = readings.flatMap((r) => r.cites ?? []);
   const citesFor = (claim: Claim): string[] => {
    const out = [...claim.cites];
    for (const cite of answerCites) if (!out.includes(cite)) out.push(cite);
    return out;
   };

   const reason = `range-discriminated:lint:${sharedSlug}`;
   const first = readings[0];
   if (!first) continue;

   // TWO applyOps calls, one SUPERSEDE each, both on the full readings list —
   // REQUIRED because applyOps' totality rule (validate rule 3 in
   // src/wiki/ops.ts) allows one op per reading per batch, and two SUPERSEDEs
   // may need to share a single answer reading.
   deps.applyOps(
    [{ op: 'SUPERSEDE', reading: first.id, claim: a.id, body: a.body, range: refined.a, cites: citesFor(a), reason }],
    { readingIds: readings.map((r) => r.id) },
    { store: deps.store, registry: deps.registry, graph, model, log },
   );
   deps.applyOps(
    [{ op: 'SUPERSEDE', reading: readings[1]?.id ?? first.id, claim: b.id, body: b.body, range: refined.b, cites: citesFor(b), reason }],
    { readingIds: readings.map((r) => r.id) },
    { store: deps.store, registry: deps.registry, graph, model, log },
   );
   // Both SUPERSEDEs wrote claims — the graph the watermark fingerprint and
   // the next passes read must include them, so the memo drops here.
   invalidateGraph();

   log({
    at: nowIso(),
    actor: 'clerk',
    kind: 'range-discriminated',
    detail: `pair=${a.id},${b.id} reason=${reason}`,
    refs: [a.id, b.id],
   });
  } catch (err) {
   log({
    at: nowIso(),
    actor: 'clerk',
    kind: JOB_FAILED,
    detail: `job=discriminated-answer pair=${a.id},${b.id} ${err instanceof Error ? err.message : String(err)}`,
    refs: [a.id, b.id],
   });
  }
 }
}


/**
 * The readings a confirmation may rest on.
 *
 * Two filters, and the second is Q-53:
 *
 *   1. LATER than `remeasureAskedAt` — a cheap pre-filter, and the reason that
 *      timestamp is written back onto the candidate at all.
 *   2. From a sitting that is neither claim's. A re-measure answered inside the
 *      frame that produced a claim measures the interview rather than the
 *      belief: lability lives in a continuous conversation, which a session
 *      boundary ends and elapsed time does not track. A reading whose cites
 *      resolve to no snippet places itself nowhere and cannot be shown to be a
 *      different sitting, so it is refused too.
 */
function confirmingReadings(
 graph: ClaimGraph,
 askedAt: string,
 a: Claim,
 b: Claim,
): Reading[] {
 const held = new Set([
  ...sittingsOfCites(a.cites, graph.snippets),
  ...sittingsOfCites(b.cites, graph.snippets),
 ]);

 return Object.values(graph.readings)
  .filter((r) => readingTime(r) > askedAt)
  .filter((r) => {
   const sittings = sittingsOfCites(r.cites, graph.snippets);
   if (sittings.size === 0) return false;
   for (const s of sittings) if (held.has(s)) return false;
   return true;
  })
  .sort(byId);
}

/** The two poles, dated — Juxtaposition material (Q-15), never an accusation. */
function juxtaposition(a: Claim, b: Claim, result: ConfirmResult & { confirmed: true }): string {
 return [
  `${a.body} (${a.range}, ${a.created.slice(0, 10)})`,
  `${b.body} (${b.range}, ${b.created.slice(0, 10)})`,
  `> ${result.evidence.quote}`,
 ].join('\n\n');
}

/**
 * Status after a Contradiction opens — delegated to `src/wiki/ops.ts`, which is
 * the ONE place a claim's status reaches disk (Q-29).
 *
 * Opening a Contradiction is not an op, so it cannot travel through `applyOps`;
 * this file briefly grew its own claim write for it and became a fourth
 * write site, breaking the invariant the plan's grep guards. `ops.ts` now
 * exports the routine instead. Its version is also strictly better than the
 * copy that was here: it propagates to a contradiction's partner claim, which
 * the local one did not.
 */
function recomputeStatus(
 ids: string[],
 deps: WikiJobDeps,
 graphOf: () => ClaimGraph,
 log: LogFn,
 at: string,
 model: string,
): void {
 // The RUN's resolved stamp, not `deps.model` — re-deriving it here would drop
 // the `ELICIT_CLERK_MODEL` fallback and stamp a different model than the one
 // that produced everything else this run wrote (Q-34, Q-48).
 opsRecomputeStatus(ids, {
  store: deps.store,
  registry: deps.registry,
  graph: graphOf(),
  model,
  log,
 }, at);
}

/**
 * Retire a suspicion with its reason of record.
 *
 * One function for all five `ClashOutcome` members, because the outcome is the
 * anti-repetition key T11 reads back and a second write path is a second place
 * for it to go missing. The candidate file stays on disk; nothing is deleted.
 */
export function dissolve(deps: WikiJobDeps, candidate: ClashCandidate, outcome: ClashOutcome): void {
 deps.store.writeCandidate({ ...candidate, status: 'dissolved', outcome });
}
