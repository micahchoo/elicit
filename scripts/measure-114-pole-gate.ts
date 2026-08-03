/**
 * Ticket 114 QR-1: Measure the pole gate on the live queue.
 *
 * Finds all opposite-mint entries (source: gap-fill, snippet field set),
 * resolves each snippet's prose from the vault via rebuildIndex,
 * runs hasConstructPole, and reports the survival rate.
 *
 * Run: npx tsx scripts/measure-114-pole-gate.ts
 */

import { createVault } from '../src/vault/vault.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { hasConstructPole } from '../src/clerk/clause.js';

const VAULT_ROOT = process.env.VAULT_PATH ?? join(process.cwd(), 'vault');
const QUEUE_DIR = join(VAULT_ROOT, 'queue');

const vault = createVault(VAULT_ROOT);
const index = vault.rebuildIndex();

interface EntryMeta {
  id: string;
  status: string;
  source: string;
  snippet?: string;
  question: string;
}

function readQueueEntries(): EntryMeta[] {
  const entries: EntryMeta[] = [];
  for (const f of readdirSync(QUEUE_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = readFileSync(join(QUEUE_DIR, f), 'utf-8');
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const snippetVal = data.snippet;
    entries.push({
      id: data.id as string,
      status: data.status as string,
      source: data.source as string,
      ...(typeof snippetVal === 'string' ? { snippet: snippetVal } : {}),
      question: data.question as string,
    });
  }
  return entries;
}

// ── Main ──

const all = readQueueEntries();

const opposite = all.filter(
  (e) => e.source === 'gap-fill' && e.snippet !== undefined,
);

console.log(`Total queue entries: ${all.length}`);
console.log(`Opposite-mint entries (gap-fill + snippet): ${opposite.length}`);
console.log('');

interface Result {
  id: string;
  snippetId: string;
  prose: string;
  passes: boolean;
  proseExcerpt: string;
}

const results: Result[] = [];

for (const entry of opposite) {
  const snippet = index.snippets[entry.snippet!];
  if (!snippet) {
    console.log(`  [MISSING] ${entry.id} -> snippet ${entry.snippet} not in index`);
    continue;
  }
  const passes = hasConstructPole(snippet.prose);
  results.push({
    id: entry.id,
    snippetId: entry.snippet!,
    prose: snippet.prose,
    passes,
    proseExcerpt: snippet.prose.length > 120 ? snippet.prose.slice(0, 120) + '...' : snippet.prose,
  });
}

const survived = results.filter((r) => r.passes);
const failed = results.filter((r) => !r.passes);
const rate = results.length > 0
  ? ((survived.length / results.length) * 100).toFixed(1)
  : '0.0';

console.log(`Resolved (found in index): ${results.length}`);
console.log(`Survived (pass gate): ${survived.length}`);
console.log(`Failed (no pole): ${failed.length}`);
console.log(`Survival rate: ${rate}%`);
console.log('');

if (failed.length > 0) {
  console.log('-- Failed entries --');
  for (const r of failed) {
    console.log(`  ${r.id}`);
    console.log(`  snippet: ${r.snippetId}`);
    console.log(`  prose: ${r.proseExcerpt}`);
    console.log('');
  }
}

if (survived.length > 0) {
  console.log(`-- Surviving entries (sample of first 5) --`);
  for (const r of survived.slice(0, 5)) {
    console.log(`  ${r.id} -> ${r.proseExcerpt}`);
  }
  if (survived.length > 5) {
    console.log(`  ... and ${survived.length - 5} more`);
  }
}
