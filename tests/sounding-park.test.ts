import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ulid } from 'ulid';
import { writeLadder, readLadder, parkPointer } from '../src/sounding/park.js';
import { createQueueStore } from '../src/queue/queue.js';
import type { ParkedLadder, QueueDraft, QueueStore } from '../src/types.js';

const NOW = '2026-08-02T12:00:00.000Z';
const LAST_RUNG_QUESTION = 'What did you mean by "the pull"?';

let root: string;
let queue: QueueStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-sounding-park-test-'));
  queue = createQueueStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A finished ladder: a live descent stamped with how and when it ended. */
function parkedLadder(overrides: {
  endedBy?: ParkedLadder['endedBy'];
  licensingAnswer?: string;
  rungs?: ParkedLadder['rungs'];
} = {}): ParkedLadder {
  return {
    id: ulid(),
    session: ulid(),
    started: '2026-08-02T11:00:00.000Z',
    ended: NOW,
    endedBy: overrides.endedBy ?? 'park',
    construct: 'the pull',
    licensingAnswer:
      overrides.licensingAnswer ?? 'I keep feeling "the pull": it is hard to say why',
    allowance: 9,
    checkpointRung: 5,
    rungs: overrides.rungs ?? [
      {
        question: 'Where does the pull show up first?',
        foothold: 'the pull',
        answer: 'It shows up in the shed, where nobody is watching.',
        at: '2026-08-02T11:05:00.000Z',
      },
      {
        question: LAST_RUNG_QUESTION,
        foothold: 'the pull',
        answer: 'Two things:\n  first, "being seen"; second — the shed.',
        at: '2026-08-02T11:10:00.000Z',
      },
    ],
  };
}

function realQuestionDraft(): QueueDraft {
  return {
    source: 'composed',
    license: 'test',
    question: 'What would you like to explore about the shed?',
    questionForm: 'deliberative',
    sharpness: 'weak',
    horizon: 'now',
  };
}

describe('sounding park (012 T7)', () => {
  it('a parked ladder round-trips through markdown, awkward prose included', () => {
    const l = parkedLadder({
      licensingAnswer: 'I keep feeling "the pull": it is hard to say why',
      rungs: [
        {
          question: 'What did you mean by "the pull"?',
          foothold: 'the pull',
          answer: 'Two things:\n  first, "being seen"; second — the shed.',
          at: NOW,
        },
      ],
    });
    writeLadder(root, l);
    expect(readLadder(root, l.id)).toEqual(l);
  });

  it('parking mints a pointer, not a question', () => {
    const l = parkedLadder({ endedBy: 'park' });
    const entry = parkPointer(queue, l);
    expect(entry.source).toBe('parked-sounding');
    expect(entry.soundingId).toBeTruthy();
    expect(entry.question).toBe(LAST_RUNG_QUESTION);
  });

  it('another day keeps the record and mints nothing', () => {
    const l = parkedLadder({ endedBy: 'another-day' });
    writeLadder(root, l);
    expect(readLadder(root, l.id)).toEqual(l);
    expect(queue.list({ source: 'parked-sounding' })).toHaveLength(0);
  });

  it('the ordinary draw never returns a parked sounding', () => {
    parkPointer(queue, parkedLadder({ endedBy: 'park' }));
    expect(queue.draw({ minutes: 20, energy: 'high', target: 'self' }, 'mid')).toBe(null);
  });

  it('a parked sounding does not shadow a real question', () => {
    parkPointer(queue, parkedLadder({ endedBy: 'park' }));
    queue.add(realQuestionDraft());
    expect(
      queue.draw({ minutes: 20, energy: 'high', target: 'self' }, 'mid')?.source,
    ).toBe('composed');
  });
});
