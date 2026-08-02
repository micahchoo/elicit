/**
 * Backfill Provenance.context for every harvest Snippet in the vault
 * by locating the snippet text in its source transcript and extracting up to two
 * preceding sentences (ticket 073).
 *
 * Idempotent: never overwrites an already-present `context` value.
 * Earliest-turn-wins: when a snippet appears in multiple turns of its transcript,
 *   the earliest is used.
 * Unlocatable snippets are logged, not guessed.
 * Restatements are never candidates: their text is a rewrite that does not
 *   appear verbatim in the transcript, so it cannot be located.
 *
 *   npx tsx scripts/backfill-context.ts --dry     report what would change, touch nothing
 *   npx tsx scripts/backfill-context.ts --apply   write context to the vault
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import type { Provenance } from '../src/types.js';

const VAULT_ROOT = process.env['ELICIT_VAULT'] ?? 'vault';
const APPLY = process.argv.includes('--apply');

// ── Types ──

export type SnippetEntry = {
  snippetId: string;
  version: number;
  prose: string;
  provenance: Provenance;
  filePath: string;
};

type SnippetFrontmatter = {
  id: string;
  version: number;
  captured: string;
  provenance: Provenance;
};

// ── Context extraction — same algorithm as the harvester (src/harvester/harvester.ts) ──

/**
 * Extract up to two sentences immediately preceding the cut in its source turn.
 * Sentence split on `. `, `! `, `? ` followed by an uppercase letter.
 * Returns undefined when the cut opens the turn (no preceding sentence).
 */
export function backfillContext(turnText: string, cutText: string): string | undefined {
  const idx = turnText.indexOf(cutText);
  if (idx < 0) return undefined;

  const before = turnText.slice(0, idx).trimEnd();
  if (before.length === 0) return undefined;

  const sentences: string[] = [];
  let current = '';
  for (let i = 0; i < before.length; i++) {
    const ch = before[i]!;
    current += ch;
    if (
      (ch === '.' || ch === '!' || ch === '?') &&
      (i + 1 >= before.length || (before[i + 1] === ' ' && i + 2 < before.length && /[A-Z]/.test(before[i + 2]!)))
    ) {
      sentences.push(current);
      current = '';
    }
  }
  if (current.trim().length > 0) {
    sentences.push(current);
  }

  if (sentences.length === 0) return undefined;

  const last = sentences.slice(-2);
  const result = last.join('').trimEnd();
  return result.length > 0 ? result : undefined;
}

// ── Transcript parsing ──

/**
 * Split a transcript into its user turns, in order. The transcript format is
 * `## agent` / `## user` headings written by `vault.appendTurn`; each user
 * turn's text runs until the next `## ` heading (any role) or the end.
 */
export function parseUserTurns(transcript: string): string[] {
  const turns: string[] = [];
  // Split on ## user headings, extract text until next ## or end
  const parts = transcript.split(/^## user$/m);
  // First part is everything before the first ## user (frontmatter + agent turns) — skip
  for (let i = 1; i < parts.length; i++) {
    const section = parts[i]!;
    // Take text until next ## (any role) or end
    const endMatch = section.match(/^## /m);
    const text = endMatch
      ? section.slice(0, endMatch.index).trim()
      : section.trim();
    turns.push(text);
  }
  return turns;
}

// ── Scan ──

/** Every version file of every snippet — same directory walk as `vault.rebuildIndex()`. */
export function readAllSnippets(vaultRoot: string = VAULT_ROOT): SnippetEntry[] {
  const entries: SnippetEntry[] = [];
  const snippetsDir = join(vaultRoot, 'snippets');
  if (!existsSync(snippetsDir)) return entries;
  try {
    for (const dirName of readdirSync(snippetsDir)) {
      const dir = join(snippetsDir, dirName);
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => /^v\d+\.md$/.test(f));
      } catch {
        continue; // not a directory — stray file, skip
      }
      for (const file of files) {
        const filePath = join(dir, file);
        const parsed = matter.read(filePath);
        const data = parsed.data as SnippetFrontmatter;
        if (!data.provenance) continue;
        entries.push({
          snippetId: data.id,
          version: data.version,
          prose: parsed.content.trimEnd(),
          provenance: data.provenance,
          filePath,
        });
      }
    }
  } catch {
    // No snippets directory yet — ok
  }
  return entries;
}

// ── Write ──

/**
 * Stamp `context` into the snippet file's frontmatter. Re-reads the file first
 * so a concurrent stamp can't be clobbered; returns false when the file already
 * carries a context by the time we get here.
 */
