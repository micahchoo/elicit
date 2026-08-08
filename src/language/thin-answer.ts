/**
 * Pivot heuristic: detect content-free closed answers that license NO deepening.
 *
 * A content-free answer is one whose signal is too thin to support a composed
 * follow-up — short, no evaluative/narrative content. The elicitor pivots past
 * composition entirely and draws the next queue/bank question instead.
 *
 * This is a cheap code heuristic (length + marker words), not a model call.
 * The pivot itself is a code path, not a prompt hope.
 */

/** Word stems that signal evaluative or narrative content worth following. */
const MARKER_STEMS = [
 'because',
 'feel',     // feel, feeling, feels, felt
 'think',    // think, thinking, thinks, thought
 'want',     // want, wanting, wants, wanted
 'remembe',  // remember, remembering, remembered
 'realiz',   // realize, realized, realizing
 'notic',    // notice, noticed, noticing
 'wonder',
 'wish',
 'hope',
 'believ',   // believe, believed, believing
 'decid',    // decide, decided, deciding
 'learn',    // learn, learned, learning
 'chang',    // change, changed, changing
 'meant',
 'matter',   // matter, matters, mattered
 'mean',     // mean, meaning, meant
 'maybe',
 'perhaps',
 'sometime', // sometimes, sometime
 'always',
 'never',
 'still',
 'again',
 'before',
 'after',
 'when',
 'where',
 'why',
 'how',
];

/** Max word count for content-free classification. */
const MAX_WORDS = 8;

/**
 * Returns true if the answer is too thin to license composition.
 *
 * Heuristic: < 8 words AND no evaluative/narrative marker words.
 * A content-free closed answer gets a fresh bank/queue draw instead of
 * a composed follow-up.
 */
export function isContentFree(text: string): boolean {
 const trimmed = text.trim();
 if (trimmed.length === 0) return true;

 const words = trimmed.split(/\s+/);

 // Very short answers are candidates
 if (words.length >= MAX_WORDS) return false;

 // Check for marker stems (case-insensitive substring match)
 const lower = trimmed.toLowerCase();
 for (const stem of MARKER_STEMS) {
  if (lower.includes(stem)) return false;
 }

 return true;
}
