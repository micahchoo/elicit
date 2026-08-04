/**
 * The tripwire sweep — ticket 132.
 *
 * The activity log here is real JSONL in a real vault layout, because the
 * counters are the thing under test: a fake counter and an honest one look
 * identical from the outside, and only one of them fires on the record the
 * person actually left.
 *
 * The synthetic instance sits down twice a day and defers rarely, then —
 * after the second graduation — defers a third of the time. That is the
 * whole fixture: everything else is what the sweep does with it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sweepTripwire, readTripwireState, underDwell, DWELL_DAYS, EVENT_FLOOR } from '../src/loop/tripwire.js';
import { appendLedger, readLedger } from '../src/loop/ledger.js';
import type { GraduationLine } from '../src/loop/ledger.js';
import { readDemotions } from '../src/loop/demotions.js';
import { renderLoopStatus } from '../scripts/loop-status.js';

let root: string;
let dataDir: string;
let vaultRoot: string;
let ledgerPath: string;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Day 0 of the fixture. Every timestamp below is an offset from it. */
const EPOCH = Date.parse('2026-06-01T09:00:00.000Z');

function at(dayOffset: number, hour = 9): string {
  return new Date(EPOCH + dayOffset * MS_PER_DAY + (hour - 9) * 3600_000).toISOString();
}

/** Append one activity event to `<vault>/log/<day>.jsonl`, as appendEvent does. */
function emit(kind: string, when: string): void {
  const dir = join(vaultRoot, 'log');
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, `${when.slice(0, 10)}.jsonl`),
    `${JSON.stringify({ at: when, actor: 'elicitor', kind, detail: 'x' })}\n`,
    'utf-8',
  );
}

/**
 * `sittings` sittings a day for `[fromDay, toDay)`, each serving 6
 * questions, of which `deferPerDay` are deferred.
 */
function record(fromDay: number, toDay: number, opts: { sittings: number; deferPerDay: number }): void {
  for (let day = fromDay; day < toDay; day++) {
    for (let s = 0; s < opts.sittings; s++) emit('session-started', at(day, 9 + s));
    for (let q = 0; q < 6; q++) emit('question-asked', at(day, 10 + q));
    for (let d = 0; d < opts.deferPerDay; d++) emit('question-deferred', at(day, 10 + d));
    // One descent a day, never stopped early — so the gate metric has a
    // denominator and stays flat across the whole fixture.
    emit('sounding-entered', at(day, 17));
  }
}

