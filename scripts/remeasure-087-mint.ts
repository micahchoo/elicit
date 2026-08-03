/**
 * Ticket 087 — the mint correctives, measured against the live clerk
 * endpoint on the existing corpus. Read-only over the vault: the script
 * never writes a claim, a snippet, a reading or a queue line; its only
 * write is the measurement file below.
 *
 * What it re-runs, and why. RESULTS §16.2 measured the FIRST prompt's
 * output on the first real claim graph: subject drift ("The user" 59,
 * "The person" 28, "The author" 2) and contentless ranges (`generally`
 * x7). This script runs the SAME sweep path — `proposeOps` per reading,
 * the lexical-resonance related-claims lookup from the live claim graph,
 * the same clerk endpoint and model — with the corrected prompt, and
 * records the after-numbers: the subject-form distribution of the minted
 * bodies and the occasionless-range findings the new lint (flipped live
 * here, shadowed in the shipped register) would produce.
 *
 * The model is the standing clerk: qwen3.6:35b at the clerk endpoint (src/llm.ts defaults)
 * (the src/llm.ts default; ELICIT_CLERK_* env overrides it, and the
 * output stamps what actually answered).
 *
 * Output: `data/eval-087-mint/output.jsonl`, one line per reading, in a
 * stable path so an interrupted run resumes (readings already on disk are
 * skipped). The summary numbers print on completion.
 *
 *   npx tsx scripts/remeasure-087-mint.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { proposeOps } from '../src/clerk/mint.js';
import { buildIndex, resonate } from '../src/index/lexical.js';
import { makeComplete, roleConfig } from '../src/llm.js';
import { createClaimStore } from '../src/wiki/store.js';
import { createVault } from '../src/vault/vault.js';
import { lint, type ThresholdRegister } from '../src/wiki/lint.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { Claim, ClaimGraph, LogFn } from '../src/wiki/contract.js';
import type { Reading, Snippet } from '../src/types.js';

const VAULT_ROOT = process.env.ELICIT_VAULT_ROOT ?? join(import.meta.dirname, '..', 'vault');
const OUT_DIR = join(import.meta.dirname, '..', 'data', 'eval-087-mint');
const OUT = join(OUT_DIR, 'output.jsonl');

const RELATED_CLAIMS_SHOWN = 3;

type OutputLine = {
 readingId: string;
 at: string;
 model: string;
 ok: boolean;
 error?: string;
 ops: {
  op: string;
  body?: string;
  range?: string;
  facet?: string;
  cites?: string[];
 }[];
};

// ── Vault, read-only ──

const vault = createVault(VAULT_ROOT);
const store = createClaimStore(VAULT_ROOT);
const index = vault.rebuildIndex();
const slice = store.loadSlice();

const complete = makeComplete('clerk');
const model = roleConfig('clerk').modelId;

// ── The sweep path, replicated from src/clerk/wiki-jobs.ts ──

/** The reading's cited snippets, keyed by id, latest version each. */
function citedSnippets(reading: Reading): Record<string, Snippet> {
 const out: Record<string, Snippet> = {};
 for (const cite of reading.cites) {
  const at = cite.lastIndexOf('@');
  const id = at > 0 ? cite.slice(0, at) : cite;
  const s = index.snippets[id];
  if (s) out[id] = s;
 }
 return out;
}

/**
 * Up to three live claims whose bodies resonate lexically with this reading.
 *
 * A claim the reading itself produced is excluded: during the RESULTS drain a
 * reading never saw its own claim (the claim was minted in the same call), so
 * showing it now would turn every measured reading into a KEEP and measure
 * nothing. `Claim.fromReadings` is the lineage edge that makes the exclusion
 * mechanical.
 */
function relatedClaims(reading: Reading): Claim[] {
 const live = slice.claims
  .filter((c) => c.archived !== true && c.supersededBy === undefined)
  .filter((c) => !c.fromReadings.includes(reading.id))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
 const indexOfBodies = buildIndex(
  live.map((c): Snippet => ({
   id: c.id,
   version: 1,
   captured: c.created,
   provenance: { kind: 'harvest', session: '', question: '', questionForm: 'deliberative' },
   prose: c.body,
  }))
 );
 const byId = new Map(live.map((c) => [c.id, c]));
 const out: Claim[] = [];
 for (const hit of resonate(indexOfBodies, reading.reading)) {
  const claim = byId.get(hit.snippetId);
  if (!claim) continue;
  out.push(claim);
  if (out.length === RELATED_CLAIMS_SHOWN) break;
 }
 return out;
}

