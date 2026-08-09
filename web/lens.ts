/**
 * The since-you-last-read lens (wave 5, canon §5.5): the pure predicates
 * behind the wiki's default reading, in their own module so they are
 * unit-testable without the DOM surface. Nothing here touches the DOM.
 *
 * The lens is CLIENT-side by owner decision: the /api/wiki payload already
 * carries `created`/`updated`/`readLog` per claim, `opened`/`updated`/
 * `status` per contradiction, and the repair wire now carries the repair's
 * timestamp. `lastRead` is the page's newest read stamp — the max over the
 * claims' readLogs — and "changed since" is a strict string comparison
 * (ISO 8601 stamps sort lexicographically, so `>` is time order).
 */

import { readableDate } from './dates.js';

/** The claim fields the lens reads — a structural subset of `Claim`. */
export type LensClaim = {
 created: string;
 updated: string;
 readLog: { at: string }[];
};

/** The contradiction fields the lens reads — a structural subset of `Contradiction`. */
export type LensExhibit = {
 opened: string;
 updated: string;
 status: string;
};

/** GET /api/wiki's freshness block (W1's wire): the person's read-through and the sittings behind it. */
export type Freshness = {
 readThrough: string | null;
 sittingsBehind: number;
 lastSittingAt: string | null;
};

/**
 * Whether a claim is full-ink under the since lens: new, edited, or
 * repair-touched after `lastRead`. `repairAt` is undefined for claims no
 * repair touched.
 */
export function sinceChanged(claim: LensClaim, repairAt: string | undefined, lastRead: string): boolean {
 return claim.created > lastRead || claim.updated > lastRead || (repairAt !== undefined && repairAt > lastRead);
}

/**
 * Whether a contradiction exhibit is full-ink: opened since `lastRead`, or
 * resolved since (a dissolved exhibit's `updated` is its resolution).
 */
export function exhibitSinceChanged(exhibit: LensExhibit, lastRead: string): boolean {
 return exhibit.opened > lastRead || (exhibit.status === 'dissolved' && exhibit.updated > lastRead);
}

/**
 * The passage fields the contextualizer lens reads — a structural subset of
 * the wire's `WikiPassage` (Batch B, §11): when it was said, and when its
 * context line was composed.
 */
export type LensPassage = {
 captured: string;
 context?: { at: string };
};

/**
 * Whether a passage is full-ink under the since lens (Batch B, §11): new —
 * said after `lastRead` — or newly contextualized (its context line was
 * composed or corrected after `lastRead`). Everything else recedes.
 */
export function passageSinceChanged(passage: LensPassage, lastRead: string): boolean {
 return passage.captured > lastRead || (passage.context !== undefined && passage.context.at > lastRead);
}

/**
 * The page's newest read stamp — the max `at` across every claim's
 * readLog — or null when nothing on the page was ever read. Null means
 * everything is new, so the lens has nothing to recede.
 */
export function lastReadOf(claims: LensClaim[]): string | null {
 let last: string | null = null;
 for (const cl of claims) {
  for (const entry of cl.readLog) {
   if (last === null || entry.at > last) last = entry.at;
  }
 }
 return last;
}

/**
 * The freshness line (canon §5.5), the ONE copy: "Read through 14 July
 * 2026." when caught up, "2 sittings behind · let it catch up" when not.
 * Nothing when the page was never read — with no reads the lens is off by
 * construction (everything is new), so there is no freshness to report.
 * The count is a plain number, matching the review count sentence's idiom.
 */
export function freshnessSentence(freshness: Freshness): string | null {
 if (freshness.readThrough === null) return null;
 if (freshness.sittingsBehind > 0) {
  const n = freshness.sittingsBehind;
  return `${n} ${n === 1 ? 'sitting' : 'sittings'} behind \u00b7 let it catch up`;
 }
 const when = readableDate(freshness.readThrough);
 if (!when) return null;
 return `Read through ${when}.`;
}
