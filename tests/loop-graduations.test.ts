/**
 * The runtime graduation store (Q-99) — data-driven `live: false -> true`,
 * symmetric with demotions and subordinate to them.
 *
 * `ELICIT_DATA_DIR` points the store at a temporary directory per test, the
 * same pattern as tests/loop-demotions.test.ts — read per call, never
 * captured at load, restored after.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDemotion } from '../src/loop/demotions.js';
import { addGraduation, isGraduated, readGraduations } from '../src/loop/graduations.js';
import { THRESHOLDS, isLive } from '../src/wiki/thresholds.js';

let dataDir: string;
let previous: string | undefined;

beforeEach(() => {
 dataDir = mkdtempSync(join(tmpdir(), 'elicit-graduations-'));
 previous = process.env.ELICIT_DATA_DIR;
 process.env.ELICIT_DATA_DIR = dataDir;
});

afterEach(() => {
 if (previous === undefined) delete process.env.ELICIT_DATA_DIR;
 else process.env.ELICIT_DATA_DIR = previous;
 rmSync(dataDir, { recursive: true, force: true });
});

describe('the store', () => {
 it('reads an absent file as nothing graduated', () => {
  expect(readGraduations(dataDir).size).toBe(0);
  expect(isGraduated('lint.occasionlessRange', dataDir)).toBe(false);
 });

 it('reads a malformed file as nothing graduated, never a throw', () => {
  writeFileSync(join(dataDir, 'graduations.json'), 'not json', 'utf-8');
  expect(readGraduations(dataDir).size).toBe(0);
  writeFileSync(join(dataDir, 'graduations.json'), '{"graduated": "nope"}', 'utf-8');
  expect(readGraduations(dataDir).size).toBe(0);
 });

 it('records a graduation idempotently and sorted', () => {
  addGraduation(dataDir, 'lint.occasionlessRange');
  addGraduation(dataDir, 'lint.godNodeFanout');
  addGraduation(dataDir, 'lint.occasionlessRange');
  expect([...readGraduations(dataDir)]).toEqual([
   'lint.godNodeFanout',
   'lint.occasionlessRange',
  ]);
 });
});

describe('isLive integration', () => {
 it('a shipped-shadow threshold reads live once graduated by data', () => {
  const t = THRESHOLDS['lint.occasionlessRange']!;
  expect(t.live).toBe(false);
  expect(isLive(t)).toBe(false);
  addGraduation(dataDir, t.name);
  expect(isLive(t)).toBe(true);
  // The register itself never moved — only the read did.
  expect(t.live).toBe(false);
 });

 it('demotion beats graduation', () => {
  const t = THRESHOLDS['lint.occasionlessRange']!;
  addGraduation(dataDir, t.name);
  expect(isLive(t)).toBe(true);
  addDemotion(dataDir, t.name);
  expect(isLive(t)).toBe(false);
 });
});
