/**
 * The Randomizer's licence (Q-16).
 *
 * Q-16 has two clauses and they pull in opposite directions, so the split
 * between them is the whole design here:
 *
 *   "the draw is never vetoed by the agent" — a draw the person asked for
 *   happens. This module is never consulted about that, and `randomizer.ts`
 *   does not let it be.
 *
 *   "licensed by dry spells and stale regions, defended on coverage grounds,
 *   not creativity" — a draw the person did NOT ask for needs a reason, and
 *   the reason must be a gap in the record rather than a judgement about them.
 *
 * So the licence answers one question only: may the system OFFER a draw
 * unasked? Everything it reads is a count of days over the Activity Log and
 * the Queue's own history. Nothing here reads a transcript, scores an answer,
 * or asks whether the person seems stuck — those are the creativity grounds
 * Q-16 rules out, and there is no field in this module that could carry them.
 *
 * Two grounds, checked in that order because the first subsumes the second:
 *
 *   - DRY SPELL. Nothing has been answered for `drySpellDays`. The drought is
 *     measured from the last answer, or — when nothing has EVER been answered
 *     — from the first thing that ever happened in the vault. That fallback is
 *     what makes a brand-new vault unlicensed rather than maximally licensed:
 *     a world one hour old has been dry for one hour.
 *   - STALE REGION. Some Facet that the record shows the person DOES answer
 *     has gone `staleRegionDays` without one. A Facet that has never been
 *     answered is not stale, it is unvisited, and that is facet balance's job
 *     (`src/queue/facet-balance.ts`) — claiming it here would double-count the
 *     same gap and send every cold-start draw to the same region.
 */

import type { Facet, QueueEntry } from '../types.js';
import type { ActivityEvent } from '../log/activity.js';
import { daysBetween, type RandomizerThresholds } from './thresholds.js';

export type LicenseGrounds = 'dry-spell' | 'stale-region' | 'none';

export type LicenseVerdict = {
  /** True when a ground was found. Independent of whether it may ACT. */
  licensed: boolean;
  grounds: LicenseGrounds;
  /**
   * Whether the threshold behind `grounds` has graduated (Q-35). A verdict can
   * be licensed and not live: that is the shadow record doing its job.
   */
  live: boolean;
  /** The evidence, formatted for one Activity Log line. */
  detail: string;
  /** The Facet named by a stale-region verdict. */
  region?: Facet;
};

function earliest(events: ActivityEvent[]): string | null {
  let min: string | null = null;
  for (const e of events) if (min === null || e.at < min) min = e.at;
  return min;
}

/** The last time anything was answered, across the Queue's whole history. */
function lastAnswer(entries: QueueEntry[]): string | null {
  let max: string | null = null;
  for (const e of entries) {
    if (!e.answeredAt) continue;
    if (max === null || e.answeredAt > max) max = e.answeredAt;
  }
  return max;
}

/** The last time each Facet was answered. Unanswered entries are not evidence. */
function lastAnswerByFacet(entries: QueueEntry[]): Map<Facet, string> {
  const byFacet = new Map<Facet, string>();
  for (const e of entries) {
    if (!e.answeredAt || !e.targetFacet) continue;
    const prev = byFacet.get(e.targetFacet);
    if (prev === undefined || e.answeredAt > prev) byFacet.set(e.targetFacet, e.answeredAt);
  }
  return byFacet;
}

export function licenseForDraw(o: {
  entries: QueueEntry[];
  events: ActivityEvent[];
  now: Date;
  thresholds: RandomizerThresholds;
}): LicenseVerdict {
  const dry = o.thresholds['randomizer.drySpellDays'];
  const stale = o.thresholds['randomizer.staleRegionDays'];

  const since = lastAnswer(o.entries) ?? earliest(o.events);
  const dryDays = since === null ? 0 : daysBetween(since, o.now);
  const from = lastAnswer(o.entries) !== null ? 'last-answer' : 'first-event';

  if (since !== null && dryDays >= dry.value) {
    return {
      licensed: true,
      grounds: 'dry-spell',
      live: dry.live,
      detail: `days=${dryDays.toFixed(1)} from=${from} threshold=${dry.value}`,
    };
  }

  const byFacet = lastAnswerByFacet(o.entries);
  let worst: { facet: Facet; days: number } | null = null;
  for (const [facet, at] of byFacet) {
    const days = daysBetween(at, o.now);
    if (days < stale.value) continue;
    if (worst === null || days > worst.days) worst = { facet, days };
  }
  if (worst) {
    return {
      licensed: true,
      grounds: 'stale-region',
      live: stale.live,
      region: worst.facet,
      detail: `region=${worst.facet} days=${worst.days.toFixed(1)} threshold=${stale.value}`,
    };
  }

  return {
    licensed: false,
    grounds: 'none',
    live: false,
    detail:
      since === null
        ? 'no history'
        : `dryDays=${dryDays.toFixed(1)} from=${from} regions=${byFacet.size}`,
  };
}
