/**
 * The graduation ledger — ticket 131.
 *
 * The ledger's whole value is that it is append-only and survives partial
 * writes, so that is what these assert: three event shapes round-trip, an
 * absent file is an empty ledger rather than a throw, and a line torn in
 * half by a crash costs the loop that line and no others.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendLedger, readLedger } from '../src/loop/ledger.js';
import type { DemotionLine, GraduationLine, ReGraduationLine } from '../src/loop/ledger.js';

let root: string;
let ledger: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-loop-ledger-'));
  // A path two directories deep: appendLedger must make the parent.
  ledger = join(root, 'data', 'graduation-ledger.jsonl');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const graduation: GraduationLine = {
  at: '2026-08-04T10:00:00.000Z',
  event: 'graduation',
  mechanism: 'patternSelection',
  cycle: 'c01',
  variant: 'a1b2c3d',
  trials: ['archives/eval/c01/t1'],
  verdicts: ['archives/eval/c01/t1/verdicts/dossier-001.json'],
  kept: 'The guarded speaker was asked about the tension she had named, in her own words.',
};

describe('ledger — append and read', () => {
  it('creates the parent directory and round-trips a graduation', () => {
    appendLedger(ledger, graduation);
    expect(readLedger(ledger)).toEqual([graduation]);
  });

  it('reads an absent ledger as empty — a fresh instance graduated nothing', () => {
    expect(readLedger(ledger)).toEqual([]);
  });

  it('keeps the three event shapes, in the order they were written', () => {
    const tripwire: DemotionLine = {
      at: '2026-08-11T10:00:00.000Z',
      event: 'demotion',
      mechanism: 'patternSelection',
      by: 'tripwire',
      metric: 'deferral-rate',
      baseline: { events: 214, rate: 0.11 },
      observed: { events: 31, rate: 0.29 },
      batch: ['patternSelection', 'lineageMirror.selection'],
      dwellUntil: '2026-08-18T10:00:00.000Z',
    };
    const owner: DemotionLine = {
      at: '2026-08-12T10:00:00.000Z',
      event: 'demotion',
      mechanism: 'lineageMirror.selection',
      by: 'owner',
    };
    const back: ReGraduationLine = {
      at: '2026-08-20T10:00:00.000Z',
      event: 're-graduation',
      mechanism: 'patternSelection',
      afterDwell: true,
      trials: ['archives/eval/c02/t1'],
      verdicts: ['archives/eval/c02/t1/verdicts/dossier-001.json'],
    };

    appendLedger(ledger, graduation);
    appendLedger(ledger, tripwire);
    appendLedger(ledger, owner);
    appendLedger(ledger, back);

    expect(readLedger(ledger)).toEqual([graduation, tripwire, owner, back]);
  });

  it('appends — a second write never rewrites the first line', () => {
    appendLedger(ledger, graduation);
    const first = readFileSync(ledger, 'utf-8');
    appendLedger(ledger, { ...graduation, at: '2026-08-05T10:00:00.000Z' });
    expect(readFileSync(ledger, 'utf-8').startsWith(first)).toBe(true);
  });

  it('exposes no rewrite API', async () => {
    const module: Record<string, unknown> = await import('../src/loop/ledger.js');
    expect(Object.keys(module).sort()).toEqual(['appendLedger', 'readLedger']);
  });
});

describe('ledger — damaged lines', () => {
  it('skips a line torn in half by a crash and keeps every other line', () => {
    appendLedger(ledger, graduation);
    appendFileSync(ledger, '{"at":"2026-08-05T10:00:00.000Z","event":"demo\n', 'utf-8');
    appendLedger(ledger, { ...graduation, at: '2026-08-06T10:00:00.000Z' });

    const read = readLedger(ledger);
    expect(read).toHaveLength(2);
    expect(read.map((l) => l.at)).toEqual(['2026-08-04T10:00:00.000Z', '2026-08-06T10:00:00.000Z']);
  });

  it('skips valid JSON that is not a ledger event', () => {
    mkdirSync(join(root, 'data'), { recursive: true });
    appendFileSync(ledger, '{"hello":"world"}\n{"at":"x","event":"nonsense","mechanism":"m"}\n', 'utf-8');
    expect(readLedger(ledger)).toEqual([]);
  });
});
