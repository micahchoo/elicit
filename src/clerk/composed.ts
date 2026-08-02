import type {
 Complete,
 Turn,
 RedLight,
 ResonanceHit,
 Snippet,
 Reading,
 QueueDraft,
 QueueEntry,
 QuestionForm,
} from '../types.js';
import {
 isInterrogative,
 hasFirstPersonOutsideQuote,
 quotesFragmentSetOff,
 setOffSpans,
} from '../elicitor/guards.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strips markdown code fences from LLM output, keeping the inner content. */
function stripFences(raw: string): string {
 let s = raw.trim();
 s = s.replace(/^```(?:json)?\s*\n?/i, '');
 s = s.replace(/\n?```\s*$/, '');
 return s.trim();
}

/**
 * Find the longest substring of `source` that appears verbatim in `question`.
 * Returns null if no match of at least `minWords` content words is found.
 * Mirrors the harvester's substring validation posture (Q-1 → Q-12).
 */
function findQuotedFragment(
 source: string,
 question: string,
 minWords = 3,
): string | null {
 let best = '';
 for (let i = 0; i < source.length; i++) {
  for (let j = i + best.length + 1; j <= source.length; j++) {
   const candidate = source.slice(i, j);
   if (question.includes(candidate)) {
    best = candidate;
   } else {
    break; // longer substrings from this start won't match either
   }
  }
 }
 if (best.length === 0) return null;
 const wordCount = best.trim().split(/\s+/).length;
 if (wordCount < minWords) return null;
 return best;
}

/**
 * The longest run of `source` that the question quotes AND sets off (040).
 *
 * Searched span by span rather than over the whole question, so an incidental
 * unmarked match cannot outrank the fragment the model actually framed.
 */
function findSetOffFragment(
 question: string,
 source: string,
 minWords = 3,
): string | null {
 let best: string | null = null;
 for (const span of setOffSpans(question)) {
  const inner = question.slice(span.start, span.end);
  const candidate = findQuotedFragment(source, inner, minWords);
  if (candidate && (!best || candidate.length > best.length)) best = candidate;
 }
 return best;
}

/**
 * Q-12 tightening: reject a composed question that does not strictly extend the
 * quoted fragment. Returns true if the question is degenerate — too close to
 * the source material to count as a genuine composition.
 */
function isDegenerateComposition(
 question: string,
 quotedFragment: string,
 userTurnFull: string,
): boolean {
 const q = question.trim();
 const f = quotedFragment.trim();
 const u = userTurnFull.trim();

 // Equals the fragment verbatim
 if (q === f) return true;
 // Equals the user's whole turn
 if (q === u) return true;

 // Adds fewer than 3 content words around the quote
 // Strip the fragment from the question; count remaining content words
 const remainder = q.replace(
  new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
  '',
 ).trim();
 const contentWords = remainder
  .split(/\s+/)
  .filter((w) => w.length > 0 && /^[a-z]/i.test(w));
 if (contentWords.length < 3) return true;

 return false;
}

// ---------------------------------------------------------------------------
// The composed-question gate
// ---------------------------------------------------------------------------

/** Why a composed question was refused. Each reason drives its own retry. */
type Rejection =
 | 'no-quote'
 | 'unframed-quote'
 | 'degenerate'
 | 'not-interrogative'
 | 'first-person'
 | 'repeats-original';

/**
 * Checks that apply once a verbatim fragment is in hand.
 *
 * Quoting is checked first and never weakened (Q-1/Q-12); these run after,
 * because "contains a quote" was the ONLY thing any compose path asked, and a
 * raw echo of the source satisfies it (eval 2026-08-02 #3).
 *
 * Framing runs before person agreement, and not by accident: an unmarked
 * splice is what let a first-person fragment pass as the agent's own words
 * (040). Reject the shape and the person question does not arise.
 */
function checkAfterQuote(question: string, fragment: string): Rejection | null {
 if (!quotesFragmentSetOff(question, fragment)) return 'unframed-quote';
 if (!isInterrogative(question, fragment)) return 'not-interrogative';
 if (hasFirstPersonOutsideQuote(question, fragment)) return 'first-person';
 return null;
}

