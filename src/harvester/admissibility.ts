/**
 * Structural admissibility — what may become Snippet material at all.
 *
 * CONTEXT.md's Two Planes invariant: a reaction to the interaction is LINEAGE.
 * It belongs to the transcript and the activity record, and it is never
 * KNOWLEDGE about the person. "This question makes no sense." says nothing
 * about a life; it says something about a question. Harvesting it seeds the
 * Wiki with a claim manufactured from the person declining to answer.
 *
 * The harvest model already reports a `standalone` boolean, and that boolean
 * is a suggestion, not a gate (adversarial eval finding #6) — it is the model
 * grading its own homework. These predicates are the gate, in code, upstream
 * of anything the model claims.
 *
 * Every test here is deliberately conservative. A false reject destroys
 * material the person actually said and will never see again; a false admit
 * costs them one line to decline during review. When a case is ambiguous,
 * ADMIT.
 */

import { isContentFree } from '../elicitor/answer-shape.js';

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Contractions expanded so one spelling per meaning reaches the matchers. */
function expandContractions(s: string): string {
  return s
    .replace(/\bcan'?t\b/g, 'can not')
    .replace(/\bwon'?t\b/g, 'will not')
    // Only known auxiliary stems expand, so "want" never becomes "wa not".
    .replace(/\b(do|does|did|is|are|was|were|has|have|had|could|should|would|must|ai)n'?t\b/g, '$1 not')
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\b(you|we|they)'re\b/g, '$1 are')
    .replace(/\b(i|you|we|they)'ve\b/g, '$1 have')
    .replace(/\b(i|you|he|she|we|they)'ll\b/g, '$1 will')
    .replace(/\b(i|you|he|she|we|they)'d\b/g, '$1 would');
}

/**
 * Lowercase, contractions expanded, punctuation gone, whitespace collapsed.
 * Every matcher below reads this form, so `"I'm not sure!"` and `"im not
 * sure"` cannot take different paths.
 */
function bare(text: string): string {
  return expandContractions(
    text.toLowerCase().replace(/[‘’ʼ`]/g, "'"),
  )
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Meta-conversational: about the exchange, not about a life
// ---------------------------------------------------------------------------

/**
 * Whole utterances that are moves in the conversation rather than claims about
 * the person: acknowledgements, deflections, refusals, requests for repair.
 * Matched against the entire normalized text, never as a substring — "no" is a
 * deflection on its own and a word inside a sentence.
 */
const DEFLECTIONS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah', 'sure', 'ok', 'okay', 'alright',
  'right', 'correct', 'exactly', 'true', 'false', 'fine',
  'maybe', 'perhaps', 'probably', 'possibly', 'i guess', 'i guess so', 'i think so',
  'i suppose', 'i suppose so',
  'dunno', 'i dunno', 'idk', 'i do not know', 'do not know', 'no idea', 'unsure',
  'not sure', 'i am not sure', 'i am not really sure', 'i can not say', 'can not say',
  'hard to say', 'who knows',
  'pass', 'skip', 'skip it', 'skip this', 'next', 'next question', 'no comment',
  'none', 'nothing', 'nothing really', 'not really', 'whatever', 'it depends', 'depends',
  'what', 'huh', 'sorry', 'no thanks',
  'what do you mean', 'what does that mean', 'what does this mean',
  'what do you mean by that', 'i do not understand', 'i do not understand the question',
  'can you rephrase that', 'can you rephrase',
  'makes no sense', 'this makes no sense', 'that makes no sense', 'it makes no sense',
  'this does not make sense', 'that does not make sense',
]);

/**
 * Names for the exchange itself. A meta-comment needs one of these as its
 * subject — "the question", not "my father". Bare "this"/"that" are excluded
 * on purpose: in "My father sold the shop. That makes no sense." the referent
 * is a life, not a prompt.
 */
const META_REFERENT =
  /\b(?:this|that|these|those|the|your|another|each|last|first|every)\s+(?:question|questions|prompt|prompts|one|exercise|conversation|app|wording|phrasing)\b|\b(?:what\s+)?you\s+(?:just\s+)?(?:asked|are\s+asking|said|wrote)\b/;

/** Comments a person makes about a prompt: it is unclear, unanswerable, wrong. */
const META_PREDICATE =
  /\b(?:makes?\s+no\s+sense|does\s+not\s+make\s+(?:any\s+)?sense|means?\s+nothing|is\s+(?:too\s+)?(?:vague|confusing|unclear|abstract|odd|strange|weird|stupid|silly|meaningless|nonsense)|is\s+not\s+(?:clear|answerable)|is\s+hard\s+to\s+answer|i\s+do\s+not\s+(?:understand|get)|i\s+can\s+not\s+(?:parse|follow|answer))\b/;

/**
 * Declining to answer. No referent required — a refusal is a move on the
 * exchange wherever it appears, and it is never a claim about a life.
 */
// The `(?!\s+to\b)` guard keeps a refusal ("I would rather not answer") apart
// from a life ("I would rather not answer to anyone for how I spend my
// mornings", "I would rather not talk to my sister about it").
const REFUSAL =
  /\b(?:(?:i\s+would\s+)?rather\s+not\s+(?:answer|say|talk|get\s+into|go\s+into)(?!\s+to\b)|(?:i\s+would\s+)?prefer\s+not\s+to\s+(?:answer|say)(?!\s+to\b)|i\s+do\s+not\s+want\s+to\s+answer(?!\s+to\b)|no\s+comment|(?:let\s+us\s+)?(?:skip|pass\s+on)\s+(?:this|that|it)(?:\s+one)?|next\s+question|ask\s+me\s+something\s+else|can\s+you\s+rephrase)\b/;

/**
 * True when the text is about the conversation, the question or the app rather
 * than about the person's life, beliefs or knowledge.
 *
 * Three ways in: the whole utterance is a known deflection; the text declines
 * to answer; or a name for the exchange carries a comment on the exchange
 * ("this question" + "makes no sense"). Referent and predicate must BOTH be
 * present — "I do not understand why my brother stopped calling" is a life, and
 * stays.
 */
export function isMetaConversational(text: string): boolean {
  const t = bare(text);
  if (t.length === 0) return false;
  if (DEFLECTIONS.has(t)) return true;
  if (REFUSAL.test(t)) return true;
  return META_REFERENT.test(t) && META_PREDICATE.test(t);
}

// ---------------------------------------------------------------------------
// Minimum propositional content: a subject and a claim
// ---------------------------------------------------------------------------

/**
 * Response tokens and function words that carry no claim by themselves. An
 * utterance built only from these ("Yes.", "Not really.", "That is true.")
 * asserts nothing without the question it answers.
 */
const PARTICLES = new Set([
  'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah', 'sure', 'ok', 'okay', 'alright',
  'right', 'correct', 'exactly', 'definitely', 'absolutely', 'totally', 'true', 'false',
  'fine', 'maybe', 'perhaps', 'probably', 'possibly', 'really', 'very', 'quite', 'just',
  'well', 'oh', 'ah', 'hmm', 'hm', 'mm', 'uh', 'um', 'er', 'huh', 'whatever', 'anyway',
  'none', 'nothing', 'not', 'never', 'always', 'sometimes', 'still', 'too', 'also',
  'both', 'neither', 'either', 'pass', 'skip', 'next', 'dunno', 'idk', 'unsure', 'sorry',
  'a', 'an', 'the', 'it', 'that', 'this', 'i', 'my', 'of', 'kind', 'sort', 'bit', 'lot',
  'much', 'more', 'less', 'thing', 'one', 'some', 'all', 'do', 'does', 'did', 'is', 'am',
  'are', 'was', 'were', 'be', 'been', 'to', 'and', 'but', 'or', 'so',
]);

/**
 * Openings that frame a claim without being one. Stripping them is what lets
 * "I am not sure." fail while "I am not sure whether the thing I call
 * discipline is actually fear." passes — same opening, and only one of them
 * has something after it.
 */
const HEDGE_FRAME =
  /^(?:i am not (?:really )?sure|i am not certain|i do not (?:really )?know|i do not think|not sure|dunno|idk|i guess|i suppose|i think|i mean|i feel like|i would say|honestly|actually|basically|obviously|well|so|but|and|yes|yeah|yep|yup|no|nope|nah|ok|okay|sure|right|maybe|perhaps|probably|hmm+|uh+|um+|oh|ah)(?![a-z])(?:\s+(?:that|if|whether|but|and|so|then|like|of course))?\s*/;

/** Repeatedly peel hedge openings; four passes covers "well maybe i think that". */
function stripHedges(t: string): string {
  let s = t;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(HEDGE_FRAME, '');
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

/**
 * True when the text carries no proposition — no subject paired with a claim.
 *
 * There is no parser here, so the test is structural rather than syntactic, and
 * chosen to fail closed toward admitting. Raw length is explicitly NOT the
 * test: "My father drank." is short and is a proposition, while "I am not sure
 * about any of that, really." is long and is not. Instead: peel the hedge
 * frames a person opens with, then ask whether anything is left. A cut lacks a
 * proposition when the remainder is empty, is a single token, or is built
 * entirely from response particles and function words — none of which can name
 * a subject and predicate something of it.
 *
 * The single-token rule has a known cost: "Fear." answering "what made you
 * leave?" is content, and it dies here instead of becoming a Bud. That is
 * accepted — a bare noun is not readable without the question that drew it,
 * which is the same reason a Bud is not a Snippet, and the transcript keeps it
 * either way.
 */
export function lacksProposition(text: string): boolean {
  const remainder = stripHedges(bare(text));
  if (remainder.length === 0) return true;

  const tokens = remainder.split(' ').filter((w) => w.length > 0);
  if (tokens.length < 2) return true;
  return tokens.every((w) => PARTICLES.has(w));
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export type InadmissibleReason =
  /** Nothing but whitespace. */
  | 'empty'
  /** A move on the exchange: deflection, refusal, comment on the question. */
  | 'meta-conversational'
  /** No subject-and-claim — unreadable without the turn that prompted it. */
  | 'no-proposition'
  /** Turn scope only: the whole answer is too thin to hold anything. */
  | 'content-free';

export type Admissibility = { ok: true } | { ok: false; reason: InadmissibleReason };

export type AdmissibilityOptions = {
  /**
   * `'cut'` (default) tests one proposed fragment: it must not be a move on
   * the exchange, and it must carry a proposition.
   *
   * `'turn'` tests a whole user answer before it is ever sent for extraction,
   * and applies ONLY the content-free test. The narrower scope is deliberate:
   * an answer that mixes a complaint with real material ("This question makes
   * no sense to me, my father never asked me anything like it.") must still
   * reach the model, so the complaint dies as a cut and the memory survives.
   */
  scope?: 'cut' | 'turn';
};

/**
 * The single gate. Runs before the model's `standalone` boolean is consulted,
 * so nothing inadmissible can reach a proposal or a Bud.
 */
export function admissible(text: string, opts: AdmissibilityOptions = {}): Admissibility {
  if (text.trim().length === 0) return { ok: false, reason: 'empty' };

  if (opts.scope === 'turn') {
    // isContentFree already classifies these turns correctly — it is what
    // triggers the elicitor's pivot. Reusing it keeps one definition of "this
    // answer holds nothing" instead of two that can drift apart.
    return isContentFree(text) ? { ok: false, reason: 'content-free' } : { ok: true };
  }

  // Proposition first: it produces the truer label for "Yes." and "I am not
  // sure.", which are empty before they are meta.
  if (lacksProposition(text)) return { ok: false, reason: 'no-proposition' };
  if (isMetaConversational(text)) return { ok: false, reason: 'meta-conversational' };
  return { ok: true };
}
