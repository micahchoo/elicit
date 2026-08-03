/**
 * The Randomizer's thresholds — Q-35 turned into data, on the pattern
 * `src/wiki/thresholds.ts` established for the wiki slice.
 *
 * The register is declared here rather than imported from the wiki's, and the
 * duplication is deliberate: `src/types.ts` records that the domain layer must
 * not depend on `src/wiki/`, and a draw source that cannot load because a wiki
 * module failed to parse is a worse outcome than six repeated lines.
 *
 * Two invariants, both copied from the wiki register because both earned it:
 *
 * - No number the draw acts on is written anywhere but here. A bare `90` in
 *   `strata.ts` would be a mechanism acting on a figure nobody decided.
 * - Every entry states the evidence that would license it to act, in prose and
 *   never as a date. `tests/randomizer.test.ts` holds that shut.
 *
 * `live: false` means: compute it, log what it would have decided, change
 * nothing. Note which entries ship live and why — the two that shape the pool
 * are BOUNDS, not selections, and Q-56 narrowed Q-35 to selection mechanisms.
 */

export type RandomizerThreshold = {
  name: string;
  /** Days, in every entry here. */
  value: number;
  /** False means: compute, log what you would have decided, change nothing. */
  live: boolean;
  /**
   * The evidence that would license this threshold to act — prose, never a
   * date. For an entry that already acts, this records the licence it acts
   * under, so demoting it is as reviewable as promoting it.
   */
  graduatesWhen: string;
};

export const RANDOMIZER_THRESHOLDS = {
  'randomizer.drySpellDays': {
    name: 'randomizer.drySpellDays',
    value: 7,
    live: false,
    graduatesWhen:
      'Shadow. It decides whether the system may OFFER a draw nobody asked for, which is a selection mechanism in the exact sense of Q-35. It graduates when the log shows a run of randomizer-license lines whose grounds=dry-spell days figure lines up with sittings the person agrees were droughts — and, critically, when the shadow record contains no line that would have interrupted an active week. A week is a guess drawn from Q-16 session budget arithmetic, not a measurement.',
  },
  'randomizer.staleRegionDays': {
    name: 'randomizer.staleRegionDays',
    value: 30,
    live: false,
    graduatesWhen:
      'Shadow, for the same reason as the dry spell and with a harder evidential bar: it names a Facet the corpus has stopped feeding, and a wrong name sends the person to a region they deliberately left. It graduates when the shadow lines name regions that the facet distribution in the Activity Log independently shows starving over the same window.',
  },
  'randomizer.cooldownDays': {
    name: 'randomizer.cooldownDays',
    value: 30,
    live: true,
    graduatesWhen:
      'Live by decision, and it is a BOUND rather than a selection (Q-56): it removes what the person has just seen from the pool, so its failure mode is a smaller pool, never a question they would not otherwise have been asked. Shadowing it would mean shipping a randomizer that can deal the same card twice in a week, which is the one thing a shuffle must not do. Demote it if the log ever shows the pool emptied by cooldown alone.',
  },
  'randomizer.recentDays': {
    name: 'randomizer.recentDays',
    value: 90,
    live: true,
    graduatesWhen:
      'Live by decision — a stratum boundary is a BOUND on the pool, not a choice within it (Q-56). Ninety days is one season: material still inside the current chapter of a life, where a draw is a reminder rather than a resurfacing. It is revisited when the vault holds enough sittings for the strata occupancy in the randomizer-drawn log to show one band starving the others.',
  },
  'randomizer.seasonDays': {
    name: 'randomizer.seasonDays',
    value: 365,
    live: true,
    graduatesWhen:
      'Live by decision, same reasoning as randomizer.recentDays. One year is the span over which a person will usually still endorse what they wrote; past it, agreement becomes a claim rather than a memory. Revisited on the same evidence.',
  },
  'randomizer.yearsDays': {
    name: 'randomizer.yearsDays',
    value: 1825,
    live: true,
    graduatesWhen:
      'Live by decision, same reasoning as randomizer.recentDays. Five years is where the imported corpus actually parts: 2017-2021 writing against 2022-2026 writing, measured 2026-08-02 in the real vault. It is a description of this corpus and it is revisited whenever the corpus stops looking like that.',
  },
} satisfies Record<string, RandomizerThreshold>;

/**
 * The register's shape with its values widened — the same mapped type
 * `src/wiki/lint.ts` uses for `ThresholdRegister`, and for the same two
 * reasons: the keys stay literal, so a lookup is a `RandomizerThreshold` and
 * not `RandomizerThreshold | undefined` under `noUncheckedIndexedAccess`, and
 * `live` stays a `boolean` rather than the literal it happens to hold today,
 * so a graduated copy is assignable.
 */
export type RandomizerThresholds = {
  [K in keyof typeof RANDOMIZER_THRESHOLDS]: RandomizerThreshold;
};
export type RandomizerThresholdName = keyof RandomizerThresholds;

/**
 * A copy of the register with the named entries live. This is how a threshold
 * graduates in a test and, one day, in the register itself — by flipping one
 * boolean, with the module unable to tell the difference.
 */
export function graduate(
  base: RandomizerThresholds,
  ...names: RandomizerThresholdName[]
): RandomizerThresholds {
  const out = { ...base };
  for (const n of names) out[n] = { ...base[n], live: true };
  return out;
}

/** Days between two instants, as a positive number of whole and part days. */
export function daysBetween(earlier: string | Date, later: Date): number {
  const a = typeof earlier === 'string' ? new Date(earlier).getTime() : earlier.getTime();
  return (later.getTime() - a) / (24 * 60 * 60 * 1000);
}