/** Gate for a question built around a KNOWN phrase (follow-up, juxtaposition). */
function checkAroundPhrase(
 question: string,
 phrase: string,
 turnText: string,
): Rejection | null {
 if (!question || !question.includes(phrase)) return 'no-quote';
 if (isDegenerateComposition(question, phrase, turnText)) return 'degenerate';
 return checkAfterQuote(question, phrase);
}

type QuoteResult =
 | { ok: true; fragment: string }
 | { ok: false; rejection: Rejection };

/** Gate for a question that must quote SOMEWHERE in `source` (opener, still-true, expedition). */
function checkQuotesSource(question: string, source: string): QuoteResult {
 const longest = findQuotedFragment(source, question);
 const fragment =
  longest && quotesFragmentSetOff(question, longest)
   ? longest
   : findSetOffFragment(question, source);

 if (!fragment) {
  return { ok: false, rejection: longest ? 'unframed-quote' : 'no-quote' };
 }

 const rejection = checkAfterQuote(question, fragment);
 if (rejection) return { ok: false, rejection };
 return { ok: true, fragment };
}

/**
 * Build the corrective suffix for the single retry. `quoteRule` is the
 * path-specific verbatim requirement, repeated in every correction so the
 * retry never trades one invariant for another.
 */
function corrective(rejection: Rejection, quoteRule: string): string {
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
   return `CRITICAL: Your previous response was rejected because it repeated the question that first elicited the snippet. Ask something different. ${quoteRule}`;
 }
}

/** Wrap text as a single user turn for LLM calls that need a Turn[]. */
function userTurn(text: string): Turn[] {
 return [{ role: 'user', text, at: '' }];
}

/** Build a QueueDraft from a verified snippet quote. */
function buildOpenerDraft(
 snippet: Snippet,
 question: string,
 quotedFragment: string,
 source: QueueDraft['source'],
 horizon: QueueDraft['horizon'],
): QueueDraft {
 return {
  source,
  license: 'CC0',
  question,
  questionForm: 'deliberative' as QuestionForm,
  cites: [`${snippet.id}@${snippet.version}`],
  quotedFragment,
  sharpness: 'weak',
  horizon,
 };
}

// ---------------------------------------------------------------------------
// Prompts
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
const FRAMING_RULE = `HOW TO USE THEIR WORDS — frame the quote, never splice it:
Put the speaker's exact words inside quotation marks. Then ask your question after them, in your own words.
Shape: You wrote: "<their exact words>." <your question>?
The shape is fixed. The question is yours — write your own, do not copy this example.
Never weave their words into the grammar of your own sentence.
Keep the quoted words exactly as they wrote them, first person and all. Outside the quotation marks, address the speaker as "you".`;

const RED_LIGHT_SYSTEM = `You are a clerk for Elicit. Review this user turn for "red lights" — phrases that signal the user is being abstract, vague, or disconnected from concrete experience. Return a JSON object with a "lights" array. Each light has:
- "kind": one of "odd-term", "unexplored-referent", "abstraction-no-episode", "pole-no-contrast", "cause-no-event"
- "phrase": the exact substring from the user turn that triggered the concern (verbatim, character-for-character)

Do not fabricate phrases. Every "phrase" must be an exact substring of the user turn.
Return ONLY valid JSON. No markdown fences. No commentary.`;

const VALID_KINDS = new Set([
 'odd-term',
 'unexplored-referent',
 'abstraction-no-episode',
 'pole-no-contrast',
 'cause-no-event',
]);

// ---------------------------------------------------------------------------
// redLights
// ---------------------------------------------------------------------------

