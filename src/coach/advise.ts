/**
 * The advice mint — ticket 090 T7, the Coach's ONE model call. The prompt
 * input is built from `AdvicePromptInput`, a type with no pointer field, so
 * the model cannot be handed an artifact (Q-78 — by construction, not
 * discipline). The output passes `adviceGuard` or nothing is written, and
 * the note replaces its predecessor by store construction (Q-77: one unread
 * note, replaced not stacked).
 *
 * Ticket 092 amends the compose prompt only: the offer's 2-3 acts
 * differentiate along the know-what / know-how / know-why axis — the
 * decomposition is scaffolding the model thinks with, regenerated per
 * offer, never stored, never displayed, never a coverage measure.
 *
 * No relevant claims → withheld `no-claims` with NO model call at all: a
 * set of uncitable options is never composed and discarded, it is never
 * requested (Q-74 — the empty-corpus quiet path, 090's data note).
 */

import {
 adviceGuard,
 type AdviceNote,
 type AdvicePromptInput,
 type CoachLicenseEvent,
} from './contract.js';
import { relevantClaims, type CoachFacts } from './license.js';
import type { CoachStore } from './store.js';
import type { Complete } from '../types.js';

export type AdviceOutcome =
 | { outcome: 'minted'; note: AdviceNote; replaced: boolean }
 /**
  * 'no-claims' — nothing relevant to cite; 'guard:<reason>' — the model's
  * option set failed the gate; 'parse-failed' — the response was not JSON;
  * 'call-failed' — the model call itself threw (the route logs it; the
  * note stays untouched).
  */
 | { outcome: 'withheld'; reason: string };

/**
 * The ONLY prompt assembly in the slice. Takes `AdvicePromptInput` fields
 * only: claims from `relevantClaims`, quest acts, return prose (the
 * person's words), artifact NAMES. The pointer cannot be passed because no
 * parameter accepts it. Null = the Direction is missing, its lens is off,
 * or nothing relevant exists to cite.
 */
export function buildAdviceInput(facts: CoachFacts, slug: string): AdvicePromptInput | null {
 const direction = facts.directions.find((d) => d.slug === slug);
 if (!direction || !direction.coached) return null;
 const claims = relevantClaims(facts, direction);
 if (claims.length === 0) return null;

 const quests = facts.quests
  .filter((q) => q.direction === slug)
  .map((q) => {
   const returnSessions = new Set(
    facts.sittingTags.filter((t) => t.quest === q.id).map((t) => t.session),
   );
   const returns = facts.snippets
    .filter((s) => returnSessions.has(s.provenance.session))
    .map((s) => s.prose);
   return { act: q.act, returns };
  });
 const artifactNames = facts.artifacts.filter((a) => a.direction === slug).map((a) => a.name);

 return {
  directionName: direction.name,
  claims: claims.map((c) => ({ id: c.id, body: c.body, range: c.range })),
  quests,
  artifactNames,
 };
}

/** Strips markdown code fences from LLM output, keeping the inner content — the harvest path's posture. */
function stripFences(raw: string): string {
 let s = raw.trim();
 s = s.replace(/^```(?:json)?\s*\n?/i, '');
 s = s.replace(/\n?```\s*$/, '');
 return s.trim();
}

/**
 * The advice system prompt. The prompt asks for 2–3 alternative concrete
 * acts as JSON with claim-id cites; the GUARD, not the prompt, enforces the
 * shape (Q-36: freedom in generation, rigidity in validation). The acts
 * differentiate along the know-what / know-how / know-why axis (092): one
 * act per branch, never shuffles of one, a know-why probe that asks up for
 * the person's own philosophy or theory (never teaching down), and a genre
 * act offered as "try the <genre> way". It never names absence or pace
 * (Q-24: dormancy is signal, never named), and the input type keeps
 * artifact pointers out of reach entirely (Q-78).
 */
