import type { Complete, RedLight } from '../types.js';
import type { GuardVerdict } from '../elicitor/guards.js';
import { composeFollowUp, redLights } from './composed.js';

/**
 * Compose the next rung of a descent: find the red lights in the answer,
 * build a follow-up question that quotes the flagged phrase, and guard it.
 *
 * Writes no prompt. Sequence per light: `redLights(answer, complete)`, then
 * `composeFollowUp(answer, light, complete)`, then `guard(question)`. Returns
 * the FIRST survivor with `foothold: light.phrase`. `null` means no light
 * produced a guarded, quoted question.
 *
 * Not private to the elicitor because three callers need it: the elicitor's
 * answer path, T8's accept route (which composes rung 0 from the licensing
 * answer), and T12's resume path.
 *
 * Behavioral invariant: the returned `foothold` is always a verbatim substring
 * of the `answer` argument — `redLights` has already checked it (composed.ts).
 * That is what makes `addRung`'s backwards check pass one call later.
 */
export async function composeRung(
  answer: string,
  complete: Complete,
  guard: (q: string) => GuardVerdict,
): Promise<{ text: string; foothold: string } | null> {
  const lights: RedLight[] = await redLights(answer, complete);
  for (const light of lights) {
    const question = await composeFollowUp(answer, light, complete);
    if (!question) continue;
    if (guard(question) !== 'ok') continue;
    return { text: question, foothold: light.phrase };
  }
  return null;
}
