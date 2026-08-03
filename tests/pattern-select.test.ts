import { describe, expect, test } from 'vitest';
import { selectPattern, selectCheapPattern, selectDeepPattern } from '../src/patterns/select.js';
import { loadPatterns, clearPatternCache } from '../src/patterns/registry.js';
import type { LicensingContext } from '../src/patterns/types.js';

function ctx(overrides: Partial<LicensingContext> = {}): LicensingContext {
  return { availableSnippets: [], isLateSession: false, ...overrides };
}

describe('pattern selection', () => {
  test('returns null when no patterns are licensed (empty context)', () => {
    const patterns = loadPatterns();
    const result = selectPattern(patterns, ctx());
    expect(result).toBeNull();
  });

  test('returns null when threshold is shadow (the default)', () => {
    const patterns = loadPatterns();
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
        { id: 's2', version: 1, facet: 'episode' },
      ],
    });
    const result = selectPattern(patterns, c);
    expect(result).toBeNull();
  });

  test('logs shadow events when log fn is provided', () => {
    const patterns = loadPatterns();
    const events: { kind: string }[] = [];
    const log = (e: { at: string; actor: string; kind: string; detail: string }) => {
      events.push(e);
    };

    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
      ],
    });

    selectPattern(patterns, c, log);
    expect(events.some((e) => e.kind === 'pattern-selection-shadow')).toBe(true);
  });

  test('selectCheapPattern only considers cheap patterns', () => {
    const patterns = loadPatterns();
    const cheap = patterns.filter((p) => p.tier === 'cheap');
    const deep = patterns.filter((p) => p.tier === 'deep');
    expect(cheap.length).toBe(7);
    expect(deep.length).toBe(3);
  });

  test('selectDeepPattern requires late session for licensing', () => {
    const patterns = loadPatterns();
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
        { id: 's2', version: 1, facet: 'causal-theory' },
        { id: 's3', version: 1, facet: 'construct' },
      ],
      isLateSession: false,
    });
    const result = selectDeepPattern(patterns, c);
    expect(result).toBeNull();
  });

  test('selectDeepPattern logs shadow event when licensed late-session', () => {
    const patterns = loadPatterns();
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
        { id: 's2', version: 1, facet: 'causal-theory' },
        { id: 's3', version: 1, facet: 'construct' },
      ],
      isLateSession: true,
    });

    const events: { kind: string }[] = [];
    const log = (e: { at: string; actor: string; kind: string; detail: string }) => {
      events.push(e);
    };

    const result = selectDeepPattern(patterns, c, log);
    expect(result).toBeNull();
    expect(events.some((e) => e.kind === 'pattern-selection-shadow')).toBe(true);
  });
});
