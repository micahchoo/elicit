/**
 * The tripwire sweep (Q-90, Q-95; ticket 132).
 *
 * After a mechanism graduates, this watches the guarded metrics and puts it
 * back in shadow if the person's own record gets worse. It runs as a docket
 * job, makes no model call, and reaches no surface: the numbers it reads
 * belong to Q-83's never-mirrored class, so they live in `data/` and in the
 * operator's terminal and nowhere else.
 *
 * ## The four numbers, and why each is a constant with a name
 *
 * - **Baseline = the trailing 28 days, FROZEN at graduation** (Q-95). Frozen
 *   is the load-bearing word. A baseline that kept sliding forward would let
 *   a mechanism that degrades the person's use of the instrument drag its
 *   own yardstick down with it, and read as fine the whole way.
 * - **Floor = 20 events per metric** before any judgment (Q-95). Under it
 *   the graduation is `graduated-unconfirmed`: not passing, not failing —
 *   Q-14's "one flip is noise", mechanized.
 * - **Dwell = 7 days** in shadow before re-graduation is even considered.
 *   Short on purpose: Q-95 makes a false demotion the cheap error and
 *   prefers fast recovery to maximum damping.
 * - **`WORSE_RATIO` = 1.5x** — the only number here that no ruling fixes.
 *   It is the declared threshold for "worse beyond noise" and it is meant
 *   to be tuned from the record, which is why it is one exported constant
 *   rather than a literal in the comparison.
 *
 * ## Why demotion is a BATCH
 *
 * When the tripwire fires, every graduation younger than the anomaly window
 * goes back to shadow with it — not the one the loop thinks is guilty.
 * Attribution at n=1 would take a model of the person, and a model of the
 * person is the one thing the guarded metrics must never have (Q-90).
 * Recency is the only admissible attribution, so recency is what is used.
 *
 * ## What it never does
 *
 * It never fires on improvement, never fires on a tie, never reverts
 * anything a mechanism already did, and never writes a guarded number to
 * the activity log.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { appendLedger, readLedger } from './ledger.js';
import type { DemotionLine, LedgerLine, MetricReading } from './ledger.js';
import { addDemotion, readDemotions } from './demotions.js';
import { GUARDED, OBSERVABLE_GUARDED } from './guarded.js';
import type { GuardedKey, Reading, Window } from './guarded.js';
import { readEvents } from '../log/activity.js';

/** Days of record frozen as the baseline at graduation (Q-95). */
export const BASELINE_DAYS = 28;

/** Observations one metric needs before the tripwire will judge it (Q-95). */
export const EVENT_FLOOR = 20;

/** Days a demoted mechanism sits in shadow before re-graduation (Q-95). */
export const DWELL_DAYS = 7;

/**
 * How much worse than baseline counts as worse at all. TUNABLE — no ruling
 * fixes it, and 1.5x is a conservative first guess: it ignores the ordinary
 * drift of a person's week and still catches a metric that half again
 * changed. Retune it from the tripwire's own record, never from argument,
 * and record the change like any other threshold move.
 */
export const WORSE_RATIO = 1.5;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One graduation under watch, keyed in the state file by `mechanism@graduatedAt`. */
export type GraduationWatch = {
  mechanism: string;
  graduatedAt: string;
  /** The trailing-28-day reading per observable metric, frozen at graduation. */
  baseline: Partial<Record<GuardedKey, MetricReading>>;
  /** The post-graduation reading, recomputed every sweep. */
  observed: Partial<Record<GuardedKey, MetricReading>>;
  /** True while any observable metric sits under the event floor. */
  unconfirmed: boolean;
  /** Set when this graduation was demoted. A demoted watch is no longer judged. */
  demotedAt?: string;
};

export type TripwireState = { watches: Record<string, GraduationWatch> };

export type TripwireFiring = {
  mechanism: string;
  metric: GuardedKey;
  baseline: MetricReading;
  observed: MetricReading;
  /** Every mechanism demoted with it, recency rule (Q-90). */
  batch: string[];
};

export type TripwireResult = {
  /** Graduations under watch after this sweep. */
  watched: number;
  /** Watch keys whose baseline was frozen this run. */
  frozen: string[];
  /** Mechanisms still under the floor — judged by nothing. */
  unconfirmed: string[];
  fired: TripwireFiring[];
  /** Mechanism keys demoted this run, including the batch. */
  demoted: string[];
};

const EMPTY: TripwireResult = { watched: 0, frozen: [], unconfirmed: [], fired: [], demoted: [] };

function statePath(dataDir: string): string {
  return join(dataDir, 'tripwire-state.json');
}

