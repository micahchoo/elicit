/**
 * The dating rule (Q-67): the ONE declared way a region's files carry their
 * dates, and the named refusal every file that does not fit earns — by name,
 * so a silent loss is impossible.
 *
 * Pure module, deliberately: a rule is a decision the person made, so dating
 * a name or a frontmatter block costs nothing and is fully testable. No file
 * I/O and no model call happen here — the scan that consumes this module does
 * both, and the two concerns stay apart.
 */

import type { DatingRule, RefusalReason } from './contract.js';

/** The rule every scan has always run under: frontmatter `date`. */
export const DEFAULT_DATING: DatingRule = { kind: 'frontmatter', key: 'date' };

/** `YYYY-MM-DD` — the day shape the corpus sits prose on. */
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar witness that a day is real: `2021-02-31` rolls forward in
 * the calendar, so it fails the round-trip and is refused rather than
 * silently dated to March.
 */
function isCalendarDay(day: string): boolean {
  return new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
}

/**
 * The ONE normaliser for a date value (Q-57): a `Date` object — how YAML
 * hands an unquoted date to gray-matter — an exact `YYYY-MM-DD` string, or
 * a full ISO datetime whose day is the first ten characters (the
 * transcripts' `started`, a generator's site-wide `lastmod`). Anything
 * else is unreadable, and a day that is not a real calendar day is refused
 * rather than rolled. scan.ts and adopt.ts import this instead of keeping
 * their own copies — one home, one lockstep.
 */
export function isoDay(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const day = value.slice(0, 10);
  if (!ISO_DAY.test(day)) return null;
  return isCalendarDay(day) ? day : null;
}

/** One date token of a filename pattern. */
type Token = 'YYYY' | 'MM' | 'DD';

/** The date tokens of a pattern, in the order they appear. */
function tokensIn(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('YYYY', i)) {
      tokens.push('YYYY');
      i += 4;
      continue;
    }
    if (pattern.startsWith('MM', i)) {
      tokens.push('MM');
      i += 2;
      continue;
    }
    if (pattern.startsWith('DD', i)) {
      tokens.push('DD');
      i += 2;
      continue;
    }
    i += 1;
  }
  return tokens;
}

/** A regex metacharacter; every other character in a pattern is literal. */
const META = /[.*+?^${}()|[\]\\]/g;

/**
 * Compile a filename pattern into a regex over the basename. `YYYY`, `MM` and
 * `DD` become capture groups in the order they appear; every other character
 * is a literal, escaped. No anchors — the date may sit inside a longer name
 * (`2021-03-04 Monday standup` matches `YYYY-MM-DD`).
 *
 * Returns null unless all three tokens appear EXACTLY once. That is a
 * declaration-time refusal, not a per-file one: a pattern with no `YYYY`, no
 * `MM` or no `DD` cannot produce a day, so the region that declared it is
 * refused (T12's 400) — a region that cannot date anything must not exist.
 */
export function compilePattern(pattern: string): RegExp | null {
  let source = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('YYYY', i)) {
      source += '(\\d{4})';
      i += 4;
      continue;
    }
    if (pattern.startsWith('MM', i)) {
      source += '(\\d{2})';
      i += 2;
      continue;
    }
    if (pattern.startsWith('DD', i)) {
      source += '(\\d{2})';
      i += 2;
      continue;
    }
    source += pattern[i]!.replace(META, '\\$&');
    i += 1;
  }
  const tokens = tokensIn(pattern);
  const complete =
    tokens.length === 3 && tokens.includes('YYYY') && tokens.includes('MM') && tokens.includes('DD');
  return complete ? new RegExp(source) : null;
}

/**
 * Date a name by a pattern: first match wins, and the captured groups are
 * assembled in the pattern's own order, so `DD-MM-YYYY` reads day first. The
 * assembled day must be a real calendar day — `2021-02-31` is refused, never
 * rolled forward to March.
 */
function dateFromName(pattern: string, basename: string): { date: string } | { reason: RefusalReason } {
  const regex = compilePattern(pattern);
  if (regex === null) return { reason: 'no-date-in-name' };
  const name = basename.replace(/\.(?:md|markdown)$/, '');
  const match = regex.exec(name);
  if (match === null) return { reason: 'no-date-in-name' };
  const tokens = tokensIn(pattern);
  const year = match[tokens.indexOf('YYYY') + 1]!;
  const month = match[tokens.indexOf('MM') + 1]!;
  const day = match[tokens.indexOf('DD') + 1]!;
  const assembled = `${year}-${month}-${day}`;
  return isCalendarDay(assembled) ? { date: assembled } : { reason: 'unparsable-date' };
}

/**
 * The one mechanical rule that dates a file (Q-67). Frontmatter rules read
 * the declared key; filename rules date the name. Every failure comes back as
 * a named reason — never a guess, and never silence.
 */
export function dateFor(
  rule: DatingRule,
  basename: string,
  frontmatter: Record<string, unknown>,
): { date: string } | { reason: RefusalReason } {
  if (rule.kind === 'frontmatter') {
    const raw = frontmatter[rule.key];
    if (raw === undefined) return { reason: 'no-date' };
    const date = isoDay(raw);
    if (date === null) return { reason: 'unparsable-date' };
    return { date };
  }
  return dateFromName(rule.pattern, basename);
}
