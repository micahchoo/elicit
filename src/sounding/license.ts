/**
 * The entry license — the mechanical gate before a Sounding may be offered.
 *
 * A Sounding is offered, never auto-entered, and the offer itself must be
 * licensed, or the agent proposes descents into whatever the person happened
 * to say last. Four mechanical facts decide it: the sitting is late enough,
 * the mode is not low-energy, the last three user turns hold one thread, and
 * no offer was already made this sitting. Nothing in this file asks a model
 * anything, and nothing in it reads emotional state.
 *
 * This mechanism ships LIVE, and Q-62 is why. Q-62 amends Q-35 a second time:
 * a mechanism whose only power is to OFFER — one proposal the person declines
 * in a word, with nothing done on decline — ships live from day one and logs
 * every evaluation. The dividing line is the consequence on silence, and here
 * silence means no descent happens, so the license is an offer. There is no
 * shadow flag, no ELICIT_* env gate, and no "would have offered" branch in
 * this file.
 */

import type { SessionState, Turn } from '../types.js';
import { contentWordsOf, jaccard } from '../index/lexical.js';

export type LicenseReasons = {
  late: boolean;
  energy: boolean;
  sustained: boolean;
  unoffered: boolean;
};

/**
 * The one tunable number in this file — the minimum mean adjacent Jaccard
 * over the last three user turns that counts as a sustained thread. Q-62
 * makes the license live from day one (offer-shaped, logs every evaluation —
 * no shadow flag, no env gate, no "would have offered" branch), and the
 * sounding-license record emitted on every evaluation is what will
 * eventually re-tune this value with evidence behind it.
 */
export const SUSTAINED_THRESHOLD = 0.15;

/** The last three user turns, newest last — the thread the license reads. */
function lastThreeUserTurns(s: SessionState): Turn[] {
  return s.turns.filter((t) => t.role === 'user').slice(-3);
}

/** Mean Jaccard over adjacent pairs — how far the turns stay on one thread. */
function meanAdjacentJaccard(turns: Turn[]): number {
  if (turns.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < turns.length - 1; i++) {
    sum += jaccard(contentWordsOf(turns[i]!.text), contentWordsOf(turns[i + 1]!.text));
  }
  return sum / (turns.length - 1);
}

/**
 * Mirrors src/index/lexical.ts's TOKEN_RE word form. The tokenizer is
 * private; this is the smallest adapter that can count a word's occurrences
 * in a text with exactly the token forms contentWordsOf sees.
 */
const WORD_RE = /[a-zA-Z0-9]+(?:[''-][a-zA-Z0-9]+)*/g;

function frequencyIn(text: string, word: string): number {
  let count = 0;
  const matches = text.toLowerCase().match(WORD_RE);
  if (matches) {
    for (const m of matches) {
      if (m === word) count++;
    }
  }
  return count;
}

/**
 * The thread's name: the content word shared by all three turns with the
 * highest frequency inside them (ties break to the alphabetically first).
 * Used only as the descent's label — it is NOT a foothold and never reaches
 * a prompt.
 */
function constructOf(turns: Turn[]): string | undefined {
  if (turns.length < 3) return undefined;
  const sets = turns.map((t) => contentWordsOf(t.text));
  const shared = new Set<string>(sets[0]!);
  for (let i = 1; i < sets.length; i++) {
    for (const word of [...shared]) {
      if (!sets[i]!.has(word)) shared.delete(word);
    }
  }
  if (shared.size === 0) return undefined;
  let best: string | undefined;
  let bestFrequency = -1;
  for (const word of shared) {
    const frequency = turns.reduce((total, t) => total + frequencyIn(t.text, word), 0);
    if (
      frequency > bestFrequency ||
      (frequency === bestFrequency && (best === undefined || word < best))
    ) {
      best = word;
      bestFrequency = frequency;
    }
  }
  return best;
}

/**
 * The entry license. `licensed` is true only when all four reasons are true;
 * `reasons` is always fully populated, even when `licensed` is false, because
 * the record logs what failed, not just that something did.
 */
export function licenseSounding(
  s: SessionState,
): { licensed: boolean; reasons: LicenseReasons; construct?: string } {
  // The elicitor's own budget formula: a sitting runs 10-20 questions.
  const budget = Math.min(20, Math.max(10, s.mode.minutes));
  // Late: past the midpoint, and still before the close. Past `budget - 2`
  // the close has already begun (elicitor.ts:308-310), and a descent offered
  // there would eat the two close moves Q-47 reserves.
  const late = s.questionCount >= Math.ceil(budget / 2) && s.questionCount < budget - 2;
  const energy = s.mode.energy !== 'low';
  const unoffered = s.soundingOffer === undefined;
  const thread = lastThreeUserTurns(s);
  // A thread needs three turns to be sustained; fewer cannot clear the bar.
  const sustained = thread.length >= 3 && meanAdjacentJaccard(thread) >= SUSTAINED_THRESHOLD;
  const licensed = late && energy && sustained && unoffered;
  const construct = constructOf(thread);
  return {
    licensed,
    reasons: { late, energy, sustained, unoffered },
    ...(construct ? { construct } : {}),
  };
}
