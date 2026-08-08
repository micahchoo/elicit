import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { readMarginaliaLine, writeMarginaliaLine } from '../vault/marginalia.js';
import type { Complete, ParkedLadder } from '../types.js';

/** `{root}/marginalia/sounding-summaries/{id}.md` — the one line, Marginalia-class (Q-8, Q-20, Q-45). */
const SUMMARIES_DIR = 'marginalia/sounding-summaries';

/**
 * One line standing for the rungs a compaction drops (T10). Written in the
 * background by the clerk model — nobody is waiting for it (Q-48) — and
 * stamped with the model that wrote it at the moment it is accepted (Q-34).
 * The prompt gets the rungs being summarized and nothing else; the line
 * names what the descent moved through, never how it went.
 *
 * A failed or empty completion is a failed summary: returns null and writes
 * nothing, so compaction degrades to less context instead of a stale or
 * invented line.
 */
export async function summarizeLadder(
  l: ParkedLadder,
  complete: Complete,
  model: string,
): Promise<{ line: string; model: string; at: string } | null> {
  const rungs = l.rungs.map((r) => `Q: ${r.question}\nA: ${r.answer}`).join('\n\n');
  let raw: string;
  try {
    raw = await complete(
      'Write ONE plain line naming what this descent moved through, from the rungs below. No interpretation, no praise, no advice, no judgment.',
      [{ role: 'user', text: rungs, at: l.ended }],
    );
  } catch {
    return null;
  }
  // One line is the contract: an embedded newline would break the compact
  // resume, so a multi-line answer is collapsed into one, never truncated.
  const line = raw.replace(/\s*\n+\s*/g, ' ').trim();
  if (line === '') return null;
  return { line, model, at: new Date().toISOString() };
}

/**
 * Persist the one line to `{root}/marginalia/sounding-summaries/{id}.md`,
 * frontmatter-stamped with the model and the moment (Q-34), body the line —
 * the same shape cover.ts uses for range summaries. Marginalia-class: never
 * a Snippet, never in the corpus, never in a Piece, never shown at close
 * (Q-8, Q-20, Q-45). Nothing in this task calls `vault.saveSnippet`.
 */
export function saveLadderSummary(
  root: string,
  id: string,
  s: { line: string; model: string; at: string },
): void {
  writeMarginaliaLine(root, 'sounding-summaries', `${id}.md`, s);
}

/**
 * The line for a ladder, or null when it has none. What T12 passes to
 * `compactLadder`; a missing or empty summary reads as no summary, so the
 * resume degrades to less context, never a stale or invented line.
 */
export function loadLadderSummary(root: string, id: string): string | null {
  return readMarginaliaLine(root, 'sounding-summaries', `${id}.md`)?.line ?? null;
}

/**
 * The background job (docket-run → ladder-summary-compose → marginalia-write):
 * every `soundings/*.md` with `ended` set and no summary yet gets one line
 * from the clerk model. One summary per ladder, so a run is idempotent and
 * does not re-summarize the vault every time the docket wakes. The stamp is
 * the CLERK model (Q-48): this call has nobody waiting on it.
 */
export async function runLadderSummaries(deps: {
  root: string;
  complete: Complete;
  model: string | undefined;
  log: (e: { at: string; actor: string; kind: string; detail: string }) => void;
}): Promise<{ summarized: number }> {
  // The stamp is the model that wrote the line (Q-34). With no model name
  // there is nothing to stamp truthfully, so nothing is written — the job
  // degrades like a failed completion, to less context and never a lie.
  if (deps.model === undefined) return { summarized: 0 };
  const dir = join(deps.root, 'soundings');
  if (!existsSync(dir)) return { summarized: 0 };
  let summarized = 0;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    const id = file.slice(0, -3);
    if (readMarginaliaLine(deps.root, 'sounding-summaries', `${id}.md`) !== null) continue;
    const data = matter(readFileSync(join(dir, file), 'utf-8')).data as Record<string, unknown>;
    if (typeof data.ended !== 'string') continue;
    const s = await summarizeLadder(data as unknown as ParkedLadder, deps.complete, deps.model);
    if (s === null) continue;
    saveLadderSummary(deps.root, id, s);
    summarized++;
    deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'sounding-summarized', detail: `sounding=${id} model=${s.model}` });
  }
  return { summarized };
}