/**
 * The state file at `path`, or an empty state. A malformed file is treated
 * as empty and rewritten: it is a cache of what the ledger and the activity
 * log already imply, so losing it costs counters, never a decision.
 *
 * Takes the path rather than the data directory so the operator's report
 * (`scripts/loop-status.ts`) reads the state through this function instead
 * of parsing the file a second way.
 */
export function readTripwireState(path: string): TripwireState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object') return { watches: {} };
    const watches = (parsed as TripwireState).watches;
    return { watches: watches !== null && typeof watches === 'object' ? watches : {} };
  } catch {
    return { watches: {} };
  }
}

function writeTripwireState(dataDir: string, state: TripwireState): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statePath(dataDir), `${JSON.stringify(state, null, 1)}\n`, 'utf-8');
}

function shift(at: string, days: number): string {
  return new Date(Date.parse(at) + days * MS_PER_DAY).toISOString();
}

/**
 * When a mechanism's dwell ends, read from the ledger — the newest
 * `dwellUntil` standing against its name. The ledger is where dwell lives
 * because dwell must survive the state file being deleted: losing the
 * cache should cost the loop its counters, never its restraint.
 */
export function dwellUntil(ledger: LedgerLine[], mechanism: string): string | undefined {
  let latest: string | undefined;
  for (const line of ledger) {
    if (line.event !== 'demotion' || line.mechanism !== mechanism) continue;
    const until = line.dwellUntil;
    if (until !== undefined && (latest === undefined || until > latest)) latest = until;
  }
  return latest;
}

/** Whether a mechanism is still serving its dwell at `now`. */
export function underDwell(ledger: LedgerLine[], mechanism: string, now: Date): boolean {
  const until = dwellUntil(ledger, mechanism);
  return until !== undefined && Date.parse(until) > now.getTime();
}

/**
 * Whether `observed` is worse than `baseline` beyond the declared ratio.
 *
 * One-sided: an improvement never fires, and neither does a tie — the
 * comparisons are strict for exactly that reason. A baseline of zero is
 * the ambiguous case, and it resolves toward shadow when the direction of
 * harm is up: a behaviour that never happened before graduation and now
 * happens is a change the loop should stop for, and Q-95 has already ruled
 * that a false demotion is the cheap error.
 */
function isWorse(metric: { worseWhen: 'higher' | 'lower' }, baseline: Reading, observed: Reading): boolean {
  return metric.worseWhen === 'higher'
    ? observed.rate > baseline.rate * WORSE_RATIO
    : observed.rate * WORSE_RATIO < baseline.rate;
}

/** Every observable metric read over one window. */
function measure(
  events: ReturnType<typeof readEvents>,
  window: Window,
): Partial<Record<GuardedKey, MetricReading>> {
  const out: Partial<Record<GuardedKey, MetricReading>> = {};
  for (const metric of OBSERVABLE_GUARDED) {
    if (metric.countEvents === undefined) continue;
    out[metric.key] = metric.countEvents(events, window);
  }
  return out;
}

/**
 * One sweep. Freezes a baseline for every graduation it has not seen,
 * refreshes the post-graduation counts for every graduation it is still
 * judging, and demotes a batch when a guarded metric has gone worse.
 *
 * An absent ledger is a no-op: an instance that has graduated nothing has
 * nothing to watch, and the sweep must cost it nothing to say so.
 */
