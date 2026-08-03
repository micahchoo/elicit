import { describe, expect, test } from 'vitest';
import { composeWithPattern } from '../src/clerk/compose-pattern.js';
import { clearPatternCache } from '../src/patterns/registry.js';
import type { Snippet, Complete, Turn } from '../src/types.js';
import type { LicensingContext } from '../src/patterns/types.js';

function fakeComplete(response: string): Complete {
  return async (_system: string, _turns: Turn[], _opts?: { temperature?: number }) => response;
}

function snippet(prose: string): Snippet {
  return {
    id: 's1', version: 1, prose, captured: '2026-01-01T00:00:00.000Z',
    provenance: { question: 'test', questionForm: 'deliberative', transcript: 't1' },
  } as unknown as Snippet;
}

function ctx(overrides: Partial<LicensingContext> = {}): LicensingContext {
  return { availableSnippets: [], isLateSession: false, ...overrides };
}

describe('composeWithPattern', () => {
  test('returns null when no patterns are licensed', async () => {
    clearPatternCache();
    const result = await composeWithPattern(
      [snippet('some prose')],
      fakeComplete('any question'),
      ctx(),
    );
    expect(result).toBeNull();
  });

  test('returns null when threshold is shadow', async () => {
    clearPatternCache();
    const result = await composeWithPattern(
      [snippet('I am drawn to solitude'), snippet('I spent Saturday alone')],
      fakeComplete('You wrote: "drawn to solitude" Would that include "spent Saturday alone"?'),
      ctx({ availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
        { id: 's2', version: 1, facet: 'episode' },
      ] }),
    );
    expect(result).toBeNull();
  });

  test('returns null when LLM response is empty', async () => {
    clearPatternCache();
    const result = await composeWithPattern(
      [snippet('x')],
      fakeComplete(''),
      ctx({ availableSnippets: [{ id: 's1', version: 1, facet: 'construct' }] }),
    );
    expect(result).toBeNull();
  });
});
