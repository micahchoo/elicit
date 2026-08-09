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
// Set-off quotation
// ---------------------------------------------------------------------------

/** A half-open range over a string. */
export interface Span {
 start: number;
 end: number;
}

/** Each opening mark and the closing mark it expects. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
 ['"', '"'],
 ['“', '”'],
 ['‘', '’'],
 ["'", "'"],
];

/** Marks and punctuation that may hug a quotation without belonging to it. */
const EDGE_CHARS = /[\s>"“”‘’'.,;:!?…—-]/u;

/** A straight quote opens a span only where an apostrophe cannot sit. */
function opensSpan(text: string, i: number): boolean {
 if (i === 0) return true;
 return /[\s([]/u.test(text[i - 1]!);
}

/** A straight quote closes a span only where an apostrophe cannot sit. */
function closesSpan(text: string, i: number): boolean {
 if (i + 1 >= text.length) return true;
 return /[\s.,;:!?)\]—-]/u.test(text[i + 1]!);
}

/** The inner material of every quotation mark pair, delimiters excluded. */
export function quotedSpans(text: string): Span[] {
 const spans: Span[] = [];
 for (let i = 0; i < text.length; i++) {
  const pair = QUOTE_PAIRS.find(([open]) => open === text[i]);
  if (!pair) continue;
  const [open, close] = pair;
  if (open === "'" && !opensSpan(text, i)) continue;

  let j = -1;
  for (let k = i + 1; k < text.length; k++) {
   if (text[k] !== close) continue;
   if (close === "'" && !closesSpan(text, k)) continue;
   j = k;
   break;
  }
  if (j === -1) continue; // An unclosed mark sets nothing off.

  spans.push({ start: i + 1, end: j });
  i = j;
 }
 return spans;
}

/** Strip the marks and punctuation that may hug quoted material. */
function core(text: string): string {
 let s = text;
 while (s.length > 0 && EDGE_CHARS.test(s[0]!)) s = s.slice(1);
 while (s.length > 0 && EDGE_CHARS.test(s[s.length - 1]!)) s = s.slice(0, -1);
 return s;
}

/** Lines that hold the fragment and nothing else. Single-line text has none. */
function ownLineSpans(text: string, fragment: string): Span[] {
 const lines = text.split('\n');
 if (lines.filter((l) => l.trim().length > 0).length < 2) return [];

 const target = core(fragment);
 if (target.length === 0) return [];

 const spans: Span[] = [];
 let at = 0;
 for (const line of lines) {
  if (core(line) === target) spans.push({ start: at, end: at + line.length });
  at += line.length + 1;
 }
 return spans;
}

/**
 * Every span of `text` that reads as the speaker's words rather than the
 * agent's: inside quotation marks, or — when the fragment is known — alone on
 * its own line.
 */
export function setOffSpans(text: string, fragment?: string): Span[] {
 const spans = quotedSpans(text);
 const f = fragment?.trim();
 if (f) spans.push(...ownLineSpans(text, f));
 return spans;
}

/**
 * Does the text quote the fragment verbatim AND SET OFF (040)?
 *
 * Q-12 asked only "is the fragment present", and a fragment spliced into the
 * middle of the agent's own clause satisfies that. Live evidence: "When did
 * you last experience the kind of resonance that I thought that I long lost?"
 * — the user's words carry no marking, so the reader cannot tell whose "I"
 * that is, and the syntax bends around the splice until it means nothing.
 *
 * Set off means one of two things: the fragment sits inside a quotation mark
 * pair, or it stands alone on its own line. Either way the seam between the
 * user's words and the agent's is visible on the page.
 */
export function quotesFragmentSetOff(text: string, fragment: string): boolean {
 const f = fragment.trim();
 if (f.length === 0) return false;

 const spans = setOffSpans(text, f);
 if (spans.length === 0) return false;

 for (let at = text.indexOf(f); at !== -1; at = text.indexOf(f, at + 1)) {
  const end = at + f.length;
  if (spans.some((s) => s.start <= at && end <= s.end)) return true;
 }
 return false;
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
 * Masking follows the SET-OFF spans, never every occurrence of the fragment
 * (040). A fragment spliced unmarked into the agent's clause is left visible
 * on purpose: masking it would launder the user's "I" into the agent's half of
 * the sentence, which is how the malformed question of 2026-08-02 passed.
 */
export function hasFirstPersonOutsideQuote(
 text: string,
 quotedFragment?: string,
): boolean {
 let scan = text;
 for (const span of setOffSpans(text, quotedFragment)) {
  scan = blank(scan, span.start, span.end);
 }

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
 * Replace every quoted span with blanks, leaving only the agent-authored
 * frame words. Own-line spans need a known fragment, which duplicate
 * checking does not have, so only quotation-mark spans are masked.
 */
function maskQuoted(text: string): string {
 let masked = text;
 for (const span of quotedSpans(text)) {
  masked = blank(masked, span.start, span.end);
 }
 return masked;
}

/**
 * Near-duplicate guard: rejects a question too similar to one already asked.
 * Uses word-set Jaccard similarity after normalization. Quoted material is
 * masked first (ticket 111): re-quoting the same Episode with a different
 * frame is a fresh question, not a duplicate.
 */
/** Word-set Jaccard over normalized text; 0 when either side is too thin. */
function jaccard(a: string, b: string): number {
 const aWords = new Set(normalizeQuestion(a).split(' ').filter((w) => w.length > 1));
 const bWords = new Set(normalizeQuestion(b).split(' ').filter((w) => w.length > 1));
 if (aWords.size < 2 || bWords.size < 2) return 0;
 const intersection = new Set([...aWords].filter((w) => bWords.has(w)));
 const union = new Set([...aWords, ...bWords]);
 return union.size === 0 ? 0 : intersection.size / union.size;
}

/** The quoted material of a question, joined — what maskQuoted removes. */
function quotedContent(text: string): string {
 return quotedSpans(text)
  .map((s) => text.slice(s.start, s.end))
  .join(' ');
}

export function isNearDuplicate(question: string, asked: string[]): boolean {
 for (const prior of asked) {
  // Both sides quote something: a duplicate needs BOTH the frame and the
  // quoted material to match. Frame-only similarity is the Sounding's
  // ladder (same frame, each rung quoting new words — fresh); quote-only
  // similarity is re-quoting an Episode under a new frame (ticket 111 —
  // fresh). Either alone must pass.
  const qQuoted = quotedContent(question);
  const aQuoted = quotedContent(prior);
  if (qQuoted.length > 0 && aQuoted.length > 0) {
   const frameSim = jaccard(maskQuoted(question), maskQuoted(prior));
   const quoteSim = jaccard(qQuoted, aQuoted);
   if (frameSim >= 0.5 && quoteSim >= 0.5) return true;
   continue;
  }
  // At least one side quotes nothing — the pre-111 whole-text comparison.
  if (jaccard(question, prior) >= 0.5) return true;
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
 | 'near-duplicate'
 | 'not-interrogative';

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
 if (!isInterrogative(question)) return 'not-interrogative';
 return 'ok';
}
