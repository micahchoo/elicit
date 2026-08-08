/**
 * The staging store: where an unreviewed import lives, and it is not the
 * corpus. Records live at `vault/imports/<hash>.md` — gray-matter, frontmatter
 * = the ImportRecord, body = the prepared prose. Markdown is the truth (Q-3).
 * Nothing in this file touches `vault/snippets/`, `vault/transcripts/` or
 * `vault/wiki/`.
 *
 * `vault/imports/` stays TRACKED — no .gitignore line: an import record is the
 * decision record for what entered the corpus and why something did not, not a
 * derived artifact (Q-3, A4/Q-61).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import type { ImportRecord, ImportStatus, RefusalReason, ScannedItem } from './contract.js';

export type AdmitResult = {
  added: string[];
  skipped: string[];
  refused: { sourcePath: string; reason: RefusalReason }[];
};

export type ImportStore = {
  /**
   * Writes records for items whose hash is unknown, deciding each record's
   * `date` (see the date invariant on `admit`). Returns what it did —
   * including refusals, because a second sitting with no `lastmod` is refused
   * here rather than at scan time, where the accepted records are not visible.
   */
  admit(items: ScannedItem[], region?: string): AdmitResult;
  knows(hash: string): boolean;
  get(hash: string): ImportRecord | null;
  /** The prepared prose fed to the harvester. Body of the record file. */
  prepared(hash: string): string;
  put(record: ImportRecord, prepared?: string): void;
  list(status?: ImportStatus, region?: string): ImportRecord[];
  /** Oldest-first by date, so a corpus imports in the order it was written. */
  nextExtracted(region?: string): ImportRecord | null;
  nextPending(region?: string): ImportRecord | null;
};

export function createImportStore(vaultRoot: string): ImportStore {
  const importsDir = join(vaultRoot, 'imports');

  const fileFor = (hash: string): string => join(importsDir, `${hash}.md`);

  const readRecord = (hash: string): ImportRecord | null => {
    const path = fileFor(hash);
    if (!existsSync(path)) return null;
    return matter(readFileSync(path, 'utf-8')).data as ImportRecord;
  };

  const writeRecord = (record: ImportRecord, body: string = ''): void => {
    mkdirSync(importsDir, { recursive: true });
    // 048 hazard: a PRESENT key holding `undefined` throws in matter.stringify
    // (js-yaml: "unacceptable kind of an object to dump") and loses the whole
    // write, not just the field. Every optional field is conditionally spread
    // or absent — never `lastmod: record.lastmod` with an undefined value.
    const fm = {
      hash: record.hash,
      sourcePath: record.sourcePath,
      date: record.date,
      ...(record.region !== undefined ? { region: record.region } : {}),
      ...(record.lastmod !== undefined ? { lastmod: record.lastmod } : {}),
      ...(record.title !== undefined ? { title: record.title } : {}),
      status: record.status,
      attempts: record.attempts,
      ...(record.cuts !== undefined ? { cuts: record.cuts } : {}),
      ...(record.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
      ...(record.kept !== undefined ? { kept: record.kept } : {}),
      ...(record.excludeReason !== undefined ? { excludeReason: record.excludeReason } : {}),
      ...(record.failure !== undefined ? { failure: record.failure } : {}),
    };
    writeFileSync(fileFor(record.hash), matter.stringify(body, fm), 'utf-8');
  };

  const list = (status?: ImportStatus, region?: string): ImportRecord[] => {
    if (!existsSync(importsDir)) return [];
    const records = readdirSync(importsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => readRecord(f.slice(0, -3)))
      .filter((r): r is ImportRecord => r !== null);
    const byStatus = status === undefined ? records : records.filter((r) => r.status === status);
    return region === undefined ? byStatus : byStatus.filter((r) => r.region === region);
  };

  const knows = (hash: string): boolean => existsSync(fileFor(hash));

  const get = (hash: string): ImportRecord | null => readRecord(hash);

  const prepared = (hash: string): string => {
    const path = fileFor(hash);
    if (!existsSync(path)) return '';
    // matter.stringify appends one trailing newline to the body; trim it back
    // so the prepared prose round-trips exactly as it was fed in.
    return matter(readFileSync(path, 'utf-8')).content.trimEnd();
  };

  const put = (record: ImportRecord, prepared: string = ''): void =>
    writeRecord(record, prepared);

  const admit = (scanned: ScannedItem[], region?: string): AdmitResult => {
    const added: string[] = [];
    const skipped: string[] = [];
    const refused: { sourcePath: string; reason: RefusalReason }[] = [];
    for (const item of scanned) {
      // A known hash at ANY status is known — accepted, excluded, failed and
      // stale all count. Re-running imports nothing twice, including things
      // the reader refused.
      if (knows(item.hash)) {
        skipped.push(item.hash);
        continue;
      }
      // `admit` is the ONLY place a record's `date` is decided. An accepted
      // record for the same source path means this is Q-59's second sitting on
      // a changed file: the sitting date is the scanned `lastmod`, and its
      // absence is a refusal ('no-lastmod') rather than a fallback to `date` —
      // dating the second sitting to the first sitting's day would put two
      // independently written versions on one date and destroy exactly the
      // drift evidence Q-59 exists to preserve.
      const alreadyAccepted = list('accepted').some((r) => r.sourcePath === item.sourcePath);
      if (alreadyAccepted) {
        if (item.lastmod === undefined) {
          refused.push({ sourcePath: item.sourcePath, reason: 'no-lastmod' });
          continue;
        }
        writeRecord(
          {
            hash: item.hash,
            sourcePath: item.sourcePath,
            date: item.lastmod,
            lastmod: item.lastmod,
            ...(region !== undefined ? { region } : {}),
            ...(item.title !== undefined ? { title: item.title } : {}),
            status: 'pending',
            attempts: 0,
          },
          item.body,
        );
        added.push(item.hash);
        continue;
      }
      writeRecord(
        {
          hash: item.hash,
          sourcePath: item.sourcePath,
          date: item.date,
          ...(region !== undefined ? { region } : {}),
          ...(item.lastmod !== undefined ? { lastmod: item.lastmod } : {}),
          ...(item.title !== undefined ? { title: item.title } : {}),
          status: 'pending',
          attempts: 0,
        },
        item.body,
      );
      added.push(item.hash);
    }
    return { added, skipped, refused };
  };

  const nextByDate = (status: ImportStatus, region?: string): ImportRecord | null => {
    const records = list(status, region);
    if (records.length === 0) return null;
    // ISO days sort lexicographically, so ascending date = oldest first.
    return records.slice().sort((a, b) => a.date.localeCompare(b.date))[0]!;
  };

  const nextExtracted = (region?: string): ImportRecord | null => nextByDate('extracted', region);
  const nextPending = (region?: string): ImportRecord | null => nextByDate('pending', region);

  return { admit, knows, get, prepared, put, list, nextExtracted, nextPending };
}
