/**
 * Adopt what the one-off script already decided — ticket 058, Task 8.
 *
 * A prior one-off ingest run leaves `post-*` sittings in
 * `vault/transcripts/` and refusal groups recorded in the prior-ingest
 * tables (`src/import/prior-ingest.ts`). Without this step the first real
 * scan re-imports every kept sitting and asks the reader to re-refuse every
 * exclusion one piece at a time.
 *
 * `adoptPriorIngest` reconciles the staging store with that run. It is
 * called by the scan pipeline (src/import/pipeline.ts) once per scan, and
 * it is idempotent: the
 * second call adds nothing. `folder` — the scanned folder path — is known
 * only at request time, which is why adoption cannot run at store
 * construction.
 *
 * Two load-bearing choices:
 * - Adoption writes NO corpus. It only mints staging records describing
 *   corpus that already exists (accepted) or refusals that were already
 *   made (excluded).
 * - Records are keyed by body hash (Q-59), never by slug. A slug key would
 *   let the same prose in a renamed file import twice.
 *
 * An unresolvable name is reported in `unresolved`, never skipped in
 * silence — the arithmetic check is `accepted + excluded` equals the file
 * count, or something was lost.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import type { ImportRecord } from './contract.js';
import { bodyHash } from './scan.js';
import { isoDay } from './dating.js';
import type { ImportStore } from './store.js';
import { EXCLUDED, MANIFEST } from './prior-ingest.js';
import type { LogFn } from '../wiki/contract.js';

/** One refusal group from the one-off script: the name and why it stayed out. */
export type ExcludedEntry = { slug: string; why: string };

export type AdoptDeps = {
  store: ImportStore;
  vaultRoot: string;
  /** The scanned folder path — known only at request time (T9). */
  folder: string;
  log: LogFn;
  /**
   * The refusal table. Defaults to the script's EXCLUDED; injectable so a
   * test can hand adoption a one-entry table and assert the reporting.
   */
  excluded?: readonly ExcludedEntry[];
};

export type AdoptResult = {
  accepted: number;
  excluded: number;
  unresolved: string[];
};

/**
 * A slug resolves to two possible file layouts and both are tried:
 * `<cand>/index.md` (the Hugo shape the real corpus uses) and `<cand>.md`
 * (a flat folder — what the fixture is and what most folders will be).
 * `blog-carefull-…` also splits on each `-` to `blog/carefull-…` in turn,
 * because the transcript session id has its slashes flattened.
 */
