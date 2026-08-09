import type { Entry, Offer, Piece } from './contract.js';
import type { QueueEntry } from '../types.js';

/**
 * Output A — the annotated export (redesign-2026-08-09 §6). Two zero-LLM
 * exports, both printing holes that already exist: `clean` — your words,
 * in order, gaps omitted — what ships; `with the questions` — your words,
 * plus every open gap in the margin as a blockquote, plus the open offers
 * listed at the end — the working document.
 *
 * Neither export ever sees the subject (Q-1: the subject describes the
 * gathering, not the writing), and neither ever sees a model sentence: a
 * model-placed gap carries only {id, kind, placedBy, question, pending}
 * (noProse), and these functions take no Complete and add no prose.
 *
 * Pins render as their pinned version's prose (Q-5 — a stale pin exports
 * the old words on purpose), in `entries` order, separated by one blank
 * line. A pin whose version cannot be resolved throws: an export missing a
 * paragraph with no complaint is worse than a failed export.
 */

function resolveParagraphs(
  entries: Entry[],
  versions: (snippet: string, version: number) => string | null,
): string[] {
  const paragraphs: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'pin') continue;
    const prose = versions(entry.snippet, entry.version);
    if (prose === null) {
      throw new Error(`cannot resolve pin ${entry.id}: ${entry.snippet}@${entry.version} has no text`);
    }
    paragraphs.push(prose);
  }
  return paragraphs;
}

/**
 * The clean export — your words, in order, gaps omitted. Gaps and
 * Marginalia render as nothing: a gap is a fact about the draft, not about
 * the text. No frontmatter, no heading, no separator, no trailing metadata
 * — the file begins with the first sentence.
 */
export function toCleanMarkdown(
  entries: Entry[],
  versions: (snippet: string, version: number) => string | null,
): string {
  return resolveParagraphs(entries, versions).join('\n\n') + '\n';
}

/**
 * The working-document export — your words, plus every open gap in the
 * margin as a blockquote, plus the open offers listed at the end. A gap is
 * open while it sits in the entries (an answered-but-unplaced gap is still
 * a hole); its blockquote prints the minted question's words, or the
 * model's verified pending text — whichever exists. A questionless gap
 * (inserted under a set-down piece, Q-41) prints nothing. The offers
 * section appears only when offers are open, and never names the subject.
 */
export function toQuestionsMarkdown(
  piece: Piece,
  versions: (snippet: string, version: number) => string | null,
  queueEntries: QueueEntry[],
  offers: Offer[],
): string {
  const byEntryId = new Map(queueEntries.map((e) => [e.id, e]));
  const lines: string[] = [];
  for (const entry of piece.entries) {
    if (entry.kind === 'pin') {
      const prose = versions(entry.snippet, entry.version);
      if (prose === null) {
        throw new Error(`cannot resolve pin ${entry.id}: ${entry.snippet}@${entry.version} has no text`);
      }
      lines.push(prose);
      continue;
    }
    // The minted entry's words, else the model's verified pending text,
    // else nothing (a questionless gap renders nothing — Q-41's set-down
    // hole has no question to print).
    const q =
      entry.question !== undefined
        ? (byEntryId.get(entry.question)?.question ?? entry.pending ?? null)
        : (entry.pending ?? null);
    if (q !== null) lines.push(`> ${q}`);
  }
  const body = lines.join('\n\n');
  if (offers.length === 0) return `${body}\n`;
  const listed = offers
    .map((o) => {
      const prose = versions(o.snippet, o.version);
      if (prose === null) {
        throw new Error(`cannot resolve offer ${o.id}: ${o.snippet}@${o.version} has no text`);
      }
      return `- ${prose}`;
    })
    .join('\n');
  return `${body}\n\n## Open offers\n\n${listed}\n`;
}
