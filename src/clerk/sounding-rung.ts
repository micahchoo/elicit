import type { Complete, RedLight,  } from '../types.js';
import type { GuardVerdict } from '../language/guards.js';
import type { CompactedLadder } from '../sounding/compaction.js';
import type { Pattern, LicensingContext } from '../patterns/types.js';
import { composeFollowUp, redLights } from './composed.js';
import { composeWithPattern } from './compose-pattern.js';
import { decomposeDerived } from '../patterns/decompose.js';

/**
 * Compose the next rung of a descent: find the red lights in the answer,
 * build a follow-up question that quotes the flagged phrase, and guard it.
 *
 * Writes no prompt. Sequence per light: `redLights(answer, complete)`, then
 * `composeFollowUp(answer, light, complete)`, then `guard(question)`. Returns
 * the FIRST survivor with `foothold: light.phrase`. `null` means no light
 * produced a guarded, quoted question. A deep `pattern` (Q-82, consent-gated
 * by the caller) routes through `composeWithPattern` instead; the default
 * path is byte-for-byte the pre-111 behavior.
 *
 * Not private to the elicitor because three callers need it: the elicitor's
 * answer path, T8's accept route (which composes rung 0 from the licensing
 * answer), and T12's resume path.
 *
 * Behavioral invariant: the returned `foothold` is always a verbatim substring
 * of the `answer` argument — `redLights` has already checked it (composed.ts),
 * and the pattern path re-derives it via `decomposeDerived`. That is what
 * makes `addRung`'s backwards check pass one call later.
 */
export async function composeRung(
  answer: string,
  complete: Complete,
  guard: (q: string) => GuardVerdict,
  pattern?: Pattern,
): Promise<{ text: string; foothold: string } | null> {
  // Deep pattern path: use composeWithPattern with the given deep pattern
  if (pattern && pattern.tier === 'deep') {
    // A rung answer is bare prose, not a Snippet — composeWithPattern takes
    // the structural PatternSource shape now, so nothing is fabricated.
    const ctx: LicensingContext = { availableSnippets: [], isLateSession: true };

    const draft = await composeWithPattern(
      [{ id: 'rung-answer', version: 1, prose: answer, captured: new Date().toISOString() }],
      complete,
      ctx,
      undefined,
      pattern,
    );
    if (!draft) return null;

    const question = draft.question;
    if (guard(question) !== 'ok') return null;

    // Extract foothold from the quoted span
    const sourceRefs = [{ id: 'rung-answer', version: 1, prose: answer }];
    const result = decomposeDerived(question, pattern, sourceRefs);
    if (!result.ok) return null;
    const foothold = result.quotedSpans[0]?.text;
    if (!foothold) return null;
    return { text: question, foothold };
  }

  // Original path: red lights → composed follow-up
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
 * The deep-pattern path skips the composite and works from the last answer
 * directly, which satisfies the same foothold contract by construction.
 */
export async function composeFromCompacted(
  c: CompactedLadder,
  complete: Complete,
  guard: (q: string) => GuardVerdict,
  pattern?: Pattern,
): Promise<{ text: string; foothold: string } | null> {
  const last = c.verbatim.at(-1)!.answer;

  // Deep pattern path: use the last answer directly with composeWithPattern
  if (pattern && pattern.tier === 'deep') {
    return composeRung(last, complete, guard, pattern);
  }

  // Original path with background context
  const background: string[] = [];
  if (c.summarized) {
    background.push(`the earlier rungs come down to: ${c.summarized.line}`);
  }
  for (const r of c.verbatim.slice(0, -1)) {
    background.push(`rung "${r.question}" drew: ${r.answer}`);
  }
  const composite =
    background.length > 0 ? `${last}\n\n(earlier in this descent: ${background.join(' ')})` : last;
  return composeRung(composite, complete, guard, pattern);
}