export function sweepTripwire(deps: {
  dataDir: string;
  ledgerPath: string;
  /** The vault root — the activity log lives at `<vaultRoot>/log`. */
  vaultRoot: string;
  now: Date;
}): TripwireResult {
  if (!existsSync(deps.ledgerPath)) return EMPTY;

  const ledger = readLedger(deps.ledgerPath);
  const graduations = ledger.filter(
    (l): l is Extract<LedgerLine, { event: 'graduation' | 're-graduation' }> =>
      l.event === 'graduation' || l.event === 're-graduation',
  );
  if (graduations.length === 0) return EMPTY;

  const state = readTripwireState(statePath(deps.dataDir));
  const events = readEvents(deps.vaultRoot);
  const nowIso = deps.now.toISOString();
  const demoted = readDemotions(deps.dataDir);

  const frozen: string[] = [];
  const unconfirmed: string[] = [];
  const fired: TripwireFiring[] = [];
  const demotedThisRun: string[] = [];

  // The window every judgment is made over: the trailing BASELINE_DAYS,
  // never reaching back before the graduation itself. Matching the observed
  // span to the frozen baseline's span is what makes the comparison
  // like-for-like — an observed window that grew without bound would dilute
  // a fresh regression into a year of good record and read as calm — and it
  // is what gives "recent" a fixed meaning for the batch below.
  const anomalyStart = shift(nowIso, -BASELINE_DAYS);

  for (const graduation of graduations) {
    const key = `${graduation.mechanism}@${graduation.at}`;
    let watch = state.watches[key];

    if (watch === undefined) {
      // Freeze the baseline: the 28 days BEFORE the graduation, read once
      // and never read again (Q-95).
      watch = {
        mechanism: graduation.mechanism,
        graduatedAt: graduation.at,
        baseline: measure(events, { from: shift(graduation.at, -BASELINE_DAYS), to: graduation.at }),
        observed: {},
        unconfirmed: true,
      };
      state.watches[key] = watch;
      frozen.push(key);
    }

    // Already demoted, by this sweep or by the owner: there is nothing left
    // to take away, and re-graduation is the loop's own act, not this one's.
    if (watch.demotedAt !== undefined || demoted.has(graduation.mechanism)) continue;
    if (underDwell(ledger, graduation.mechanism, deps.now)) continue;

    watch.observed = measure(events, {
      from: graduation.at > anomalyStart ? graduation.at : anomalyStart,
      to: nowIso,
    });

    // The floor is PER METRIC (Q-95). A metric under it is judged by
    // nothing; the metrics that have reached it are judged now. Reading the
    // floor as "every metric, or no judgment" would make the tripwire
    // unreachable in practice — dormancy counts days and the gate metric
    // counts descents, so the slowest of the seven would gate all of them,
    // and a mechanism could degrade the instrument for a month while the
    // sweep waited for a number that says nothing about it.
    const judgeable = new Set(
      OBSERVABLE_GUARDED
        .filter((m) => (watch.observed[m.key]?.events ?? 0) >= EVENT_FLOOR)
        .map((m) => m.key),
    );

    // The flag is the other reading, and it is the honest one for a REPORT:
    // while any guarded metric sits under the floor, this graduation has not
    // been confirmed by the whole guarded set.
    watch.unconfirmed = judgeable.size < OBSERVABLE_GUARDED.length;
    if (watch.unconfirmed) unconfirmed.push(graduation.mechanism);
    if (judgeable.size === 0) continue;

    // The first metric in Q-90's declared order that has gone worse is the
    // one the ledger line names — a stable rule, so the same record always
    // fires the same way.
    const worse = GUARDED.find((m) => {
      if (!judgeable.has(m.key)) return false;
      const baseline = watch.baseline[m.key];
      const observed = watch.observed[m.key];
      return baseline !== undefined && observed !== undefined && isWorse(m, baseline, observed);
    });
    if (worse === undefined) continue;

    fired.push({
      mechanism: graduation.mechanism,
      metric: worse.key,
      baseline: watch.baseline[worse.key]!,
      observed: watch.observed[worse.key]!,
      batch: [],
    });
  }

  // ── The batch, decided once ──
  //
  // Detection is per graduation; demotion is not. A degradation is a fact
  // about the instance's record, and several watches will see the same one
  // — so the sweep collects every firing first and demotes ONE batch. The
  // earlier shape, demoting per firing, let the oldest graduation's window
  // sweep in everything that came after it, which is recency in name only.
  //
  // The batch is every graduation inside the anomaly window (Q-90's recency
  // rule) plus every mechanism that actually fired: a mechanism whose own
  // frozen baseline proved the degradation goes back to shadow even if it
  // graduated long before the window.
  if (fired.length > 0) {
    const batch = [
      ...new Set([
        ...fired.map((f) => f.mechanism),
        ...graduations.filter((g) => g.at >= anomalyStart).map((g) => g.mechanism),
      ]),
    ].filter((m) => !demoted.has(m)).sort();

    const until = shift(nowIso, DWELL_DAYS);
    // One metric names the batch: the first firing, in Q-90's declared
    // metric order. The others are in the state file and the report.
    const cause = fired[0]!;

    for (const mechanism of batch) {
      addDemotion(deps.dataDir, mechanism);
      demoted.add(mechanism);
      demotedThisRun.push(mechanism);
      const line: DemotionLine = {
        at: nowIso,
        event: 'demotion',
        mechanism,
        by: 'tripwire',
        metric: cause.metric,
        baseline: cause.baseline,
        observed: cause.observed,
        batch,
        dwellUntil: until,
      };
      appendLedger(deps.ledgerPath, line);
    }

    for (const [k, w] of Object.entries(state.watches)) {
      if (batch.includes(w.mechanism) && w.demotedAt === undefined) {
        state.watches[k] = { ...w, demotedAt: nowIso };
      }
    }
    for (const firing of fired) firing.batch = batch;
  }

  writeTripwireState(deps.dataDir, state);

  return {
    watched: Object.keys(state.watches).length,
    frozen,
    unconfirmed,
    fired,
    demoted: demotedThisRun,
  };
}
