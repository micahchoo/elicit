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
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
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