export async function redLights(
 turnText: string,
 complete: Complete,
): Promise<RedLight[]> {
 const raw = await complete(RED_LIGHT_SYSTEM, userTurn(turnText), {
  temperature: 0.4,
 });
 const cleaned = stripFences(raw);

 let lights: Array<{ kind?: string; phrase?: string }>;
 try {
  const parsed = JSON.parse(cleaned);
  lights = Array.isArray(parsed.lights) ? parsed.lights : [];
 } catch {
  return [];
 }

 const valid: RedLight[] = [];
 for (const light of lights) {
  if (
   typeof light.kind !== 'string' ||
   typeof light.phrase !== 'string' ||
   !light.phrase
  )
   continue;

  // Q-12: phrase MUST be an exact substring of the turn
  if (!turnText.includes(light.phrase)) {
   console.warn(
    `Composed: dropped red-light phrase not in turn — "${light.phrase}"`,
   );
   continue;
  }

  if (!VALID_KINDS.has(light.kind)) continue;

  valid.push({
   kind: light.kind as RedLight['kind'],
   phrase: light.phrase,
  });
 }

 return valid;
}

// ---------------------------------------------------------------------------
// composeFollowUp
// ---------------------------------------------------------------------------

export async function composeFollowUp(
 turnText: string,
 light: RedLight,
 complete: Complete,
): Promise<string | null> {
 const prompt = `You are a clerk for Elicit. A user just said something that triggered a concern. Compose ONE follow-up question that quotes the flagged phrase exactly.

User turn: "${turnText}"
Concern: ${light.kind} — the phrase "${light.phrase}" triggered this.

Your question MUST contain this exact phrase, verbatim and inside quotation marks: "${light.phrase}".

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST contain this exact substring, inside quotation marks: "${light.phrase}".`;

 const raw = await complete(prompt, userTurn(turnText), {
  temperature: 0.4,
 });
 let question = stripFences(raw).trim();

 let rejection = checkAroundPhrase(question, light.phrase, turnText);
 if (!rejection) return question;

 // One retry with corrective prompt
 console.warn(`Composed: follow-up rejected (${rejection}), retrying`);
 const retryPrompt = `${prompt}\n\n${corrective(rejection, quoteRule)}`;
 const retryRaw = await complete(retryPrompt, userTurn(turnText), {
  temperature: 0.4,
 });
 question = stripFences(retryRaw).trim();

 rejection = checkAroundPhrase(question, light.phrase, turnText);
 if (!rejection) return question;

 console.warn(
  `Composed: follow-up retry also rejected (${rejection}) — returning null`,
 );
 return null;
}

// ---------------------------------------------------------------------------
// composeJuxtaposition
// ---------------------------------------------------------------------------

export async function composeJuxtaposition(
 turnText: string,
 hit: ResonanceHit,
 complete: Complete,
): Promise<string | null> {
 const prompt = `You are a clerk for Elicit. The user just said something that echoes a past snippet. Compose ONE question that juxtaposes what they just said with a shared phrase from their past.

What they just said: "${turnText}"
Past snippet: "${hit.snippetText}"
Shared phrase that appears in both: "${hit.sharedPhrase}"

Your question MUST contain this exact phrase, verbatim and inside quotation marks: "${hit.sharedPhrase}".
Ask about the connection between their present thought and their past one.

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST contain this exact substring, inside quotation marks: "${hit.sharedPhrase}".`;

 const raw = await complete(prompt, userTurn(turnText), {
  temperature: 0.4,
 });
 const question = stripFences(raw).trim();

 let rejection = checkAroundPhrase(question, hit.sharedPhrase, turnText);
 if (!rejection) return question;

 // One retry
 console.warn(`Composed: juxtaposition rejected (${rejection}), retrying`);
 const retryPrompt = `${prompt}\n\n${corrective(rejection, quoteRule)}`;
 const retryRaw = await complete(retryPrompt, userTurn(turnText), {
  temperature: 0.4,
 });
 const retryQuestion = stripFences(retryRaw).trim();

 rejection = checkAroundPhrase(retryQuestion, hit.sharedPhrase, turnText);
 if (!rejection) return retryQuestion;

 console.warn(
  `Composed: juxtaposition retry also rejected (${rejection}) — returning null`,
 );
 return null;
}

// ---------------------------------------------------------------------------
// composeOpener
// ---------------------------------------------------------------------------

