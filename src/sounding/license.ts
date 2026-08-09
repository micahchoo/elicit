/**
 * The entry license — the mechanical gate before a Sounding may be offered.
 *
 * A Sounding is offered, never auto-entered, and the offer itself must be
 * licensed, or the agent proposes descents into whatever the person happened
 * to say last. Three mechanical facts decide it: the sitting is late enough,
 * the last three user turns hold one thread, and no offer was already made
 * this sitting. Nothing in this file asks a model anything, and nothing in
 * it reads emotional state.
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
import { contentWordsOf, jaccard, wordsOf } from '../index/lexical.js';
import { SOUNDING_THRESHOLDS } from './thresholds.js';
import { readNumber } from '../wiki/thresholds.js';

export type LicenseReasons = {
  late: boolean;
  sustained: boolean;
  unoffered: boolean;
};

/**
 * The minimum mean adjacent content-word Jaccard over the last three user
 * turns that counts as a sustained thread. Re-derived 2026-08-05 from 957
 * window evaluations across 105 archived sittings (ticket 142):
 *
 *   Content-word Jaccard: p50=0.053  p75=0.081  p90=0.115  p95=0.135
 *
 * The prior value 0.15 sat above p95; only 3.4% of windows cleared it and
 * `late` was simultaneously false every time, producing 0 offers in 216
 * evaluations. 0.10 sits near p85 — a window that tight is rare but a
 * sitting of 8+ turns will find one in the mid-phase.
 *
 * This value bakes in the assumption that real sittings last 5+ turns;
 * 1-exchange sittings will never reach the late window.
 */

/** The sustained-thread bar, from the register (Q-35). Honors the live flag. */
const SUSTAINED = SOUNDING_THRESHOLDS['sounding.sustainedOverlap'];

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
 * How often `word` occurs in `text` — the frequency that names the
 * thread. Counts every token form `wordsOf` produces (no stopword
 * filter): the exact stream the WORD_RE mirror produced, now single-homed
 * on lexical.ts's TOKEN_RE (Wave D F8).
 */
function frequencyIn(text: string, word: string): number {
  let count = 0;
  for (const w of wordsOf(text)) {
    if (w === word) count++;
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
 * The entry license. `licensed` is true only when all three reasons are true;
 * `reasons` is always fully populated, even when `licensed` is false, because
 * the record logs what failed, not just that something did.
 */
export function licenseSounding(
  s: SessionState,
): { licensed: boolean; reasons: LicenseReasons; sustainedValue: number; construct?: string } {
  // Late: the sitting has left its opening phase and is not yet closing.
  // Re-derived 2026-08-05 from 209 sounding-license evaluations across six
  // archive vaults (gate-repair):
  //
  //   Joint (late, sustained): (false,false) 85.6%  (false,true) 5.3%
  //                           (true,false)   8.6%  (true,true)  0.5%
  //
  // At questionCount >= 9, `late` cleared 9.1% of evaluations; `sustained`
  // cleared 5.7%; the joint cleared ONCE (0.5%) — one sounding offered in
  // 209 windows, across 145 sittings. The assumption that real sittings
  // last 5+ turns was never operant at 9. Lowering to 6 makes it so: a
  // sitting at turn 6 is clearly past opening and has enough turns for a
  // three-turn thread. The `sustained` gate at 0.10 remains the quality
  // filter — scattered conversation still cannot fire it.
  //
  // Ticket 135's greeting turn is free (questionCount starts at 0 and the
  // greeting never counts), so every count here runs one lower than
  // pre-135 at the same depth.
  const lateEntry = SOUNDING_THRESHOLDS['sounding.lateQuestionCount'];
  const late =
    lateEntry.live &&
    s.questionCount >= readNumber(lateEntry, 6) &&
    s.phase !== 'closing-door';
  const unoffered = s.soundingOffer === undefined;
  const thread = lastThreeUserTurns(s);
  // A thread needs three turns to be sustained; fewer cannot clear the bar.
  const value = thread.length >= 3 ? meanAdjacentJaccard(thread) : 0;
  const sustained = SUSTAINED.live && value >= readNumber(SUSTAINED, 0.10);
  const licensed = late && sustained && unoffered;
  const construct = constructOf(thread);
  return {
    licensed,
    reasons: { late, sustained, unoffered },
    sustainedValue: value,
    ...(construct ? { construct } : {}),
  };
}