function graduation(mechanism: string, day: number): GraduationLine {
  return {
    at: at(day),
    event: 'graduation',
    mechanism,
    cycle: 'c01',
    variant: 'a1b2c3d',
    trials: ['archives/eval/c01/t1'],
    verdicts: ['archives/eval/c01/t1/verdicts/dossier-001.json'],
    kept: 'The follow-up quoted the sentence she had actually said.',
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-loop-tripwire-'));
  dataDir = join(root, 'data');
  vaultRoot = join(root, 'vault');
  ledgerPath = join(dataDir, 'graduation-ledger.jsonl');
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function sweep(nowDay: number) {
  return sweepTripwire({ dataDir, ledgerPath, vaultRoot, now: new Date(at(nowDay)) });
}

describe('tripwire — the no-op paths', () => {
  it('does nothing when the ledger is absent', () => {
    const result = sweep(40);
    expect(result).toEqual({ watched: 0, frozen: [], unconfirmed: [], fired: [], demoted: [] });
    expect(readDemotions(dataDir).size).toBe(0);
  });

  it('does nothing when the ledger holds no graduation', () => {
    appendLedger(ledgerPath, { at: at(1), event: 'demotion', mechanism: 'patternSelection', by: 'owner' });
    expect(sweep(40).watched).toBe(0);
  });
});

describe('tripwire — the event floor (Q-95)', () => {
  it('freezes a baseline and reports graduated-unconfirmed under the floor', () => {
    record(0, 30, { sittings: 2, deferPerDay: 1 });
    appendLedger(ledgerPath, graduation('patternSelection', 30));

    // One day after graduation: 2 sittings, 6 questions served — nothing is
    // near 20 events, so nothing is judged.
    record(30, 31, { sittings: 2, deferPerDay: 1 });
    const result = sweep(31);

    expect(result.frozen).toEqual(['patternSelection@' + at(30)]);
    expect(result.unconfirmed).toEqual(['patternSelection']);
    expect(result.fired).toEqual([]);
    expect(readDemotions(dataDir).size).toBe(0);

    const watch = readTripwireState(join(dataDir, 'tripwire-state.json')).watches['patternSelection@' + at(30)]!;
    expect(watch.unconfirmed).toBe(true);
    // Baseline is the trailing 28 days: 2 sittings a day, 1 deferral in 6.
    expect(watch.baseline['deferral-rate']).toEqual({ events: 168, rate: 1 / 6 });
    expect(watch.baseline['sitting-frequency']?.rate).toBeCloseTo(2, 5);
    expect(watch.observed['sitting-frequency']?.events).toBeLessThan(EVENT_FLOOR);
  });

  it('freezes the baseline once — a later sweep never re-reads it', () => {
    record(0, 30, { sittings: 2, deferPerDay: 1 });
    appendLedger(ledgerPath, graduation('patternSelection', 30));
    sweep(31);
    const frozen = readTripwireState(join(dataDir, 'tripwire-state.json')).watches['patternSelection@' + at(30)]!.baseline;

    // The person's habits change completely after graduation. The yardstick
    // must not move with them (Q-95).
    record(30, 45, { sittings: 6, deferPerDay: 5 });
    const again = sweep(45);

    expect(again.frozen).toEqual([]);
    expect(readTripwireState(join(dataDir, 'tripwire-state.json')).watches['patternSelection@' + at(30)]!.baseline).toEqual(frozen);
  });
});

describe('tripwire — one-sided judgment (Q-90)', () => {
  it('never fires on improvement, with every metric past its floor', () => {
    record(0, 30, { sittings: 2, deferPerDay: 3 });
    appendLedger(ledgerPath, graduation('patternSelection', 30));
    // After graduation: deferrals stop, sittings rise. Every metric better.
    record(30, 60, { sittings: 3, deferPerDay: 0 });

    const result = sweep(60);
    expect(result.unconfirmed).toEqual([]);
    expect(result.fired).toEqual([]);
    expect(readDemotions(dataDir).size).toBe(0);
    expect(readTripwireState(join(dataDir, 'tripwire-state.json')).watches['patternSelection@' + at(30)]!.unconfirmed).toBe(false);
  });

  it('never fires on an unchanged record — a tie is not evidence', () => {
    record(0, 30, { sittings: 2, deferPerDay: 1 });
    appendLedger(ledgerPath, graduation('patternSelection', 30));
    record(30, 45, { sittings: 2, deferPerDay: 1 });

    expect(sweep(45).fired).toEqual([]);
    expect(readDemotions(dataDir).size).toBe(0);
  });
});

describe('tripwire — firing and batch demotion (Q-90 recency)', () => {
  /**
   * Two graduations, ten days apart, then a deferral rate that triples.
   * The older graduation is what the anomaly window starts from, so the
   * batch is every graduation at or after it.
   */
  function twoGraduationsThenRegression(): void {
    record(0, 30, { sittings: 2, deferPerDay: 1 });
    appendLedger(ledgerPath, graduation('patternSelection', 30));
    record(30, 40, { sittings: 2, deferPerDay: 1 });
    appendLedger(ledgerPath, graduation('lineageMirror.selection', 40));
    // Deferrals go from 1-in-6 to 4-in-6.
    record(40, 55, { sittings: 2, deferPerDay: 4 });
  }

  it('demotes on a metric worse beyond the declared ratio, with the numbers on the line', () => {
    twoGraduationsThenRegression();
    const result = sweep(55);

    // Both watches see the same degradation — one fact about the record,
    // seen twice — and it is still one batch.
    expect(result.fired.map((f) => f.mechanism)).toEqual(['patternSelection', 'lineageMirror.selection']);
    const firing = result.fired[0]!;
    expect(firing.mechanism).toBe('patternSelection');
    expect(firing.metric).toBe('deferral-rate');
    expect(firing.baseline.rate).toBeCloseTo(1 / 6, 5);
    expect(firing.observed.rate).toBeGreaterThan(firing.baseline.rate * 1.5);

    const line = readLedger(ledgerPath).find(
      (l) => l.event === 'demotion' && l.mechanism === 'patternSelection',
    );
    expect(line).toMatchObject({
      event: 'demotion',
      by: 'tripwire',
      metric: 'deferral-rate',
      dwellUntil: new Date(Date.parse(at(55)) + DWELL_DAYS * MS_PER_DAY).toISOString(),
    });
    expect(line?.event === 'demotion' && line.baseline?.events).toBeGreaterThan(0);
  });

  it('demotes the whole batch — both graduations, each with its own ledger line', () => {
    twoGraduationsThenRegression();
    const result = sweep(55);

    expect(result.demoted.sort()).toEqual(['lineageMirror.selection', 'patternSelection']);
    expect([...readDemotions(dataDir)].sort()).toEqual(['lineageMirror.selection', 'patternSelection']);

    const lines = readLedger(ledgerPath).filter((l) => l.event === 'demotion');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.event === 'demotion' && line.batch?.sort()).toEqual([
        'lineageMirror.selection',
        'patternSelection',
      ]);
    }
  });

  it('leaves an older graduation alone — recency is the whole attribution rule', () => {
    // The person deferred heavily BEFORE the old graduation, so its frozen
    // baseline already contains that behaviour and the late regression is
    // no change against it. It fires on nothing, and it graduated outside
    // the anomaly window, so it must not be swept into the batch.
    record(0, 20, { sittings: 2, deferPerDay: 4 });
    appendLedger(ledgerPath, graduation('clash.embeddingCosine', 20));
    record(20, 40, { sittings: 2, deferPerDay: 1 });
    appendLedger(ledgerPath, graduation('patternSelection', 40));
    record(40, 60, { sittings: 2, deferPerDay: 4 });

    const result = sweep(60);
    expect(result.fired.map((f) => f.mechanism)).toEqual(['patternSelection']);
    expect(result.demoted).toEqual(['patternSelection']);
    expect(readDemotions(dataDir).has('clash.embeddingCosine')).toBe(false);
  });

  it('holds the demoted mechanism under dwell, then lets it go', () => {
    twoGraduationsThenRegression();
    sweep(55);
    const ledger = readLedger(ledgerPath);

    expect(underDwell(ledger, 'patternSelection', new Date(at(56)))).toBe(true);
    expect(underDwell(ledger, 'patternSelection', new Date(at(55 + DWELL_DAYS + 1)))).toBe(false);
  });

  it('does not fire twice on the same graduation', () => {
    twoGraduationsThenRegression();
    sweep(55);
    record(55, 70, { sittings: 2, deferPerDay: 4 });

    const again = sweep(70);
    expect(again.fired).toEqual([]);
    expect(again.demoted).toEqual([]);
    expect(readLedger(ledgerPath).filter((l) => l.event === 'demotion')).toHaveLength(2);
  });
});

