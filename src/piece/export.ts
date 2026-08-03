import type { Arrangement } from './contract.js';

/**
 * The artifact that leaves the app — Q-1's guarantee at its strongest.
 *
 * Pins render as their pinned version's prose (Q-5 — a stale pin exports
 * the old words on purpose, and Q-39 says why), in `entries` order,
 * separated by one blank line. Gaps and Marginalia render as nothing: a
 * gap is a fact about the draft, not about the text, and Marginalia are
 * never part of the Piece text. No frontmatter, no heading, no separator,
 * no trailing metadata — the file begins with the first sentence.
 *
 * A pin whose version cannot be resolved throws: an export missing a
 * paragraph with no complaint is worse than a failed export.
 */
export function toMarkdown(a: Arrangement, versions: (snippet: string, version: number) => string | null): string {
  const paragraphs: string[] = [];
  for (const entry of a.entries) {
    if (entry.kind !== 'pin') continue;
    const prose = versions(entry.snippet, entry.version);
    if (prose === null) {
      throw new Error(`cannot resolve pin ${entry.id}: ${entry.snippet}@${entry.version} has no text`);
    }
    paragraphs.push(prose);
  }
  return paragraphs.join('\n\n') + '\n';
}
