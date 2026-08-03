/**
 * The entry license (soundings slice, Task 2).
 *
 * A Sounding is offered, never auto-entered, and the offer itself must pass
 * four mechanical checks — late enough in the sitting, an energetic mode,
 * three user turns on one thread, no offer already made this sitting.
 * Nothing here involves a model.
 */

import { describe, expect, test } from 'vitest';
import type { QueueStore, SessionState, Turn, Vault } from '../src/types.js';
import { licenseSounding } from '../src/sounding/license.js';
import { buildIndex } from '../src/index/lexical.js';
import { makeScriptedComplete } from './fakes.js';

/**
 * A full SessionState with the license's inputs set by hand. The license
 * reads turns, questionCount, mode and soundingOffer — nothing else — but
 * the helper still builds every field the type demands, so the fixture
 * cannot silently drift out of the real shape.
 */
function sitting(opts: {
  questionCount: number;
  minutes: number;
  energy: 'low' | 'medium' | 'high';
  userTurns: string[];
  soundingOffer?: 'offered' | 'declined' | 'entered';
}): SessionState {
  const { questionCount, minutes, energy, userTurns, soundingOffer } = opts;
  const turns: Turn[] = [];
  userTurns.forEach((text, i) => {
    turns.push({
      role: 'agent',
      text: `What would you say about turn ${i + 1}?`,
      at: `2026-08-02T10:0${i}:00.000Z`,
    });
    turns.push({ role: 'user', text, at: `2026-08-02T10:0${i}:30.000Z` });
  });
  return {
    id: `sitting-${questionCount}`,
    mode: { minutes, energy },
    protocol: 'cdm',
    deps: {
      complete: makeScriptedComplete([]),
      vault: {} as Vault,
      queue: {} as QueueStore,
      index: buildIndex([]),
    },
    turns,
    questionCount,
    phase: 'mid',
    ...(soundingOffer ? { soundingOffer } : {}),
  };
}

/** Three user turns that stay on one thread — the pull, being seen, the work. */
function threeOnOneThread(): string[] {
  return [
    'The pull is real, the pull to do the work',
    'The pull to be seen, and the pull of the work',
    'The work and the pull, always the pull',
  ];
}

describe('the entry license', () => {
  test('an early sitting is not licensed, however good the thread', () => {
    const s = sitting({ questionCount: 2, minutes: 20, energy: 'high', userTurns: threeOnOneThread() });
    expect(licenseSounding(s).licensed).toBe(false);
    expect(licenseSounding(s).reasons.late).toBe(false);
  });

  test('a sitting already in its close is not licensed either', () => {
    // budget 20, close begins at 18 — an offer here would eat the two close moves (Q-47)
    const s = sitting({ questionCount: 18, minutes: 20, energy: 'high', userTurns: threeOnOneThread() });
    expect(licenseSounding(s).reasons.late).toBe(false);
  });

  test('a low-energy mode is not licensed', () => {
    const s = sitting({ questionCount: 12, minutes: 20, energy: 'low', userTurns: threeOnOneThread() });
    expect(licenseSounding(s).reasons.energy).toBe(false);
  });

  test('three turns that share no vocabulary are not a sustained thread', () => {
    const s = sitting({
      questionCount: 12,
      minutes: 20,
      energy: 'high',
      userTurns: ['I cycle to work', 'My sister called', 'Rain again'],
    });
    expect(licenseSounding(s).reasons.sustained).toBe(false);
  });

  test('late, energetic, three turns on one thread, never offered — licensed', () => {
    const s = sitting({ questionCount: 12, minutes: 20, energy: 'high', userTurns: threeOnOneThread() });
    const v = licenseSounding(s);
    expect(v.licensed).toBe(true);
    expect(v.construct).toBeTruthy();
  });

  test('a decline is never re-licensed in the same sitting', () => {
    const s = sitting({ questionCount: 12, minutes: 20, energy: 'high', userTurns: threeOnOneThread(), soundingOffer: 'declined' });
    expect(licenseSounding(s).licensed).toBe(false);
    expect(licenseSounding(s).reasons.unoffered).toBe(false);
  });

  test('an accepted offer is not re-licensed either', () => {
    const s = sitting({ questionCount: 12, minutes: 20, energy: 'high', userTurns: threeOnOneThread(), soundingOffer: 'entered' });
    expect(licenseSounding(s).licensed).toBe(false);
  });
});