export async function composeOpener(
 snippet: Snippet,
 complete: Complete,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit — a quiet, reflective interview tool. Given a snippet the user wrote in a prior session, compose ONE question that returns them to that thought. Quote the snippet verbatim — your question must set off an exact phrase from the snippet inside quotation marks.

Snippet: "${snippet.prose}"
Snippet date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from this snippet inside quotation marks: "${snippet.prose}".`;

 const raw = await complete('', [{ role: 'user', text: prompt, at: '' }], { temperature: 0.4 });
 let question = stripFences(raw).trim();

 let check = checkQuotesSource(question, snippet.prose);
 if (check.ok) {
  return buildOpenerDraft(snippet, question, check.fragment, 'composed', 'session');
 }

 // One retry
 console.warn(`Composed: opener rejected (${check.rejection}), retrying`);
 const retryPrompt = `${prompt}\n\n${corrective(check.rejection, quoteRule)}`;
 const retryRaw = await complete('', [{ role: 'user', text: retryPrompt, at: '' }], { temperature: 0.4 });
 question = stripFences(retryRaw).trim();
 check = checkQuotesSource(question, snippet.prose);

 if (check.ok) {
  return buildOpenerDraft(snippet, question, check.fragment, 'composed', 'session');
 }

 console.warn(
  `Composed: opener retry also rejected (${check.rejection}) — returning null`,
 );
 return null;
}

// ---------------------------------------------------------------------------
// composeStillTrue
// ---------------------------------------------------------------------------

export async function composeStillTrue(
 snippet: Snippet,
 complete: Complete,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit. Given an old snippet the user wrote, compose ONE question asking whether it still holds true. Quote the snippet verbatim — your question must set off an exact phrase from it inside quotation marks. DO NOT repeat or echo the original question that elicited the snippet.

Snippet: "${snippet.prose}"
Original question (do NOT repeat this): "${snippet.provenance.question}"
Snippet date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from this snippet inside quotation marks: "${snippet.prose}", and MUST NOT repeat the original question: "${snippet.provenance.question}".`;

 // Attempt 1
 const raw = await complete('', [{ role: 'user', text: prompt, at: '' }], { temperature: 0.4 });
 const question1 = stripFences(raw).trim();
 const attempt1 = tryBuildStillTrue(snippet, question1);
 if (attempt1.ok) return attempt1.draft;

 // One retry — enforce every constraint, corrected for what failed
 console.warn(`Composed: still-true rejected (${attempt1.rejection}), retrying`);
 const retryPrompt = `${prompt}\n\n${corrective(attempt1.rejection, quoteRule)}`;
 const retryRaw = await complete('', [{ role: 'user', text: retryPrompt, at: '' }], { temperature: 0.4 });
 const question2 = stripFences(retryRaw).trim();
 const attempt2 = tryBuildStillTrue(snippet, question2);
 if (attempt2.ok) return attempt2.draft;

 console.warn(
  `Composed: still-true retry also rejected (${attempt2.rejection}) — returning null`,
 );
 return null;
}

type StillTrueResult =
 | { ok: true; draft: QueueDraft }
 | { ok: false; rejection: Rejection };

/** Validate and build a still-true draft, or name why it was refused. */
function tryBuildStillTrue(
 snippet: Snippet,
 question: string,
): StillTrueResult {
 if (
  question.length === 0 ||
  question === snippet.provenance.question ||
  question.includes(snippet.provenance.question)
 ) {
  return { ok: false, rejection: 'repeats-original' };
 }

 const check = checkQuotesSource(question, snippet.prose);
 if (!check.ok) return { ok: false, rejection: check.rejection };

 return {
  ok: true,
  draft: buildOpenerDraft(
   snippet,
   question,
   check.fragment,
   'still-true',
   'session',
  ),
 };
}

// ---------------------------------------------------------------------------
// composeExpedition
// ---------------------------------------------------------------------------

