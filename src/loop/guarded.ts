/**
 * The guarded metrics (Q-90) — the boundary to the owner's instance.
 *
 * Seven measures the loop may look at and may never optimize toward. They
 * are the tripwire's only input, and every one of them is counted with
 * arithmetic over records already on disk: ZERO model calls, here or
 * downstream. A metric a model computes is a metric a model can be wrong
 * about in a direction that flatters whoever asked, and these exist to
 * catch exactly that.
 *
 * ## Why each metric declares a direction
 *
 * The test against baseline is one-sided (Q-90): the tripwire fires on
 * degradation and never on improvement, so each metric has to say which
 * way is worse. Skipping and deferring more is worse; sitting down less is
 * worse. Without `worseWhen` a two-sided test would demote a mechanism for
 * the person answering more, which is the failure mode inverted.
 *
 * ## Why some metrics count nothing
 *
 * A metric whose events are not on disk carries `observable: false` and no
 * counter. The alternative — a plausible proxy — is worse than a gap: a
 * tripwire watching a number that stands for something else reports
 * safety it does not have, and the report reads identically either way.
 * `note` says what is missing and what would close it, so the gap is a
 * ticket rather than a mystery.
 *
 * As of ticket 132, two of the seven cannot be counted (skip-rate became
 * countable when the skip route gained its emit at integration). The
 * reasons are in each entry, and neither is a modelling problem — each is
 * one missing line at an emitter.
 */

import type { ActivityEvent } from '../log/activity.js';

export type GuardedKey =
  | 'skip-rate'
  | 'deferral-rate'
  | 'refusal-rate'
  | 'dormancy'
  | 'discomfort-gate-frequency'
  | 'sitting-frequency'
  | 'sitting-length-vs-mode';

/** A half-open span of time, `[from, to)`, as ISO 8601 strings. */
export type Window = { from: string; to: string };

/**
 * One metric over one window. `events` is the number of OBSERVATIONS the
 * rate rests on — the unit named by the metric's `unit` field — and it is
 * what the Q-95 floor of 20 counts. `rate` is the value compared against
 * the frozen baseline.
 */
export type Reading = { events: number; rate: number };

