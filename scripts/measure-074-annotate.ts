/**
 * Ticket 074 — model-resolved referent annotation, measured against the
 * labelled dangler set before it ships. Read-only over the vault: the
 * script never writes a snippet, a reading or a queue line; its only
 * writes are the measurement file below (and the driver's manual grades,
 * read by --score).
 *
 * What it measures, and why. The label table
 * (docs/dangler-labels-2026-08-02.md) says which of the 139 snippets
 * dangle and what the true referent is — 96 dangle, 71 resolvable from
 * the mechanical 2-sentence window alone, 25 unresolvable, 0 via
 * eliciting question (this vault is 100% imported prose). The annotation
 * ships only if its precision on that set earns it: a wrong resolved
 * referent is worse than the dimmed context window alone, because it
 * asserts where the window merely shows. So the sweep runs
 * annotateReferent over the labelled rows with the standing clerk model
 * and records one outcome per row — annotation, silence, missing, or a
 * recorded model error — keyed to the label, so the driver can compute
 * precision, the unresolvable-bucket silence rate, and the
 * resolvable-bucket recall.
 *
 * The model is the standing clerk: qwen3.6:35b at the clerk endpoint (src/llm.ts defaults)
 * (the src/llm.ts default; ELICIT_CLERK_* env overrides it, and the
 * banner stamps what actually answered).
 *
 * Output: `data/eval-074-annotate/output.jsonl`, one line per row, in a
 * stable path so an interrupted run resumes (rows already on disk are
 * skipped). `--score` reads that file plus the manually graded
 * `grades.jsonl` and prints the after-numbers.
 *
 *   npx tsx scripts/measure-074-annotate.ts [--limit N]
 *   npx tsx scripts/measure-074-annotate.ts --score
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { annotateReferent, type AnnotateItem } from '../src/clerk/annotate.js';
import { makeComplete, roleConfig } from '../src/llm.js';
import type { Complete, Snippet } from '../src/types.js';
import { createVault } from '../src/vault/vault.js';

const VAULT_ROOT = process.env.ELICIT_VAULT_ROOT ?? join(import.meta.dirname, '..', 'vault');
const LABEL_DOC = join(import.meta.dirname, '..', 'docs', 'dangler-labels-2026-08-02.md');
const OUT_DIR = join(import.meta.dirname, '..', 'data', 'eval-074-annotate');
const OUT = join(OUT_DIR, 'output.jsonl');
const GRADES = join(OUT_DIR, 'grades.jsonl');

/** The counts the doc's own Summary asserts — a mis-parse silently measures the wrong set. */
const SUMMARY_COUNTS = {
  total: 139,
  dangles: 96,
  noDangles: 43,
  sameTurn: 71,
  unresolvable: 25,
  elicitingQuestion: 0,
} as const;

type Label = {
  dangles: boolean;
  expression: string | null;
  referent: string | null;
  source: string | null;
};

type LabeledRow = {
  id: string;
  label: Label;
};