// ── Resumable run ──

mkdirSync(OUT_DIR, { recursive: true });
const done = new Set<string>();
const lines: OutputLine[] = [];
if (existsSync(OUT)) {
 for (const line of readFileSync(OUT, 'utf-8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as OutputLine;
  lines.push(r);
  // Only a line that MEASURED counts as done; a failed call stays
  // retryable so a transient outage does not burn the reading.
  if (r.ok) done.add(r.readingId);
 }
}

const readings = Object.values(index.readings).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
console.log(`ticket-087 re-run: ${readings.length} readings, ${done.size} already measured, model=${model}`);

let failures = 0;

for (const reading of readings) {
 if (done.has(reading.id)) continue;

 const at = new Date().toISOString();
 try {
  const result = await proposeOps(
   { reading, snippets: citedSnippets(reading), relatedClaims: relatedClaims(reading) },
   complete
  );
  lines.push({
   readingId: reading.id,
   at,
   model,
   ok: true,
   ops: result.ops.map((op) => ({
    op: op.op,
    ...('body' in op && op.body !== undefined ? { body: op.body } : {}),
    ...('range' in op && op.range !== undefined ? { range: op.range } : {}),
    ...('facet' in op && op.facet !== undefined ? { facet: op.facet } : {}),
    ...('cites' in op && op.cites !== undefined ? { cites: op.cites } : {}),
   })),
  });
 } catch (err) {
  failures++;
  lines.push({
   readingId: reading.id,
   at,
   model,
   ok: false,
   error: err instanceof Error ? err.message : String(err),
   ops: [],
  });
  console.error(`reading ${reading.id}: ${err instanceof Error ? err.message : String(err)}`);
 }

 writeFileSync(OUT, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
 if (lines.length % 10 === 0) console.log(`${lines.length} measured so far, ${failures} failures`);
}

// ── The after-numbers ──

const minted = lines.filter((l) => l.ok).flatMap((l) =>
 l.ops
  .filter((op) => op.op === 'MINT' && op.body !== undefined && op.range !== undefined)
  .map((op) => ({
   readingId: l.readingId,
   body: op.body as string,
   range: op.range as string,
   facet: op.facet,
   cites: op.cites ?? [],
  }))
);

function subjectForm(body: string): string {
 if (body.startsWith('The user')) return 'The user';
 if (body.startsWith('The person')) return 'The person';
 if (body.startsWith('The author')) return 'The author';
 if (body.startsWith('They')) return 'They';
 return 'other';
}

const forms = new Map<string, number>();
for (const m of minted) forms.set(subjectForm(m.body), (forms.get(subjectForm(m.body)) ?? 0) + 1);

// The new lint findings, computed over the minted output with the
// shadowed mechanisms flipped live — the after-number the ticket asks for.
const noopLog: LogFn = () => void 0;
const OCCASIONLESS_LIVE: ThresholdRegister = {
 ...THRESHOLDS,
 'lint.occasionlessRange': { ...THRESHOLDS['lint.occasionlessRange'], live: true },
};
const WEAK_LIVE: ThresholdRegister = {
 ...THRESHOLDS,
 'lint.weakEvidenceDangler': { ...THRESHOLDS['lint.weakEvidenceDangler'], live: true },
};

function mintedGraph(): ClaimGraph {
 const at = new Date().toISOString();
 return {
  claims: minted.map((m) => ({
   id: m.readingId,
   body: m.body,
   range: m.range,
   status: 'unconfirmed' as const,
   cites: m.cites,
   facet: (m.facet ?? 'construct') as Claim['facet'],
   referents: [],
   fromReadings: [m.readingId],
   attested: false,
   readLog: [],
   model,
   modelAt: at,
   created: at,
   updated: at,
  })),
  snippets: index.snippets,
  readings: index.readings,
  contradictions: [],
  referents: [],
 };
}

const occasionlessCount = lint(mintedGraph(), OCCASIONLESS_LIVE, noopLog).filter(
 (f) => f.kind === 'occasionless-range'
).length;
const weakCount = lint(mintedGraph(), WEAK_LIVE, noopLog).filter((f) => f.kind === 'weak-evidence').length;

console.log('---');
console.log(`readings measured: ${minted.length} of ${lines.length} ok lines`);
console.log('subject-form distribution (after):');
for (const [form, n] of [...forms.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${form}: ${n}`);
console.log(`occasionless-range findings (lint live, after): ${occasionlessCount}`);
console.log(`weak-evidence findings (lint live, after): ${weakCount}`);
console.log(`output: ${OUT}`);
