/**
 * The marginalia/ layout — one store for the Marginalia-class summary lines.
 *
 * Two subsystems write one-line summaries under `{root}/marginalia/`:
 * memory/cover.ts (transcript range summaries) and clerk/sounding-summary.ts
 * (ladder summaries). Before this module each owned its own directory
 * constant, mkdir+readdir+matter-parse skeleton, and file shape — the same
 * layout versioned by convention in two places. The custody slice owns the
 * marginalia layout here; the two writers keep their record shapes and their
 * own subdirectories, and share only the file convention.
 *
 * Marginalia-class (Q-8, Q-20, Q-45): agent annotations beside the corpus,
 * never Snippets, never in a Piece.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

/** The marginalia root, relative to the vault root. */
const MARGINALIA_ROOT = 'marginalia';

/**
 * Write one summary line as `{root}/marginalia/<subdir>/<file>.md`,
 * frontmatter-stamped with the model and the moment (Q-34), body the line.
 */
export function writeMarginaliaLine(
  root: string,
  subdir: string,
  file: string,
  s: { model: string; at: string; line: string; extra?: string },
): void {
  const dir = join(root, MARGINALIA_ROOT, subdir);
  mkdirSync(dir, { recursive: true });
  const content = `---
${s.extra ?? ''}model: ${s.model}
at: ${s.at}
---
${s.line}
`;
  writeFileSync(join(dir, file), content, 'utf-8');
}

/** The stamp + body of one summary file, or null when it is missing or unreadable. */
export function readMarginaliaLine(
  root: string,
  subdir: string,
  file: string,
): { model: string; at: string; line: string } | null {
  try {
    const parsed = matter.read(join(root, MARGINALIA_ROOT, subdir, file));
    const { model, at: rawAt } = parsed.data as { model?: unknown; at?: unknown };
    const at = rawAt instanceof Date ? rawAt.toISOString() : String(rawAt ?? '');
    const line = (parsed.content ?? '').trim();
    if (typeof model !== 'string' || line === '') return null;
    return { model, at, line };
  } catch {
    return null;
  }
}

/** Every summary file in a subdirectory, keyed by file name (sans .md). */
export function listMarginaliaFiles(root: string, subdir: string): string[] {
  const dir = join(root, MARGINALIA_ROOT, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}
