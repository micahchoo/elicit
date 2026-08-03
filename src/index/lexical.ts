import type { Snippet, LexicalIndex, ResonanceHit } from '../types.js';

// ── Stopwords ────────────────────────────────────────────────────────────
const STOPWORDS = new Set([
 'a', 'an', 'the', 'and', 'or', 'but', 'if', 'as', 'at', 'by', 'for',
 'from', 'in', 'into', 'of', 'off', 'on', 'onto', 'out', 'over', 'to',
 'up', 'with', 'about', 'above', 'after', 'before', 'between', 'during',
 'through', 'under', 'without', 'is', 'am', 'are', 'was', 'were', 'be',
 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
 'doing', 'will', 'would', 'shall', 'should', 'can', 'could', 'may',
 'might', 'must', 'it', 'its', 'he', 'she', 'they', 'we', 'you', 'i',
 'me', 'my', 'your', 'his', 'her', 'their', 'our', 'this', 'that',
 'these', 'those', 'then', 'than', 'so', 'such', 'both', 'each', 'every',
 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'no', 'not', 'nor',
 'only', 'own', 'same', 'too', 'very', 'just', 'also', 'now', 'here',
 'there', 'when', 'where', 'why', 'how', 'who', 'whom', 'whose', 'what',
 'which', 'while', 'well', 'yet', 'still', 'again', 'even', 'though',
 'although', 'because', 'since', 'until', 'once',
]);

// ── Tokenization ─────────────────────────────────────────────────────────

interface Token {
 word: string;    // lowercase, stripped of edge punctuation
 original: string; // original casing
 start: number;    // character offset
 end: number;      // character offset after token
}

const TOKEN_RE = /[a-zA-Z0-9]+(?:[''-][a-zA-Z0-9]+)*/g;

function tokenize(text: string): Token[] {
 const tokens: Token[] = [];
 let match: RegExpExecArray | null;
 while ((match = TOKEN_RE.exec(text)) !== null) {
  tokens.push({
   word: match[0].toLowerCase(),
   original: match[0],
   start: match.index,
   end: match.index + match[0].length,
  });
 }
 return tokens;
}

function isStopword(word: string): boolean {
 return STOPWORDS.has(word);
}

function isAllStopwords(words: string[]): boolean {
 return words.every(isStopword);
}

// ── Content-word extraction for diversity ────────────────────────────────

function extractContentWords(tokens: Token[]): Set<string> {
 return new Set(
  tokens
   .filter(t => !isStopword(t.word))
   .map(t => t.word),
 );
}

