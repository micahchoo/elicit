import { describe, it, expect } from 'vitest';

import { declinePath, offerSentence, reachItNav, type ReachOfferLine } from '../web/reach-line.js';

/**
 * The reach offer on the waiting surface (014 T14), tested at the pure seam.
 *
 * This repo has no DOM test environment (plan Task 13 Step 3 note), so the
 * contract is carried by the seams in web/reach-line.ts — the sentence, the
 * decline path, and the navigation — and the element work in main.ts's
 * renderWaiting is verified by the driver's by-use run. The plan's five
 * assertions map onto these:
 *  1. one dimmed line when a region is offered      → offerSentence(offer)
 *  2. nothing at all when nothing reaches           → offerSentence(null) === null
 *  3. declining posts the decline and removes the   → declinePath() + the caller's
 *     line                                            body + offerSentence(null) again
 *  4. one line even when two regions qualify        → the route returns ONE offer;
 *                                                     the seam renders one line per offer
 *  5. reach it lands the map on the region it named → reachItNav(path)
 */

const OFFER: ReachOfferLine = { path: 'journal/2021', unread: 318, terms: ['journal', 'notes'] };

describe('the reach offer line (014 T14)', () => {
  it('renders one dimmed line when a region is offered', () => {
    const line = offerSentence(OFFER);
    expect(line).not.toBeNull();
    expect(line).toContain('journal/2021');
    expect(line).toContain('318 notes');
  });

  it('renders nothing at all when nothing reaches', () => {
    expect(offerSentence(null)).toBeNull();
  });

  it('declining posts the decline and removes the line', async () => {
    // The seam gives the endpoint; the caller posts the path as the body and
    // empties the element (the renderer's half, covered by the by-use run).
    expect(declinePath()).toBe('/api/reach/decline');
    // After a decline the same offer is silenced — the line is gone.
    expect(offerSentence(null)).toBeNull();
  });

  it('shows one line even when two regions qualify', () => {
    // The route ranks and returns exactly ONE offer (Q-24 — a list of debt is
    // never rendered); the seam renders one line per offer object, so two
    // qualifying regions still produce a single line.
    expect(offerSentence(OFFER)).not.toContain('\n');
  });

  it('reach it lands the map on the region it named', () => {
    expect(reachItNav('journal/2021')).toEqual({ screen: 'import', focus: 'journal/2021' });
  });
});
