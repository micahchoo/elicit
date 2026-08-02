/**
 * The Clerk's wiki work, as one run — five jobs, in order, each isolated, with
 * one half-job between the first two.
 *
 * The half-job is `jobPrime`, and it is numbered that way because it decides
 * nothing and writes no wiki artifact: it only gives the async clash channels a
 * vector for what the sweep just minted, so that job 3 can see this run's own
 * claims instead of the previous run's. Ticket 067 has the reasoning; the
 * function's own comment has the two constraints that make it safe.
 *
 * This is where the slice becomes a program. Every module below it is pure or
 * single-purpose and none of them has a caller until this file exists, so the
 * shape of this file is the shape of the whole slice's failure modes:
 *
 *   - **Per-job isolation** (ticket 023 item 2). Each job runs inside its own
 *     try/catch, and inside job 1 each `proposeOps` call runs inside a second
 *     one. A dead endpoint costs the reading it was called for and nothing
 *     else; lint, the candidate pool and the confirmation pass still run, and
 *     `runWikiJobs` still returns a fully populated report.
 *   - **One in-process lock**, exactly as `runDocket` has. A concurrent call
 *     returns an empty report rather than interleaving writes into the same
 *     four directories.
 *   - **Nothing is written except through `applyOps` and `store.write*`.** No
 *     `Claim` literal is constructed here; a status is never written by hand
 *     (`computeStatus` decides it, Q-29); and the four model-facing
 *     collaborators are injected, so every test runs on fakes.
 *
 * ── Decisions this file records, because a reader will want them ──
 *
 * **`Registry.mergeCandidates` is NOT called here, and that is the choice.**
 * T8's `lint` computes the same relation over the same data and its finding is
 * the one the user sees (`src/wiki/registry.ts` says so itself). Calling both
 * in one docket pass would put two shadow records per pair into
 * `WikiReport.shadow` and double-count the evidence that
 * `registry.mergeCandidateSimilarity` graduates on under Q-35 — which is the
 * one thing that must not happen to a graduation record. So this run calls
 * `lint` only, and `Registry.mergeCandidates` is documented as the editing
 * slice's entry point: its real consumer is the user-attested merge verb,
 * which needs `Referent` objects rather than lint's slug strings.
 * `tests/wiki-jobs.test.ts` holds it shut with a registry that throws.
 *
 * **`Registry.claimsFor` is not read here either.** It returns archived and
 * superseded claims by design, and its one consumer in this slice is T11's
 * referent channel, which filters. Nothing in this file has to remember to.
 *
 * **`applyOps` emits no `REJECTED` sweep line** — T9 leaves the ledger to the
 * caller and emits `claim-op-rejected` to the Activity Log instead. This file
 * owns the ledger line, and appends one per `rejected[].reading`, because that
 * count is what the back-off rule in job 1 reads on the next run.
 *
 * **This file writes no Claim at all, and that was a repair.** It briefly grew
 * its own claim write for the one status change that is not an op —
 * opening a Contradiction contests both claims mechanically, and Q-29 has no op
 * that can carry a status — which made a FOURTH write site and broke the
 * invariant T9's grep guards. `src/wiki/ops.ts` now exports `recomputeStatus`
 * and this file delegates to it, so `store.ts` and `ops.ts` remain the only two
 * places a claim reaches disk. The exported routine is also better than the
 * copy that was here: it propagates to a contradiction's partner claim.
 *
 * **Two bounds live here rather than in `THRESHOLDS`.** Q-56: bounds ship live
 * from day one, so there is no shadow for them to graduate out of. The
 * opposition judgment quota is declared below as a `Threshold`-shaped literal
 * and passed through `shadowDecision` so that every clip leaves the same
 * `threshold-clipped` record any register entry would — the precedent is
 * `REFERENT_FANOUT_CAP` in `src/wiki/clash.ts`. Moving either into the
 * register is a one-line change in a file this task does not own.
 *
 * **Q-54 is half-built, deliberately.** `range-discriminated` is a
 * `ClashOutcome` and this file persists it like any other: `dissolutionOutcome`
 * maps a confirmation's reason onto the closed union, and `RANGE_DISCRIMINATED`
 * is the sentinel that reaches it — the same shape `UNVERIFIED_CONFIRMATION`
 * already uses. What is NOT built is the consequence Q-54 names: one SUPERSEDE
 * per pole with a narrowed Range and reason `range-discriminated:<candidateId>`.
 * That needs a composed narrowed Range, which no function in `src/clerk/`
 * produces today, and `judgeConfirmation` has no arm that reports a
 * discriminating condition. Both are edits to files this task does not own.
 * Reported as deferred rather than skipped.
 */

