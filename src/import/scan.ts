/**
 * The folder scanner: a folder becomes items and refusals, and no date is
 * ever guessed (Q-57).
 *
 * Reads `*.md` and `*.markdown` recursively under `root`, strips frontmatter
 * with gray-matter, and refuses — with a reason — any file whose frontmatter
 * has no readable `date`. The sitting date is frontmatter `date`; `lastmod`
 * is carried for Q-59's second sitting on a changed file, never used as the
 * first-import date. A file with no `date` must come back refused rather than
 * dated from its mtime or name: under Q-50 the date is the only thing that
 * makes an imported sitting independent evidence, and a guessed date corrupts
 * that silently and permanently.
 *
 * A region may declare how its files carry dates (Q-67): `scanFolder(root)`
 * runs the frontmatter rule above exactly, and `scanFolder(root, rule)` dates
 * every file by the declared rule and refuses every file it cannot date — by
 * name, so a silent loss is impossible.
 *
 * Two load-bearing choices, both ruled on 2026-08-02:
 * - The hash covers the BODY only, never the frontmatter. Frontmatter is not
 *   the person's prose, so it cannot be part of that prose's identity; and a
 *   generator's site-wide touch (6 of 47 real files share one `lastmod`) must
 *   not mint six duplicate sittings.
 * - This function never writes and never calls a model.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';

import { dateFor, DEFAULT_DATING } from './dating.js';
import type { DatingRule, RefusalReason } from './contract.js';

/** The body's identity (Q-59): SHA-256 of the prose, frontmatter excluded. */
export function bodyHash(body: string): string {
  return createHash('sha256').update(body.trimEnd()).digest('hex').slice(0, 12);
}

/** One scanned source file, frontmatter stripped. Structural type only: the
 * parallel store task defines its own copy, and structural typing keeps the
 * two interchangeable. */
export type ScannedItem = {
  hash: string;
  sourcePath: string;
  date: string;
  lastmod?: string;
  title?: string;
  /** The body, frontmatter stripped. What the reviewer will read whole. */
  body: string;
};

export type ScanResult = {
  items: ScannedItem[];
  refused: { sourcePath: string; reason: RefusalReason }[];
};

/** `YYYY-MM-DD` — the day shape the corpus sits prose on. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Frontmatter dates arrive from YAML as `Date` objects or strings depending
 * on quoting. Normalise BOTH to `YYYY-MM-DD`; anything else is unreadable.
 * A string day is checked as a real calendar day, so `2020-02-31` is refused
 * rather than silently rolled to March 2.
 */
function isoDay(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && ISO_DAY.test(value)) {
    const day = new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10);
    return day === value ? value : null;
  }
  return null;
}

/** One file's fate: a ScannedItem, or the reason it did not become one. */
type ScanOutcome = ScannedItem | { reason: RefusalReason };

function scanFile(sourcePath: string, rule: DatingRule): ScanOutcome {
  const raw = readFileSync(sourcePath, 'utf-8');
  const parsed = matter(raw);
  const body = parsed.content;

  // `matter` is empty both for a file with no `---` block and for an empty
  // one; the raw string alone tells the two apart. An empty block is still a
  // block, so it falls through to the date checks like any other frontmatter.
  // Under a filename rule a file with no `---` block is the NORMAL case — the
  // date lives in the name — so `no-frontmatter` is this branch's refusal,
  // while `empty-body` stays unconditional: a file with nothing in it has no
  // prose under any rule.
  if (rule.kind === 'frontmatter') {
    if (parsed.matter === '' && !raw.startsWith('---')) return { reason: 'no-frontmatter' };
  }
  if (body.trimEnd() === '') return { reason: 'empty-body' };

  // The rule says where the date lives (Q-67): the declared frontmatter key,
  // or the file's name. `lastmod` stays frontmatter-only under every rule — a
  // filename encodes one date, and Q-59's second sitting needs a different one.
  const dated = dateFor(rule, basename(sourcePath), parsed.data);
  if ('reason' in dated) return { reason: dated.reason };

  const lastmod = isoDay(parsed.data.lastmod);
  const title = typeof parsed.data.title === 'string' ? parsed.data.title : undefined;
  return {
    hash: bodyHash(body),
    sourcePath,
    date: dated.date,
    ...(lastmod === null ? {} : { lastmod }),
    ...(title === undefined ? {} : { title }),
    body,
  };
}

/**
 * Every `*.md` and `*.markdown` file under `root`, absolute paths, in the
 * deterministic order the scan visits them. Exported because the survey
 * (Task 4) needs the SAME walk: a second copy would let the map and the scan
 * disagree about which files exist.
 */
export function walkMarkdown(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    // Sorted so the walk is deterministic on any filesystem.
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!(entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) continue;
      out.push(full);
    }
  };
  visit(root);
  return out;
}

/** Scan `root` recursively: every `*.md` and `*.markdown` becomes an item or a refusal. */
export function scanFolder(root: string, rule: DatingRule = DEFAULT_DATING): ScanResult {
  const items: ScannedItem[] = [];
  const refused: { sourcePath: string; reason: RefusalReason }[] = [];

  for (const full of walkMarkdown(root)) {
    const outcome = scanFile(full, rule);
    if ('hash' in outcome) {
      items.push(outcome);
    } else {
      refused.push({ sourcePath: full, reason: outcome.reason });
    }
  }
  return { items, refused };
}
