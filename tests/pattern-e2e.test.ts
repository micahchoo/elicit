import { describe, expect, test, afterEach } from 'vitest';
import { loadPatterns, clearPatternCache } from '../src/patterns/registry.js';
import { licensePattern } from '../src/patterns/license.js';
import { selectCheapPattern, selectDeepPattern } from '../src/patterns/select.js';
import { decomposeDerived } from '../src/patterns/decompose.js';
import { isNearDuplicate } from '../src/elicitor/guards.js';
import type { LicensingContext } from '../src/patterns/types.js';

const QR2_FIXTURES = [
  'You wrote: "I have been trying to honor that full spectrum of states instead of pushing through them" — when you honor that full spectrum of states instead of pushing through them, what does that look like?',
  'You wrote: "The old one no longer holds my attention" — what new path are you walking toward now that the old one no longer holds your attention?',
  'You wrote: "I have been in a low place" — how long will you let yourself stay there?',
  'You wrote: "I need to hold space for this" — what would it mean to truly welcome that feeling?',
  'You wrote: "There is an aliveness I have been ignoring" — how might you tend to that aliveness?',
];

function richCtx(): LicensingContext {
  return {
    availableSnippets: [
      { id: 's1', version: 1, facet: 'construct' },
      { id: 's2', version: 1, facet: 'construct' },
      { id: 's3', version: 1, facet: 'construct' },
      { id: 's4', version: 1, facet: 'episode' },
      { id: 's5', version: 1, facet: 'episode' },
      { id: 's6', version: 1, facet: 'causal-theory' },
      { id: 's7', version: 1, facet: 'value' },
      { id: 's8', version: 1, facet: 'intention' },
      { id: 's9', version: 1, facet: 'fact' },
    ],
    isLateSession: true,
  };
}

describe('derivation patterns e2e', () => {
  afterEach(() => {
    clearPatternCache();
  });

  test('all ten seed patterns load', () => {
    expect(loadPatterns().length).toBe(10);
  });

  test('exactly seven cheap and three deep patterns', () => {
    const p = loadPatterns();
    expect(p.filter((x) => x.tier === 'cheap').length).toBe(7);
    expect(p.filter((x) => x.tier === 'deep').length).toBe(3);
  });

  test('QR-2 fixtures are rejected by decomposition guard', () => {
    const cheap = loadPatterns().filter((p) => p.tier === 'cheap');
    for (const question of QR2_FIXTURES) {
      const match = question.match(/"([^"]+)"/);
      const sourceProse = match ? match[1]! : 'fallback';
      for (const pattern of cheap) {
        const result = decomposeDerived(question, pattern, [
          { id: 's0', version: 1, prose: sourceProse },
        ]);
        expect(result.ok).toBe(false);
      }
    }
  });

  test('cheap patterns are licensed with minimal material', () => {
    const cheap = loadPatterns().filter((p) => p.tier === 'cheap');
    const ctx: LicensingContext = {
      availableSnippets: [{ id: 's1', version: 1, facet: 'construct' }],
      isLateSession: false,
    };
    const licensed = cheap.filter((p) => licensePattern(p, ctx));
    expect(licensed.length).toBeGreaterThan(0);
  });

  test('deep patterns require late session', () => {
    const deep = loadPatterns().filter((p) => p.tier === 'deep');
    const early = { ...richCtx(), isLateSession: false };
    expect(deep.filter((p) => licensePattern(p, early)).length).toBe(0);

    const late = { ...richCtx(), isLateSession: true };
    expect(deep.filter((p) => licensePattern(p, late)).length).toBeGreaterThan(0);
  });
  test('instance-testing needs episode + general-claim', () => {
    const it = loadPatterns().find((p) => p.id === 'instance-testing')!;
    // Without episode
    const noEpi: LicensingContext = {
      availableSnippets: [{ id: 's1', version: 1, facet: 'construct' }],
      isLateSession: false,
    };
    expect(licensePattern(it, noEpi)).toBe(false);
    // With episode + 2 construct (minSnippets: 2)
    const withEpi: LicensingContext = {
      availableSnippets: [
        { id: 's1', version: 1, facet: 'construct' },
        { id: 's2', version: 1, facet: 'construct' },
        { id: 's3', version: 1, facet: 'episode' },
      ],
      isLateSession: false,
    };
    expect(licensePattern(it, withEpi)).toBe(true);
  });

  test('selectCheapPattern never returns deep patterns', () => {
    const patterns = loadPatterns();
    for (let i = 0; i < 100; i++) {
      const r = selectCheapPattern(patterns, richCtx());
      if (r) expect(r.tier).toBe('cheap');
    }
  });

  test('selectDeepPattern never returns cheap patterns', () => {
    const patterns = loadPatterns();
    for (let i = 0; i < 100; i++) {
      const r = selectDeepPattern(patterns, richCtx());
      if (r) expect(r.tier).toBe('deep');
    }
  });

  test('selectCheapPattern returns null in shadow mode', () => {
    expect(selectCheapPattern(loadPatterns(), richCtx())).toBeNull();
  });

  test('shadow mode logs events', () => {
    const events: { kind: string }[] = [];
    selectCheapPattern(loadPatterns(), richCtx(), (e) => events.push(e));
    expect(events.some((e) => e.kind === 'pattern-selection-shadow')).toBe(true);
  });

  test('near-duplicate: same quote, different frame → not duplicate', () => {
    const q1 = 'You wrote: "the pull." Is that still true today?';
    const q2 = 'You wrote: "the pull." If "the pull" were a character, what would it want?';
    expect(isNearDuplicate(q1, [q2])).toBe(false);
  });

  test('near-duplicate: different quotes, similar frame → duplicate', () => {
    const q1 = 'You wrote: "the pull." What does that feel like?';
    const q2 = 'You wrote: "the ache." What does that feel like?';
    expect(isNearDuplicate(q1, [q2])).toBe(true);
  });

  test('valid instance-testing passes decomposition', () => {
    const it = loadPatterns().find((p) => p.id === 'instance-testing')!;
    const claim = 'I value autonomy above all else';
    const instance = 'Last week I turned down a collaboration offer';

    const result = decomposeDerived(
      `You wrote: "${claim}" Would that include "${instance}"?`,
      it,
      [{ id: 's1', version: 1, prose: claim }, { id: 's2', version: 1, prose: instance }],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotedSpans).toHaveLength(2);
      expect(result.operatorsUsed).toContain('instance-of');
    }
  });

  test('valid clean-language question passes decomposition', () => {
    const cl = loadPatterns().find((p) => p.id === 'clean-language')!;
    const metaphor = 'a fog I cannot see through';
    const result = decomposeDerived(
      `You mentioned "${metaphor}" — and what kind of fog is that fog?`,
      cl,
      [{ id: 's1', version: 1, prose: metaphor }],
    );
    expect(result.ok).toBe(true);
  });
});
