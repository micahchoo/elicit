/**
 * The words a person reads where the code holds a machine literal.
 *
 * One rule, three maps: **no enum member of this system reaches a human
 * surface as itself.** Ticket 038 closed because the activity stream leaked
 * ULIDs onto a surface a person reads; ticket 063 found 26 event kinds
 * rendering as two context-free words. `src/log/format.ts` answers that for the
 * Activity Log. This file answers it for the waiting surface and the wiki, and
 * it is a module rather than a literal in a render function for the reason S19
 * gives: a `Record` keyed by the union makes a new member fail to COMPILE, and
 * a unit test can catch a map that exists and is mis-keyed, which a grep over
 * the render layer cannot.
 *
 * Q-15 governs every string below. Nothing on these surfaces may accuse: a
 * question is met as an ordinary question, a Contradiction as material, and a
 * lint note as a remark about evidence — never as a verdict on the person.
 *
 * **On the path.** `sourceLabel` is what the plan and the manifest name, and
 * `web/main.ts` imports this file by this path. The facet and lint maps belong
 * beside it because they answer the same rule for the same reader, and there is
 * no better home in the tree today: `src/wiki/` holds the wiki's own shapes,
 * and a label is a render concern rather than a wiki concern. A later pass that
 * moves all three to `src/labels.ts` should do so; until then the file name
 * names its first member rather than its rule.
 */

import type { Facet, QueueEntry } from '../types.js';
import type { LintFinding } from '../wiki/contract.js';

/**
 * Where a waiting question came from, in words.
 *
 * Four of the five say the same thing, and that is the requirement rather than
 * an oversight (S3). `contradiction-remeasure` and `lint-still-true` are the
 * two literals this slice adds, and a re-measure that announces itself as a
 * re-measure is the verification Q-15 forbids — so both read as the ordinary
 * question `composed` is. Only `user-declared` differs, because the person
 * parked that one themselves and knows it.
 */
const SOURCE_LABELS: Record<QueueEntry['source'], string> = {
  composed: 'from your own words',
  'still-true': 'from your own words',
  'user-declared': 'you set this aside',
  'contradiction-remeasure': 'from your own words',
  'lint-still-true': 'from your own words',
};

export function sourceLabel(s: QueueEntry['source']): string {
  return SOURCE_LABELS[s];
}

/**
 * A facet as a section heading on the wiki.
 *
 * `docs/interface-references.md` makes facets the headings of the essay, and
 * three of the eight literals are hyphenated slugs. Each heading here is that
 * facet's own definition from the harvest prompt (`src/harvester/harvester.ts`)
 * said in a reader's words, so the two cannot drift into different meanings.
 */
const FACET_HEADINGS: Record<Facet, string> = {
  episode: 'Occasions',
  'general-event': 'What happens again and again',
  'lifetime-period': 'Stretches of life',
  fact: 'Steady facts',
  construct: 'Distinctions drawn',
  intention: 'Wants and plans',
  value: 'What is worth doing',
  'causal-theory': 'Explanations of the self',
};

export function facetHeading(f: Facet): string {
  return FACET_HEADINGS[f];
}

/**
 * A lint finding as the dimmed marginal line the document rule describes.
 *
 * The note is built from the KIND alone and never from `LintFinding.detail`,
 * which carries claim ids and `snippetId@version` cites — the exact leak ticket
 * 038 closed. What the reader needs is what kind of remark this is; which cite
 * is stale is the Clerk's business and stays in the Activity Log.
 */
const LINT_NOTES: Record<LintFinding['kind'], string> = {
  'stale-citation': 'the words behind this were written again since',
  'orphan-claim': 'nothing in the vault stands behind this any more',
  'god-node-facet': 'this section has grown large enough to be worth dividing',
  'merge-candidate': 'two names here may turn out to be one',
};

export function lintNote(k: LintFinding['kind']): string {
  return LINT_NOTES[k];
}
