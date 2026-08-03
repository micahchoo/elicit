import { describe, expect, test } from 'vitest';
import { licensePattern } from '../src/patterns/license.js';
import type { LicensingContext, Pattern } from '../src/patterns/types.js';

function pattern(overrides: Partial<Pattern> & { id: Pattern['id'] }): Pattern {
  return {
    name: overrides.id,
    tier: overrides.tier ?? 'cheap',
    operators: overrides.operators ?? ['sentence-completion'],
    derivesFrom: overrides.derivesFrom ?? { minSnippets: 1, facets: ['construct'] },
    requiredQuotes: overrides.requiredQuotes ?? ['quote'],
    questionForm: overrides.questionForm ?? 'deliberative',
    contaminationRisk: overrides.contaminationRisk ?? 'low',
    graduation: overrides.graduation ?? 'shadow',
    ...overrides,
  };
}

function ctx(overrides: Partial<LicensingContext> = {}): LicensingContext {
  return {
    availableSnippets: [],
    isLateSession: false,
    ...overrides,
  };
}

describe('pattern licensing', () => {
  test('licenses a pattern with enough matching snippets', () => {
    const p = pattern({
      id: 'instance-testing',
      derivesFrom: { minSnippets: 1, facets: ['construct'] },
    });
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
      ],
    });
    expect(licensePattern(p, c)).toBe(true);
  });

  test('rejects when too few snippets match', () => {
    const p = pattern({
      id: 'instance-testing',
      derivesFrom: { minSnippets: 2, facets: ['construct'] },
    });
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
      ],
    });
    expect(licensePattern(p, c)).toBe(false);
  });

  test('rejects when a required facet is missing', () => {
    const p = pattern({
      id: 'instance-testing',
      derivesFrom: { minSnippets: 1, facets: ['construct', 'causal-theory'] },
    });
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
      ],
    });
    expect(licensePattern(p, c)).toBe(false);
  });

  test('licenses when alsoNeeds is satisfied', () => {
    const p = pattern({
      id: 'instance-testing',
      derivesFrom: {
        minSnippets: 2,
        facets: ['construct'],
        alsoNeeds: ['episode'],
      },
    });
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
        { id: 's2', version: 1, facet: 'construct' },
        { id: 's3', version: 1, facet: 'episode' },
      ],
    });
    expect(licensePattern(p, c)).toBe(true);
  });

  test('rejects when alsoNeeds is unsatisfied', () => {
    const p = pattern({
      id: 'instance-testing',
      derivesFrom: {
        minSnippets: 1,
        facets: ['construct'],
        alsoNeeds: ['episode'],
      },
    });
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
      ],
    });
    expect(licensePattern(p, c)).toBe(false);
  });

  test('rejects deep patterns when not late session', () => {
    const p = pattern({
      id: 'externalizing',
      tier: 'deep',
      derivesFrom: { minSnippets: 1, facets: ['construct'] },
    });
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
      ],
      isLateSession: false,
    });
    expect(licensePattern(p, c)).toBe(false);
  });

  test('licenses deep patterns when late session', () => {
    const p = pattern({
      id: 'externalizing',
      tier: 'deep',
      derivesFrom: { minSnippets: 1, facets: ['construct'] },
    });
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
      ],
      isLateSession: true,
    });
    expect(licensePattern(p, c)).toBe(true);
  });

  test('licenses cheap patterns regardless of session phase', () => {
    const p = pattern({
      id: 'sentence-stems',
      derivesFrom: { minSnippets: 1, facets: ['construct'] },
    });
    const early = ctx({
      availableSnippets: [{ id: 's1', version: 1, facet: 'construct' }],
      isLateSession: false,
    });
    const late = ctx({
      availableSnippets: [{ id: 's1', version: 1, facet: 'construct' }],
      isLateSession: true,
    });
    expect(licensePattern(p, early)).toBe(true);
    expect(licensePattern(p, late)).toBe(true);
  });
});
