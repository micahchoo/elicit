import { describe, expect, test, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPatterns, patternById, clearPatternCache } from '../src/patterns/registry.js';

describe('pattern registry', () => {
  let dir: string;

  beforeEach(() => {
    clearPatternCache();
    dir = mkdtempSync(join(tmpdir(), 'pattern-registry-'));
  });

  test('loads all ten seed patterns from data/patterns/', () => {
    const patterns = loadPatterns();
    expect(patterns.length).toBe(10);
  });

  test('skips non-JSON files', () => {
    writeFileSync(join(dir, 'notes.txt'), 'not a pattern');
    const p = { id: 'reversal', name: 'Reversal', tier: 'cheap', operators: ['reversal'], derivesFrom: { minSnippets: 1, facets: ['intention'] }, requiredQuotes: ['q'], questionForm: 'deliberative', contaminationRisk: 'low', graduation: 'shadow' };
    writeFileSync(join(dir, 'rev.json'), JSON.stringify(p));
    const patterns = loadPatterns(dir);
    expect(patterns).toHaveLength(1);
  });

  test('skips malformed JSON with a warn', () => {
    writeFileSync(join(dir, 'bad.json'), '{not json}');
    const patterns = loadPatterns(dir);
    expect(patterns).toHaveLength(0);
  });

  test('skips files missing id', () => {
    writeFileSync(join(dir, 'noid.json'), JSON.stringify({ name: 'test' }));
    const patterns = loadPatterns(dir);
    expect(patterns).toHaveLength(0);
  });

  test('returns empty array for nonexistent directory', () => {
    const patterns = loadPatterns('/nonexistent/path/patterns');
    expect(patterns).toHaveLength(0);
  });

  test('returns empty array for empty directory', () => {
    const patterns = loadPatterns(dir);
    expect(patterns).toHaveLength(0);
  });

  test('caches results between calls', () => {
    const p = { id: 'dilemma', name: 'D', tier: 'cheap', operators: ['dilemma-construct'], derivesFrom: { minSnippets: 1, facets: ['construct'] }, requiredQuotes: ['a', 'b'], questionForm: 'deliberative', contaminationRisk: 'low', graduation: 'shadow' };
    writeFileSync(join(dir, 'd.json'), JSON.stringify(p));
    const first = loadPatterns(dir);
    const second = loadPatterns(dir);
    expect(first).toBe(second);
  });

  test('patternById finds a pattern', () => {
    const patterns = loadPatterns();
    const found = patternById('instance-testing', patterns);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Instance testing');
  });

  test('patternById returns undefined for unknown id', () => {
    const patterns = loadPatterns();
    const found = patternById('nonexistent' as 'instance-testing', patterns);
    expect(found).toBeUndefined();
  });
});
