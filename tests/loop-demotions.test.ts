/**
 * The demotion store, and the proof it is not inert — ticket 131.
 *
 * A demotions file nothing consults is a note, not a demotion. So these
 * tests do not assert that `addDemotion` writes JSON; they assert that a
 * demoted mechanism reads as NOT LIVE through the paths production
 * actually uses — `shadowDecision`, the door every threshold decision
 * passes through, and `selectPattern`, the one place that gated on `.live`
 * directly.
 *
 * `ELICIT_DATA_DIR` points the store at a temporary directory. It is read
 * per call rather than captured at load, which is what lets the real read
 * path be exercised without the repo's own `data/` being touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addDemotion, clearDemotion, isDemoted, readDemotions } from '../src/loop/demotions.js';
import { THRESHOLDS, isLive, shadowDecision } from '../src/wiki/thresholds.js';
import type { ThresholdLogFn } from '../src/wiki/thresholds.js';
import { selectPattern } from '../src/patterns/select.js';
import type { Pattern, LicensingContext } from '../src/patterns/types.js';

let dataDir: string;
let previous: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'elicit-loop-demotions-'));
  previous = process.env.ELICIT_DATA_DIR;
  process.env.ELICIT_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previous === undefined) delete process.env.ELICIT_DATA_DIR;
  else process.env.ELICIT_DATA_DIR = previous;
  rmSync(dataDir, { recursive: true, force: true });
});

/** Every line `shadowDecision` writes, so the shadow record can be read back. */
function recorder(): { log: ThresholdLogFn; lines: { kind: string; detail: string }[] } {
  const lines: { kind: string; detail: string }[] = [];
  const log: ThresholdLogFn = (e) => { lines.push({ kind: e.kind, detail: e.detail }); };
  return { log, lines };
}

describe('demotion store — the file', () => {
  it('reads an absent store as nothing demoted', () => {
    expect(readDemotions(dataDir).size).toBe(0);
  });

  it('records a key, and recording it twice changes nothing', () => {
    addDemotion(dataDir, 'patternSelection');
    addDemotion(dataDir, 'patternSelection');
    expect([...readDemotions(dataDir)]).toEqual(['patternSelection']);
  });

  it('writes readable JSON, so the owner can see what is demoted', () => {
    addDemotion(dataDir, 'clash.embeddingCosine');
    const parsed: unknown = JSON.parse(readFileSync(join(dataDir, 'demotions.json'), 'utf-8'));
    expect(parsed).toEqual({ demoted: ['clash.embeddingCosine'] });
  });

  it('reads a malformed store as nothing demoted, never as everything demoted', () => {
    addDemotion(dataDir, 'patternSelection');
    rmSync(join(dataDir, 'demotions.json'));
    expect(readDemotions(dataDir).size).toBe(0);
  });
});

describe('demotion reaches the real read path', () => {
  it('a demoted threshold reads live=false through isLive', () => {
    const t = THRESHOLDS['clash.embeddingCosine'];
    expect(t.live).toBe(true);
    expect(isLive(t)).toBe(true);

    addDemotion(dataDir, 'clash.embeddingCosine');

    expect(isLive(t)).toBe(false);
    // The declaration is untouched: what it earned and what is true of it
    // now are two facts.
    expect(t.live).toBe(true);
  });

  it('shadowDecision refuses the licence and writes the shadow record', () => {
    const t = THRESHOLDS['clash.embeddingCosine'];
    const before = recorder();
    expect(shadowDecision(t, 'admit a pair', before.log)).toBe(true);
    expect(before.lines).toEqual([]);

    addDemotion(dataDir, 'clash.embeddingCosine');

    const after = recorder();
    expect(shadowDecision(t, 'admit a pair', after.log)).toBe(false);
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]?.kind).toBe('shadow-decision');
    expect(after.lines[0]?.detail).toContain('mode=shadow threshold=clash.embeddingCosine');
  });

  it('selectPattern falls back to shadow when its threshold is demoted', () => {
    const pattern: Pattern = {
      id: 'sentence-stems',
      name: 'Sentence stems',
      tier: 'cheap',
      operators: ['sentence-completion'],
      derivesFrom: { minSnippets: 1, facets: ['fact'] },
      requiredQuotes: ['general-claim'],
      questionForm: 'deliberative',
      contaminationRisk: 'low',
      graduation: 'live',
    };
    const ctx: LicensingContext = {
      availableSnippets: [{ id: '01J', version: 1, facet: 'fact' }],
      isLateSession: false,
    };

    expect(selectPattern([pattern], ctx)).toEqual(pattern);

    addDemotion(dataDir, 'patternSelection');

    const lines: { kind: string }[] = [];
    expect(selectPattern([pattern], ctx, (e) => { lines.push({ kind: e.kind }); })).toBeNull();
    expect(lines.map((l) => l.kind)).toEqual(['pattern-selection-shadow']);
  });

  it('a demotion the owner clears reads live again — no restart in either direction', () => {
    const t = THRESHOLDS['clash.embeddingCosine'];
    addDemotion(dataDir, 'clash.embeddingCosine');
    expect(isLive(t)).toBe(false);
    clearDemotion(dataDir, 'clash.embeddingCosine');
    expect(isLive(t)).toBe(true);
  });

  it('demotes only the key it was given', () => {
    addDemotion(dataDir, 'clash.embeddingCosine');
    expect(isDemoted('clash.embeddingCosine')).toBe(true);
    expect(isDemoted('patternSelection')).toBe(false);
    expect(isLive(THRESHOLDS['mint.callsPerRun'])).toBe(true);
  });
});
