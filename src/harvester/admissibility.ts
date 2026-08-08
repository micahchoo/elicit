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
 *
 * Two tests here were added under ticket 037 and both are measured against the
 * 295 hand-marked cuts in `docs/ingest-triage-2026-08-02.md` rather than
 * argued for: `isQuotedFromSource` (Q-51 at cut level, 7 of 7 with no false
 * positives) and `startsMidSentence` (the fragment router, 7 of 9 at a cost of
 * 4 delayed keeps). The same measurement said NO to two other candidate gates
 * — a leading-referent check, and any structural test for "is this sentence
 * about the person at all" — and those absences are recorded where the
 * predicates would have gone, so nobody re-derives them from first principles.
 */

import { isContentFree } from '../language/thin-answer.js';

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
 *
 * Exported because the harvester's facet/stance post-checks match on the same
 * shapes ("i used to", "i do not think that anymore") and two normalizations
 * would drift apart — the whole reason this one exists.
 */
export function normalize(text: string): string {
  return bare(text);
}

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
// Sentence alignment: was this span lifted from the middle of a sentence?
// ---------------------------------------------------------------------------

/**
 * True when the cut begins inside a sentence rather than at the start of one.
 *
 * The test is the first character: a span that opens on a lowercase letter was
 * either lifted mid-sentence ("the move from renting to owning", "we chose
 * to wait a season") or lifted from a heading that is itself not a sentence
 * ("how notification patterns steer attention on these platforms"). Both are
 * fragments, and neither is readable without the words in front of it.
 *
 * MEASURED, against the 295 hand-marked cuts of the 2026-08-02 published-prose
 * harvest (review record kept with the corpus, outside the repo): it fires on
 * 7 of the 9 cuts the reader marked `frag`, and on 4 of their 139 keeps. Two
 * things follow from that ratio. First, this is a routing test, not a
 * rejection test — the caller sends what it catches to the Bud path, where the
 * fragment survives and can be asked about, so the 4 keeps are delayed rather
 * than destroyed. Second, it is deliberately NOT the check ticket 035 proposed
 * (a leading bare pronoun/demonstrative). That one was measured on the same
 * set: 0 of 9 `frag` and 25 of 139 keeps. Real prose opens sentences with
 * expletive "It was…" and discourse "This…" constantly, so the rule reads as a
 * fragment detector and behaves as a keep shredder.
 *
 * The two `frag` cuts this misses are full grammatical sentences whose
 * referents dangle ("After getting the first version to work, I came across
 * the biggest issue." — which issue?). No structural test reaches those; they
 * need a reader.
 */
export function startsMidSentence(text: string): boolean {
  return /^[a-z]/.test(text.trim());
}

// ---------------------------------------------------------------------------
// Q-51: a quoted passage is not the person's belief
// ---------------------------------------------------------------------------

/**
 * Quoted spans in a source text, as `scripts/ingest-posts.ts` defines them.
 *
 * A span is a quotation when it opens and closes with curly quotes, nests no
 * further quote mark, runs at least 20 characters, and does not cross a
 * paragraph break. Straight quotes are deliberately NOT matched: a person
 * typing `he called it "the wall"` is naming their own coinage, and the same
 * marks do duty for scare quotes, emphasis and titles.
 */
export function quotedSpans(source: string): string[] {
  return [...source.matchAll(/“([^“”]{20,3000})”/g)]
    .map((m) => m[1] as string)
    .filter((s) => !/\n\s*\n/.test(s))
    .map((s) => s.trim());
}

/** True when the cut is (part of) one of those spans — someone else's words. */
export function isQuotedFromSource(cutText: string, spans: string[]): boolean {
  const stripped = cutText.replace(/^[“”"]+/, '').replace(/[“”"]+$/, '').trim();
  return stripped.length > 0 && spans.some((s) => s.includes(stripped));
}

// ---------------------------------------------------------------------------
// The gate that is not here: "is this sentence about the person at all?"
// ---------------------------------------------------------------------------
//
// 114 of the 149 cuts the reader dropped on 2026-08-02 they dropped as `world`
// (true no matter who wrote it — a building's floor plan, a city's case count)
// or `log` (what they did, in order, with nothing said about why). That is 76%
// of all the junk, and every one of them passes every test in this file. The
// criterion used is one sentence: WOULD THIS BE EVIDENCE ABOUT THE PERSON IF
// YOU DID NOT KNOW WHO WROTE IT?
//
// It does not mechanize. Six candidate predicates were measured against the
// same 295 cuts, and the best of them reaches 74% precision at 18% recall:
//
//   no first-person singular                76 of 114   53 keeps lost   48% prec
//   no first-person AND no stance verb      32 of 114   16 keeps lost   54% prec
//   past-tense action verb, no stance verb  37 of 114   14 keeps lost   69% prec
//   third-person AND past-tense action      20 of 114    4 keeps lost   74% prec
//
// Doing nothing already scores 53%, because 53% of the cuts are junk. So the
// whole yield of the best rule is +21 points of precision, bought by shredding
// real material. And the reason is not that the rules are crude. "The studio
// is where the four partners work from" (drop) and "Slowness is an honest
// constraint because it changes what a plan can promise" (keep) are both
// third-person declaratives. "I made a rough spreadsheet and shared it with
// a colleague" (drop) and "I started to treat every draft as an experiment
// on myself" (keep) are both first-person past. One reports an
// action, the other reports a stance, and no regex sees the difference —
// because the difference is what the sentence is ABOUT.
//
// So this gate is a judgement, and it stays with the person, in review, where
// judgements go. Do not replace it with a model call either: that is the
// self-report the whole file exists to route around, and it would be a gate
// nobody has evaluated on a labelled set. The set is right there when somebody
// wants to try.

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
  | 'content-free'
  /** Q-51: the span sits inside a quotation in the source it was cut from. */
  | 'quoted';

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
  /**
   * The text the cut was taken from, for the Q-51 quotation test. Cut scope
   * only. Absent means the test does not run — it cannot, because a quotation
   * is only visible against the words around it.
   */
  source?: string;
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

  // Q-51 last, and only when a source was handed in. This is the one test here
  // that is NOT about the cut alone: the same sentence is admissible when the
  // person wrote it and inadmissible when they quoted it, and only the source
  // says which. Measured against the 2026-08-02 published-prose harvest it
  // finds 7 of 7 quoted cuts with zero false positives on the other 288.
  if (opts.source !== undefined && isQuotedFromSource(text, quotedSpans(opts.source))) {
    return { ok: false, reason: 'quoted' };
  }
  return { ok: true };
}
