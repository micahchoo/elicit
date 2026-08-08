/**
 * The graduation ledger — `data/graduation-ledger.jsonl` (Q-97, ticket 122).
 *
 * The loop's memory against oscillation. One JSON line per event, appended
 * and never touched again: the loop reads the whole file every cycle to
 * learn what it already did, and a mechanism that was demoted last week
 * cannot be re-graduated as if the demotion never happened.
 *
 * ## Why there is no rewrite API in this module
 *
 * There is no `updateLedger`, no `replaceLine`, no `removeLine`, and the
 * absence is the feature. A ledger a process can edit is a ledger that
 * records what the process last believed rather than what happened, and
 * the one thing this file has to survive is the loop deciding, in good
 * faith, that an old line is wrong. Correction is a NEW line — the
 * re-graduation event exists for exactly that. State that needs revising
 * lives in `data/tripwire-state.json` (src/loop/tripwire.ts), which is a
 * cache of what the ledger plus the activity log already imply.
 *
 * It lives outside the vault, under `data/`, because the vault is the
 * person's record and this is instrument plane: it is about mechanisms,
 * never about the person, and it survives a fresh start (Q-89).
 */

import { basename, dirname } from 'node:path';

import { appendLine, readLines } from '../jsonl.js';

/** A rate measured over a window, as the ledger records it. */
export type MetricReading = {
  /** How many observations the rate was computed from — the Q-95 floor counts these. */
  events: number;
  /** The metric's value over the window. */
  rate: number;
};

/**
 * A mechanism went live on its own record: the trials that earned it, the
 * verdict files that judged them, and one citation-backed sentence saying
 * why it was kept. `mechanism` is the registry key (src/registry.ts) — the
 * ledger and the mechanism-exposure registry speak one vocabulary.
 */
export type GraduationLine = {
  at: string;
  event: 'graduation';
  mechanism: string;
  cycle: string;
  /** The commit sha of the candidate variant. */
  variant: string;
  /** Archive directories of the paired trials, e.g. `archives/eval/c01/t1`. */
  trials: string[];
  /** Paths of the verdict files, beside the lives they cite. */
  verdicts: string[];
  /** One sentence: the citation-backed reason (the keep rule's win). */
  kept: string;
};

/**
 * A mechanism went back to shadow. Two writers, distinguished by `by`:
 * the tripwire, which carries the numbers that fired it and the batch it
 * demoted with (Q-90's recency rule), and the owner, whose line carries no
 * numbers because the owner owes no argument.
 */
export type DemotionLine = {
  at: string;
  event: 'demotion';
  mechanism: string;
  by: 'tripwire' | 'owner';
  /** The guarded metric that fired. Tripwire only. */
  metric?: string;
  /** The frozen pre-graduation reading (Q-95). Tripwire only. */
  baseline?: MetricReading;
  /** The post-graduation reading it was compared against. Tripwire only. */
  observed?: MetricReading;
  /** Every mechanism demoted in this batch, including this one. Tripwire only. */
  batch?: string[];
  /** When the mechanism may be re-graduated: `at` + 7 days (Q-95). Tripwire only. */
  dwellUntil?: string;
};

/**
 * A demoted mechanism earned its way back after dwell, on FRESH evidence.
 * The trials are new: re-graduation never re-reads the trials that earned
 * the first graduation, or the loop would relitigate the same evidence
 * until it won.
 */
export type ReGraduationLine = {
  at: string;
  event: 're-graduation';
  mechanism: string;
  afterDwell: boolean;
  trials: string[];
  verdicts: string[];
};

/**
 * A candidate ran the full battery and did not clear the keep rule (Q-98):
 * at least one resolving-cited regression, however many wins. A rejected
 * trial is evidence too (docs/loop-prompt.md step 7) — this is what makes
 * that evidence part of the loop's memory against oscillation, the same
 * way a graduation is: without this line, a future cycle re-proposing the
 * same mechanism would find no trace that it was already tried and lost.
 */
export type RejectionLine = {
  at: string;
  event: 'rejection';
  mechanism: string;
  cycle: string;
  /** The commit sha of the candidate variant that was tried. */
  variant: string;
  trials: string[];
  verdicts: string[];
  /** One sentence: the citation-backed reason it was not kept. */
  rejected: string;
};

export type LedgerLine = GraduationLine | DemotionLine | ReGraduationLine | RejectionLine;

/**
 * Append one line. Creates the parent directory, so the first graduation of
 * a fresh instance does not fail on a missing `data/`.
 *
 * The write is one `appendFileSync` of one line ending in a newline, which
 * is what makes a concurrent reader safe: a reader either sees the whole
 * line or does not see it, and never sees half of one.
 */
export function appendLedger(path: string, line: LedgerLine): void {
  appendLine(dirname(path), basename(path), JSON.stringify(line));
}

/**
 * Every line, in the order they were written. An absent file reads as an
 * empty ledger — a fresh instance has graduated nothing, which is a fact,
 * not an error.
 *
 * A malformed line is skipped, not thrown on. The ledger is append-only and
 * nothing rewrites it, so a half-written line can only come from a crash
 * mid-append; refusing to read the other 200 lines because of it would make
 * a crash cost the loop its whole memory.
 */
export function readLedger(path: string): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const raw of readLines(dirname(path), basename(path))) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isLedgerLine(parsed)) lines.push(parsed);
    } catch {
      // A half-written line from a crash. Skipped, never repaired.
    }
  }
  return lines;
}

/** Structural guard: the two fields every event shape shares, plus a known event. */
function isLedgerLine(value: unknown): value is LedgerLine {
  if (value === null || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  if (typeof o.at !== 'string' || typeof o.mechanism !== 'string') return false;
  return (
    o.event === 'graduation' || o.event === 'demotion' || o.event === 're-graduation' || o.event === 'rejection'
  );
}
