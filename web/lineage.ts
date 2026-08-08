/**
 * The lineage block: the eliciting question and its context window, dimmed
 * above a quotation — lineage, not corpus (the same dimmed register on the
 * harvest review card, the wiki's quotes and the anniversary card). Nothing
 * renders when neither field is present.
 *
 * The el verb is injected per call (the seam, web/deps.ts); this helper is
 * pure prose-building, so it takes the DOM verb as its first argument
 * rather than holding module state.
 */

import type { WebDepsCore } from './deps.js';

/**
 * The eliciting question and context window, dimmed — lineage, not corpus.
 * Null when there is nothing to show.
 */
export function lineageBlock(
 el: WebDepsCore['el'],
 question: string | undefined,
 context: string | undefined,
): HTMLElement | null {
 if (!question && !context) return null;
 const prov = el('div', { class: 'lineage-provenance' });
 if (question) {
  const q = el('div', { class: 'lineage-question' });
  q.textContent = '\u2191 ' + question;  // up-arrow: "this asked"
  prov.append(q);
 }
 if (context) {
  const ctx = el('div', { class: 'lineage-context' });
  // Show context then the cut's boundary marked with a hairline
  ctx.textContent = context + ' \u2500';  // em-dash marks boundary
  prov.append(ctx);
 }
 return prov;
}
