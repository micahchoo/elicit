import type { Rung, Snippet, SoundingEnd, SoundingState } from '../types.js';
import { isContentFree } from '../elicitor/answer-shape.js';
import { buildIndex, resonate } from '../index/lexical.js';

/**
 * Adapter: rung answers are NOT Snippets — they have not passed admissibility,
 * they are not evidence, and none of them is ever written to vault/snippets/.
 * buildIndex reads only snippet.prose/id/version (lexical.ts:174), so a
 * minimal construction suffices; `captured`/`provenance` are not read and no
 * real provenance exists for words that were never admitted, which is what the
 * narrow cast marks. The `rung:` id prefix makes a stray one obvious in a
 * debugger — if these values are ever found escaping this module, that is a
 * bug, not a feature.
 */
function rungsAsIndexInput(rungs: Rung[]): Snippet[] {
  return rungs.map((rung, i) => ({
    id: `rung:${i}`,
    version: 1,
    prose: rung.answer,
  }) as Snippet);
}

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
  const index = buildIndex(rungsAsIndexInput(earlier));
  for (const rung of s.rungs.slice(-2)) {
    if (resonate(index, rung.answer).length === 0) return null;
  }
  return 'convergence';
}
