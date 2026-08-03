/**
 * The one-off ingest run's decisions, as data — ticket 058, Task 8.
 *
 * A prior bulk import leaves two tables behind: the posts it kept
 * (`MANIFEST`) and the refusal groups it ruled out (`EXCLUDED`), each
 * refusal carrying the reader's reason in their own words. The adoption
 * step (`src/import/adopt.ts`) reads both to reconcile the staging store
 * with what that run already decided, so a rescan neither re-imports nor
 * re-asks.
 *
 * The tables themselves are the owner's editorial record over their own
 * corpus — personal material, so they live outside git in
 * `data/prior-ingest.local.json` ({ manifest, excluded }). Absent that
 * file, both tables are empty and adoption is a clean no-op: nothing was
 * previously decided, so there is nothing to adopt.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Select =
  /** Whole body, minus the named headings' sections. */
  | { kind: 'body'; dropSections?: string[]; keepUntil?: string }
  /** Only these exact passages. Each is verified as a substring before use. */
  | { kind: 'passages'; passages: string[] };

export type Post = {
  slug: string;
  /** The sitting date. Not always frontmatter `date` — see `dateNote`. */
  sitting: string;
  dateNote?: string;
  select: Select;
  /** Why this is in, in the reader's words, so a later reader can disagree. */
  why: string;
  /** Keep blockquotes? Default false — they are other people's words. */
  keepQuotes?: boolean;
};

/** One refusal group: the name and why it stayed out, verbatim. */
export type Excluded = { slug: string; why: string };

const LOCAL_TABLES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'prior-ingest.local.json',
);

function loadTables(): { manifest: Post[]; excluded: Excluded[] } {
  if (!existsSync(LOCAL_TABLES)) return { manifest: [], excluded: [] };
  const parsed = JSON.parse(readFileSync(LOCAL_TABLES, 'utf-8')) as {
    manifest?: Post[];
    excluded?: Excluded[];
  };
  return { manifest: parsed.manifest ?? [], excluded: parsed.excluded ?? [] };
}

const tables = loadTables();

export const MANIFEST: Post[] = tables.manifest;
export const EXCLUDED: Excluded[] = tables.excluded;