describe('loop-status renders what the sweep left behind', () => {
  it('shows the split, the state, the numbers and the unobservable metrics', () => {
    record(0, 30, { sittings: 2, deferPerDay: 1 });
    appendLedger(ledgerPath, graduation('patternSelection', 30));
    record(30, 45, { sittings: 2, deferPerDay: 4 });
    sweep(45);

    const report = renderLoopStatus({
      ledgerPath,
      tripwireStatePath: join(dataDir, 'tripwire-state.json'),
      demotionsDir: dataDir,
      now: new Date(at(46)),
    });

    expect(report).toContain('GUARDED');
    expect(report).toContain('DIAGNOSTIC');
    expect(report).toContain('sounding-depth');
    expect(report).toContain('patternSelection — dwelling');
    expect(report).toContain('deferral-rate');
    // skip-rate became countable when the skip route gained its emit at
    // integration (ticket 132); the two metrics nothing can count say so,
    // in the report itself.
    expect(report).toContain('skip-rate');
    expect(report).not.toContain('skip-rate                 NOT OBSERVABLE');
    expect(report).toContain('refusal-rate              NOT OBSERVABLE');
    expect(report).toContain('sitting-length-vs-mode    NOT OBSERVABLE');
    expect(report).toContain('floor met');
  });

  it('says so plainly when nothing has graduated', () => {
    expect(renderLoopStatus({
      ledgerPath,
      tripwireStatePath: join(dataDir, 'tripwire-state.json'),
      demotionsDir: dataDir,
    })).toContain('Nothing has graduated.');
  });
});