const ADVICE_SYSTEM =
 'You are a clerk for Elicit, composing an advice note for one page of a ' +
 'person\'s notebook. Offer 2 or 3 ALTERNATIVE concrete acts the person could ' +
 'take next on their direction — never a single prescribed next step, never ' +
 'advice about what they have not done or how fast they are going. ' +
 'Differentiate the acts along the branches of knowing, one act per branch: ' +
 'a vocabulary or terminology act (know-what), a procedure or practice act ' +
 '(know-how), or a know-why probe — never two acts from the same branch, ' +
 'never shuffles of one. A know-why probe is a QUESTION, not a lesson: it ' +
 'asks for the person\'s OWN philosophy or theory of the practice, in their ' +
 'own words — asking up, never teaching down. One act may be offered as ' +
 '"try the <genre> way" — doing the practice in a distinct genre, whose ' +
 'return (what fit, what chafed) is the person\'s to give. Each act must ' +
 'cite the claim ids that make it relevant, from the provided list. ' +
 'Artifacts may be mentioned only by the name the person gave them. ' +
 'Respond with JSON only: {"options": [{"text": "...", "cites": ["claimId"]}]}.';

function buildPrompt(input: AdvicePromptInput): string {
 const claimsBlock = input.claims.map((c) => `- [${c.id}] ${c.body} (${c.range})`).join('\n');
 const questsBlock =
  input.quests.length === 0
   ? '- none yet'
   : input.quests
    .map((q) => {
     const returns = q.returns.length === 0 ? '(no return yet)' : q.returns.map((r) => `  "…${r}"`).join('\n');
     return `- act: ${q.act}\n${returns}`;
    })
    .join('\n');
 const artifactsBlock =
  input.artifactNames.length === 0 ? '- none yet' : input.artifactNames.map((n) => `- ${n}`).join('\n');
 return [
  `Direction: ${input.directionName}`,
  '',
  'Claims that make acts relevant:',
  claimsBlock,
  '',
  'Quests and their returns (the person\'s own words):',
  questsBlock,
  '',
  'Artifacts, by the name the person gave them:',
  artifactsBlock,
  '',
  'Branches of knowing — one act per branch, the axis of the offer:',
  '- know-what — a vocabulary or terminology act: naming and distinguishing the words of the practice.',
  '- know-how — a procedure or practice act: doing the practice concretely.',
  '- know-why — a probe: one question asking for the person\'s own philosophy or theory of the practice, in their own words.',
 ].join('\n');
}

export async function runCoachAdvice(deps: {
 store: CoachStore;
 facts: CoachFacts;
 complete: Complete;
 slug: string;
 license: CoachLicenseEvent;
}): Promise<AdviceOutcome> {
 const input = buildAdviceInput(deps.facts, deps.slug);
 if (!input) return { outcome: 'withheld', reason: 'no-claims' };

 const direction = deps.store.getDirection(deps.slug);
 const declined = direction?.declinedOptions ?? [];
 const citable = new Set(input.claims.map((c) => c.id));

 let raw: string;
 try {
  raw = await deps.complete(ADVICE_SYSTEM, [{ role: 'user', text: buildPrompt(input), at: new Date().toISOString() }], {
   temperature: 0.7,
  });
 } catch {
  return { outcome: 'withheld', reason: 'call-failed' };
 }

 let parsed: unknown;
 try {
  parsed = JSON.parse(stripFences(raw));
 } catch {
  return { outcome: 'withheld', reason: 'parse-failed' };
 }

 const guarded = adviceGuard(parsed, { declined, claimExists: (id) => citable.has(id) });
 if (!guarded.ok) return { outcome: 'withheld', reason: `guard:${guarded.reason}` };

 const note: AdviceNote = {
  direction: deps.slug,
  mintedAt: new Date().toISOString(),
  license: deps.license,
  options: guarded.options,
 };
 const replaced = deps.store.readAdvice(deps.slug) !== null;
 deps.store.writeAdvice(note);
 return { outcome: 'minted', note, replaced };
}
