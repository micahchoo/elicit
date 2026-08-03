import { describe, test, expect } from 'vitest';
import { descentEnd } from '../src/sounding/convergence.js';
import type { Rung, SoundingState } from '../src/types.js';

/**
 * Fixture care: `isContentFree` (answer-shape.ts) fires on texts under 8 words
 * with no evaluative/narrative marker stem, so every rich-answer fixture below
 * is >= 8 words — or the content-free check ends the ladder before the echo
 * check ever runs.
 */
const threeRichAnswers = [
  'the pull is about wanting to be seen doing the work',
  'I notice it most when nobody is watching me work',
  'it comes back to wanting to be seen doing the work',
];

const nineDistinctAnswers = [
  ...threeRichAnswers,
  'my father built furniture in a shed and never showed anyone',
  'I think the wanting began long before I had words for it',
  'being seen mattered more to me than the work itself ever did',
  'the moment I realized was when I stopped telling anyone at all',
  'it changed something when I noticed the audience was imaginary',
  'I have learned that the wish to be seen never really goes away',
];

function ladder(opts: { allowance: number; answers: string[] }): SoundingState {
  const rungs: Rung[] = opts.answers.map((answer, i) => ({
    question: `rung question ${i + 1}`,
    foothold: 'fixture foothold',
    answer,
    at: `2026-08-02T00:00:${String(i).padStart(2, '0')}Z`,
  }));
  return {
    id: 'fixture-sounding',
    session: 'fixture-session',
    started: '2026-08-02T00:00:00Z',
    construct: 'fixture construct',
    licensingAnswer: 'fixture licensing answer',
    allowance: opts.allowance,
    checkpointRung: Math.ceil(opts.allowance / 2),
    rungs,
  };
}

describe('descentEnd', () => {
  test('a full ladder ends at the cap', () => {
    expect(descentEnd(ladder({ allowance: 8, answers: nineDistinctAnswers.slice(0, 8) }))).toBe('cap');
  });

  test('a content-free answer ends the descent', () => {
    expect(descentEnd(ladder({ allowance: 12, answers: [...threeRichAnswers, 'dunno'] }))).toBe('convergence');
  });

  test('two answers of 3+ tokens echoing earlier rungs end the descent', () => {
    const answers = [
      'the pull is about wanting to be seen doing the work',
      'I notice it most when nobody is watching me work',
      'it comes back to wanting to be seen doing the work',
      'again it is about wanting to be seen doing the work',
    ];
    expect(descentEnd(ladder({ allowance: 12, answers }))).toBe('convergence');
  });

  test('answers under three tokens can never echo — resonate floors at 3 (lexical.ts:225)', () => {
    const answers = ['being seen matters to me a great deal', 'being seen', 'being seen', 'being seen'];
    // 'being seen' is 2 tokens, so resonate returns [] for it; the content-free
    // check is what ends this ladder, and the echo check contributes nothing.
    expect(descentEnd(ladder({ allowance: 12, answers }))).toBe('convergence');
  });

  test('one echo alone does not end the descent', () => {
    const answers = [
      'the pull is about wanting to be seen doing the work',
      'I notice it most when nobody is watching me work',
      'it comes back to wanting to be seen doing the work',
      'my father built furniture in a shed and never showed anyone',
    ];
    expect(descentEnd(ladder({ allowance: 12, answers }))).toBe(null);
  });

  test('a short ladder never converges — there is nothing to echo yet', () => {
    // The plan's original fixture ('a rich first/second answer here') is 6 words
    // with no marker stem — content-free by answer-shape.ts, so the pivot would
    // fire before the short-ladder guard. Rich means >= 8 words or a marker stem.
    expect(descentEnd(ladder({ allowance: 12, answers: ['a rich first answer here with real meaning in it', 'a rich second answer here with real meaning too'] }))).toBe(null);
  });
});
