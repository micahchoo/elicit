/**
 * The clerk's shared composition machinery — the one home for the primitives
 * every compose path in the tree had copied by hand (ticket 082's convergence
 * debt): fence stripping, the framing rule, the rejection→correction table,
 * and the two-attempts-then-silence retry skeleton.
 *
 * `guardComposed` (emit-form) is deliberately NOT re-homed here: it is the
 * round-two gate, already single-homed. This module composes WITH it.
 */

import { guardComposed } from '../language/emit-form.js';

/** Why a composed question was refused. Each reason drives its own correction. */
export type Rejection =
 | 'no-quote'
 | 'unframed-quote'
 | 'degenerate'
 | 'not-interrogative'
 | 'first-person'
 | 'repeats-original'
 | 'summary-echo'
 | 'names-the-tension';

// ---------------------------------------------------------------------------
// Fence stripping
// ---------------------------------------------------------------------------

/**
 * Strips markdown code fences from LLM output, keeping the inner content.
 *
 * The strict form (the default) opens only a bare ``` or ```json fence,
 * case-insensitively, and tolerates trailing whitespace after the closing
 * fence. `loose` is the lineage-mirror copy's semantics: any fence info
 * string (```ts, ```python, …) is stripped and both fences must sit flush
 * at the ends of the text.
 */
export function stripFences(text: string, opts?: { loose?: boolean }): string {
 let s = text.trim();
 if (opts?.loose) {
  s = s.replace(/^```[^\n]*\n?|\n?```$/g, '');
 } else {
  s = s.replace(/^```(?:json)?\s*\n?/i, '');
  s = s.replace(/\n?```\s*$/, '');
 }
 return s.trim();
}

// ---------------------------------------------------------------------------
// The framing rule
// ---------------------------------------------------------------------------

/**
 * The one shape every composed question takes (040).
 *
 * Splicing the user's words into the middle of the agent's clause produced
 * "When did you last experience the kind of resonance that I thought that I
 * long lost?" — syntax bent around the fragment until it meant nothing, and no
 * way for the reader to tell whose "I" that was. Framing separates the two
 * voices on the page: the quote is untouched and visibly theirs, the question
 * is the agent's own.
 *
 * Q-36 holds either side of the quotation mark. Inside it, the model has no
 * freedom at all — the words are the user's, character for character. Outside
 * it, the model has full freedom over what it asks; the example below fixes
 * the shape, never the wording.
 */
export const FRAMING_RULE = `HOW TO USE THEIR WORDS — frame the quote, never splice it:
Put the speaker's exact words inside quotation marks. Then ask your question after them, in your own words.
Shape: You wrote: "<their exact words>." <your question>?
The shape is fixed. The question is yours — write your own, do not copy this example.
Never weave their words into the grammar of your own sentence.
Keep the quoted words exactly as they wrote them, first person and all. Outside the quotation marks, address the speaker as "you".`;

// ---------------------------------------------------------------------------
// The rejection→correction table
// ---------------------------------------------------------------------------

/**
 * Build the corrective suffix for the single retry. `quoteRule` is the
 * path-specific verbatim requirement, repeated in every correction so the
 * retry never trades one invariant for another.
 *
 * `variant` picks the wording of the 'repeats-original' correction: the
 * composition wording (a snippet's eliciting question must not be repeated)
 * or the re-measure wording (a fresh measurement must not re-ask what
 * produced the claim). Both wordings are canonical here; each site keeps the
 * one it always shipped.
 */
export function corrective(
 rejection: Rejection,
 quoteRule: string,
 variant: 'composition' | 'remeasure' = 'composition',
): string {
 if (rejection === 'summary-echo') {
  return 'Your question must NOT repeat or closely paraphrase the history summary lines shown above. Use the snippet for your quote, not the summaries.';
 }
 switch (rejection) {
  case 'no-quote':
   return `CRITICAL: Your previous response was rejected because it did not quote the speaker verbatim. ${quoteRule}`;
  case 'unframed-quote':
   return `CRITICAL: Your previous response was rejected because it wove the speaker's words into your own sentence. Put their words inside quotation marks. Then ask your question after them, in your own words. ${quoteRule}`;
  case 'degenerate':
   return `CRITICAL: Your previous response was rejected because it only handed the speaker their own words back. ${quoteRule} Then ask your own question around that quote.`;
  case 'not-interrogative':
   return `CRITICAL: Your previous response was rejected because it was not a question. Return ONE question, addressed to the speaker, ending in a question mark. ${quoteRule}`;
  case 'first-person':
   return `CRITICAL: Your previous response was rejected because it spoke in the first person outside the quote. Keep the quoted words exactly as they are; everywhere else address the speaker as "you" — never "I", "my", or "me". ${quoteRule}`;
  case 'repeats-original':
   return variant === 'remeasure'
    ? `CRITICAL: Your previous response was rejected because it re-asked a question they have already answered. Ask about the same thing from a completely different angle — a specific occasion, a comparison, a case where it did not hold. ${quoteRule}`
    : `CRITICAL: Your previous response was rejected because it repeated the question that first elicited the snippet. Ask something different. ${quoteRule}`;
  case 'names-the-tension':
   return `CRITICAL: Your previous response was rejected because it repeated a summary written about the speaker back at them. Ask only about their own words. ${quoteRule}`;
 }
}

// ---------------------------------------------------------------------------
// The two-attempt retry skeleton
// ---------------------------------------------------------------------------

/** One gate verdict: the accepted question (and its build) or the refusal. */
export type ComposeGateResult<T> =
 | { ok: true; question: string; value: T }
 | { ok: false; rejection: Rejection };

/**
 * The two-attempts-then-silence skeleton every compose path in the tree ran
 * by hand — attempt → gate → guardComposed → corrective retry → gate →
 * guardComposed → null. `send` performs the model call (each path has its own
 * prompt/message shape), `gate` validates the draft in hand (and MAY warn for
 * path-specific refusals; `phase` distinguishes the attempt from the retry),
 * `retryPrompt` appends the corrective suffix.
 *
 * The warn message prefixes are the sink contract: `Composed: <site> …` is
 * what warnReject's site regex parses, so `site` is the path label exactly as
 * the per-path messages always named it.
 */
export async function composeWithRetry<T>(
 site: string,
 send: (prompt: string) => Promise<string>,
 prompt: string,
 gate: (question: string, phase: 'first' | 'retry') => ComposeGateResult<T>,
 retryPrompt: (rejection: Rejection) => string,
 warn: (message: string) => void,
): Promise<T | null> {
 let question = stripFences(await send(prompt)).trim();
 let attempt = gate(question, 'first');
 if (attempt.ok) {
  if (!guardComposed(attempt.question, { asked: [] }, `Composed: ${site} rejected`, warn).ok) return null;
  return attempt.value;
 }

 // One retry, corrected for what failed — the same discipline every compose
 // path in the tree runs. Two attempts, then silence: a third would spend a
 // clerk call to hear the same refusal.
 warn(`Composed: ${site} rejected (${attempt.rejection}), retrying`);
 question = stripFences(await send(retryPrompt(attempt.rejection))).trim();
 const retry = gate(question, 'retry');
 if (retry.ok) {
  if (!guardComposed(retry.question, { asked: [] }, `Composed: ${site} retry rejected`, warn).ok) return null;
  return retry.value;
 }

 warn(`Composed: ${site} retry also rejected (${retry.rejection}) — returning null`);
 return null;
}
