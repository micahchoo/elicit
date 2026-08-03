import { describe, expect, test } from 'vitest';
import { compactLadder } from '../src/sounding/compaction.js';
import type { ParkedLadder } from '../src/types.js';

/**
 * The fixture is a full 9-rung ladder; `ladderOf(n)` takes its LAST n rungs,
 * so the last two of a `ladderOf(7)` are exactly `rungs.slice(-2)` — the
 * comparison the plan's first test makes. The module is a pure shape
 * function, so rung content is arbitrary (no content checks fire here).
 */
const rungs = Array.from({ length: 9 }, (_, i) => ({
  question: `question ${i}`,
  foothold: `foothold ${i}`,
  answer: `answer ${i}`,
  at: `2026-08-02T12:00:0${i}.000Z`,
}));

function ladderOf(n: number): ParkedLadder {
  return {
    id: 'ladder-id',
    session: 'session-id',
    started: '2026-08-02T12:00:00.000Z',
    construct: 'test construct',
    licensingAnswer: 'licensing answer',
    allowance: n,
    checkpointRung: Math.ceil(n / 2),
    rungs: rungs.slice(-n),
    ended: '2026-08-02T12:30:00.000Z',
    endedBy: 'park',
  };
}

describe('compaction', () => {
  test('the last two rungs come back verbatim, newest last', () => {
    const c = compactLadder(ladderOf(7), 'the thread ran from being seen to the shed');
    expect(c.verbatim).toEqual(rungs.slice(-2));
    expect(c.verbatim.at(-1)).toEqual(rungs.at(-1));
    expect(c.summarized).toEqual({ count: 5, line: 'the thread ran from being seen to the shed' });
  });

  test('a one-rung ladder has nothing to summarize', () => {
    const c = compactLadder(ladderOf(1), null);
    expect(c.verbatim).toHaveLength(1);
    expect(c.summarized).toBe(null);
    expect(c.unsummarized).toBe(0);
  });

  test('a missing summary drops context — it never falls back to the whole ladder', () => {
    const c = compactLadder(ladderOf(9), null);
    expect(c.verbatim).toHaveLength(2);
    expect(c.summarized).toBe(null);
    expect(c.unsummarized).toBe(7);
  });
});