/**
 * Pure license function: is this snippet a candidate for an Expedition?
 *
 * A snippet is eligible when its region is well-cited but shallow —
 * the wiki knows it matters but cannot deepen it from self-report alone.
 *
 * Heuristic (025):
 * - Snippet reading facet is 'fact' or 'construct'
 * - Cited by ≥2 queue-asked questions
 * - No episode-facet sibling (other snippet in same session with an
 *   episode-facet reading — episode evidence means the region is not shallow)
 */
export function isExpeditionCandidate(
 snippet: Snippet,
 readings: Record<string, Reading>,
 queueEntries: QueueEntry[],
 allSnippets: Snippet[],
): boolean {
 const citeStr = `${snippet.id}@${snippet.version}`;

 // Facet gate: at least one reading must have facet 'fact' | 'construct'
 const snippetReadings = Object.values(readings).filter((r) =>
  (r.cites ?? []).includes(citeStr),
 );
 const hasTargetFacet = snippetReadings.some(
  (r) => r.facet === 'fact' || r.facet === 'construct',
 );
 if (!hasTargetFacet) return false;

 // Cited by ≥2 queue-asked questions
 const citedCount = queueEntries.filter(
  (e) => e.status === 'asked' && (e.cites ?? []).includes(citeStr),
 ).length;
 if (citedCount < 2) return false;

 // No episode-facet sibling in same session
 const sessionId = snippet.provenance.session;
 for (const other of allSnippets) {
  if (other.id === snippet.id) continue;
  if (other.provenance.session !== sessionId) continue;
  const otherCiteStr = `${other.id}@${other.version}`;
  const otherReadings = Object.values(readings).filter((r) =>
   (r.cites ?? []).includes(otherCiteStr),
  );
  if (otherReadings.some((r) => r.facet === 'episode')) {
   return false;
  }
 }

 return true;
}

/**
 * Compose an expedition question for a licensed snippet.
 *
 * The question has two parts:
 * 1. A send-out — ask the user to go read, research, or observe
 * 2. The reflection ask — "what surprised you, and what does it change?"
 *
 * Only the reflective turn is person-bearing (CONTEXT.md: Expedition).
 * Q-12 enforced: the question MUST contain a verbatim quote of the snippet.
 * Horizon: 'days'. Prompt uses user-role messages only (llama.cpp compat).
 */
export async function composeExpedition(
 snippet: Snippet,
 complete: Complete,
): Promise<QueueDraft | null> {
 const prompt = `You are a clerk for Elicit. Given a snippet the user wrote, compose a question that sends them out to investigate — read, research, observe — then return to reflect.

Your question must have two parts: (1) a send-out — ask them to go learn something specific this snippet touches but does not answer, and (2) the reflection ask — "What surprised you, and what does it change?"

It must also set off an exact phrase from the snippet inside quotation marks.

Snippet: "${snippet.prose}"
Snippet date: ${snippet.captured}

${FRAMING_RULE}

Return only the question text. No markdown, no commentary.`;

 const quoteRule = `Your question MUST set off an exact phrase from this snippet inside quotation marks: "${snippet.prose}".`;

 const raw = await complete(
  '',
  [{ role: 'user', text: prompt, at: '' }],
  { temperature: 0.4 },
 );
 let question = stripFences(raw).trim();

 let check = checkQuotesSource(question, snippet.prose);
 if (check.ok) {
  return buildOpenerDraft(snippet, question, check.fragment, 'composed', 'days');
 }

 // One retry
 console.warn(`Composed: expedition rejected (${check.rejection}), retrying`);
 const retryPrompt = `${prompt}\n\n${corrective(check.rejection, quoteRule)}`;
 const retryRaw = await complete(
  '',
  [{ role: 'user', text: retryPrompt, at: '' }],
  { temperature: 0.4 },
 );
 question = stripFences(retryRaw).trim();
 check = checkQuotesSource(question, snippet.prose);

 if (check.ok) {
  return buildOpenerDraft(snippet, question, check.fragment, 'composed', 'days');
 }

 console.warn(
  `Composed: expedition retry also rejected (${check.rejection}) — returning null`,
 );
 return null;
}
