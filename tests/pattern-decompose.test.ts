import { describe, expect, test } from 'vitest';
import { decomposeDerived } from '../src/patterns/decompose.js';
import type { Pattern } from '../src/patterns/types.js';

// ---------------------------------------------------------------------------
// QR-2 fixtures — the permanent negative test suite
// ---------------------------------------------------------------------------

const QR2_FIXTURES = [
  'You wrote: "I try to honor my limits" — when you honor your limits instead of pushing through them, what does that look like?',
  'You wrote: "The old road is quiet now" — what new road are you taking now that the old one no longer calls to you?',
  'You wrote: "I have been in a low place" — how long will you let yourself stay stuck there?',
  'You wrote: "I need to hold space for this" — what would it mean to truly welcome that feeling?',
  'You wrote: "There is a spark I keep ignoring" — how might you tend to that spark?',
];

const QR2_EXPECTED_REASONS: ('presupposition')[] = [
  'presupposition', 'presupposition', 'presupposition', 'presupposition', 'presupposition',
];

function testPattern(overrides: Partial<Pattern> & { id: Pattern['id'] }): Pattern {
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

function sources(texts: string[]) {
  return texts.map((prose, i) => ({ id: `s${i}`, version: 1, prose }));
}

describe('decomposition guard', () => {
  test.each(QR2_FIXTURES.map((q, i) => [q, QR2_EXPECTED_REASONS[i]!]))(
    'rejects QR-2 fixture',
    (question, expectedReason) => {
      const pattern = testPattern({ id: 'instance-testing', operators: ['instance-of'] });
      const quoteMatch = question.match(/"([^"]+)"/);
      const sourceProse = quoteMatch ? quoteMatch[1]! : 'fallback text';
      const result = decomposeDerived(question, pattern, sources([sourceProse]));
      if (result.ok) {
        expect.fail(`QR-2 fixture passed — should have been ${expectedReason}`);
      }
      expect(result.reason).toBe(expectedReason);
    },
  );

  test('rejects question with no quoted spans', () => {
    const result = decomposeDerived('What do you think?', testPattern({ id: 'sentence-stems' }), sources(['x']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-quoted-spans');
  });

  test('rejects question where quoted text is not in any source', () => {
    const result = decomposeDerived(
      'You wrote: "fabricated text." What do you think?',
      testPattern({ id: 'instance-testing', operators: ['instance-of'] }),
      sources(['real prose']),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unquoted-material');
  });

  test('rejects question where agent speaks in first person outside quotes', () => {
    const quote = 'the pull';
    const result = decomposeDerived(
      `You wrote: "${quote}" I think this reflects your deeper struggle.`,
      testPattern({ id: 'instance-testing', operators: ['instance-of'] }),
      sources([quote]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('assertion-outside-quote');
  });

  test('accepts a valid instance-testing question', () => {
    const claim = 'I am drawn to solitude';
    const instance = 'I spent last Saturday reading alone for eight hours';
    const result = decomposeDerived(
      `You wrote: "${claim}" Would that include "${instance}"?`,
      testPattern({ id: 'instance-testing', operators: ['instance-of'] }),
      sources([claim, instance]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotedSpans).toHaveLength(2);
      expect(result.operatorsUsed).toContain('instance-of');
    }
  });

  test('accepts a valid dilemma question', () => {
    const poleA = 'deeply independent';
    const poleB = 'hungry for connection';
    const result = decomposeDerived(
      `You have described yourself as "${poleA}" and also as "${poleB}". Which is closer to how you would act in a crisis?`,
      testPattern({ id: 'dilemma', operators: ['dilemma-construct'] }),
      sources([poleA, poleB]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotedSpans).toHaveLength(2);
    }
  });

  test('accepts a valid counterfactual question', () => {
    const episode = 'I quit my job in March without a backup plan';
    const result = decomposeDerived(
      `You described "${episode}" — what if your manager had offered you a promotion that same week?`,
      testPattern({ id: 'counterfactual', operators: ['counterfactual-twist'] }),
      sources([episode, 'my manager offered me a promotion that same week']),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotedSpans).toHaveLength(1);
    }
  });
  test('accepts a valid sentence-stem question', () => {
    const stem = 'I am the kind of person who needs to be moving';
    const result = decomposeDerived(
      `You wrote: "${stem}" \u2014 finish this: ${stem} because ______.`,
      testPattern({ id: 'sentence-stems', operators: ['sentence-completion'] }),
      sources([stem]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotedSpans.length).toBeGreaterThanOrEqual(1);
    }
  });


  test('accepts a valid clean-language question', () => {
    const metaphor = 'a weight I am carrying';
    const result = decomposeDerived(
      `You mentioned "${metaphor}" — and what kind of weight is that weight?`,
      testPattern({ id: 'clean-language', operators: ['clean-language-frame'] }),
      sources([metaphor]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quotedSpans).toHaveLength(1);
    }
  });

  test('accepts legitimate "you" framing outside quotes', () => {
    const quote = 'the pull';
    const result = decomposeDerived(
      `You wrote: "${quote}" When you first noticed that feeling, where were you?`,
      testPattern({ id: 'instance-testing', operators: ['instance-of'] }),
      sources([quote, 'I first noticed that feeling in college']),
    );
    expect(result.ok).toBe(true);
  });
});