export function stampContext(filePath: string, context: string): boolean {
  const parsed = matter.read(filePath);
  const data = parsed.data as SnippetFrontmatter;
  const current = data.provenance?.context;
  if (current !== undefined && current !== '') return false;
  data.provenance.context = context;
  const content = matter.stringify(parsed.content, parsed.data);
  writeFileSync(filePath, content, 'utf-8');
  return true;
}

// ── Selection ──

/**
 * A harvest snippet is a backfill candidate when it carries no context yet.
 * Restatements are the reviewer's rewrite (their text is not verbatim in the
 * transcript) and unprompted material has no eliciting question — neither can
 * be located, so neither is a candidate.
 */
export function isBackfillCandidate(provenance: Provenance): boolean {
  return (
    provenance.kind === 'harvest' &&
    (provenance.context === undefined || provenance.context === '')
  );
}

// ── Main ──

// Run the pipeline only when this file is the entry point (direct tsx/bun
// invocation). Tests import the functions above; importing must not re-scan
// or report on the vault.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

function main(): void {
  const snippets = readAllSnippets();

  const candidates = snippets.filter((s) => isBackfillCandidate(s.provenance));

  // Harvest snippets that already carry a context — counted for the report.
  let alreadyHad = snippets.filter(
    (s) => s.provenance.kind === 'harvest' && !isBackfillCandidate(s.provenance),
  ).length;

  const backfilled: { entry: SnippetEntry; context: string; turn: number }[] = [];
  const unlocatable: SnippetEntry[] = [];
  const noPreceding: SnippetEntry[] = [];
  let errors = 0;

  for (const entry of candidates) {
    const transcriptPath = join(VAULT_ROOT, 'transcripts', `${entry.provenance.session}.md`);
    let transcript: string;
    try {
      transcript = readFileSync(transcriptPath, 'utf-8');
    } catch {
      unlocatable.push(entry);
      continue;
    }

    const turns = parseUserTurns(transcript);
    // Earliest turn wins: the first turn whose text contains the snippet verbatim.
    const turnIdx = turns.findIndex((t) => t.includes(entry.prose));
    if (turnIdx < 0) {
      unlocatable.push(entry);
      continue;
    }

    const context = backfillContext(turns[turnIdx]!, entry.prose);
    if (context === undefined) {
      // Located, but the cut opened its turn — no preceding sentence to take,
      // exactly as the harvester's own context rule handles it.
      noPreceding.push(entry);
      continue;
    }

    backfilled.push({ entry, context, turn: turnIdx });
  }

  // ── Apply or report ──

  let written = 0;
  if (APPLY) {
    for (const b of backfilled) {
      try {
        if (stampContext(b.entry.filePath, b.context)) {
          written++;
          console.log(`stamped ${b.entry.snippetId} v${b.entry.version} (turn ${b.turn})`);
        } else {
          alreadyHad++; // stamped between scan and write — not ours to touch
          console.log(`skipped ${b.entry.snippetId} v${b.entry.version} — context appeared meanwhile`);
        }
      } catch {
        errors++;
        console.error(`error writing ${b.entry.filePath}`);
      }
    }
  } else {
    for (const b of backfilled) {
      console.log(`\n${b.entry.snippetId} v${b.entry.version} — session ${b.entry.provenance.session} (turn ${b.turn})`);
      console.log(`  context: ${JSON.stringify(b.context)}`);
    }
  }

  for (const e of unlocatable) {
    console.error(`unlocatable: ${e.snippetId} v${e.version} — session ${e.provenance.session}`);
  }
  for (const e of noPreceding) {
    console.error(`no preceding sentence: ${e.snippetId} v${e.version} — session ${e.provenance.session}`);
  }

  console.log(`\nbackfill-context ${APPLY ? 'APPLIED' : 'DRY RUN'} — ${VAULT_ROOT}`);
  console.log(`snippets scanned:      ${snippets.length}`);
  console.log(`candidates (harvest):  ${candidates.length}`);
  console.log(`already had context:   ${alreadyHad}`);
  console.log(`backfilled:            ${APPLY ? `${written}/${backfilled.length}` : backfilled.length}`);
  console.log(`unlocatable:           ${unlocatable.length}`);
  console.log(`no preceding sentence: ${noPreceding.length}`);
  console.log(`errors:                ${errors}`);
  if (!APPLY) console.log(`\n(dry run — vault untouched; re-run with --apply to write)`);
}

if (isMain) {
  main();
}
