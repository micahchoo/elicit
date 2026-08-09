/**
 * The answered turn (ticket 041, T17).
 *
 * Every case here drives the LIVE path: a real queue store and a real vault
 * over a tmp root, a scripted `Complete`, and no state set by hand. The status
 * is always read back through a FRESH `createQueueStore`, so a field that is
 * written to memory and dropped at the frontmatter fails here — which is the
 * exact shape of the bug this task closes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { QueueDraft, QueueEntry, QueueStore, Vault } from '../src/types.js';
import { createQueueStore } from '../src/queue/queue.js';
import { createVault } from '../src/vault/vault.js';
import { startSession, userTurn, skipQuestion } from '../src/elicitor/elicitor.js';
import { isContentFree } from '../src/language/thin-answer.js';
import { buildIndex } from '../src/index/lexical.js';
import { makeScriptedComplete } from './fakes.js';

let root: string;
let queue: QueueStore;
let vault: Vault;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-answered-turn-'));
  queue = createQueueStore(root);
  vault = createVault(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const BANK = [{ text: 'What are you avoiding today?', questionForm: 'deliberative' as const }];

/** A weak, now-horizon entry: the only shape `draw` will serve at 'opening'. */
function weakDraft(question: string, overrides?: Partial<QueueDraft>): QueueDraft {
  return {
    source: 'composed',
    license: 'machine',
    question,
    questionForm: 'deliberative',
    horizon: 'now',
    ...overrides,
  };
}

/** Read one entry back through a store that shares nothing but the disk. */
function fromDisk(id: string): QueueEntry {
  const found = createQueueStore(root).list().find((e) => e.id === id);
  if (!found) throw new Error(`entry ${id} is not on disk`);
  return found;
}

/** One rich user turn costs two model calls: red lights, then the probe. */
function richTurnResponses(probe: string): string[] {
  return ['{}', probe];
}

const RICH_ANSWER =
  'I remember the week I stopped answering, because the silence felt like a decision.';

function openSession(deps: { complete: ReturnType<typeof makeScriptedComplete> }) {
  return startSession(
    {},
    { complete: deps.complete, vault, queue, index: buildIndex([]), bank: BANK },
  );
}

describe('a user turn answers the queue entry that opened it', () => {
  it('marks the drawn entry answered, with an answeredAt that survives the disk', async () => {
    const seeded = queue.add(weakDraft('You wrote of a room you no longer enter. What is in it?'));

    const session = openSession({
      complete: makeScriptedComplete(richTurnResponses('What did the room hold before you left?')),
    });
    expect(session.turns[0]!.text).toBe(seeded.question);
    expect(fromDisk(seeded.id).status).toBe('asked');

    const before = Date.now();
    await userTurn(session, RICH_ANSWER);

    const answered = fromDisk(seeded.id);
    expect(answered.status).toBe('answered');
    expect(answered.answeredAt).toBeTypeOf('string');
    const at = new Date(answered.answeredAt!).getTime();
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('marks a mid-session draw answered too, not only the opener', async () => {
    const seeded = [
      queue.add(weakDraft('What did you stop measuring?')),
      queue.add(weakDraft('What did you start counting instead?')),
    ];
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const session = openSession({
      complete: makeScriptedComplete(richTurnResponses('What does the count buy you?')),
    });
    // Which of the two opens is the draw's business — two entries created in
    // one millisecond tie on `created`. The test names them by what was asked.
    const opener = seeded.find((e) => e.question === session.turns[0]!.text)!;
    const held = seeded.find((e) => e.id !== opener.id)!;

    // 'dunno' pivots past composition into a fresh queue draw (ticket 020).
    await userTurn(session, 'dunno');
    expect(fromDisk(opener.id).status).toBe('answered');
    expect(fromDisk(held.id).status).toBe('asked');
    expect(session.turns.at(-1)!.text).toBe(held.question);

    await userTurn(session, RICH_ANSWER);
    expect(fromDisk(held.id).status).toBe('answered');
    expect(fromDisk(held.id).answeredAt).toBeTypeOf('string');
  });

  it('marks a content-free answer answered — uptake is not a quality judgment', async () => {
    // Grounded on the same predicate the elicitor pivots on, so this case
    // cannot drift into testing a rich answer by accident.
    expect(isContentFree('dunno')).toBe(true);
    const seeded = queue.add(weakDraft('What did the letter say?'));

    const session = openSession({ complete: makeScriptedComplete([]) });
    expect(session.turns[0]!.text).toBe(seeded.question);

    await userTurn(session, 'dunno');

    const answered = fromDisk(seeded.id);
    expect(answered.status).toBe('answered');
    expect(answered.answeredAt).toBeTypeOf('string');
  });

  it('leaves every entry untouched when the opener came from the bank', async () => {
    // Days-horizon entries are never drawn into an exchange, so this one is
    // never served: the session opens on the bank and the queue stays pending.
    const seeded = queue.add(weakDraft('A future one', { horizon: 'days' }));

    const session = openSession({
      complete: makeScriptedComplete(richTurnResponses('What made the decision for you?')),
    });
    expect(session.turns[0]!.text).toBe(BANK[0]!.text);

    await userTurn(session, RICH_ANSWER);

    const untouched = fromDisk(seeded.id);
    expect(untouched.status).toBe('pending');
    expect(untouched.answeredAt).toBeUndefined();
  });

  it('does not mark a skipped question answered — a skip is not an answer', async () => {
    const seeded = queue.add(weakDraft('What are you not saying?'));

    const session = openSession({
      complete: makeScriptedComplete(richTurnResponses('What would you say instead?')),
    });
    expect(session.turns[0]!.text).toBe(seeded.question);

    const replacement = skipQuestion(session);
    expect(replacement.kind).toBe('question');

    await userTurn(session, RICH_ANSWER);

    const skipped = fromDisk(seeded.id);
    expect(skipped.status).toBe('asked');
    expect(skipped.answeredAt).toBeUndefined();
  });

  it('marks exactly one entry per drawn question, not one per user turn', async () => {
    const seeded = queue.add(weakDraft('What changed in the last year?'));

    const session = openSession({
      complete: makeScriptedComplete([
        ...richTurnResponses('What did that cost you?'),
        ...richTurnResponses('Who noticed first?'),
      ]),
    });
    expect(session.turns[0]!.text).toBe(seeded.question);

    await userTurn(session, RICH_ANSWER);
    await userTurn(session, 'It cost me the friendship I thought I had earned, and I felt it.');

    const answered = createQueueStore(root)
      .list()
      .filter((e) => e.status === 'answered');
    expect(answered).toHaveLength(1);
    expect(answered[0]!.id).toBe(seeded.id);
  });
});
