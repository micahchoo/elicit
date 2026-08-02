/**
 * Guards — the pure predicates every question passes before it is uttered.
 *
 * Q-36: freedom in generation, rigidity in validation. Whatever composed a
 * question (protocol probe, juxtaposition, red-light follow-up, docket mint),
 * the same checks decide whether it may be asked. Keeping them here, free of
 * session and LLM types, is what lets one choke point serve every branch.
 */

// ---------------------------------------------------------------------------
// Question shape
// ---------------------------------------------------------------------------

/** Closing punctuation that may legitimately follow the question mark. */
const TRAILING_CLOSERS = /[)\]"'”’\s]+$/u;

/**
 * Is this text a question rather than an echo?
 *
 * Two failures it catches, both observed live (eval 2026-08-02 #3): a flat
 * declarative minted as an "opener", and the source snippet handed back
 * unchanged — which passes any longest-common-substring quote check trivially.
 *
 * Pass `quotedFragment` where one is known: a question that is nothing but the
 * fragment adds no move of its own, however it is punctuated.
 */
export function isInterrogative(text: string, quotedFragment?: string): boolean {
 const t = text.trim();
 if (t.length === 0) return false;

 if (!t.replace(TRAILING_CLOSERS, '').endsWith('?')) return false;

 if (quotedFragment && quotedFragment.trim().length > 0) {
  const added = t
   .split(quotedFragment.trim())
   .join(' ')
   .replace(/[^\p{L}\p{N}]+/gu, ' ')
   .trim();
  if (added.length === 0) return false;
 }

 return true;
}

// ---------------------------------------------------------------------------
// Person agreement
// ---------------------------------------------------------------------------

/** Case-sensitive: the pronoun "I", including "I'm", "I've", "I'd", "I'll". */
const FIRST_PERSON_I = /\bI\b/;
/** Case-insensitive: these read as first person wherever they sit. */
const FIRST_PERSON_OTHER = /\b(?:my|me|mine|myself)\b/i;

/** Blank out a span, keeping the surrounding offsets stable. */
function blank(text: string, start: number, end: number): string {
 return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

/** Blank out every `open`…`close` span, including the delimiters. */
function maskPairs(text: string, open: string, close: string): string {
 let out = text;
 let from = 0;
 for (;;) {
  const i = out.indexOf(open, from);
  if (i === -1) break;
  const j = out.indexOf(close, i + open.length);
  if (j === -1) break;
  out = blank(out, i, j + close.length);
  from = j + close.length;
 }
 return out;
}

/**
 * Does the text speak in first person OUTSIDE the material it quotes?
 *
 * The tension is real and stays unresolved by design: Sole Authorship (Q-1)
 * requires the quoted fragment verbatim, so "my hedges" must survive inside
 * the quote — while the question around it addresses the speaker as "you".
 * Observed 6/6 in the eval: the model carries the quote's person out past the
 * closing quotation mark ("…particularly when considering my actual
 * confidence?"). Only the outside is checked; the quote is never rewritten.
 *
 * The quoted span may be delimited by " ", ' ', typographic quotes, or not
 * delimited at all — so pass `quotedFragment` when it is known, and it is
 * masked wherever it appears.
 */
export function hasFirstPersonOutsideQuote(
 text: string,
 quotedFragment?: string,
): boolean {
 let scan = text;

 const fragment = quotedFragment?.trim();
 if (fragment) {
  let at = scan.indexOf(fragment);
  while (at !== -1) {
   scan = blank(scan, at, at + fragment.length);
   at = scan.indexOf(fragment, at + fragment.length);
  }
 }

 scan = maskPairs(scan, '"', '"');
 scan = maskPairs(scan, '“', '”');
 scan = maskPairs(scan, '‘', '’');
 // Straight single quotes bound a span only when they are not apostrophes.
 scan = scan.replace(
  /(^|[\s([])'[^']+'(?=$|[\s.,;:!?)\]])/g,
  (m) => ' '.repeat(m.length),
 );

 return FIRST_PERSON_I.test(scan) || FIRST_PERSON_OTHER.test(scan);
}

// ---------------------------------------------------------------------------
// Session guards
// ---------------------------------------------------------------------------

/**
 * Parrot guard: rejects a generated question that appears as a near-substring
 * of the prompt that produced it. Normalizes whitespace and case before checking.
 */
export function isParrot(question: string, prompt: string): boolean {
 const normQ = question.replace(/\s+/g, ' ').toLowerCase().trim();
 const normP = prompt.replace(/\s+/g, ' ').toLowerCase();
 const qWords = normQ.split(' ');
 if (qWords.length < 4) return false;
 // Sliding window: check if any 4+ consecutive words from the question
 // appear as a substring in the prompt
 for (let i = 0; i <= qWords.length - 4; i++) {
  const phrase = qWords.slice(i, i + 4).join(' ');
  if (normP.includes(phrase)) return true;
 }
 return false;
}

/**
 * Conversation-referential guard: rejects probes about the conversation itself.
 * "What are you trying to achieve in this conversation?" is furniture.
 */
export function isConversationReferential(question: string): boolean {
 return /\bthis conversation\b/i.test(question);
}

/** Normalize question text for duplicate comparison. */
function normalizeQuestion(text: string): string {
 return text
  .toLowerCase()
  .replace(/[^\w\s]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
}

/**
 * Near-duplicate guard: rejects a question too similar to one already asked.
 * Uses word-set Jaccard similarity after normalization.
 */
export function isNearDuplicate(question: string, asked: string[]): boolean {
 const normQ = normalizeQuestion(question);
 const qWords = new Set(normQ.split(' ').filter((w) => w.length > 1));
 if (qWords.size < 2) return false;

 for (const prior of asked) {
  const normA = normalizeQuestion(prior);
  const aWords = new Set(normA.split(' ').filter((w) => w.length > 1));
  if (aWords.size < 2) continue;

  const intersection = new Set([...qWords].filter((w) => aWords.has(w)));
  const union = new Set([...qWords, ...aWords]);
  if (union.size === 0) continue;

  const similarity = intersection.size / union.size;
  if (similarity >= 0.5) return true;
 }

 return false;
}

// ---------------------------------------------------------------------------
// The choke point
// ---------------------------------------------------------------------------

export type GuardVerdict =
 | 'ok'
 | 'parrot'
 | 'conversation-referential'
 | 'near-duplicate';

export interface GuardContext {
 /** Every question already asked this session — agent turns, in order. */
 asked: string[];
 /**
  * The prompt that produced the question, when there is one. Absent for
  * composed questions: those are BUILT from the user's words (Q-12), so
  * measuring them against their own compose prompt would reject every
  * valid one. Their echo guard is `isDegenerateComposition` instead.
  */
 systemPrompt?: string;
}

/**
 * Run every guard that applies. One call, one verdict — so a branch cannot
 * ship a question by forgetting a check (eval 2026-08-02 #4: juxtaposition and
 * red-light follow-ups returned unguarded and repeated themselves).
 */
export function checkQuestion(
 question: string,
 ctx: GuardContext,
): GuardVerdict {
 if (ctx.systemPrompt !== undefined && isParrot(question, ctx.systemPrompt)) {
  return 'parrot';
 }
 if (isConversationReferential(question)) return 'conversation-referential';
 if (isNearDuplicate(question, ctx.asked)) return 'near-duplicate';
 return 'ok';
}
