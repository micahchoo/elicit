import type { Complete, RedLight, Snippet } from '../types.js';
import type { GuardVerdict } from '../elicitor/guards.js';
import type { CompactedLadder } from '../sounding/compaction.js';
import type { Pattern, LicensingContext } from '../patterns/types.js';
import { composeFollowUp, redLights } from './composed.js';
import { composeWithPattern } from './compose-pattern.js';
import { decomposeDerived } from '../patterns/decompose.js';

export async function composeRung(
  answer: string,
  complete: Complete,
  guard: (q: string) => GuardVerdict,
  pattern?: Pattern,
): Promise<{ text: string; foothold: string } | null> {
  // Deep pattern path: use composeWithPattern with the given deep pattern
  if (pattern && pattern.tier === 'deep') {
    const asSnippet: Snippet = {
      id: 'rung-answer', version: 1, prose: answer,
      captured: new Date().toISOString(),
      provenance: { question: 'rung', questionForm: 'deliberative', transcript: 'descent' },
    } as unknown as Snippet;

    const ctx: LicensingContext = { availableSnippets: [], isLateSession: true };

    const draft = await composeWithPattern([asSnippet], complete, ctx, undefined, pattern);
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
