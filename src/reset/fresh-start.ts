import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Fresh start: move every person-derived record into a dated archive
 * directory, leaving the instruments in place. The next boot then rebuilds
 * an empty vault and asks for a new password — the same stop → move → boot
 * flow the 2026-08-03 pristine reset proved by hand.
 *
 * The split is the reset's own rule: the vault, annotations, gazetteer,
 * prior-ingest record, and the eval corpora (real-corpus excerpts —
 * archived by Micah's 2026-08-04 decision) are the person's history and
 * move. The question bank, decks, patterns, ktg, atlases and
 * decisions.jsonl are instrument data — curation records, not diary — and
 * stay.
 *
 * Nothing is ever deleted: every operation is a rename into the archive,
 * so the vault keeps its own git history intact.
 */

export type FreshStartReport = {
 /** Absolute path of the archive directory this run created. */
 archiveDir: string;
 /** Absolute source paths that were moved, in move order. */
 moved: string[];
};

/** `2026-08-04T03-45-12` — an ISO second-stamp safe for a directory name. */
export function archiveStamp(now: Date): string {
 return now.toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * The person-derived paths that exist right now, absolute. The eval glob is
 * read from disk so a new `data/eval-*` corpus is archived without a code
 * change; a missing path is simply not a target.
 */
export function freshStartTargets(cwd: string, vaultRoot: string): string[] {
 const dataDir = join(cwd, 'data');
 const candidates = [
  resolve(vaultRoot),
  join(dataDir, 'annotations'),
  join(dataDir, 'gazetteer'),
  join(dataDir, 'prior-ingest.local.json'),
 ];
 if (existsSync(dataDir)) {
  for (const name of readdirSync(dataDir)) {
   // The manifest itself is the pointer INTO the archives (Q-91) — it must
   // survive the reset it records, so the glob never picks it up.
   if (name.startsWith('eval-') && name !== 'eval-fixtures.json') {
    candidates.push(join(dataDir, name));
   }
  }
 }
 return candidates.filter((p) => existsSync(p));
}

export type EvalFixturesManifest = {
 entries: Array<{
  /** The archive stamp this reset wrote. */
  archivedAt: string;
  /** Corpus name → cwd-relative archive path, read-only to the loop (Q-91). */
  fixtures: Record<string, string>;
 }>;
};

/**
 * Move every target into `<cwd>/archives/<stamp>/`, mirroring the manual
 * reset's layout: the vault at `vault/`, everything else under `data/`.
 *
 * Refuses an archive directory that already exists — two resets in the
 * same second would otherwise interleave into one archive, and an archive
 * is a record: it is written once. A failure mid-move throws naming what
 * had already moved, so the operator knows the exact state on disk.
 */
export function archiveFreshStart(opts: {
 cwd: string;
 vaultRoot: string;
 now: Date;
}): FreshStartReport {
 const archiveDir = join(opts.cwd, 'archives', archiveStamp(opts.now));
 if (existsSync(archiveDir)) {
  throw new Error(`fresh start refused: archive already exists at ${archiveDir}`);
 }
 const targets = freshStartTargets(opts.cwd, opts.vaultRoot);
 const vaultAbs = resolve(opts.vaultRoot);

 mkdirSync(join(archiveDir, 'data'), { recursive: true });
 const moved: string[] = [];
 for (const src of targets) {
  const dest =
   src === vaultAbs
    ? join(archiveDir, 'vault')
    : join(archiveDir, 'data', src.split('/').pop()!);
  try {
   renameSync(src, dest);
  } catch (err) {
   throw new Error(
    `fresh start failed moving ${src} → ${dest} after moving [${moved.join(', ')}]: ` +
     (err instanceof Error ? err.message : String(err)),
   );
  }
  moved.push(src);
 }

 // Q-91: every archived eval corpus stays reachable through one pointer.
 // The manifest appends across resets — each entry is a record of where one
 // reset put its corpora, and the loop reads fixtures ONLY through here.
 const stamp = archiveStamp(opts.now);
 const evalMoves: Record<string, string> = {};
 for (const src of moved) {
  const name = src.split('/').pop()!;
  if (src !== vaultAbs && name.startsWith('eval-')) {
   evalMoves[name] = join('archives', stamp, 'data', name);
  }
 }
 if (Object.keys(evalMoves).length > 0) {
  const manifestPath = join(opts.cwd, 'data', 'eval-fixtures.json');
  const manifest: EvalFixturesManifest = existsSync(manifestPath)
   ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as EvalFixturesManifest)
   : { entries: [] };
  manifest.entries.push({ archivedAt: stamp, fixtures: evalMoves });
  mkdirSync(join(opts.cwd, 'data'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
 }

 return { archiveDir, moved };
}
