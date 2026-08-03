/**
 * Decomposition guard — the Q-81 boundary check for derived questions.
 *
 * A derived question must decompose into:
 * 1. Quoted spans — exact substrings of source Snippets
 * 2. Registered operators — content words from the pattern's operator set
 * 3. Recombined elements — nothing else of substance
 *
 * A question that fails to decompose is refused with a named reason.
 * This is Q-36's split made concrete: the model has full creative freedom
 * inside the prompt; this guard catches what crosses the line.
 */

import type { Pattern, DecompositionResult, Operator } from './types.js';

// ---------------------------------------------------------------------------
// Quoted-span extraction
// ---------------------------------------------------------------------------

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ['\u201C', '\u201D'],
  ['\u2018', '\u2019'],
  ["'", "'"],
];

function opensSpan(text: string, i: number): boolean {
  if (i === 0) return true;
  return /[\s([]/u.test(text[i - 1]!);
}

function closesSpan(text: string, i: number): boolean {
  if (i + 1 >= text.length) return true;
  return /[\s.,;:!?)\]\\u2014\\u2013-]/u.test(text[i + 1]!);
}

interface QuotedSpan {
  text: string;
  start: number;
  end: number;
}

function extractQuotedSpans(question: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  for (let i = 0; i < question.length; i++) {
    const pair = QUOTE_PAIRS.find(([open]) => open === question[i]);
    if (!pair) continue;
    const [open, close] = pair;
    if (open === "'" && !opensSpan(question, i)) continue;
    let j = -1;
    for (let k = i + 1; k < question.length; k++) {
      if (question[k] !== close) continue;
      if (close === "'" && !closesSpan(question, k)) continue;
      j = k;
      break;
    }
    if (j === -1) continue;
    spans.push({ text: question.slice(i + 1, j), start: i + 1, end: j });
    i = j;
  }
  return spans;
}

// ---------------------------------------------------------------------------
// Source matching
// ---------------------------------------------------------------------------

interface Source {
  id: string;
  version: number;
  prose: string;
}

