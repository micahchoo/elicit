/**
 * Intake dedupe — §12.1, Batch C2 (the audit deltas).
 *
 * Near-duplicate detection at harvest intake, surfaced as a review sentence
 * ("this repeats what you said Tuesday — keep both?"), never a silent drop.
 * The detection home is the pending-record write: when a harvest run lands,
 * every proposal is compared against the corpus index that already exists on
 * disk, and each near-duplicate match is recorded on the pending record so
 * the review row can say so BEFORE the person decides. The passage is always
 * kept — the flag rides the record; the person keeps both or trims.
 *
 * The similarity is lexical word-set Jaccard (src/index/lexical.ts), the
 * deterministic channel that is always live: the embedding channel is a
 * quota'd background resource (§12's debts gate it behind full-corpus
 * coverage), while intake must not depend on an embedder being warm. The
 * threshold is deliberately high — near-duplicate means "the same thing said
 * again", not "the same theme touched". The probe guards flag word-set
 * Jaccard >= 0.5 as a question REJECT, and the sounding license treats mean
 * adjacent Jaccard >= 0.10 as a sustained thread; both are thematic
 * similarity, not duplication. A passage that re-says an older one in
 * almost the same words lands far above those; a passage that merely shares
 * a theme lands far below.
 *
 * Exact-body duplicates are included by construction: Jaccard of an exact
 * repeat is 1.0. The old silent exact-body drop in decide() (ticket 145) is
 * gone — a byte-identical passage in a later sitting is flagged and kept,
 * exactly like its near cousin.
 */
import type { Index, CutProposal } from '../types.js';
import { contentWordsOf, jaccard } from '../index/lexical.js';

/**
 * One near-duplicate match: which proposal repeats which earlier snippet,
 * and when the earlier passage was captured (the sentence's date).
 */
export type RepeatsFlag = {
 /** The proposal index (proposals[proposal].text is the repeated passage). */
 proposal: number;
 /** The older snippet the proposal repeats — its id and capture date. */
 olderSnippetId: string;
 olderCaptured: string;
};

/**
 * The near-duplicate bar: word-set Jaccard over content words. 0.85 —
 * above the guard's 0.5 (a REJECT-level overlap is not yet a repeat) and
 * far above the sounding's 0.10; see the module header for the reasoning.
 * A function, not a scalar const, so the mechanism registry's enumerator
 * sees it.
 */
export function REPEAT_JACCARD_THRESHOLD(): number {
 return 0.85;
}

/**
 * Passages need at least this many content words before near-duplicate
 * detection has a stable shape. A two-word passage repeating a one-word
 * snippet is an exact-body case or nothing; a short passage whose few
 * content words coincide with an older one's is not a "repeat of what you
 * said Tuesday" worth a sentence.
 */
const MIN_CONTENT_WORDS = 4;

/**
 * Which of this harvest's proposals near-repeat a snippet already in the
 * corpus. The corpus is the vault index as it exists when the harvest
 * lands — the sitting's OWN passages are not yet committed, so they are
 * not candidates (a passage repeats what came before it, not what it
 * sits beside).
 *
 * Returns one flag per flagged proposal — the proposal's closest corpus
 * match, when that match clears the threshold. Matches are never dropped
 * and never merged here; the flag is the entire effect.
 */
export function detectRepeats(
 proposals: CutProposal[],
 index: Index,
): RepeatsFlag[] {
 if (proposals.length === 0) return [];
 const snippets = Object.values(index.snippets);
 if (snippets.length === 0) return [];

 // Content words per corpus snippet, computed once.
 const corpus = snippets.map((s) => ({ id: s.id, captured: s.captured, words: contentWordsOf(s.prose) }));

 const flags: RepeatsFlag[] = [];
 for (let i = 0; i < proposals.length; i++) {
  const text = proposals[i]!.text;
  const words = contentWordsOf(text);
  if (words.size < MIN_CONTENT_WORDS) continue;

  let best: { id: string; captured: string; score: number } | null = null;
  for (const s of corpus) {
   if (s.words.size < MIN_CONTENT_WORDS) continue;
   const score = jaccard(words, s.words);
   if (score >= REPEAT_JACCARD_THRESHOLD() && (best === null || score > best.score)) {
    best = { id: s.id, captured: s.captured, score };
   }
  }
  if (best !== null) {
   flags.push({ proposal: i, olderSnippetId: best.id, olderCaptured: best.captured });
  }
 }
 return flags;
}
