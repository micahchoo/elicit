/**
 * The operator's view of the loop — the ONLY renderer of the record plane
 * (ticket 122's spec, ticket 131).
 *
 *   npx tsx scripts/loop-status.ts
 *
 * It reads the graduation ledger, the tripwire state and the demotion
 * store, and prints one block per mechanism: what state it is in, its
 * guarded metrics as baseline against observed, how far it is from the
 * event floor, its dwell clock, and the last thing the ledger says about
 * it. Nothing here reaches the app. No number in this report may ever
 * appear on a person-facing surface — that is Q-83's never-mirrored class
 * applied to the operator hat, and this file is where the numbers stop.
 *
 * Guarded and diagnostic print under separate headings, with the split
 * visible (Q-90). A metric that cannot be counted prints as not
 * observable, with the reason, rather than as a blank or a zero: a zero
 * and an unmeasured thing look identical in a table, and only one of them
 * is safe to trust.
 *
 * `renderLoopStatus` takes its three paths so it can be rendered against a
 * temporary directory in a test. The CLI below is the thin shell.
 */

import { join, resolve } from 'node:path';

import { readLedger } from '../src/loop/ledger.js';
import type { LedgerLine, MetricReading } from '../src/loop/ledger.js';
import { readDemotions } from '../src/loop/demotions.js';
import { GUARDED, DIAGNOSTIC } from '../src/loop/guarded.js';
import {
  EVENT_FLOOR, WORSE_RATIO, BASELINE_DAYS, DWELL_DAYS, dwellUntil, readTripwireState,
} from '../src/loop/tripwire.js';
import type { GraduationWatch, TripwireState } from '../src/loop/tripwire.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LoopStatusDeps = {
  ledgerPath: string;
  tripwireStatePath: string;
  demotionsDir: string;
  /** Defaults to now — injected so a rendering is reproducible in a test. */
  now?: Date;
};

/** What a mechanism is doing right now, in the spec's four words. */
type MechanismState = 'shadow' | 'live' | 'graduated-unconfirmed' | 'dwelling';

function rate(reading: MetricReading | undefined): string {
  return reading === undefined ? '—' : reading.rate.toFixed(3);
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Prose broken at word boundaries, for the terminal. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function daysBetween(from: Date, to: string): number {
  return Math.ceil((Date.parse(to) - from.getTime()) / MS_PER_DAY);
}

/** The newest ledger line naming this mechanism. */
function lastLine(ledger: LedgerLine[], mechanism: string): LedgerLine | undefined {
  return [...ledger].reverse().find((l) => l.mechanism === mechanism);
}

/** The newest watch for a mechanism, which is the one its state is read from. */
function newestWatch(state: TripwireState, mechanism: string): GraduationWatch | undefined {
  return Object.values(state.watches)
    .filter((w) => w.mechanism === mechanism)
    .sort((a, b) => a.graduatedAt.localeCompare(b.graduatedAt))
    .at(-1);
}

function stateOf(
  mechanism: string,
  ledger: LedgerLine[],
  demoted: Set<string>,
  watch: GraduationWatch | undefined,
  now: Date,
): MechanismState {
  if (demoted.has(mechanism)) {
    const until = dwellUntil(ledger, mechanism);
    return until !== undefined && Date.parse(until) > now.getTime() ? 'dwelling' : 'shadow';
  }
  if (watch === undefined) return 'shadow';
  return watch.unconfirmed ? 'graduated-unconfirmed' : 'live';
}

/**
 * The report, as text. Every mechanism the ledger or the demotion store
 * knows about appears, in name order.
 */
export function renderLoopStatus(deps: LoopStatusDeps): string {
  const now = deps.now ?? new Date();
  const ledger = readLedger(deps.ledgerPath);
  const state = readTripwireState(deps.tripwireStatePath);
  const demoted = readDemotions(deps.demotionsDir);

  const mechanisms = [...new Set([
    ...ledger.map((l) => l.mechanism),
    ...Object.values(state.watches).map((w) => w.mechanism),
    ...demoted,
  ])].sort();

  const out: string[] = [];
  out.push(`Loop status — ${now.toISOString()}`);
  out.push(`  ledger: ${deps.ledgerPath} (${ledger.length} line${ledger.length === 1 ? '' : 's'})`);
  out.push(
    `  rules: baseline ${BASELINE_DAYS}d frozen at graduation, floor ${EVENT_FLOOR} events, ` +
    `dwell ${DWELL_DAYS}d, worse beyond ${WORSE_RATIO}x`,
  );
  out.push('');

  if (mechanisms.length === 0) {
    out.push('Nothing has graduated. The loop has no record yet.');
    return `${out.join('\n')}\n`;
  }

  out.push('GUARDED — observable by everything, optimizable by nothing (Q-90)');

  for (const mechanism of mechanisms) {
    const watch = newestWatch(state, mechanism);
    const mechanismState = stateOf(mechanism, ledger, demoted, watch, now);

    out.push('');
    out.push(`  ${mechanism} — ${mechanismState}`);

    if (watch !== undefined) {
      out.push(`    graduated ${watch.graduatedAt}`);
    }
    if (mechanismState === 'dwelling') {
      const until = dwellUntil(ledger, mechanism)!;
      out.push(`    dwell ends ${until} (${daysBetween(now, until)}d left)`);
    }

    for (const metric of GUARDED) {
      const name = pad(metric.key, 26);
      if (!metric.observable) {
        // The whole reason, not a truncation of it. This is the only place
        // an operator learns that a guarded metric is watching nothing, and
        // a half-sentence would leave them believing it was covered.
        out.push(`    ${name}NOT OBSERVABLE`);
        for (const line of wrap(metric.note.replace(/^NOT OBSERVABLE\.\s*/, ''), 72)) {
          out.push(`      ${line}`);
        }
        continue;
      }
      const baseline = watch?.baseline[metric.key];
      const observed = watch?.observed[metric.key];
      const toward = observed === undefined
        ? `0/${EVENT_FLOOR} toward floor`
        : observed.events >= EVENT_FLOOR
          ? `${observed.events} events, floor met`
          : `${observed.events}/${EVENT_FLOOR} toward floor`;
      out.push(
        `    ${name}baseline ${pad(rate(baseline), 8)}observed ${pad(rate(observed), 8)}` +
        `${toward}  (worse when ${metric.worseWhen})`,
      );
    }

    const last = lastLine(ledger, mechanism);
    out.push(`    last: ${last === undefined ? '(no ledger line)' : JSON.stringify(last)}`);
  }

  out.push('');
  out.push('DIAGNOSTIC — watched, never gates (Q-90)');
  for (const metric of DIAGNOSTIC) {
    out.push(`  ${metric.key} — ${metric.note}`);
  }

  return `${out.join('\n')}\n`;
}

// ── The CLI ──

const DATA_DIR = process.env.ELICIT_DATA_DIR ?? join(import.meta.dirname, '..', 'data');

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  process.stdout.write(renderLoopStatus({
    ledgerPath: join(DATA_DIR, 'graduation-ledger.jsonl'),
    tripwireStatePath: join(DATA_DIR, 'tripwire-state.json'),
    demotionsDir: DATA_DIR,
  }));
}