export type GuardedMetric = {
  key: GuardedKey;
  /** Which direction is worse for the person, and therefore the only one that fires. */
  worseWhen: 'higher' | 'lower';
  /** What one event is — the thing the event floor counts. */
  unit: string;
  observable: boolean;
  /** What the counter counts, or what is missing and what would close the gap. */
  note: string;
  /** Absent exactly when `observable` is false. */
  countEvents?: (events: ActivityEvent[], window: Window) => Reading;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Events inside `[from, to)`, by timestamp. */
function inWindow(events: ActivityEvent[], window: Window): ActivityEvent[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  return events.filter((e) => {
    const at = Date.parse(e.at);
    return !Number.isNaN(at) && at >= from && at < to;
  });
}

/** How many events of one kind the window holds. */
function countKind(events: ActivityEvent[], kind: string): number {
  return events.filter((e) => e.kind === kind).length;
}

/** A rate that is 0 rather than NaN when nothing was observed. */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Whole days the window spans, at least one. */
function days(window: Window): number {
  const span = Date.parse(window.to) - Date.parse(window.from);
  return Math.max(1, Math.round(span / MS_PER_DAY));
}

/**
 * The seven, in the order Q-90 names them. The list is exported whole so a
 * report can show the split — every guarded metric appears, counted or
 * not, because a metric that disappears when it cannot be measured looks
 * exactly like a metric that is fine.
 */
export const GUARDED: readonly GuardedMetric[] = [
  {
    key: 'skip-rate',
    worseWhen: 'higher',
    unit: 'question served',
    observable: true,
    note:
      'question-asked with source=skip (the replacement draw a skip triggers — ' +
      'emitted by the skip route since ticket 132) over the questions served ' +
      '(question-asked + juxtaposition-offered).',
    countEvents: (events, window) => {
      const w = inWindow(events, window);
      const served = countKind(w, 'question-asked') + countKind(w, 'juxtaposition-offered');
      const skips = w.filter(
        (e) => e.kind === 'question-asked' && /\bsource=skip\b/.test(e.detail),
      ).length;
      return { events: served, rate: ratio(skips, served) };
    },
  },
  {
    key: 'deferral-rate',
    worseWhen: 'higher',
    unit: 'question served',
    observable: true,
    note: 'question-deferred over the questions served (question-asked + juxtaposition-offered).',
    countEvents: (events, window) => {
      const w = inWindow(events, window);
      const served = countKind(w, 'question-asked') + countKind(w, 'juxtaposition-offered');
      return { events: served, rate: ratio(countKind(w, 'question-deferred'), served) };
    },
  },
  {
    key: 'refusal-rate',
    worseWhen: 'higher',
    unit: 'question served',
    observable: false,
    note:
      'NOT OBSERVABLE. Nothing records a person declining to answer. The nearest ' +
      'events — sounding-declined, coach-offer-declined, reach-declined — are ' +
      'declines of an OFFER, which Q-62 makes the mechanism working rather than a ' +
      'refusal, and counting them here would fire the tripwire on the design ' +
      'behaving correctly. The harvester already classifies content-free turns ' +
      '(contentFreeSkips in src/harvester/admissibility.ts); surfacing that count ' +
      'per sitting as its own event would close this.',
  },
  {
    key: 'dormancy',
    worseWhen: 'higher',
    unit: 'day',
    observable: true,
    note: 'The share of days in the window on which no sitting was started.',
    countEvents: (events, window) => {
      const w = inWindow(events, window);
      const active = new Set(
        w.filter((e) => e.kind === 'session-started').map((e) => e.at.slice(0, 10)),
      );
      const span = days(window);
      return { events: span, rate: ratio(span - active.size, span) };
    },
  },
  {
    key: 'discomfort-gate-frequency',
    worseWhen: 'higher',
    unit: 'descent entered',
    observable: true,
    note:
      'sounding-gate over descents entered. The gate is always present and never ' +
      'triggered (Q-44), and the event is emitted only on park or another-day — so ' +
      'this counts the times the margin words were used to STOP, which is the ' +
      'behavioral signal Q-44 permits. Depth is not counted here: Q-90 leaves it ' +
      'diagnostic on purpose.',
    countEvents: (events, window) => {
      const w = inWindow(events, window);
      const entered = countKind(w, 'sounding-entered');
      return { events: entered, rate: ratio(countKind(w, 'sounding-gate'), entered) };
    },
  },
  {
    key: 'sitting-frequency',
    worseWhen: 'lower',
    unit: 'sitting',
    observable: true,
    note: 'session-started per day over the window.',
    countEvents: (events, window) => {
      const started = countKind(inWindow(events, window), 'session-started');
      return { events: started, rate: ratio(started, days(window)) };
    },
  },
  {
    key: 'sitting-length-vs-mode',
    worseWhen: 'lower',
    unit: 'sitting',
    observable: false,
    note:
      'NOT OBSERVABLE. session-started records the declared Mode (mode=25m/high) and ' +
      'nothing records when a sitting ended, so the achieved length cannot be read. ' +
      'The available proxy — the last event carrying the same session id — counts a ' +
      'browser tab left open as a long sitting, in the direction that hides the ' +
      'regression. A session-ended event carrying elapsed minutes closes it.',
  },
];

/** The guarded metrics that can actually be counted today. */
export const OBSERVABLE_GUARDED: GuardedMetric[] = GUARDED.filter((m) => m.observable);

/**
 * Watched, never gating. Q-90 leaves sounding depth OUT of the guarded set
 * deliberately: guarding it would make descents dying early look like
 * safety, and blind the loop to the one failure it most needs to see. It
 * is listed so a report can show the split rather than imply the guarded
 * seven are everything the loop looks at.
 */
export const DIAGNOSTIC: readonly { key: string; note: string }[] = [
  {
    key: 'sounding-depth',
    note:
      'Rungs per descent (sounding-rung over sounding-entered). Deliberately NOT ' +
      'guarded — the gate is watched, depth is diagnostic (Q-90).',
  },
];
