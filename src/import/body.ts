/**
 * The proven body pipeline, moved verbatim out of `scripts/ingest-posts.ts`
 * (which ran it against 47 real posts and 295 hand-marked cuts on 2026-08-02).
 * Pure functions, no I/O. The surface re-points at this one copy so a bugfix
 * cannot drift from the auditable record of what was ingested.
 */

import type { Turn } from '../types.js';
import { ORPHAN_QUOTES } from './prior-ingest.js';

/** Strip Hugo shortcodes, images, bare links and HTML. */
export function clean(md: string, keepQuotes: boolean): string {
  return md
    // {{< card >}}…{{< /card >}} and self-closing shortcodes
    .replace(/\{\{[<%][\s\S]*?[>%]\}\}/g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t.length === 0) return true;
      if (!keepQuotes && t.startsWith('>')) return false;   // other people's words
      if (/^!\[/.test(t)) return false;                      // images
      if (/^\[.*\]\(.*\)$/.test(t)) return false;            // link-only lines
      if (/^https?:\/\//.test(t)) return false;              // bare URLs
      if (/^[-*]\s*$/.test(t)) return false;
      if (/^<.*>$/.test(t)) return false;                    // raw HTML
      return true;
    })
    .join('\n');
}

/**
 * Paragraphs carrying an inline academic citation are dropped whole.
 *
 * Essayistic sources are the specific hazard and the reason the rule is
 * mechanical rather than a judgement: quotations get set as ordinary
 * paragraphs with the citation trailing, and sometimes with no quote marks
 * at all because the citation sits on the NEXT paragraph. A reader cannot
 * tell those from the author's own sentences, so neither can a harvester.
 * The cases only a reader can find live in `ORPHAN_QUOTES` (the local
 * prior-ingest tables).
 */
export function dropCitedParagraphs(text: string): { kept: string; dropped: number } {
  const paras = text.split(/\n\s*\n/);
  let dropped = 0;
  const kept = paras.filter((p) => {
    // This regex requires the year to sit immediately before the closing
    // paren, so a citation carrying a page number escapes it: `[(Name 2008,
    // p. 83)]` does not match because `, p. 83` follows `2008`. That is a
    // real hole — six paragraphs slipped through the 2026-08-02 dry run and
    // four reproduced sentences reached review as the author's own prose.
    //
    // It is left narrow ON PURPOSE. Widening it to `\d{4}[^)]*\)` was tried
    // and measured: it closes the hole, and it also drops seven more
    // paragraphs of which five ARE the author's own prose — sentences that
    // name a source while making their own point ("a method I am borrowing
    // from ..."). Narrowing it instead to cited-AND-contains-a-quote-mark
    // fails the same way, because writers quote a word inside their own
    // argument.
    //
    // Paragraph-level citation filtering cannot separate "reproducing
    // someone" from "citing someone while making one's own point". The
    // separation happens at CUT level in `isQuotedFromSource`
    // (src/harvester/admissibility.ts), which is exact — 7 of 295 on the dry
    // run, zero false positives — and which makes widening this one a pure
    // loss. Unmarked quotations, which neither rule can see, stay the
    // manifest's job (`dropSections`, `ORPHAN_QUOTES`); Q-51 says that
    // judgement is not automatable, and this is where that bites.
    const cited = /\[\([A-Z][^)]*\d{4}\)\]\(#/.test(p) || /\(\s*[A-Z][a-z]+\s+(and|&)?\s*[A-Za-z]*\s*\d{4}\s*\)/.test(p);
    const orphan = ORPHAN_QUOTES.some((q) => p.includes(q));
    if (cited || orphan) { dropped++; return false; }
    return true;
  }).join('\n\n');
  return { kept, dropped };
}

/**
 * Split into turns on paragraph boundaries, never mid-sentence.
 *
 * `propose()` verifies each cut as an exact substring of ITS OWN turn, so a
 * split through a sentence destroys any cut that spanned it.
 */
export function toTurns(text: string, at: string, maxWords = 320): Turn[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const turns: Turn[] = [];
  let buf: string[] = [];
  let count = 0;
  const flush = () => {
    if (buf.length === 0) return;
    turns.push({ role: 'user', text: buf.join('\n\n'), at });
    buf = []; count = 0;
  };
  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (count > 0 && count + w > maxWords) flush();
    buf.push(p); count += w;
  }
  flush();
  return turns;
}
