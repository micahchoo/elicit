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

  test('returns a licensed pattern now the threshold is live (graduated 2026-08-03)', () => {
    const patterns = loadPatterns();
    const c = ctx({
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
        { id: 's2', version: 1, facet: 'episode' },
      ],
    });
    const result = selectPattern(patterns, c);
    expect(result).not.toBeNull();
    expect(patterns.some((p) => p.id === result!.id)).toBe(true);
  });

  test('logs a live selection event when log fn is provided', () => {
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
    expect(events.some((e) => e.kind === 'pattern-selection-live')).toBe(true);
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

  test('selectDeepPattern returns a deep pattern and logs live when licensed late-session', () => {
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
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('deep');
    expect(events.some((e) => e.kind === 'pattern-selection-live')).toBe(true);
  });
});
