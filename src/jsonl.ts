/**
 * One JSONL mechanic, shared by every append-only ledger in the tree —
 * Wave D4's convergence target for the reach declines, the graduation
 * ledger, the import-repair ledger, the repair records and the clerk's
 * sweep log and deferral.
 *
 * A ledger is a file that is only ever appended to: one line per record,
 * written whole, never rewritten. Each store keeps its OWN line grammar
 * (which JSON shape it writes) and its own parse of what it reads back
 * (which fields it demands, what it skips); this module is only the
 * append/read mechanic, so a crash leaves the file in the one state that
 * costs nothing: a line that is either fully written or not there at all.
 *
 * The guarantees every ledger here depends on:
 *
 *  - `appendLine` writes the line and its newline in one `appendFileSync`
 *    call, so a concurrent or crashed reader either sees the whole line or
 *    does not see it, and never sees half of one.
 *  - `readLines` returns every fully written line, in order. A missing
 *    file reads as no lines, and the trailing empty element a final
 *    newline leaves behind is dropped. Anything else — including a
 *    half-written final line — is delivered raw, and the caller's parse
 *    already skips what it cannot read: the ledger's own rule, stated once
 *    here instead of once per store.
 *
 * The two read helpers below are the same discipline for the two read
 * shapes the stores converged on: `readJsonl` for the ledgers' parse
 * loop (split, trim, parse, skip what will not parse) and
 * `jsonCursorFile` for the single-record JSON cursors — the still-true
 * and outcome offsets, the resume marker and the engagement ledger.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Append one line. Creates the parent directory, so the first write of a
 * fresh instance does not fail on a missing `data/`, `imports/` or
 * `wiki/` directory. The write is one `appendFileSync` of the line ending
 * in a newline, which is what makes a concurrent reader safe.
 */
export function appendLine(root: string, relPath: string, line: string): void {
 const file = join(root, relPath);
 mkdirSync(dirname(file), { recursive: true });
 appendFileSync(file, `${line}\n`, 'utf-8');
}

/**
 * Every line that was fully written, oldest first. An absent file reads as
 * an empty ledger — a fresh instance has recorded nothing, which is a fact,
 * not an error.
 */
export function readLines(root: string, relPath: string): string[] {
 let text: string;
 try {
  text = readFileSync(join(root, relPath), 'utf-8');
 } catch {
  return [];
 }
 const lines = text.split('\n');
 if (lines[lines.length - 1] === '') lines.pop();
 return lines;
}

/**
 * Every line a ledger can yield, parsed. The split→trim→parse→skip
 * skeleton every JSONL store used to hand-roll: a missing file reads as
 * an empty ledger, a blank line is skipped, and a line that will not
 * parse is dropped on the Activity Log's precedent — a torn final line
 * must never hide the good lines above it. What each store demands of a
 * line is its OWN grammar (`parse`), and a line that grammar refuses is
 * skipped exactly like a line that will not parse.
 */
export function readJsonl<T>(root: string, relPath: string, parse: (value: unknown) => T | null): T[] {
 const out: T[] = [];
 for (const line of readLines(root, relPath)) {
  const trimmed = line.trim();
  if (trimmed === '') continue;
  let value: unknown;
  try {
   value = JSON.parse(trimmed);
  } catch {
   continue; // A torn line costs one record, never the run.
  }
  const parsed = parse(value);
  if (parsed !== null) out.push(parsed);
 }
 return out;
}

/**
 * A single-record JSON cursor file — the try/JSON.parse/type-check shape
 * every cursor, marker and engagement ledger used to hand-roll. `read` is
 * the missing-or-unparseable-is-null answer, and each caller maps null to
 * its own default (0 for the offsets, null for the resume marker, the
 * fresh engagement state). `write` creates the parent directory and
 * stringifies compact, or through `stringify` when a site's wire format
 * says otherwise — the engagement ledger's pretty-printed line. File
 * names and formats are the caller's contract; nothing here rewrites them.
 */
export function jsonCursorFile<T>(
 root: string,
 relPath: string,
 parse: (value: unknown) => T | null,
 stringify?: (value: T) => string,
): { read(): T | null; write(value: T): void } {
 const file = join(root, relPath);
 return {
  read(): T | null {
   try {
    return parse(JSON.parse(readFileSync(file, 'utf-8')));
   } catch {
    return null;
   }
  },
  write(value: T): void {
   mkdirSync(dirname(file), { recursive: true });
   writeFileSync(file, stringify ? stringify(value) : JSON.stringify(value), 'utf-8');
  },
 };
}