import { ulid } from 'ulid';
import { buildIndex, resonate } from '../index/lexical.js';
import {
 claimDelta,
 changedIn,
 fingerprintOf,
 readWatermark,
 sameFingerprint,
 vaultDiff,
 writeWatermark,
} from '../index/watermark.js';
import type { IndexFingerprint, VaultDiff } from '../index/watermark.js';
import { sittingsOfCites } from '../wiki/status.js';
import { THRESHOLDS, shadowDecision, type Threshold } from '../wiki/thresholds.js';
import type { ThresholdRegister } from '../wiki/lint.js';
import { SUPERSEDE_MODEL_UPGRADE, readingTime, shadowCollector } from '../wiki/contract.js';
import type { ApplyDeps } from '../wiki/ops.js';
import { recomputeStatus as opsRecomputeStatus } from '../wiki/ops.js';
import type {
 Claim,
 ClaimGraph,
 ClaimStore,
 ClashCandidate,
 ClashOutcome,
 ClerkOp,
 Contradiction,
 LintFinding,
 LogFn,
 OpResult,
 Registry,
 WikiReport,
} from '../wiki/contract.js';
import type { ClashChannel, ClashPool } from '../wiki/clash.js';
import { primeable } from '../wiki/embedding.js';
import type { MintItem, MintResult } from './mint.js';
import { UNVERIFIED_CONFIRMATION, type ConfirmResult, type OppositionJudgment } from './contradiction.js';
import { readSitting, sittingCache } from './sitting.js';
import type { SittingContext } from './composed.js';
import type {
 Complete,
 Index,
 QueueDraft,
 QueueEntry,
 QueueStore,
 Reading,
 Snippet,
} from '../types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The Q-34 stamp when the caller supplies none. `bonsai-27b` is the ELICITOR
 * (Q-48); the Clerk's careful model is what writes every artifact here, and a
 * stamp that named the wrong role would make the two indistinguishable in the
 * record — which is the one thing Q-34 stamps exist to keep possible.
 */
export const DEFAULT_CLERK_MODEL = 'qwen3.6:35b';

/** Every per-job failure and the lock refusal, under one kind. Detail says which job. */
const JOB_FAILED = 'wiki-jobs-failed';

/**
 * Q-54's sentinel, on the same channel `UNVERIFIED_CONFIRMATION` uses: a
 * dissolving `reason` set to exactly this string means the answer named a
 * discriminating condition rather than denying the tension. No function in
 * `src/clerk/contradiction.ts` writes it yet — that arm is the deferred half —
 * and the day one does, the outcome and its persistence are already here.
 */
export const RANGE_DISCRIMINATED = 'range-discriminated';

/**
 * How many opposition judgments one run may spend (Q-56).
 *
 * A BOUND, not a selection threshold: it ships live at birth, because a quota
 * in shadow is not a quota. What it owes instead is the record, so it is shaped
 * as a `Threshold` and passed through `shadowDecision` with `clips: true` — a
 * clip therefore leaves the same `threshold-clipped` line a register entry
 * would, and moving it into `src/wiki/thresholds.ts` later changes one import.
 */
export const OPPOSITION_QUOTA: Threshold = {
 name: 'clash.judgmentsPerRun',
 value: 3,
 live: true,
 graduatesWhen:
  'Already live: Q-56 makes quotas live at birth, since a quota in shadow lets the run it was meant to bound proceed unbounded. PROVISIONAL per Q-30 — the VALUE is unearned, not the liveness. Every clip emits threshold-clipped, and that record is what resizes it.',
};

/** At most this many existing claims are shown to the model beside one reading. */
const RELATED_CLAIMS_SHOWN = 3;

/** How much of an unparsable model answer rides into the log line. */
const RAW_EXCERPT_CHARS = 200;

/**
 * Ticket 076's gates. The queue-driven jobs and the sweep gate on the git
 * diff since the last docket commit (Q-61): a job whose inputs show no diff
 * is skipped and logs `wiki-job-skipped reason=no-diff`, a different outcome
 * from ran-and-found-nothing (the 034 rule). The docket's own bookkeeping —
 * `log/`, `wiki/sweep-log.jsonl`, `wiki/sweep-deferral.jsonl`,
 * `wiki/still-true-cursor.json` — maps to no input class on purpose.
 */
const GIT_GATED_INPUTS: Record<string, readonly string[]> = {
 'presweep-confirmation': ['queue/', 'wiki/candidates/', 'wiki/claims/', 'wiki/readings/', 'snippets/'],
 sweep: ['wiki/readings/', 'snippets/'],
 remeasure: ['queue/', 'wiki/candidates/', 'wiki/claims/', 'snippets/'],
 confirmation: ['queue/', 'wiki/candidates/', 'wiki/claims/', 'wiki/readings/', 'snippets/'],
};

/**
 * The graph-derived passes gate on the index watermark instead: the pool, the
 * embeddings and the lint findings are a pure function of the graph, so a run
 * whose fingerprint matches the watermark knows the index is current and
 * skips them. A missing or unreadable watermark is the repair path — the full
 * rebuild that is today's behavior.
 */
const WATERMARK_GATED = new Set(['prime', 'lint', 'candidates']);

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type WikiJobDeps = {
 store: ClaimStore;
 registry: Registry;
 queue: QueueStore;
 /** Snippets and readings live in the Vault; `loadSlice` holds the rest of the graph. */
 vault: { rebuildIndex(): Index };
 /** `makeComplete('clerk')` (Q-48). Never called by this file directly. */
 complete: Complete;
 channels: ClashChannel[];
 proposeOps: (item: MintItem, complete: Complete) => Promise<MintResult>;
 applyOps: (ops: unknown[], sweep: { readingIds: string[] }, deps: ApplyDeps) => OpResult;
 lint: (graph: ClaimGraph, thresholds: ThresholdRegister, log: LogFn) => LintFinding[];
 poolCandidates: (
  graph: ClaimGraph,
  channels: ClashChannel[],
  store: ClaimStore,
  log: LogFn,
 ) => ClashPool;
 judgeOpposition: (
  a: Claim,
  b: Claim,
  quotes: { a: string; b: string },
  complete: Complete,
 ) => Promise<OppositionJudgment | null>;
 composeRemeasure: (
  candidate: { a: Claim; b: Claim; poleA: string; poleB: string },
  originalQuestions: string[],
  complete: Complete,
 ) => Promise<QueueDraft | null>;
 judgeConfirmation: (
  candidate: ClashCandidate,
  remeasure: { readings: Reading[]; snippets: Record<string, Snippet> },
  claims: { a: Claim; b: Claim },
  complete: Complete,
 ) => Promise<ConfirmResult | null>;
 composeStillTrue: (
  snippet: Snippet,
  complete: Complete,
  sitting?: SittingContext,
 ) => Promise<QueueDraft | null>;
 log: LogFn;
 vaultRoot: string;
 /** Defaults to `ELICIT_CLERK_MODEL ?? 'qwen3.6:35b'` (Q-34, Q-48). */
 model?: string;
 thresholds?: ThresholdRegister;
 /** Ticket 045: a question inherits the Target of the sitting whose words it quotes. */
 sittingOf?: (root: string, session: string) => SittingContext;
};

