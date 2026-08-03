import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pattern, PatternId } from '../src/patterns/types.js';

const PATTERNS_DIR = join(import.meta.dirname!, '..', 'data', 'patterns');

function loadAllPatterns(): Pattern[] {
  const files = readdirSync(PATTERNS_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => {
    const raw = readFileSync(join(PATTERNS_DIR, f), 'utf-8');
    return JSON.parse(raw) as Pattern;
  });
}

const VALID_PATTERN_IDS: PatternId[] = [
  'sentence-stems',
  'clean-language',
  'instance-testing',
  'counterfactual',
  'dilemma',
  'reversal',
  'anniversary-framing',
  'externalizing',
  'miracle-question',
  'heavy-scenario',
];

const CHEAP_PATTERNS: PatternId[] = [
  'sentence-stems',
  'clean-language',
  'instance-testing',
  'counterfactual',
  'dilemma',
  'reversal',
  'anniversary-framing',
];

const DEEP_PATTERNS: PatternId[] = [
  'externalizing',
  'miracle-question',
  'heavy-scenario',
];

describe('pattern types', () => {
  const patterns = loadAllPatterns();

  test('all ten seed patterns load and parse', () => {
    expect(patterns).toHaveLength(10);
  });

  test('every pattern has a valid id', () => {
    for (const p of patterns) {
      expect(VALID_PATTERN_IDS).toContain(p.id);
    }
  });

  test('every pattern id is present exactly once', () => {
    const ids = patterns.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...VALID_PATTERN_IDS].sort());
  });

  test('every pattern has a non-empty name', () => {
    for (const p of patterns) {
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  test('cheap patterns match the catalogue tier', () => {
    for (const p of patterns) {
      if (CHEAP_PATTERNS.includes(p.id)) {
        expect(p.tier).toBe('cheap');
      }
    }
  });

  test('deep patterns match the catalogue tier', () => {
    for (const p of patterns) {
      if (DEEP_PATTERNS.includes(p.id)) {
        expect(p.tier).toBe('deep');
      }
    }
  });

  test('every pattern has at least one operator', () => {
    for (const p of patterns) {
      expect(p.operators.length).toBeGreaterThan(0);
    }
  });

  test('every pattern has a valid derivesFrom with minSnippets >= 1', () => {
    for (const p of patterns) {
      expect(p.derivesFrom.minSnippets).toBeGreaterThanOrEqual(1);
      expect(p.derivesFrom.facets.length).toBeGreaterThan(0);
    }
  });

  test('every pattern has at least one requiredQuote', () => {
    for (const p of patterns) {
      expect(p.requiredQuotes.length).toBeGreaterThan(0);
    }
  });

  test('every pattern has a valid questionForm', () => {
    const validForms = ['deliberative', 'theoretical', 'why'];
    for (const p of patterns) {
      expect(validForms).toContain(p.questionForm);
    }
  });

  test('every pattern has a valid contaminationRisk', () => {
    const validRisks = ['low', 'moderate', 'high'];
    for (const p of patterns) {
      expect(validRisks).toContain(p.contaminationRisk);
    }
  });

  test('every pattern starts in shadow graduation', () => {
    for (const p of patterns) {
      expect(p.graduation).toBe('shadow');
    }
  });

  test('deep patterns have high or moderate contamination risk', () => {
    for (const p of patterns) {
      if (p.tier === 'deep') {
        expect(['moderate', 'high']).toContain(p.contaminationRisk);
      }
    }
  });
});
