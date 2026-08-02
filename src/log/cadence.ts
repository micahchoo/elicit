/**
 * Sitting cadence — the record, as a fact, for the waiting surface (ticket 056).
 *
 * Zero outbound contact is right and stays (Q-22). The failure mode of a
 * zero-outbound system is that the person drifts away and nothing notices:
 * silent death has no detector, and the monthly qualitative test cannot be run
 * on a system nobody opened. This is the detector, and it detects for the
 * PERSON rather than for the system — it is a line of text they may read, not
 * a signal anything acts on.
 *
 * NOT a streak and NOT a nag (Q-24). No target number, no comparison to a
 * previous period, no verb in the second person about what they failed to do.
 * Dormancy is signal, never debt. The only honest sentence here reports two
 * numbers and stops.
 *
 * Reads transcripts rather than the Activity Log, because transcripts are the
 * durable record (Q-3) and the log began later than the vault did.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

export type Cadence = {
  /** ISO date of the most recent sitting, absent when there has never been one. */
  last?: string;
  /** Sittings started in the 30 days before `now`. */
  inLastMonth: number;
  /** Sittings ever. Imports excluded — see `IMPORT_PROTOCOL`. */
  total: number;
};

/**
 * An imported piece is a sitting in every structural sense — it has a
 * transcript, a date and snippets — and in no experiential sense: nobody sat
 * for it. Ticket 057 put 19 of them in the vault dated 2017-2026, so counting
 * them here would report a "last sitting" in July 2026 that never happened and
 * would make the number this module exists to show a lie on the first day.
 */
const IMPORT_PROTOCOL = 'import';

const DAY_MS = 24 * 60 * 60 * 1000;

export function readCadence(root: string, now: number = Date.now()): Cadence {
  const dir = join(root, 'transcripts');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return { inLastMonth: 0, total: 0 };
  }

  const started: string[] = [];
  for (const f of files) {
    let data: { started?: unknown; protocol?: unknown };
    try {
      data = matter(readFileSync(join(dir, f), 'utf-8')).data as typeof data;
    } catch {
      // A transcript we cannot parse is not a sitting we can date. Skipping it
      // undercounts, which is the safe direction: this number must never claim
      // more activity than there was.
      continue;
    }
    if (data.protocol === IMPORT_PROTOCOL) continue;
    if (typeof data.started !== 'string' || data.started.length === 0) continue;
    const t = Date.parse(data.started);
    if (Number.isNaN(t)) continue;
    started.push(data.started);
  }

  if (started.length === 0) return { inLastMonth: 0, total: 0 };

  started.sort();
  const cutoff = now - 30 * DAY_MS;
  return {
    last: started[started.length - 1] as string,
    inLastMonth: started.filter((s) => Date.parse(s) >= cutoff).length,
    total: started.length,
  };
}

/**
 * The sentence. Returned from the server so the wording lives in one place and
 * is testable, rather than being assembled in the client where it cannot be.
 *
 * Every phrasing here is deliberate. "Your last sitting was X ago" states a
 * fact about the past; "it has been X since you sat" states a fact about a
 * gap, and a gap implies something should have filled it. There is no "only",
 * no "just", and no exclamation. A long absence reads exactly like a short one.
 */
export function cadenceSentence(c: Cadence, now: number = Date.now()): string {
  if (c.last === undefined) return 'No sittings yet.';

  const days = Math.floor((now - Date.parse(c.last)) / DAY_MS);
  const when =
    days <= 0 ? 'today'
    : days === 1 ? 'yesterday'
    : days < 30 ? `${days} days ago`
    : days < 60 ? 'about a month ago'
    : days < 365 ? `about ${Math.round(days / 30)} months ago`
    : days < 730 ? 'about a year ago'
    : `about ${Math.round(days / 365)} years ago`;

  const month =
    c.inLastMonth === 0 ? 'none in the last month'
    : c.inLastMonth === 1 ? 'one in the last month'
    : `${c.inLastMonth} in the last month`;

  return `Last sitting ${when}, ${month}.`;
}
