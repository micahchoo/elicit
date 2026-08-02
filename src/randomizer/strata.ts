/**
 * Depth stratification — the second of Q-18's two draw channels.
 *
 * The problem this exists to solve is measurable in the real vault as of
 * 2026-08-02: 139 snippets across 19 sittings spanning 2017 to 2026, and 76 of
 * them — 55% — come from ONE sitting, the March 2020 capstone. A flat uniform
 * draw over the corpus is therefore a draw from March 2020 more often than
 * not, and the nine years Q-18 wants to reach are unreachable in practice.
 *
 * Two skews, one mechanism:
 *
 *   1. Era volume. Group by age band, pick a band, then pick inside it. Every
 *      band is equally likely regardless of how much was written in it, so the
 *      thin years are as reachable as the loud ones.
 *   2. Document volume. Inside a band, pick a SITTING first, then a snippet
 *      inside the sitting. Without this the capstone still wins its own band
 *      76 times out of 89 — the same skew one level down.
 *
 * The bands, and why these four rather than any others. They are cuts in how
 * far the writing is from the person reading it now, not equal slices of time:
 *
 *   - `recent` (under 90 days) — one season. Still in the current chapter; a
 *     draw here is a reminder, not a resurfacing.
 *   - `season` (90 days to a year) — out of mind, still endorsed. The person
 *     will usually recognise the position as theirs.
 *   - `years` (1 to 5 years) — another chapter. Agreement has become a claim
 *     rather than a memory, which is exactly what a still-true question tests.
 *   - `deep` (over 5 years) — where this corpus actually parts, measured: the
 *     2017-2021 writing sits on one side of five years and the 2022-2026
 *     writing on the other.
 *
 * Boundaries live in `thresholds.ts`, never here.
 *
 * "Forgotten" is enforced separately, by the cooldown in `randomizer.ts`.
 * Depth is what makes old material REACHABLE; the cooldown is what makes it
 * forgotten. Conflating them — treating `recent` as ineligible — would delete
 * a band rather than de-weight it, and the person's last sitting is legitimate
 * material the day after they stop thinking about it.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Index, Stratum } from '../types.js';
import { daysBetween, type RandomizerThresholds } from './thresholds.js';

/** A snippet with the date it was actually written, and its band. */
export type DatedSnippet = {
  id: string;
  version: number;
  prose: string;
  /** The sitting it came from — the unit of the second uniform pick. */
  session: string;
  /** ISO instant of the sitting, or of capture when the sitting is missing. */
  wroteAt: string;
  stratum: Stratum;
};

/**
 * When each sitting happened, read from `transcripts/*.md` frontmatter.
 *
 * This is the whole reason the imported corpus has depth at all. Ticket 057
 * backdated `started` to each post's publication date and left `captured` at
 * the import instant, so `captured` says 2026-08-02 for all 139 snippets and
 * the sitting says 2017 through 2026. Reading `captured` here would collapse
 * nine years into one afternoon.
 */
export function readSittingDates(root: string): Map<string, string> {
  const dates = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(join(root, 'transcripts'));
  } catch {
    return dates;
  }
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    try {
      const data = matter.read(join(root, 'transcripts', file)).data as Record<string, unknown>;
      const session = typeof data.session === 'string' ? data.session : file.slice(0, -3);
      const started = data.started;
      // gray-matter parses an unquoted ISO date into a Date; a quoted one
      // stays a string. Both occur in the real vault.
      if (started instanceof Date) dates.set(session, started.toISOString());
      else if (typeof started === 'string') dates.set(session, started);
    } catch {
      // An unreadable transcript costs its snippets their true date, not the
      // whole draw — they fall back to `captured` below.
    }
  }
  return dates;
}

/** Which band an instant falls in. */
export function stratumFor(
  wroteAt: string,
  now: Date,
  t: RandomizerThresholds,
): Stratum {
  const age = daysBetween(wroteAt, now);
  if (age < t['randomizer.recentDays'].value) return 'recent';
  if (age < t['randomizer.seasonDays'].value) return 'season';
  if (age < t['randomizer.yearsDays'].value) return 'years';
  return 'deep';
}

/**
 * Every snippet in the index, dated by its sitting and banded.
 *
 * A snippet whose sitting has no transcript keeps `captured` as its date. That
 * is the honest fallback: the only thing known about it is when it arrived.
 */
export function datedSnippets(
  index: Index,
  sittingDates: Map<string, string>,
  now: Date,
  t: RandomizerThresholds,
): DatedSnippet[] {
  const out: DatedSnippet[] = [];
  for (const s of Object.values(index.snippets)) {
    const session = s.provenance?.session ?? '';
    const wroteAt = sittingDates.get(session) ?? s.captured;
    if (!wroteAt) continue;
    out.push({
      id: s.id,
      version: s.version,
      prose: s.prose,
      session,
      wroteAt,
      stratum: stratumFor(wroteAt, now, t),
    });
  }
  // Sorted so a given rng sequence draws the same thing on every machine. The
  // draw's randomness must come from `random`, never from readdir order.
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Group by band, keeping only the bands that hold something. */
export function stratify(snips: DatedSnippet[]): Map<Stratum, DatedSnippet[]> {
  const strata = new Map<Stratum, DatedSnippet[]>();
  for (const s of snips) {
    const bucket = strata.get(s.stratum);
    if (bucket) bucket.push(s);
    else strata.set(s.stratum, [s]);
  }
  return strata;
}

/** Group a band by sitting, so one long document cannot own its own band. */
export function bySitting(snips: DatedSnippet[]): DatedSnippet[][] {
  const sittings = new Map<string, DatedSnippet[]>();
  for (const s of snips) {
    const bucket = sittings.get(s.session);
    if (bucket) bucket.push(s);
    else sittings.set(s.session, [s]);
  }
  return [...sittings.keys()].sort().map((k) => sittings.get(k)!);
}
