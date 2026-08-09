/**
 * The reflection follow-ups (090 T6) — two zero-LLM template questions
 * quoting the return verbatim (Q-12, code-verified), capped by
 * coach.reflectionCap (Q-56), deduped on the (quest, session) pair, into
 * the ordinary Queue under the quest-reflection source (Q-75).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueueStore } from '../src/queue/queue.js';
import { mintReflections } from '../src/coach/reflection.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { ThresholdLogFn } from '../src/domain/thresholds.js';
import type { Quest } from '../src/coach/contract.js';
import type { QueueStore } from '../src/types.js';

let root: string;
let queue: QueueStore;

function quest(): Quest {
 return {
  id: '01KZ0DJAKS53EHA0KJZTGZJHY5',
  direction: 'cooking',
  act: 'Cook one meal from scratch',
  cites: ['c1'],
  adoptedAt: '2026-08-03T09:00:00.000Z',
 };
}

function collector(): { events: { kind: string; detail: string }[]; log: ThresholdLogFn } {
 const events: { kind: string; detail: string }[] = [];
 const log: ThresholdLogFn = (e) => events.push({ kind: e.kind, detail: e.detail });
 return { events, log };
}

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'elicit-coach-reflection-'));
 queue = createQueueStore(root);
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

describe('mintReflections (090 T6)', () => {
 it('mints the two template questions quoting the return verbatim, with the full field set', () => {
  const { log } = collector();
  const out = mintReflections({
   queue,
   quest: quest(),
   session: 's-1',
   returnText: 'I burnt the rice. Then I tried again.',
   log,
  });
  expect(out.minted).toHaveLength(2);
  expect(out.clipped).toBe(0);

  const entries = queue.list({ source: 'quest-reflection' });
  expect(entries).toHaveLength(2);
  for (const e of entries) {
   expect(e.source).toBe('quest-reflection');
   expect(e.quest).toBe(quest().id);
   expect(e.direction).toBe('cooking');
   expect(e.questionForm).toBe('theoretical');
   expect(e.horizon).toBe('session');
   expect(e.license).toBe(`Q-75 quest return quest=${quest().id} session=s-1`);
   expect(e.target).toBeUndefined();
   const quote = e.quotedFragment!;
   expect('I burnt the rice. Then I tried again.').toContain(quote);
   expect(e.question).toContain(`"${quote}"`);
  }
  expect(entries[0]!.question).toBe(
   'You came back with "I burnt the rice." — what broke along the way that these words don\'t say?',
  );
  expect(entries[1]!.question).toBe('You came back with "I burnt the rice." — what surprised you?');
 });

 it('a second call for the same (quest, session) mints nothing — the dedupe survives restarts via the license', () => {
  const { log } = collector();
  const first = mintReflections({ queue, quest: quest(), session: 's-1', returnText: 'I burnt the rice.', log });
  expect(first.minted).toHaveLength(2);
  const second = mintReflections({ queue, quest: quest(), session: 's-1', returnText: 'I burnt the rice.', log });
  expect(second.minted).toHaveLength(0);
  expect(second.clipped).toBe(0);
  expect(queue.list({ source: 'quest-reflection' })).toHaveLength(2);
 });

 it('a different session re-mints — the dedupe key is the (quest, session) pair', () => {
  const { log } = collector();
  mintReflections({ queue, quest: quest(), session: 's-1', returnText: 'I burnt the rice.', log });
  mintReflections({ queue, quest: quest(), session: 's-2', returnText: 'It went better.', log });
  expect(queue.list({ source: 'quest-reflection' })).toHaveLength(4);
 });

 it('a cap at 1 mints one question and records the clip through shadowDecision', () => {
  const cap = THRESHOLDS['coach.reflectionCap'];
  const saved = cap.value;
  cap.value = 1;
  try {
   const { events, log } = collector();
   const out = mintReflections({ queue, quest: quest(), session: 's-1', returnText: 'I burnt the rice.', log });
   expect(out.minted).toHaveLength(1);
   expect(out.clipped).toBe(1);
   expect(queue.list({ source: 'quest-reflection' })).toHaveLength(1);
   const clip = events.find((e) => e.kind === 'threshold-clipped');
   expect(clip).toBeDefined();
   expect(clip!.detail).toContain('coach.reflectionCap');
  } finally {
   cap.value = saved;
  }
 });

 it('a return that is one long unbroken word still yields a valid substring quote', () => {
  const { log } = collector();
  const returnText = 'w'.repeat(300);
  const out = mintReflections({ queue, quest: quest(), session: 's-1', returnText, log });
  expect(out.minted).toHaveLength(2);
  const quote = queue.list({ source: 'quest-reflection' })[0]!.quotedFragment!;
  expect(returnText).toContain(quote);
  expect(quote.length).toBe(200);
 });

 it('an empty return mints nothing rather than an unquoted question (Q-12 rigidity)', () => {
  const { log } = collector();
  const out = mintReflections({ queue, quest: quest(), session: 's-1', returnText: '   ', log });
  expect(out.minted).toHaveLength(0);
  expect(out.clipped).toBe(0);
  expect(queue.list({ source: 'quest-reflection' })).toHaveLength(0);
 });
});