function resolveSource(folder: string, slug: string): string | null {
  const candidates = [slug];
  for (let i = 0; i < slug.length; i++) {
    if (slug[i] === '-') candidates.push(`${slug.slice(0, i)}/${slug.slice(i + 1)}`);
  }
  for (const cand of candidates) {
    for (const layout of [join(cand, 'index.md'), `${cand}.md`]) {
      const path = join(folder, layout);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/** Every directory under `folder`, repo-relative, recursive and sorted. */
function directories(folder: string): string[] {
  const out: string[] = [];
  const visit = (rel: string): void => {
    const entries = readdirSync(join(folder, rel), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      out.push(child);
      visit(child);
    }
  };
  visit('');
  return out;
}

/** The markdown files directly inside a directory, sorted. */
function filesIn(folder: string, dir: string): string[] {
  return readdirSync(join(folder, dir), { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.markdown')))
    .map((e) => join(folder, dir, e.name))
    .sort();
}

/**
 * The unique directory whose BASENAME matches `part` by prefix or suffix —
 * `south-asian-digital-history` resolves to `external/south-asian-digital-history`
 * and `portfolio-workshops` to `portfolio-workshops-classes-panels-and-publications`.
 * Ambiguous or empty matches return null: a resolver that loses a name
 * silently is the failure this step exists to prevent.
 */
function matchDirectory(dirs: string[], part: string): string | null {
  const matches = dirs.filter((d) => {
    const base = d.split('/').pop()!;
    return base === part || base.startsWith(part) || base.endsWith(part);
  });
  return matches.length === 1 ? matches[0]! : null;
}

/** One EXCLUDED entry resolved to files; unresolvable names ride in `missing`. */
function resolveExcluded(
  folder: string,
  entry: ExcludedEntry,
  manifestSlugs: Set<string>,
  dirs: string[],
): { files: string[]; missing: string[] } {
  // Slash-separated index-page entry: split on ' / ', resolve each part.
  if (entry.slug.includes(' / ')) {
    const files: string[] = [];
    const missing: string[] = [];
    for (const part of entry.slug.split(' / ')) {
      const dir = matchDirectory(dirs, part);
      if (dir === null) {
        missing.push(part);
        continue;
      }
      files.push(...filesIn(folder, dir));
    }
    return { files, missing };
  }
  // Glob: every directory under the prefix, minus any slug in MANIFEST —
  // a kept post under an otherwise-excluded prefix stays kept.
  if (entry.slug.endsWith('/*')) {
    const prefix = entry.slug.slice(0, -1); // 'external/'
    const files: string[] = [];
    for (const dir of dirs) {
      if (!dir.startsWith(prefix)) continue;
      if (dir.slice(prefix.length).includes('/')) continue; // direct children only
      if (manifestSlugs.has(dir)) continue;
      files.push(...filesIn(folder, dir));
    }
    return { files, missing: [] };
  }
  // Exact slug: the one directory.
  const dir = join(folder, entry.slug);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { files: [], missing: [entry.slug] };
  }
  return { files: filesIn(folder, entry.slug), missing: [] };
}

/** Adopt the kept `post-*` sittings: one accepted record per existing transcript. */
function adoptAccepted(deps: AdoptDeps, unresolved: string[]): number {
  const transcriptsDir = join(deps.vaultRoot, 'transcripts');
  if (!existsSync(transcriptsDir)) return 0;
  const names = readdirSync(transcriptsDir)
    .filter((n) => n.startsWith('post-') && n.endsWith('.md'))
    .sort();

  let accepted = 0;
  for (const name of names) {
    const parsed = matter(readFileSync(join(transcriptsDir, name), 'utf-8'));
    if (parsed.data.protocol !== 'import') continue;

    const slug = name.slice('post-'.length, -'.md'.length);
    const source = resolveSource(deps.folder, slug);
    if (source === null) {
      unresolved.push(slug); // logged, never guessed
      continue;
    }
    const day = isoDay(parsed.data.started);
    if (day === null) {
      unresolved.push(slug); // the sitting date is unreadable — never guessed
      continue;
    }
    const hash = bodyHash(matter(readFileSync(source, 'utf-8')).content);
    if (deps.store.knows(hash)) continue; // idempotent: a re-run adds nothing

    const record: ImportRecord = {
      hash,
      sourcePath: source,
      date: day,
      status: 'accepted',
      attempts: 0,
      sessionId: name.slice(0, -'.md'.length),
    };
    deps.store.put(record);
    accepted++;
  }
  return accepted;
}

/** Adopt the refusals: one excluded record per file the table resolves to. */
function adoptExcluded(deps: AdoptDeps, unresolved: string[]): number {
  const dirs = directories(deps.folder);
  const manifestSlugs = new Set(MANIFEST.map((p) => p.slug));
  const entries = deps.excluded ?? EXCLUDED;

  let excluded = 0;
  for (const entry of entries) {
    const { files, missing } = resolveExcluded(deps.folder, entry, manifestSlugs, dirs);
    unresolved.push(...missing);
    for (const file of files) {
      const parsed = matter(readFileSync(file, 'utf-8'));
      const hash = bodyHash(parsed.content);
      if (deps.store.knows(hash)) continue; // count only newly written records
      const record: ImportRecord = {
        hash,
        sourcePath: file,
        date: isoDay(parsed.data.date) ?? '',
        status: 'excluded',
        attempts: 0,
        excludeReason: entry.why, // verbatim — the reasons are worth keeping
      };
      deps.store.put(record);
      excluded++;
    }
  }
  return excluded;
}

/**
 * Reconcile the staging store with the one-off script run. Idempotent —
 * the second call adds nothing — and writes no corpus: only staging
 * records describing corpus that already exists, or refusals already made.
 */
export function adoptPriorIngest(deps: AdoptDeps): AdoptResult {
  const unresolved: string[] = [];
  const accepted = adoptAccepted(deps, unresolved);
  const excluded = adoptExcluded(deps, unresolved);

  const names = [...new Set(unresolved)];
  deps.log({
    at: new Date().toISOString(),
    actor: 'clerk',
    kind: 'import-adopted',
    detail:
      `accepted=${accepted} excluded=${excluded} unresolved=${names.length}` +
      (names.length > 0 ? ` ${names.join(' ')}` : ''),
  });
  return { accepted, excluded, unresolved: names };
}
