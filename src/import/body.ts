/**
 * The proven body pipeline, moved verbatim out of `scripts/ingest-posts.ts`
 * (which ran it against 47 real posts and 295 hand-marked cuts on 2026-08-02).
 * Pure functions, no I/O. The surface re-points at this one copy so a bugfix
 * cannot drift from the auditable record of what was ingested.
 */

import type { Turn } from '../types.js';

/**
 * The line-drop vocabulary, in one copy: `clean` deletes by it and the
 * review surface (server.ts `droppedRegions`) names dropped regions by it,
 * so a bugfix to either cannot drift from the other.
 */
export const IMAGE_LINE = /^!\[/;
export const LINK_ONLY_LINE = /^\[.*\]\(.*\)$/;
export const BARE_URL_LINE = /^https?:\/\//;
export const RAW_HTML_LINE = /^<.*>$/;
export const SHORTCODE = /\{\{[<%][\s\S]*?[>%]\}\}/;
export const BULLET_ONLY_LINE = /^[-*]\s*$/;

/** The two citation shapes `dropCitedParagraphs` drops on. */
export const INLINE_CITE = /\[\([A-Z][^)]*\d{4}\)\]\(#/;
export const PAREN_CITE = /\(\s*[A-Z][a-z]+\s+(and|&)?\s*[A-Za-z]*\s*\d{4}\s*\)/;

export type DroppedRunKind = 'quoted' | 'cited' | 'not-prose';

/**
 * Classify one run of dropped lines the way the review surface names them:
 * quoted beats cited beats not-prose. A line `clean` deletes that matches
 * no rule here — the bullet-only line — falls to 'not-prose', which is
 * what the review marks showed before this vocabulary moved home.
 */
export function classifyDroppedRun(lines: string[]): DroppedRunKind {
  const trimmed = lines.map((l) => l.trim());
  const any = (re: RegExp): boolean => trimmed.some((t) => re.test(t));
  if (trimmed.every((t) => t.startsWith('>'))) return 'quoted';
  if (any(IMAGE_LINE) || any(LINK_ONLY_LINE) || any(BARE_URL_LINE) || any(RAW_HTML_LINE) || any(SHORTCODE)) return 'not-prose';
  if (any(INLINE_CITE) || any(PAREN_CITE)) return 'cited';
  return 'not-prose';
}

/**
 * The regions of a source body that preparation dropped, and why — the
 * reader sees *why* a paragraph carries no cuts. `at`/`length` are offsets
 * into the source body, so the surface can mark the words in place. A line
 * survives iff its trailing-whitespace-stripped text is empty (blank lines
 * are separators, never marks) or appears in the prepared prose; consecutive
 * non-surviving lines form one mark, named by `classifyDroppedRun` — the
 * same vocabulary `clean` deletes by (moved home with the classifier).
 */
export type DroppedRegion = { at: number; length: number; why: DroppedRunKind };

export function droppedRegions(body: string, prepared: string): DroppedRegion[] {
  const preparedLines = new Set(prepared.split('\n').map((l) => l.trimEnd()));
  const survives = (line: string): boolean => {
    const t = line.trimEnd();
    return t === '' || preparedLines.has(t);
  };
  const marks: DroppedRegion[] = [];
  let runStart = -1;
  let runEnd = 0;
  let at = 0;
  const mark = (): DroppedRegion => ({
    at: runStart,
    length: runEnd - runStart,
    why: classifyDroppedRun(body.slice(runStart, runEnd).split('\n')),
  });
  for (const line of body.split('\n')) {
    if (survives(line)) {
      if (runStart !== -1) marks.push(mark());
      runStart = -1;
    } else if (runStart === -1) {
      runStart = at;
      runEnd = at + line.length;
    } else {
      runEnd = at + line.length;
    }
    at += line.length + 1;
  }
  if (runStart !== -1) marks.push(mark());
  return marks;
}

/** Strip Hugo shortcodes, images, bare links and HTML. */
export function clean(md: string, keepQuotes: boolean): string {
  return md
    // {{< card >}}…{{< /card >}} and self-closing shortcodes
    .replace(new RegExp(SHORTCODE.source, 'g'), '')
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t.length === 0) return true;
      if (!keepQuotes && t.startsWith('>')) return false;   // other people's words
      if (IMAGE_LINE.test(t)) return false;                  // images
      if (LINK_ONLY_LINE.test(t)) return false;              // link-only lines
      if (BARE_URL_LINE.test(t)) return false;               // bare URLs
      if (BULLET_ONLY_LINE.test(t)) return false;
      if (RAW_HTML_LINE.test(t)) return false;               // raw HTML
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
 * The cases only a reader can find live in the caller-supplied
 * orphan-quote list (prior-ingest tables).
 */
export function dropCitedParagraphs(text: string, orphanQuotes: string[]): { kept: string; dropped: number } {
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
    const cited = INLINE_CITE.test(p) || PAREN_CITE.test(p);
    const orphan = orphanQuotes.some((q) => p.includes(q));
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
