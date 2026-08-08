import type { Rung, SoundingEnd, SoundingState } from '../types.js';
import { isContentFree } from '../language/thin-answer.js';
import { echoesAny } from '../index/lexical.js';

/**
 * Structural end conditions (Q-46): a descent ends because a counter ran out
 * or because code found the answers echoing — never because a model said so.
 *
 * Pure: no I/O, no `complete`, no `Date.now()`. Checks in order:
 *   1. `'cap'` — the rung counter ran out. Checked first, so a ladder that is
 *      both full and echoing reports the simpler, more checkable reason.
 *   2. `'convergence'` — the pivot heuristic (Q-46) reads the last answer as
 *      content-free; it carries nothing a follow-up could deepen.
 *   3. `'convergence'` — both of the last two answers echo an earlier rung.
 *      Fewer than four rungs means there is nothing to echo yet.
 * Returns `null` to keep going.
 */
export function descentEnd(s: SoundingState): SoundingEnd | null {
  // 1. The counter: a full ladder is a full ladder, whatever else is true.
  if (s.rungs.length >= s.allowance) return 'cap';

  const last = s.rungs.at(-1);
  if (!last) return null; // contract: at least one rung; keep going defensively

  // 2. The pivot heuristic — already the elicitor's content-free gate.
  if (isContentFree(last.answer)) return 'convergence';

  // 3. The echo check: both of the last two answers must hit the earlier
  //    ladder (rungs[0 .. n-3]). One echo alone is not convergence.
  if (s.rungs.length < 4) return null;

  const earlier = s.rungs.slice(0, s.rungs.length - 2);
  const lastTwo = s.rungs.slice(-2);
  // echoesAny shares the lexical tokenizer/trigram keying with buildIndex —
  // a boolean check, no ranked index, no Snippet-shaped inputs.
  if (!echoesAny(lastTwo[0]!.answer, earlier.map((r) => r.answer))) return null;
  if (!echoesAny(lastTwo[1]!.answer, earlier.map((r) => r.answer))) return null;
  return 'convergence';
}
