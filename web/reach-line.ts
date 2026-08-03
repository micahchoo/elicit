/**
 * The Reach offer as the waiting surface reads it (plan Task 14): one dimmed
 * line, nothing on silence, and two words — reach it · not now.
 *
 * Pure seams, separated from web/main.ts because main.ts touches the DOM at
 * import time and this repo has no DOM test environment (plan Task 13 Step 3
 * note): the sentence, the decline path, and the navigation are the testable
 * contract; `renderWaiting` in main.ts is the only caller, and it owns the
 * element work.
 *
 * The line takes the cadence line's idiom exactly (Q-37: the record,
 * offered, and nothing acts on it): dimmed, `:empty` hidden, and the
 * `.reach-offer` class carries the style.
 */

/** The offer the route sends: one unharvested region, and the terms that matched. */
export type ReachOfferLine = {
  path: string;
  unread: number;
  terms: string[];
};

/**
 * The one sentence the waiting surface shows, or null for silence. An offer
 * of nothing renders nothing at all — no empty state, no "nothing to offer"
 * line: silence is the correct output and it must look like silence.
 */
export function offerSentence(offer: ReachOfferLine | null): string | null {
  if (offer === null) return null;
  const notes = offer.unread === 1 ? '1 note' : `${offer.unread} notes`;
  return `${offer.path} has ${notes} you have not harvested; what is open now touches it.`;
}

/** Where a decline goes: one click, one recorded signal (Q-22, never escalated). */
export function declinePath(): string {
 return '/api/reach/decline';
}

/** Where `reach it` goes: the map, opened at the region the offer named. */
export function reachItNav(path: string): { screen: 'import'; focus: string } {
  return { screen: 'import', focus: path };
}
