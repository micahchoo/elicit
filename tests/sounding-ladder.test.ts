import { describe, expect, test } from 'vitest';
import {
  addRung,
  applyGate,
  enterSounding,
  gateStateFor,
} from '../src/sounding/ladder.js';
import type { SoundingState } from '../src/types.js';

const LICENSING = 'I keep feeling the pull to be seen doing the work';
const NOW = '2026-08-02T12:00:00.000Z';

/**
 * Fixture care: `isContentFree` (answer-shape.ts) fires on texts under 8
 * words with no evaluative/narrative marker stem, so every rung answer below
 * is >= 8 words — or the pivot check ends the ladder before the test does.
 */
function entered(): SoundingState {
  return enterSounding({
    session: 's',
    construct: 'the pull',
    licensingAnswer: LICENSING,
    mode: { minutes: 20, energy: 'high' },
    questionCount: 8,
    at: NOW,
  });
}

/**
 * A real substring of `prev` for the backwards chain: the first three words.
 * Verbatim by construction, so the foothold check can never fire for the
 * wrong reason.
 */
function footholdFrom(prev: string): string {
  return prev.split(' ').slice(0, 3).join(' ');
}

/** A ladder with `n` rich rungs, then the allowance overridden. */
function ladderWithRungs(n: number, allowance: number): SoundingState {
  let s = entered();
  let prev = LICENSING;
  for (let i = 1; i <= n; i++) {
    const answer = `the pull again, take ${i}, said at some length`;
    s = addRung(s, `q${i}`, footholdFrom(prev), answer, NOW);
    prev = answer;
  }
  return { ...s, allowance, checkpointRung: Math.ceil(allowance / 2) };
}

describe('the ladder', () => {
  test('rung 0 must quote the answer that licensed the descent', () => {
    const s = entered();
    expect(() => addRung(s, 'What is "the shove"?', 'the shove', 'anything at all here', NOW))
      .toThrow(/foothold/);
    expect(() => addRung(s, 'What is "the pull"?', 'the pull', 'anything at all here', NOW))
      .not.toThrow();
  });

  test('rung N quotes rung N-1s answer, never its own', () => {
    const s = addRung(entered(), 'What is "the pull"?', 'the pull',
      'it started in my fathers shed where nobody came', NOW);

    // The question for rung 1 was composed from rung 0s answer. That is a chain.
    expect(() => addRung(s, 'What happened in "my fathers shed"?', 'my fathers shed',
      'I do not remember much of it', NOW)).not.toThrow();

    // A foothold taken from the answer being recorded is not a chain — the question
    // would have had to quote an answer that did not exist when it was composed.
    expect(() => addRung(s, 'What do you mean by "do not remember"?', 'do not remember',
      'I do not remember much of it', NOW)).toThrow(/foothold/);
  });

  test('the gate reports the rung and the total on every rung', () => {
    const s = addRung(entered(), 'q1', 'the pull', 'the pull is strong in me', NOW);
    expect(gateStateFor(s)).toEqual({ rung: 1, of: 10, checkpoint: false });
  });

  test('the checkpoint fires on the halfway rung and on no other', () => {
    let s = entered();   // allowance 10, checkpoint 5
    let prev = LICENSING;
    for (let i = 1; i <= 10; i++) {
      const answer = `the pull again, take ${i}, said at some length`;
      s = addRung(s, `q${i}`, footholdFrom(prev), answer, NOW);
      expect(gateStateFor(s).checkpoint).toBe(i === 5);
      prev = answer;
    }
  });

  test('continue ends the descent only when the structure says so', () => {
    expect(applyGate(ladderWithRungs(10, 10), 'continue').end).toBe('cap');
    expect(applyGate(ladderWithRungs(2, 10), 'continue').end).toBe(null);
  });

  test('park and another-day end the descent whatever the counter says', () => {
    const short = ladderWithRungs(2, 10);
    expect(applyGate(short, 'park').end).toBe('park');
    expect(applyGate(short, 'another-day').end).toBe('another-day');
  });
});