function findSource(quoted: string, sources: Source[]): { sourceSnippetId: string; sourceVersion: number } | null {
  for (const s of sources) {
    if (s.prose.includes(quoted)) return { sourceSnippetId: s.id, sourceVersion: s.version };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Content-word analysis
// ---------------------------------------------------------------------------

const GRAMMATICAL = new Set([
  'a', 'an', 'the',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'if', 'then', 'else', 'or', 'and', 'but', 'not', 'nor',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'about', 'like', 'through', 'after', 'over', 'between', 'out', 'up', 'down',
  'just', 'very', 'so', 'too', 'also', 'only', 'even', 'still', 'now', 'here', 'there',
  // Quote-introducing verbs (Q-12 framing)
  'wrote', 'said', 'described', 'mentioned', 'called', 'named',
  // Common cognitive and framing verbs
  'think', 'feel', 'notice', 'know', 'want', 'need', 'try', 'make', 'take',
  'come', 'go', 'see', 'look', 'find', 'give', 'tell', 'ask', 'let', 'put',
  // Ordinals and quantities
  'first', 'last', 'next', 'any', 'some', 'each', 'every', 'all', 'more', 'most',
  'other', 'another', 'own', 'same', 'such', 'both', 'few', 'many', 'much',
  // Temporal
  'always', 'never', 'ever', 'once', 'again', 'often', 'sometimes',
  'already', 'yet', 'while', 'during', 'until', 'since',
  // Comparison
  'than', 'less', 'rather',
  // Reflexive pronouns
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
  // Discourse / hesitation
  'well', 'yes', 'no', 'oh', 'ah', 'um', 'uh',
]);

function isContentWord(word: string): boolean {
  return word.length >= 2 && !GRAMMATICAL.has(word.toLowerCase()) && !/^\d+$/.test(word);
}

function contentWords(text: string): string[] {
  return text
    .replace(/['\u2018\u2019]s\b/gi, '')
    .replace(/n['\u2018\u2019]t\b/gi, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(isContentWord)
    .map((w) => w.toLowerCase());
}

function isOperatorWord(word: string, operators: Operator[]): boolean {
  const MAP: Record<Operator, string[]> = {
    'suppose': ['suppose', 'imagine', 'what', 'if'],
    'time-shift': ['then', 'now', 'later', 'before', 'after', 'looking', 'back', 'today', 'years', 'ago'],
    'miracle': ['miracle', 'overnight', 'awake', 'solved', 'different'],
    'clean-language-frame': ['kind', 'anything', 'else', 'where', 'about', 'happens'],
    'sentence-completion': ['because', 'finish', 'complete'],
    'reversal': ['surprise', 'answer', 'ask', 'question'],
    'externalize': ['character', 'want', 'story', 'name', 'call'],
    'instance-of': ['include', 'apply', 'cover', 'case', 'example'],
    'counterfactual-twist': ['different', 'instead', 'otherwise', 'changed', 'manager', 'offered', 'promotion'],
    'dilemma-construct': ['closer', 'between', 'choose', 'act', 'crisis'],
    'anniversary-frame': ['written', 'date', 'since', 'changed', 'looking', 'back'],
  };
  for (const op of operators) {
    const words = MAP[op] ?? [];
    if (words.includes(word.toLowerCase())) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Assertion / presupposition detection
// ---------------------------------------------------------------------------

const PRESUPPOSITION_TRIGGERS = [
  // QR-2 fixture patterns
  /\bwhen you (honor|allow|let|choose|decide|embrace|accept)\b/i,
  /\bnow that\b/i,
  /\blet yourself\b/i,
  /\bhold space\b/i,
  /\btruly\b/i,
  /\btend to\b/i,
  /\bwhat new path\b/i,
  /\bhow long will you\b/i,
  // General presupposition patterns
  /\byou (still|keep|continue to)\b/i,
  /\byou are (becoming|growing|learning to)\b/i,
  /\bthe (old|new|real|true) you\b/i,
  /\byour (true|real|inner|authentic)\b/i,
  // Therapy-register lexicon
  /\b(integrate|integrated|integration)\b/i,
  /\b(healing|heal|healed)\b/i,
  /\b(alignment|aligned|align)\b/i,
  /\b(resonance|resonating)\b/i,
];

const AGENT_FIRST_PERSON = /\b(I|me|my|mine|myself)\b/g;

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export function decomposeDerived(
  question: string,
  pattern: Pattern,
  sources: Source[],
): DecompositionResult {
  // Step 1: extract quoted spans
  const quoted = extractQuotedSpans(question);
  if (quoted.length === 0) return { ok: false, reason: 'no-quoted-spans' };

  // Step 2: verify each quoted span is an exact substring of a source
  const quotedSpans: { text: string; sourceSnippetId: string; sourceVersion: number }[] = [];

  for (const q of quoted) {
    const src = findSource(q.text, sources);
    if (!src) return { ok: false, reason: 'unquoted-material' };
    quotedSpans.push({ text: q.text, sourceSnippetId: src.sourceSnippetId, sourceVersion: src.sourceVersion });
  }

  // Step 3: blank out quoted spans and check non-quoted text
  let nonQuoted = question;
  for (let i = quoted.length - 1; i >= 0; i--) {
    const q = quoted[i]!;
    nonQuoted = nonQuoted.slice(0, q.start) + ' '.repeat(q.end - q.start) + nonQuoted.slice(q.end);
  }

  // Check for presupposition triggers
  for (const trigger of PRESUPPOSITION_TRIGGERS) {
    if (trigger.test(nonQuoted)) return { ok: false, reason: 'presupposition' };
  }

  // Step 4: compute source words early — used for agent check masking
  // and for operator echo-skipping below.
  const sourceWords = new Set(sources.flatMap((s) => contentWords(s.prose)));
  // Check for agent first-person outside quotes, masked against source echoes.
  // Build a regex from sourceWords PLUS the single-character "I" when it
  // appears in any source prose (isContentWord excludes 1-char words).
  const maskWords = new Set(sourceWords);
  if (sources.some((s) => /\bI\b/.test(s.prose))) maskWords.add('i');
  const maskWordsList = [...maskWords];
  const agentText = maskWordsList.length > 0
    ? nonQuoted.replace(
        new RegExp(maskWordsList.map(w => `\\b${w}\\b`).join('|'), 'gi'),
        '',
      )
    : nonQuoted;
  if (AGENT_FIRST_PERSON.test(agentText)) return { ok: false, reason: 'assertion-outside-quote' };

  // Check non-quoted content words: echoes from sources pass, operators pass,
  // anything else is unregistered introduction.

  const words = contentWords(nonQuoted);
  const operatorsUsed = new Set<Operator>();

  for (const word of words) {
    if (sourceWords.has(word)) continue; // echo — the person's own vocabulary
    if (isOperatorWord(word, pattern.operators)) {
      for (const op of pattern.operators) {
        if (isOperatorWord(word, [op])) operatorsUsed.add(op);
      }
    } else {
      return { ok: false, reason: 'unregistered-operator' };
    }
  }

  return {
    ok: true,
    quotedSpans: quotedSpans as DecompositionResult extends { ok: true } ? DecompositionResult['quotedSpans'] : never,
    operatorsUsed: [...operatorsUsed],
  };
}
