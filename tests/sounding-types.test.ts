import { describe, expect, test } from 'vitest';
import type { Rung, SoundingState, ParkedLadder, GateChoice } from '../src/types.js';

test('a rung records the foothold its question was built from', () => {
  const r: Rung = {
    question: 'What do you mean by "the pull"?',
    foothold: 'the pull',
    answer: 'It started in a shed',
    at: '2026-08-02T10:00:00.000Z',
  };
  expect(r.foothold).toBe('the pull');
});

test('a ladder keeps the answer that licensed it, so rung 0 has something to quote', () => {
  const s: SoundingState = {
    id: 'x',
    session: 's',
    started: '2026-08-02T10:00:00.000Z',
    construct: 'the pull',
    licensingAnswer: 'I keep feeling the pull to be seen working',
    allowance: 9,
    checkpointRung: 5,
    rungs: [],
  };
  expect(s.licensingAnswer).toContain('the pull');
});

test('a parked ladder records how it ended', () => {
  const p: ParkedLadder = {
    ...aLiveLadder(),
    ended: '2026-08-02T10:20:00.000Z',
    endedBy: 'park',
  };
  expect(p.endedBy).toBe('park');
});

test('the three gate words are the only gate words', () => {
  const all: GateChoice[] = ['continue', 'park', 'another-day'];
  expect(all).toHaveLength(3);
});

function aLiveLadder(): SoundingState {
  return {
    id: 'x',
    session: 's',
    started: '2026-08-02T10:00:00.000Z',
    construct: 'the pull',
    licensingAnswer: 'I keep feeling the pull to be seen working',
    allowance: 9,
    checkpointRung: 5,
    rungs: [],
  };
}
