import type { Complete, RedLight } from '../types.js';
import type { GuardVerdict } from '../elicitor/guards.js';
import type { CompactedLadder } from '../sounding/compaction.js';
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
/**
 * Compose the resumed rung of a parked descent (plan Task 12): the same
 * operation as `composeRung` with a compacted ladder for context.
 *
 * The foothold MUST come from `c.verbatim.at(-1)!.answer` — the last kept
 * answer — because `addRung` validates the next turn's foothold against
 * `rungs.at(-1)!.answer` alone. The summary line and any earlier verbatim
 * rung are context ONLY, never a foothold source.
 *
 * Design decision (T12, recorded in the batch report): `composeRung`'s
 * signature and the redLights/composeFollowUp prompts in composed.ts are
 * fixed, so the context is appended to the last kept answer as a marked
 * background block before delegating. `redLights` validates phrases against
 * the composite (background quoting would pass composition), but `addRung`
 * validates against the last answer ALONE — any context-quoting drift fails
 * loudly one turn later instead of silently chaining from the wrong words.
 */
export async function composeFromCompacted(
  c: CompactedLadder,
  complete: Complete,
  guard: (q: string) => GuardVerdict,
): Promise<{ text: string; foothold: string } | null> {
  const last = c.verbatim.at(-1)!.answer;
  const background: string[] = [];
  if (c.summarized) {
    background.push(`the earlier rungs come down to: ${c.summarized.line}`);
  }
  for (const r of c.verbatim.slice(0, -1)) {
    background.push(`rung "${r.question}" drew: ${r.answer}`);
  }
  const composite =
    background.length > 0 ? `${last}\n\n(earlier in this descent: ${background.join(' ')})` : last;
  return composeRung(composite, complete, guard);
}