/** Content words of a text string, for callers that hold no token stream. */
export function contentWordsOf(text: string): Set<string> {
 return extractContentWords(tokenize(text));
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B| */
export function jaccard(a: Set<string>, b: Set<string>): number {
 if (a.size === 0 && b.size === 0) return 0;
 let intersection = 0;
 for (const item of a) {
  if (b.has(item)) intersection++;
 }
 return intersection / (a.size + b.size - intersection);
}

// ── Internal index structure ─────────────────────────────────────────────

interface IndexHit {
 snippetId: string;
 version: number;
 tokenStart: number; // position in snippet's token array
 snippetText: string;
 contentWords: Set<string>;
}

interface InternalIndex {
 _brand: 'LexicalIndex';
 /** trigram (3 words space-joined) → [hits] */
 entries: Map<string, IndexHit[]>;
 /** snippetId → token array with character positions */
 tokens: Map<string, Token[]>;
 snippetCount: number;
}

// ── Shared phrase extraction ─────────────────────────────────────────────

/**
 * Given a word-level match span, extract the character-level substring
 * from the query that also appears verbatim in the snippet text.
 * If the direct query slice doesn't appear verbatim, try the snippet slice.
 * If neither works, trim from ends until a verbatim substring (≥3 words) is found.
 * Returns null if no valid 3+-word verbatim shared phrase exists.
 */
function extractSharedPhrase(
 queryText: string,
 snippetText: string,
 queryTokens: Token[],
 snippetTokens: Token[],
 qStart: number, // start token index in query
 qEnd: number,   // exclusive end token index in query
 sStart: number, // start token index in snippet
 sEnd: number,   // exclusive end token index in snippet
): string | null {
 // Try query's exact substring in snippet
 const queryPhrase = queryText.slice(
  queryTokens[qStart]!.start,
  queryTokens[qEnd - 1]!.end,
 );
 if (snippetText.includes(queryPhrase)) {
  return queryPhrase;
 }

 // Try snippet's exact substring in query
 const snippetPhrase = snippetText.slice(
  snippetTokens[sStart]!.start,
  snippetTokens[sEnd - 1]!.end,
 );
 if (queryText.includes(snippetPhrase)) {
  return snippetPhrase;
 }

 // Neither exact substring works — trim from ends to find a compatible span.
 // This handles single-word casing mismatches at edges (e.g., "The" vs "the").
 let left = qStart;
 let right = qEnd;

 while (right - left >= 3) {
  // Try trimming left
  if (left < qStart + (qEnd - qStart - 3)) {
   const lPhrase = queryText.slice(
    queryTokens[left + 1]!.start,
    queryTokens[right - 1]!.end,
   );
   if (snippetText.includes(lPhrase)) return lPhrase;
   const sLPhrase = snippetText.slice(
    snippetTokens[sStart + (left + 1 - qStart)]!.start,
    snippetTokens[sEnd - 1]!.end,
   );
   if (queryText.includes(sLPhrase)) return sLPhrase;
   left++;
   continue;
  }
  // Try trimming right
  if (right > qStart + 3) {
   const rPhrase = queryText.slice(
    queryTokens[left]!.start,
    queryTokens[right - 2]!.end,
   );
   if (snippetText.includes(rPhrase)) return rPhrase;
   const sRPhrase = snippetText.slice(
    snippetTokens[sStart + (left - qStart)]!.start,
    snippetTokens[sEnd - 1 - (qEnd - right + 1)]!.end,
   );
   if (queryText.includes(sRPhrase)) return sRPhrase;
   right--;
   continue;
  }
  break;
 }

 return null;
}

// ── Public API ───────────────────────────────────────────────────────────

export function buildIndex(snippets: Snippet[]): LexicalIndex {
 const entries = new Map<string, IndexHit[]>();
 const tokens = new Map<string, Token[]>();

 for (const snip of snippets) {
  const toks = tokenize(snip.prose);
  tokens.set(snip.id, toks);
  const cw = extractContentWords(toks);

  // Extract all trigrams (3 consecutive words)
  for (let i = 0; i <= toks.length - 3; i++) {
   const trigramWords = [toks[i]!.word, toks[i + 1]!.word, toks[i + 2]!.word];
   // Reject stopword-only trigrams
   if (isAllStopwords(trigramWords)) continue;

   const key = trigramWords.join(' ');
   const hit: IndexHit = {
    snippetId: snip.id,
    version: snip.version,
    tokenStart: i,
    snippetText: snip.prose,
    contentWords: cw,
   };
   const existing = entries.get(key);
   if (existing) {
    existing.push(hit);
   } else {
    entries.set(key, [hit]);
   }
  }
 }

 const index: InternalIndex = {
  _brand: 'LexicalIndex' as const,
  entries,
  tokens,
  snippetCount: snippets.length,
 };

 return index as LexicalIndex;
}

export function resonate(
 index: LexicalIndex,
 text: string,
 k: number = 5,
): ResonanceHit[] {
 const idx = index as unknown as InternalIndex;
 if (idx.snippetCount === 0) return [];

 const queryTokens = tokenize(text);
 if (queryTokens.length < 3) return [];

 // Collect all candidate hits with their query-token positions
 interface Candidate {
  snippetId: string;
  version: number;
  snippetText: string;
  contentWords: Set<string>;
  sharedPhrase: string;
  score: number;
 }

 const seen = new Map<string, Candidate>(); // key = snippetId + '|' + sharedPhrase
 const candidates: Candidate[] = [];

 // For each query trigram, find matching snippets
 for (let qPos = 0; qPos <= queryTokens.length - 3; qPos++) {
  const qTrigramWords = [
   queryTokens[qPos]!.word,
   queryTokens[qPos + 1]!.word,
   queryTokens[qPos + 2]!.word,
  ];
  if (isAllStopwords(qTrigramWords)) continue;

  const key = qTrigramWords.join(' ');
  const matches = idx.entries.get(key);
  if (!matches || matches.length === 0) continue;

  // Compute doc frequency (unique snippetIds for this trigram)
  const uniqueSnippetIds = new Set(matches.map(m => m.snippetId));
  const docFreq = uniqueSnippetIds.size;

  for (const match of matches) {
   const snippetTokens = idx.tokens.get(match.snippetId);
   if (!snippetTokens) continue;

   const sPos = match.tokenStart;

   // Extend left
   let leftExt = 0;
   while (
    qPos - leftExt - 1 >= 0 &&
    sPos - leftExt - 1 >= 0 &&
    queryTokens[qPos - leftExt - 1]!.word ===
    snippetTokens[sPos - leftExt - 1]!.word
   ) {
    leftExt++;
   }

   // Extend right (we start with 3 words = the trigram)
   let rightExt = 3;
   while (
    qPos + rightExt < queryTokens.length &&
    sPos + rightExt < snippetTokens.length &&
    queryTokens[qPos + rightExt]!.word ===
    snippetTokens[sPos + rightExt]!.word
   ) {
    rightExt++;
   }

   const wordCount = leftExt + rightExt;

   // Extract verbatim shared phrase
   const sharedPhrase = extractSharedPhrase(
    text,
    match.snippetText,
    queryTokens,
    snippetTokens,
    qPos - leftExt,
    qPos + rightExt,
    sPos - leftExt,
    sPos + rightExt,
   );

   if (!sharedPhrase) continue;

   // Verify at least 3 words in the shared phrase
   const phraseTokens = tokenize(sharedPhrase);
   if (phraseTokens.length < 3) continue;
   // Reject all-stopword phrases (shouldn't happen given the index filter,
   // but guard against edge cases from trimming)
   if (isAllStopwords(phraseTokens.map(t => t.word))) continue;

   const uniqueKey = `${match.snippetId}|${sharedPhrase}`;
   if (seen.has(uniqueKey)) continue;
   seen.set(uniqueKey, { snippetId: match.snippetId, version: 0, snippetText: '', contentWords: new Set(), sharedPhrase, score: 0 });

   // Score: longer phrases score higher; rarer phrases score higher
   const score = wordCount * Math.log(idx.snippetCount / docFreq + 1);

   candidates.push({
    snippetId: match.snippetId,
    version: match.version,
    snippetText: match.snippetText,
    contentWords: match.contentWords,
    sharedPhrase,
    score,
   });
  }
 }

 // Sort candidates by score descending
 candidates.sort((a, b) => b.score - a.score);

 // Overfetch: take top 3*k for diversity processing
 const overfetchLimit = Math.min(candidates.length, 3 * k);
 const overfetched = candidates.slice(0, overfetchLimit);

 // Deduplicate by snippetId (keep highest score — already sorted)
 const bySnippet = new Map<string, Candidate>();
 for (const c of overfetched) {
  if (!bySnippet.has(c.snippetId)) {
   bySnippet.set(c.snippetId, c);
  }
 }

 // Diversity: drop near-identical snippets (>80% shared content words)
 const diversified: Candidate[] = [];
 for (const c of bySnippet.values()) {
  let tooClose = false;
  for (const kept of diversified) {
   if (jaccard(c.contentWords, kept.contentWords) > 0.8) {
    tooClose = true;
    break;
   }
  }
  if (!tooClose) {
   diversified.push(c);
  }
 }

 // Return top k
 return diversified.slice(0, k).map(c => ({
  snippetId: c.snippetId,
  version: c.version,
  sharedPhrase: c.sharedPhrase,
  score: c.score,
  snippetText: c.snippetText,
 }));
}