/**
 * The pool's own measurements, carried out of the run (ticket 059, Q-52).
 *
 * `WikiReport.candidates` says what each channel produced and nothing more, so
 * on its own it still cannot tell "the pool was empty" from "the pool was full
 * of agreement" from "no contradictions exist". These four numbers can: `size`
 * against `perChannel` separates an empty pool from a suppressed one,
 * `suppressed` names the anti-repetition filter's work, and `reproposed`
 * counts Q-53's second attempts.
 *
 * It rides as an intersection rather than as new `WikiReport` fields because
 * `src/wiki/contract.ts` is not this task's to edit — ticket 059 is where the
 * fields land. The intersection is assignable to `WikiReport` everywhere
 * `WikiReport` is expected, so T13 and `DocketReport.wiki` are unaffected.
 */
export type PoolReport = {
 size: number;
 perChannel: Record<string, number>;
 suppressed: number;
 reproposed: number;
};

export type WikiJobsReport = WikiReport & { pool: PoolReport };

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const nowIso = (): string => new Date().toISOString();

/** The snippet id half of a `snippetId@version` cite. */
function snippetIdOf(cite: string): string {
 const at = cite.lastIndexOf('@');
 return at <= 0 ? cite : cite.slice(0, at);
}

/**
 * A numeric bound from the register. A non-numeric value is a misconfigured
 * entry, and 0 is the safe direction for a cap or a quota: it does less work,
 * never more.
 */
function bound(t: Threshold): number {
 return typeof t.value === 'number' ? t.value : 0;
}

/** A claim the graph still asserts. Archived and superseded claims are history. */
function isLive(c: Claim): boolean {
 return c.archived !== true && c.supersededBy === undefined;
}

