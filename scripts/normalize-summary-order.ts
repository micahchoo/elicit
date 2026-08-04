/**
 * Normalize consolidation summary session order — ticket 117.
 *
 * Summaries written before the 117 fix hold their `sessions:` arrays
 * newest-first (the docket handed nextConsolidation a descending array
 * against an oldest-first contract). This script re-orders each summary's
 * sessions oldest-first by the transcript's own `started` stamp and renames
 * the file to `<first>-<last>.md`, so range keys match what the fixed
 * bracketing tree proposes and already-spent consolidation calls stay
 * reusable.
 *
 * Non-destructive by construction: dry-run by default (prints the plan);
 * `--apply` writes the corrected file FIRST and removes the old one after,
 * and refuses to overwrite an existing target. A session with no transcript
 * (or no started stamp) makes its summary UNORDERABLE — reported, skipped,
 * never guessed.
 *
 * Usage:
 *   npx tsx scripts/normalize-summary-order.ts <vault-root> [--apply]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const SUMMARIES_DIR = 'marginalia/transcript-summaries';

const [root, flag] = process.argv.slice(2);
if (!root) {
  console.error('usage: npx tsx scripts/normalize-summary-order.ts <vault-root> [--apply]');
  process.exit(1);
}
const apply = flag === '--apply';

function startedOf(session: string): string | null {
  const file = join(root!, 'transcripts', `${session}.md`);
  if (!existsSync(file)) return null;
  const started = matter(readFileSync(file, 'utf-8')).data.started;
  return typeof started === 'string' && started !== '' ? started : null;
}

const dir = join(root!, SUMMARIES_DIR);
if (!existsSync(dir)) {
  console.error(`no summaries dir at ${dir}`);
  process.exit(1);
}

let ok = 0;
let already = 0;
let unorderable = 0;

for (const entry of readdirSync(dir).sort()) {
  if (!entry.endsWith('.md')) continue;
  const path = join(dir, entry);
  const parsed = matter(readFileSync(path, 'utf-8'));
  const sessions = parsed.data.sessions as string[] | undefined;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    console.log(`SKIP  ${entry} — no sessions array`);
    unorderable++;
    continue;
  }

  const dated = sessions.map((s) => ({ s, at: startedOf(s) }));
  const missing = dated.filter((d) => d.at === null).map((d) => d.s);
  if (missing.length > 0) {
    console.log(`SKIP  ${entry} — no started stamp for: ${missing.join(', ')}`);
    unorderable++;
    continue;
  }

  const ordered = [...dated].sort((a, b) => a.at!.localeCompare(b.at!)).map((d) => d.s);
  const target = `${ordered[0]}-${ordered[ordered.length - 1]}.md`;

  if (ordered.join(',') === sessions.join(',') && target === entry) {
    already++;
    continue;
  }

  if (entry !== target && existsSync(join(dir, target))) {
    console.log(`SKIP  ${entry} — target ${target} already exists`);
    unorderable++;
    continue;
  }

  console.log(`${apply ? 'FIX ' : 'PLAN'}  ${entry} → ${target}  [${ordered.join(', ')}]`);
  if (apply) {
    const yaml = ordered.map((s) => `  - ${s}`).join('\n');
    const body = `---
sessions:
${yaml}
model: ${parsed.data.model ?? 'unknown'}
at: ${parsed.data.at instanceof Date ? parsed.data.at.toISOString() : parsed.data.at ?? ''}
---
${parsed.content.trim()}
`;
    writeFileSync(join(dir, target), body, 'utf-8');
    if (entry !== target) unlinkSync(path);
  }
  ok++;
}

console.log(
  `\n${apply ? 'fixed' : 'would fix'} ${ok}, already correct ${already}, skipped ${unorderable}` +
  (apply ? '' : '  (re-run with --apply to write)'),
);
