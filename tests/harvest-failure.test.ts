import { describe, it, expect } from 'vitest';

import { HARVEST_FAILED_SENTENCE, harvestFailedFor, type ActivityEventLike } from '../web/harvest-failure.js';

/**
 * The harvest-failure sentence on the reviews surface (ticket 154), tested
 * at the pure seam. A failed harvest writes no pending record — the only
 * client-reachable signal is the activity feed, so the matching logic is a
 * pure function over the feed's events.
 */

function ev(kind: string, detail: string, at = '2026-08-06T00:00:00.000Z'): ActivityEventLike {
  return { at, kind, detail };
}

/** The parse-failed detail shape: every chunk failing to parse (034 rule). */
const PARSE_FAILED =
  'proposals=0 buds=0 parsed=false parseMode=failed chunks=0/2 chunkErrors=2 fabricationDrops=0 ' +
  'cutsSeen=0 inadmissibleDrops=0 contentFreeSkips=0 sourceTurnCorrections=0';

describe('the harvest-failure sentence (ticket 154)', () => {
  it('reassures with the fact, not an apology', () => {
    expect(HARVEST_FAILED_SENTENCE).toBe(
      'the reader stumbled on this sitting; your words are safe in the transcript.',
    );
  });

  it('recognises the propose-throw variant, which names its session', () => {
    const events = [ev('harvest-started', 'session=abc123 chunks=4'), ev('harvest-failed', 'session=abc123')];
    expect(harvestFailedFor(events, 'abc123')).toBe(true);
  });

  it('attributes a parse-failed event to the harvest-started before it', () => {
    const events = [ev('harvest-started', 'session=s1 chunks=4'), ev('harvest-failed', PARSE_FAILED)];
    expect(harvestFailedFor(events, 's1')).toBe(true);
  });

  it('does not claim a failure for a session whose harvest succeeded', () => {
    const events = [
      ev('harvest-started', 'session=s1 chunks=4'),
      ev('harvest-proposed', 'proposals=2 buds=1 parsed=true'),
      ev('harvest-started', 'session=s2 chunks=3'),
      ev('harvest-failed', PARSE_FAILED),
    ];
    expect(harvestFailedFor(events, 's1')).toBe(false);
    expect(harvestFailedFor(events, 's2')).toBe(true);
  });

  it('does not cross concurrent harvests: a failure belongs to the start that preceded it', () => {
    const events = [
      ev('harvest-started', 'session=s1 chunks=4'),
      ev('harvest-started', 'session=s2 chunks=4'),
      ev('harvest-failed', PARSE_FAILED),
    ];
    expect(harvestFailedFor(events, 's2')).toBe(true);
    expect(harvestFailedFor(events, 's1')).toBe(false);
  });

  it('says nothing when no harvest has started', () => {
    expect(harvestFailedFor([ev('question-asked', 'session=s1 source=queue')], 's1')).toBe(false);
  });
});