function byId<T extends { id: string }>(a: T, b: T): number {
 return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The prose of the first cite that resolves, or the empty string. */
function quoteFor(claim: Claim, graph: ClaimGraph): string {
 for (const cite of claim.cites) {
  const snippet = graph.snippets[snippetIdOf(cite)];
  if (snippet) return snippet.prose;
 }
 return '';
}

/** The questions that elicited the words two claims rest on (Q-14's input). */
function originalQuestions(a: Claim, b: Claim, graph: ClaimGraph): string[] {
 const out: string[] = [];
 for (const cite of [...a.cites, ...b.cites]) {
  const question = graph.snippets[snippetIdOf(cite)]?.provenance.question;
  if (question && !out.includes(question)) out.push(question);
 }
 return out;
}

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

/** The empty report — the concurrent-call answer, and the shape every job fills in. */
function emptyReport(): WikiJobsReport {
 return {
  swept: 0,
  applied: 0,
  rejected: 0,
  unprocessed: 0,
  oversized: 0,
  stuck: 0,
  lint: [],
  candidates: {},
  oppositionJudged: 0,
  oppositionOpposed: 0,
  remeasuresMinted: 0,
  remeasuresExpired: 0,
  contradictionsOpened: 0,
  candidatesDissolved: 0,
  mint: {
   calls: 0,
   callsParsed: 0,
   callErrors: 0,
   oversized: 0,
   opsSeen: 0,
   readingsSwept: 0,
  },
  shadow: [],
  pool: { size: 0, perChannel: {}, suppressed: 0, reproposed: 0 },
 };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** In-process lock, exactly as `runDocket` holds one. */
let running = false;

export async function runWikiJobs(deps: WikiJobDeps): Promise<WikiJobsReport> {
 if (running) {
  deps.log({
   at: nowIso(),
   actor: 'clerk',
   kind: JOB_FAILED,
   detail: 'job=lock a wiki run is already in progress, so this one did nothing',
  });
  return emptyReport();
 }
 running = true;

 const report = emptyReport();
 const collector = shadowCollector(deps.log);
 const log = collector.log;
 const model = deps.model ?? clerkModel();
 const thresholds = deps.thresholds ?? THRESHOLDS;
 const poles = new Map<string, { poleA: string; poleB: string }>();
 const spend = { opposition: 0 };
 /** What job 1 minted or rewrote, and therefore what job 1.5 must embed. */
 const touched = new Set<string>();

 const graph = (): ClaimGraph => {
  const index = deps.vault.rebuildIndex();
  return { ...deps.store.loadSlice(), snippets: index.snippets, readings: index.readings };
 };

 // ── Ticket 076: the two gates, computed once so a skipped job costs only a log line ──
 const diff = vaultDiff(deps.vaultRoot);
 const watermark = readWatermark(deps.vaultRoot);
 const gateGraph = graph();
 const current = fingerprintOf(gateGraph, deps.store.listCandidates());
 const indexCurrent = watermark !== null && sameFingerprint(watermark, current);

 const guard = async (job: string, run: () => Promise<void>): Promise<void> => {
  try {
   await run();
  } catch (err) {
   // A caught failure leaves its counters where they stand and never
   // throws: the report is what the docket renders, and a run that half
   // happened must still be able to say so.
   log({
    at: nowIso(),
    actor: 'clerk',
    kind: JOB_FAILED,
    detail: `job=${job} ${err instanceof Error ? err.message : String(err)}`,
   });
  }
 };

 let indexRan = false;
 const guardGated = async (job: string, run: () => Promise<void>): Promise<void> => {
  const inputs = GIT_GATED_INPUTS[job];
  const shouldRun = inputs !== undefined
   ? !diff.available || changedIn(diff, inputs)
   : !indexCurrent;
  if (!shouldRun) {
   const reason = inputs !== undefined
    ? `reason=no-diff since=${diff.since ?? ''}`
    : `reason=index-current at=${watermark!.at}`;
   log({ at: nowIso(), actor: 'clerk', kind: 'wiki-job-skipped', detail: `job=${job} ${reason}` });
   return;
  }
  if (inputs === undefined) indexRan = true;
  await guard(job, run);
 };

 try {
  await guardGated('presweep-confirmation', () => jobPresweepConfirmation(deps, report, graph, log, model));
  await guardGated('sweep', () => jobSweep(deps, report, graph, log, model, touched));
  await guardGated('prime', () => jobPrime(deps, graph, touched, watermark));
  await guardGated('lint', () => jobLint(deps, report, graph, log, thresholds));
  await guardGated('candidates', () => jobCandidates(deps, report, graph, log, model, poles, spend));
  // Ticket 076: the watermark is written HERE — after the index passes and
  // before the queue-driven jobs — so a candidate dissolved or minted by
  // remeasure/confirmation lands after the watermark and re-opens the index
  // passes on the next run. Q-53's one reproposal after an expiry depends on
  // that exact ordering.
  if (indexRan) writeWatermark(deps.vaultRoot, fingerprintOf(graph(), deps.store.listCandidates()));
  await guardGated('remeasure', () => jobRemeasure(deps, report, graph, log, poles, spend));
  await guardGated('confirmation', () => jobConfirmation(deps, report, graph, log, model));
  report.shadow = collector.records;
  log({
   at: nowIso(),
   actor: 'clerk',
   kind: 'wiki-run',
   detail:
    `swept=${report.swept} applied=${report.applied} rejected=${report.rejected} ` +
    `unprocessed=${report.unprocessed} oversized=${report.oversized} stuck=${report.stuck} ` +
    `oppositionJudged=${report.oppositionJudged} oppositionOpposed=${report.oppositionOpposed} ` +
    `remeasuresMinted=${report.remeasuresMinted} remeasuresExpired=${report.remeasuresExpired} ` +
    `contradictionsOpened=${report.contradictionsOpened} candidatesDissolved=${report.candidatesDissolved}`,
  });
  return report;
 } finally {
  running = false;
 }
}

/** `ELICIT_CLERK_MODEL ?? 'qwen3.6:35b'` — the Clerk's role, never the Elicitor's (Q-48). */
function clerkModel(): string {
 const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
 return env?.['ELICIT_CLERK_MODEL'] ?? DEFAULT_CLERK_MODEL;
}

// ---------------------------------------------------------------------------
// Job 1 — the sweep (Q-28), with Q-34's lazy re-annotation folded in
// ---------------------------------------------------------------------------

async function jobSweep(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 graphOf: () => ClaimGraph,
 log: LogFn,
 model: string,
 touched: Set<string>,
): Promise<void> {
 const graph = graphOf();
 const swept = deps.store.sweptReadingIds();
 const attempts = deps.store.attemptCounts();
 const backoff = bound(THRESHOLDS['sweep.attemptsBeforeBackoff']);

 const pending = Object.values(graph.readings)
  .filter((r) => !swept.has(r.id))
  .sort(byId);

 // S11: a reading the model cannot handle must not sit at the head of a
 // fixed-order queue and eat the whole run quota forever while new material
 // starves. It stays unprocessed (Q-29) — it just stops going first.
 const stuck = pending.filter((r) => (attempts.get(r.id) ?? 0) >= backoff);
 const fresh = pending.filter((r) => (attempts.get(r.id) ?? 0) < backoff);
 const ordered = [...fresh, ...stuck];
 report.stuck = stuck.length;

 const quota = bound(THRESHOLDS['mint.callsPerRun']);
 if (ordered.length > quota) {
  shadowDecision(
   THRESHOLDS['mint.callsPerRun'],
   `${ordered.length - quota} readings left for the next run`,
   log,
   true,
  );
 }
 const batch = ordered.slice(0, quota);
 if (batch.length === 0) return;

 const live = graph.claims.filter(isLive).sort(byId);
 const claimIndex = buildIndex(live.map(asIndexEntry));
 const claimsById = new Map(live.map((c) => [c.id, c]));

 // The bodies as they stood BEFORE any op landed. Ticket 067's second prime
 // needs to know what this job changed, and `applyOps` cannot say: a MINT op
 // carries no id, because the id is minted inside the write boundary. The diff
 // below is the only honest answer, and it is keyed on the BODY rather than on
 // `updated` because a body is exactly what an embedding is OF.
 const bodiesBefore = new Map(graph.claims.map((c) => [c.id, c.body]));

 const ops: unknown[] = [];
 const accepted: string[] = [];
 const at = nowIso();

 for (const reading of batch) {
  report.mint.calls++;
  try {
   const result = await deps.proposeOps(
    {
     reading,
     snippets: citedSnippets(reading, graph),
     relatedClaims: relatedClaims(reading, claimIndex, claimsById),
    },
    deps.complete,
   );
   report.mint.opsSeen += result.diagnostics.opsSeen;

   // The four outcomes, four kinds. `oversized` is read FIRST, because
   // `proposeOps` reports it with `parsed: false` — nothing was parsed
   // because no call was made.
   if (result.diagnostics.oversized) {
    deps.store.appendSweep({ readingId: reading.id, op: 'OVERSIZED', at, model });
    report.oversized++;
    report.mint.oversized++;
    report.swept++;
    log({
     at,
     actor: 'clerk',
     kind: 'mint-oversized',
     detail: `reading=${reading.id} did not fit the payload budget, so it was set aside`,
     refs: [reading.id],
    });
    continue;
   }

   if (!result.diagnostics.parsed) {
    deps.store.appendSweep({ readingId: reading.id, op: 'REJECTED', at, model, reason: 'parse' });
    log({
     at,
     actor: 'clerk',
     kind: 'mint-parse-failed',
     detail: `reading=${reading.id} raw="${result.raw.slice(0, RAW_EXCERPT_CHARS)}"`,
     refs: [reading.id],
    });
    continue;
   }
   report.mint.callsParsed++;

   if (result.ops.length === 0) {
    deps.store.appendSweep({ readingId: reading.id, op: 'REJECTED', at, model, reason: 'empty' });
    log({
     at,
     actor: 'clerk',
     kind: 'mint-empty',
     detail: `reading=${reading.id} parsed cleanly and proposed no operation`,
     refs: [reading.id],
    });
    continue;
   }

   accepted.push(reading.id);
   ops.push(...withModelUpgradeReasons(result.ops, deps.store, model));
  } catch (err) {
   report.mint.callErrors++;
   deps.store.appendSweep({ readingId: reading.id, op: 'REJECTED', at, model, reason: 'call' });
   log({
    at,
    actor: 'clerk',
    kind: 'mint-call-failed',
    detail: `reading=${reading.id} ${err instanceof Error ? err.message : String(err)}`,
    refs: [reading.id],
   });
  }
 }

 if (accepted.length === 0) {
  report.unprocessed = batch.length - report.swept;
  report.mint.readingsSwept = report.swept;
  return;
 }

 const result = deps.applyOps(ops, { readingIds: accepted }, {
  store: deps.store,
  registry: deps.registry,
  graph,
  model,
  log,
 });

 report.applied = result.applied.length;
 report.rejected = result.rejected.length;
 report.swept += result.applied.length;
 report.unprocessed = batch.length - report.swept;
 report.mint.readingsSwept = report.swept;

 // Ticket 067: which claims this job created or rewrote. Read from the store
 // rather than from `graphOf()`, because the claims are the only half needed
 // and rebuilding the vault index for them would be a sixth pass over the
 // snippets to answer a question about the wiki.
 //
 // No liveness filter, and that is deliberate rather than forgotten. No op
 // both rewrites a body and retires the claim — MERGE archives its sources
 // with their bodies untouched, SUPERSEDE leaves the old body where it was and
 // writes a NEW claim — so a changed body is a live claim by construction. And
 // the consumer filters anyway: `prime` intersects this set with its own
 // window of live claims. A guard here would be a branch no op can reach.
 for (const claim of deps.store.loadSlice().claims) {
  if (bodiesBefore.get(claim.id) !== claim.body) touched.add(claim.id);
 }

 // T9 emits `claim-op-rejected` and leaves the ledger to us. The REJECTED line
 // is what the back-off rule above counts on the next run, so it has to be
 // written here or the rule has no input.
 for (const rejection of result.rejected) {
  if (rejection.reading === undefined) continue;
  deps.store.appendSweep({
   readingId: rejection.reading,
   op: 'REJECTED',
   at,
   model,
   reason: rejection.reason,
  });
 }
}

/**
 * The claim-body index adapter.
 *
 * `buildIndex` reads `id`, `version` and `prose` and nothing else; the rest of
 * the shape is filled to satisfy the type. **No synthetic Snippet is written to
 * disk and none escapes this module** — Sole Authorship (Q-1) governs what a
 * Snippet is, and a claim body is agent prose. `src/wiki/clash.ts` holds a
 * private twin of this for the lexical channel; neither file exports it, so
 * both are kept deliberately identical rather than shared through a widened
 * surface nobody asked for.
 */
function asIndexEntry(c: Claim): Snippet {
 return {
  id: c.id,
  version: 1,
  captured: c.created,
  provenance: { kind: 'harvest', session: '', question: '', questionForm: 'deliberative' },
  prose: c.body,
 };
}

/** The reading's cited snippets, keyed by id, latest version each. */
function citedSnippets(reading: Reading, graph: ClaimGraph): Record<string, Snippet> {
 const out: Record<string, Snippet> = {};
 for (const cite of reading.cites) {
  const id = snippetIdOf(cite);
  const snippet = graph.snippets[id];
  if (snippet) out[id] = snippet;
 }
 return out;
}

/** Up to three live claims whose bodies resonate with this reading. */
function relatedClaims(
 reading: Reading,
 index: ReturnType<typeof buildIndex>,
 claims: Map<string, Claim>,
): Claim[] {
 const out: Claim[] = [];
 for (const hit of resonate(index, reading.reading)) {
  const claim = claims.get(hit.snippetId);
  if (!claim) continue;
  out.push(claim);
  if (out.length === RELATED_CLAIMS_SHOWN) break;
 }
 return out;
}

/**
 * Q-34's lazy re-annotation, and the whole of it.
 *
 * A claim this run touched anyway, whose stamp names a model that is not the
 * one now reading, and which the current model proposes to SUPERSEDE — that IS
 * the disagreement Q-34 describes, and its reason of record is `model-upgrade`
 * so that later drift analysis can subtract it. **No batch job runs here**: the
 * full re-annotation pass is user-triggered and this slice does not build its
 * trigger. Nothing extra is sent to the model; the op path is the normal one.
 */
function withModelUpgradeReasons(ops: ClerkOp[], store: ClaimStore, model: string): unknown[] {
 return ops.map((op) => {
  if (op.op !== 'SUPERSEDE') return op;
  const target = store.readClaim(op.claim);
  if (!target || target.model === model) return op;
  return { ...op, reason: SUPERSEDE_MODEL_UPGRADE };
 });
}

// ---------------------------------------------------------------------------
// Job 1.5 — the second prime (ticket 067)
// ---------------------------------------------------------------------------

/**
 * Give the async channels a vector for everything job 1 just wrote.
 *
 * **Why it is here and not left to the caller.** `src/server.ts` primes before
 * the run, which is correct and not enough: job 1 is the sweep that MINTS
 * claims, and job 3 pools them through `candidates()`, which is cache-only and
 * synchronous by design. A claim born in this run therefore had no vector until
 * the NEXT run, and the embedding channel skipped it — never an error, never a
 * fabricated pair, just silence. On the first run over an imported corpus,
 * where every claim is minted in one sweep, that silence is the whole channel,
 * and Q-35 reads it as "the channel found nothing" when the channel was never
 * asked. Ticket 007 already showed this channel's silence is hard to read; a
 * second source of the same silence makes the graduation record worse.
 *
 * **It is a second `prime`, never an await inside `candidates()`.**
 * `poolCandidates` depends on `candidates` being pure, synchronous and
 * deterministic, so the async half stays outside it.
 *
 * **It embeds only what the sweep added.** `touched` is job 1's diff, so a run
 * that mints one claim into a wiki of four hundred costs one embed and not four
 * hundred — and a first prime that gave up at its budget is not silently asked
 * to spend that budget twice. The graph handed over is the WHOLE post-sweep
 * graph, because the channel prunes its cache to the live claims of the graph
 * it is given: a narrowed graph here would delete every vector the first prime
 * wrote (ticket 053 recorded that deletion arriving from the other direction).
 *
 * Nothing runs when the sweep changed nothing, so an ordinary quiet run makes
 * no network call and writes no vector file at all.
 */
async function jobPrime(
 deps: WikiJobDeps,
 graphOf: () => ClaimGraph,
 touched: Set<string>,
 watermark: IndexFingerprint | null,
): Promise<void> {
 // `ClashChannel` cannot express `prime`, and `primeable` is the one place
 // that shape is tested — see `src/wiki/embedding.ts`.
 const asyncChannels = deps.channels.filter(primeable);
 if (asyncChannels.length === 0) return;

 const graph = graphOf();
 // Ticket 076: the watermark's delta joins the sweep's touched set as the
 // embedding work list, so a claim hand-edited between runs is re-embedded
 // even though the sweep did not touch it. A MISSING watermark keeps ticket
 // 067's exact narrowing (the touched set alone): the repair path is a run
 // identical to today's, never a broader one — the index passes all run, the
 // watermark is rewritten, and the results match the pre-076 path. Either
 // way the graph handed to `prime` stays whole — ticket 067's rule, because
 // `persist` prunes to the live claims of the graph it is given.
 let only: Set<string> | undefined;
 if (watermark !== null) {
  only = claimDelta(watermark, graph.claims);
  for (const id of touched) only.add(id);
  if (only.size === 0) return;
 } else if (touched.size === 0) {
  return;
 } else {
  only = touched;
 }
 for (const channel of asyncChannels) await channel.prime(graph, only);
}

// ---------------------------------------------------------------------------
// Job 2 — lint, and its one mechanical consequence (Q-31)
// ---------------------------------------------------------------------------

async function jobLint(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 graphOf: () => ClaimGraph,
 log: LogFn,
 thresholds: ThresholdRegister,
): Promise<void> {
 const graph = graphOf();
 const findings = deps.lint(graph, thresholds, log);
 report.lint = findings;

 const live = new Map(graph.claims.filter(isLive).map((c) => [c.id, c]));
 const sittingFor = sittingCache(deps.vaultRoot, deps.sittingOf ?? readSitting);

 for (const finding of findings) {
  if (finding.kind !== 'stale-citation') continue;
  const claim = live.get(finding.subject);
  if (!claim) continue;

  // Deduped on the CLAIM, never on the cite (B8). `composeStillTrue`'s draft
  // cites one snippet version, so joining through the snippet would let two
  // claims resting on one stale snippet suppress each other's question —
  // the opposite of Q-31's "one per flagged claim".
  //
  // The predicate is "not yet resolved", never "pending" (S8): a drawn entry
  // reads `asked` and `expire()` only ever expires `pending` ones, so an
  // unanswered drawn entry stays `asked` indefinitely and a pending-keyed
  // dedupe would re-mint the run after the question was drawn.
  const held = deps.queue
   .list({ source: 'lint-still-true' })
   .some((e) => e.claim === claim.id && e.status !== 'answered' && e.status !== 'expired');
  if (held) continue;

  const stale = finding.refs
   .slice(1)
   .map((ref) => graph.snippets[snippetIdOf(ref)])
   .find((s): s is Snippet => s !== undefined);
  if (!stale) continue;

  try {
   const draft = await deps.composeStillTrue(
    stale,
    deps.complete,
    sittingFor(stale.provenance.session),
   );
   if (!draft) continue;
   // Spread, never used unmodified (S21): `composeStillTrue` hardcodes
   // `source: 'still-true'`, and a draft used as-is would land invisible to
   // the dedupe above and to the report.
   deps.queue.add({ ...draft, source: 'lint-still-true', claim: claim.id });
  } catch (err) {
   log({
    at: nowIso(),
    actor: 'clerk',
    kind: JOB_FAILED,
    detail: `job=lint-still-true claim=${claim.id} ${err instanceof Error ? err.message : String(err)}`,
    refs: [claim.id],
   });
  }
 }
}

// ---------------------------------------------------------------------------
// Job 3 — the candidate pool and its opposition judgments (Q-30 stage 1)
// ---------------------------------------------------------------------------

async function jobCandidates(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 graphOf: () => ClaimGraph,
 log: LogFn,
 model: string,
 poles: Map<string, { poleA: string; poleB: string }>,
 spend: { opposition: number },
): Promise<void> {
 const graph = graphOf();
 const pool = deps.poolCandidates(graph, deps.channels, deps.store, log);

 report.candidates = pool.perChannel;
 report.pool = {
  size: pool.pairs.length,
  perChannel: pool.perChannel,
  suppressed: pool.suppressed,
  reproposed: pool.reproposed,
 };

 const quota = bound(OPPOSITION_QUOTA);
 for (let i = 0; i < pool.pairs.length; i++) {
  const pooled = pool.pairs[i];
  if (!pooled) continue;
  if (spend.opposition >= quota) {
   shadowDecision(
    OPPOSITION_QUOTA,
    `${pool.pairs.length - i} pooled pairs left without a judgment this run`,
    log,
    true,
   );
   return;
  }

  const [a, b] = pooled.pair;
  const quotes = { a: quoteFor(a, graph), b: quoteFor(b, graph) };
  // Q-52: the poles must be verbatim in the quotes the model was shown, so a
  // pair whose evidence is not in hand cannot be judged at all.
  if (quotes.a === '' || quotes.b === '') continue;

  spend.opposition++;
  try {
   const judgment = await deps.judgeOpposition(a, b, quotes, deps.complete);
   // `null` is a FAILURE and `opposed: false` is a JUDGMENT. Collapsing the
   // two would destroy the stage-1 precision record Q-49 acts under.
   if (!judgment) continue;
   report.oppositionJudged++;
   if (!judgment.opposed) continue;
   report.oppositionOpposed++;

   // Routed through `shadowDecision` rather than reading `opposed` directly,
   // so no threshold is read outside the register and reversing Q-49 is one
   // boolean rather than a change here.
   const admitted = shadowDecision(
    THRESHOLDS['clash.oppositionGate'],
    `pool a candidate on ${a.id} and ${b.id}`,
    log,
   );
   if (!admitted) continue;

   const at = nowIso();
   const candidate: ClashCandidate = {
    id: ulid(),
    pair: [a.id, b.id],
    channel: pooled.channel,
    status: 'pending-remeasure',
    // Q-53: the pool decided this, and defaulting it here would make an
    // expired pair re-proposable forever.
    attempts: pooled.attempts,
    model,
    modelAt: at,
    created: at,
   };
   deps.store.writeCandidate(candidate);
   poles.set(candidate.id, { poleA: judgment.poleA, poleB: judgment.poleB });
  } catch (err) {
   log({
    at: nowIso(),
    actor: 'clerk',
    kind: JOB_FAILED,
    detail: `job=opposition pair=${a.id},${b.id} ${err instanceof Error ? err.message : String(err)}`,
   });
  }
 }
}

// ---------------------------------------------------------------------------
// Job 4 — re-measure minting, and the expired branch (Q-30 stage 2, Q-53)
// ---------------------------------------------------------------------------

async function jobRemeasure(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 graphOf: () => ClaimGraph,
 log: LogFn,
 poles: Map<string, { poleA: string; poleB: string }>,
 spend: { opposition: number },
): Promise<void> {
 const graph = graphOf();
 const claims = new Map(graph.claims.map((c) => [c.id, c]));
 const entries = new Map(deps.queue.list().map((e) => [e.id, e]));
 const pending = deps.store.listCandidates().filter((c) => c.status === 'pending-remeasure');

 // The expired branch, FIRST (B9). Without it the pair is stranded: job 5
 // waits for `answered`, an expired entry never reaches it, and the candidate
 // sits in `pending-remeasure` for good while T11 correctly refuses to
 // re-propose the pair. Dissolving retires it through the path that already
 // exists — and under Q-53 `remeasure-expired` is the one outcome that lets
 // the pair be proposed once more, because silence is not a verdict.
 const stillPending: ClashCandidate[] = [];
 for (const candidate of pending) {
  const entry = candidate.remeasureQueueId ? entries.get(candidate.remeasureQueueId) : undefined;
  if (entry?.status === 'expired') {
   dissolve(deps, candidate, 'remeasure-expired');
   report.remeasuresExpired++;
   report.candidatesDissolved++;
   continue;
  }
  stillPending.push(candidate);
 }

 const cap = bound(THRESHOLDS['remeasure.liveCap']);
 let liveNow = deps.queue
  .list({ source: 'contradiction-remeasure' })
  .filter((e) => isLiveEntry(e)).length;

 for (const candidate of stillPending) {
  // Exactly one question per candidate, ever — and because T11 filters the
  // pair at every status, exactly one per pair.
  if (candidate.remeasureQueueId !== undefined) continue;

  if (liveNow >= cap) {
   shadowDecision(
    THRESHOLDS['remeasure.liveCap'],
    `a re-measure for candidate ${candidate.id}`,
    log,
    true,
   );
   return;
  }

  const a = claims.get(candidate.pair[0]);
  const b = claims.get(candidate.pair[1]);
  if (!a || !b) continue;

  const pair =
   poles.get(candidate.id) ??
   (await recoverPoles(deps, report, log, spend, candidate, a, b, graph));
  if (!pair) continue;

  try {
   const draft = await deps.composeRemeasure(
    { a, b, poleA: pair.poleA, poleB: pair.poleB },
    originalQuestions(a, b, graph),
    deps.complete,
   );
   // `null` is legitimate: the guards refused the question and the candidate
   // simply waits for the next run.
   if (!draft) continue;
   const entry = deps.queue.add(draft);
   // The left edge of stage 3's window, and there is no other way to
   // compute it once the run that minted the question is over.
   deps.store.writeCandidate({
    ...candidate,
    remeasureQueueId: entry.id,
    remeasureAskedAt: nowIso(),
   });
   liveNow++;
   report.remeasuresMinted++;
  } catch (err) {
   log({
    at: nowIso(),
    actor: 'clerk',
    kind: JOB_FAILED,
    detail: `job=remeasure candidate=${candidate.id} ${err instanceof Error ? err.message : String(err)}`,
   });
  }
 }
}

/** A queue entry that still occupies a slot: drawn or waiting, but not resolved. */
function isLiveEntry(e: QueueEntry): boolean {
 return e.status === 'pending' || e.status === 'asked' || e.status === 'deferred';
}

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
async function recoverPoles(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 log: LogFn,
 spend: { opposition: number },
 candidate: ClashCandidate,
 a: Claim,
 b: Claim,
 graph: ClaimGraph,
): Promise<{ poleA: string; poleB: string } | null> {
 if (spend.opposition >= bound(OPPOSITION_QUOTA)) return null;

 const quotes = { a: quoteFor(a, graph), b: quoteFor(b, graph) };
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
// Pre-sweep confirmation (ticket 070)
// ---------------------------------------------------------------------------

/**
 * Judge answered re-measures BEFORE the sweep, so the answer's cite is not yet
 * absorbed into a pole claim and Q-53's held-sittings check can pass.
 *
 * Ticket 070: job 1 (sweep) absorbs the re-measure answer's cite into a pole
 * claim via UPDATE. When job 5 then judges, `confirmingReadings` computes the
 * held-sittings set from both claims' cites — which now INCLUDES the answer's
 * own sitting. Q-53 correctly refuses every reading from that sitting, and the
 * candidate is stranded permanently at `pending-remeasure`.
 *
 * Running this pass first, against a graph where the cite is not yet on any
 * pole, ensures the answer's sitting is always admissible. `jobConfirmation`
 * (job 5) still runs after the sweep as a safety net; it skips any candidate
 * this pass already judged.
 */
async function jobPresweepConfirmation(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 graphOf: () => ClaimGraph,
 log: LogFn,
 model: string,
): Promise<void> {
 const graph = graphOf();
 const claims = new Map(graph.claims.map((c) => [c.id, c]));
 const entries = new Map(deps.queue.list().map((e) => [e.id, e]));

 for (const candidate of deps.store.listCandidates()) {
  if (candidate.status !== 'pending-remeasure') continue;
  const queueId = candidate.remeasureQueueId;
  const askedAt = candidate.remeasureAskedAt;
  if (queueId === undefined || askedAt === undefined) continue;

  if (entries.get(queueId)?.status !== 'answered') continue;

  const a = claims.get(candidate.pair[0]);
  const b = claims.get(candidate.pair[1]);
  if (!a || !b) continue;

  const readings = confirmingReadings(graph, askedAt, a, b);
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
   log({
    at,
    actor: 'clerk',
    kind: 'contradiction-opened',
    detail: `type=${result.type} presweep`,
    refs: [a.id, b.id, candidate.id],
   });
   deps.store.writeCandidate({ ...candidate, status: 'confirmed' });
   report.contradictionsOpened++;

   recomputeStatus([a.id, b.id], deps, graphOf, log, at, model);
  } catch (err) {
   log({
    at: nowIso(),
    actor: 'clerk',
    kind: JOB_FAILED,
    detail: `job=presweep-confirmation candidate=${candidate.id} ${err instanceof Error ? err.message : String(err)}`,
   });
  }
 }
}

// ---------------------------------------------------------------------------
// Job 5 — confirmation (Q-30 stages 3-4, Q-53)
// ---------------------------------------------------------------------------
async function jobConfirmation(
 deps: WikiJobDeps,
 report: WikiJobsReport,
 graphOf: () => ClaimGraph,
 log: LogFn,
 model: string,
): Promise<void> {
 const graph = graphOf();
 const claims = new Map(graph.claims.map((c) => [c.id, c]));
 const entries = new Map(deps.queue.list().map((e) => [e.id, e]));

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
   log({
    at,
    actor: 'clerk',
    kind: 'contradiction-opened',
    detail: `type=${result.type}`,
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
    detail: `job=confirmation candidate=${candidate.id} ${err instanceof Error ? err.message : String(err)}`,
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
function dissolve(deps: WikiJobDeps, candidate: ClashCandidate, outcome: ClashOutcome): void {
 deps.store.writeCandidate({ ...candidate, status: 'dissolved', outcome });
}