type Outcome =
  | { kind: 'annotation'; expression: string; referent: string }
  | { kind: 'silence' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

type Row = {
  id: string;
  label: Label;
  outcome: Outcome;
};

type Grade = {
  id: string;
  correct: boolean;
  note?: string;
};

// ── The label table ──

/**
 * The labelled rows of docs/dangler-labels-2026-08-02.md, in table order:
 * `| <26-char ULID> | yes|no | <expression(s)> | <referent> | <source> |`
 * between the header line and the `## Summary` heading. A 'no' row has an
 * em dash in the last three cells — normalized to null.
 */
function parseLabels(doc: string): LabeledRow[] {
  const lines = doc.split('\n');
  const header = lines.findIndex((l) => l.startsWith('| Snippet |'));
  const summary = lines.findIndex((l, i) => i > header && l.startsWith('## Summary'));
  if (header === -1 || summary === -1) {
    throw new Error(`label table not found in ${LABEL_DOC} (header=${header}, summary=${summary})`);
  }
  const rows: LabeledRow[] = [];
  for (const line of lines.slice(header + 1, summary)) {
    const cells = line.split('|').map((c) => c.trim());
    // cells: ['', <ULID>, 'yes'|'no', <expression>, <referent>, <source>, ''] — the
    // ULID filter skips the `|---|---|---|` separator and any stray line.
    const id = cells[1] ?? '';
    if (!/^[A-Z0-9]{26}$/.test(id)) continue;
    if (cells[2] === 'yes') {
      rows.push({
        id,
        label: {
          dangles: true,
          expression: cells[3] === '—' || cells[3] === undefined ? null : cells[3],
          referent: cells[4] === '—' || cells[4] === undefined ? null : cells[4],
          source: cells[5] === '—' || cells[5] === undefined ? null : cells[5],
        },
      });
    } else {
      rows.push({ id, label: { dangles: false, expression: null, referent: null, source: null } });
    }
  }
  return rows;
}

/**
 * Hard gate against a mis-parse: the parsed set must equal the counts the
 * doc's own Summary asserts, or the measurement is silently over the wrong
 * population and must not run.
 */
function assertSanity(rows: LabeledRow[]): void {
  const counts = {
    total: rows.length,
    dangles: rows.filter((r) => r.label.dangles).length,
    noDangles: rows.filter((r) => !r.label.dangles).length,
    sameTurn: rows.filter((r) => r.label.source === 'same-turn context').length,
    unresolvable: rows.filter((r) => r.label.source === 'unresolvable').length,
    elicitingQuestion: rows.filter((r) => r.label.source === 'eliciting question').length,
  };
  const bad = (Object.keys(SUMMARY_COUNTS) as (keyof typeof SUMMARY_COUNTS)[]).filter(
    (k) => counts[k] !== SUMMARY_COUNTS[k]
  );
  if (bad.length > 0) {
    const detail = bad.map((k) => `${k}: got ${counts[k]}, want ${SUMMARY_COUNTS[k]}`).join('; ');
    throw new Error(`dangler label parse failed the doc-Summary sanity check (${LABEL_DOC}): ${detail}`);
  }
}

// ── One row through the model ──

/**
 * The row's outcome. A snippet absent from the vault index is 'missing'; a
 * throw from annotateReferent is a recorded 'error' — a model failure is a
 * row the score must see, never silence and never a crash.
 */
async function annotateOne(
  row: LabeledRow,
  snippets: Record<string, Snippet>,
  complete: Complete,
  model: string
): Promise<Outcome> {
  const snippet = snippets[row.id];
  if (snippet === undefined) return { kind: 'missing' };
  try {
    const item: AnnotateItem = { snippet, model };
    const result = await annotateReferent(item, complete);
    return result.kind === 'annotation'
      ? { kind: 'annotation', expression: result.annotation.expression, referent: result.annotation.referent }
      : { kind: 'silence' };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ── The sweep ──

async function sweep(limit: number | null): Promise<void> {
  const rows = parseLabels(readFileSync(LABEL_DOC, 'utf-8'));
  assertSanity(rows);

  const vault = createVault(VAULT_ROOT);
  const index = vault.rebuildIndex();
  const complete = makeComplete('clerk');
  const model = roleConfig('clerk').modelId;

  // Resumable: rows already on disk are done — each outcome lands on disk
  // before the next model call starts, so an interrupted run re-measures
  // nothing.
  mkdirSync(OUT_DIR, { recursive: true });
  const done = new Set<string>();
  const written: Row[] = [];
  if (existsSync(OUT)) {
    for (const line of readFileSync(OUT, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Row;
      written.push(r);
      done.add(r.id);
    }
  }

  const todo = limit === null ? rows : rows.slice(0, limit);
  console.log(`ticket-074 sweep: ${rows.length} rows, ${done.size} already done, model=${model}`);

  let errors = 0;
  for (const row of todo) {
    if (done.has(row.id)) continue;
    const outcome = await annotateOne(row, index.snippets, complete, model);
    if (outcome.kind === 'error') errors++;
    written.push({ id: row.id, label: row.label, outcome });
    writeFileSync(OUT, written.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
    if (written.length % 10 === 0) console.log(`${written.length} measured so far, ${errors} errors`);
  }

  // ── The after-numbers ──
  const buckets = new Map<string, { annotation: number; silence: number; error: number; missing: number }>();
  for (const r of written) {
    const key = r.label.source ?? 'dangles=no';
    const c = buckets.get(key) ?? { annotation: 0, silence: 0, error: 0, missing: 0 };
    c[r.outcome.kind]++;
    buckets.set(key, c);
  }
  console.log('---');
  console.log('mechanical summary (per label.source bucket):');
  for (const [key, c] of [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    console.log(`  ${key}: annotation=${c.annotation} silence=${c.silence} error=${c.error} missing=${c.missing}`);
  }
  console.log(`output: ${OUT}`);
}

// ── The score ──

/** The three labelled buckets partition all 139 rows; 'eliciting question' is 0 by construction. */
function bucketOf(r: Row): 'same-turn-context' | 'unresolvable' | 'dangles=no' {
  if (!r.label.dangles) return 'dangles=no';
  if (r.label.source === 'unresolvable') return 'unresolvable';
  return 'same-turn-context';
}

function score(): void {
  if (!existsSync(OUT)) {
    throw new Error(`no sweep output at ${OUT} — run the sweep first`);
  }
  const rows: Row[] = [];
  for (const line of readFileSync(OUT, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as Row);
  }

  const grades = new Map<string, Grade>();
  if (existsSync(GRADES)) {
    for (const line of readFileSync(GRADES, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const g = JSON.parse(line) as Grade;
      grades.set(g.id, g);
    }
  }

  // Grades apply ONLY to annotation rows; a missing grade would silently
  // undercount precision, so it hard-fails.
  const annotations = rows.filter((r) => r.outcome.kind === 'annotation');
  const ungraded = annotations.filter((r) => !grades.has(r.id));
  if (ungraded.length > 0) {
    throw new Error(
      `${ungraded.length} annotation row(s) have no grade in ${GRADES}: ${ungraded.map((r) => r.id).join(', ')}`
    );
  }
  const correct = annotations.filter((r) => grades.get(r.id)?.correct === true).length;
  const wrong = annotations.length - correct;

  console.log('---');
  console.log(`annotations: ${annotations.length}`);
  console.log(`correct: ${correct}`);
  console.log(`WRONG: ${wrong}`);
  const precision = annotations.length === 0 ? 'n/a (no annotations)' : `${correct}/${annotations.length} = ${(correct / annotations.length).toFixed(3)}`;
  console.log(`precision: ${precision}`);
  for (const b of ['same-turn-context', 'unresolvable', 'dangles=no'] as const) {
    const inBucket = rows.filter((r) => bucketOf(r) === b);
    const ann = inBucket.filter((r) => r.outcome.kind === 'annotation');
    const ok = ann.filter((r) => grades.get(r.id)?.correct === true).length;
    console.log(`${b}: ${ann.length} annotations, ${ok} correct (of ${inBucket.length} labelled rows)`);
  }
  const unresolvableRows = rows.filter((r) => r.label.source === 'unresolvable');
  const silentUnresolvable = unresolvableRows.filter((r) => r.outcome.kind === 'silence').length;
  console.log(`silence on unresolvable: ${silentUnresolvable}/${unresolvableRows.length}`);
  const resolvableRows = rows.filter((r) => r.label.source === 'same-turn context');
  const correctResolvable = resolvableRows.filter(
    (r) => r.outcome.kind === 'annotation' && grades.get(r.id)?.correct === true
  ).length;
  const recall = resolvableRows.length === 0 ? 'n/a (no resolvable rows)' : `${correctResolvable}/${resolvableRows.length} = ${(correctResolvable / resolvableRows.length).toFixed(3)}`;
  console.log(`recall on resolvable: ${recall}`);
  console.log(`errors: ${rows.filter((r) => r.outcome.kind === 'error').length}`);
  console.log(`missing: ${rows.filter((r) => r.outcome.kind === 'missing').length}`);
}

// ── Entry ──

function parseLimit(args: string[]): number | null {
  const at = args.indexOf('--limit');
  if (at === -1) return null;
  const raw = args[at + 1];
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n) || n < 1) {
    throw new Error('--limit expects a positive integer (smoke-testing the first N rows)');
  }
  return n;
}

const args = process.argv.slice(2);
if (args.includes('--score')) {
  score();
} else {
  await sweep(parseLimit(args));
}
