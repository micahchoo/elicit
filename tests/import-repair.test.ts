import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { runImportRepair } from '../src/import/repair.js';
import { createQueueStore } from '../src/queue/queue.js';
import { createVault } from '../src/vault/vault.js';
import type { Provenance, QueueStore, Snippet, Vault } from '../src/types.js';

/** A tmp vault root per test — the ledger, the Buds and the queue all live
 * under it, and all three must be fresh per test. */
let root: string;
let vault: Vault;
let queue: QueueStore;
let events: { kind: string; detail: string }[];
let nextId: number;

const log = (e: {
 at: string;
 actor: 'clerk';
 kind: string;
 detail: string;
 refs?: string[];
}): void => {
 events.push({ kind: e.kind, detail: e.detail });
};

const buildDeps = (): {
 vault: Vault;
 queue: QueueStore;
 vaultRoot: string;
 log: typeof log;
 snippets: Snippet[];
} => ({ vault, queue, vaultRoot: root, log, snippets: [] });

const logged = (kind: string) => events.filter((e) => e.kind === kind);

/** A dangling snippet: opens with an anaphor, no 073 context window. */
const danglingSnippet = (prose: string, captured = '2026-08-01T10:00:00.000Z'): Snippet => {
 const provenance: Provenance = {
  kind: 'unprompted',
  session: 'import-abc123def456',
  question: '',
  questionForm: 'deliberative',
 };
 return { id: `d${++nextId}`, version: 1, captured, provenance, prose };
};

/** A dangler the 073 context window resolves. */
const windowedSnippet = (prose: string): Snippet => {
 const s = danglingSnippet(prose);
 return { ...s, provenance: { ...s.provenance, context: 'We rebuilt the importer that week.' } };
};

/** Fill the cap: n live 'import-repair' entries that are never answered. */
const seedLive = (n: number): void => {
 for (let i = 0; i < n; i++) {
  queue.add({
   source: 'import-repair',
   license: 'CC0',
   question: 'filler',
   questionForm: 'deliberative',
   horizon: 'now',
  });
 }
};

/** Every Bud on disk, as its frontmatter plus the held fragment. */
const budsOnDisk = (dir: string) => {
 let files: string[];
 try {
  files = readdirSync(join(dir, 'buds'));
 } catch {
  return [];
 }
 return files
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((f) => {
   const parsed = matter.read(join(dir, 'buds', f));
   const data = parsed.data as { id: string; failures: string[] };
   return { id: data.id, failures: data.failures, fragment: parsed.content };
  });
};

/** Every ledger line, parsed. */
const ledgerLines = (dir: string) =>
 readFileSync(join(dir, 'imports', 'repair-ledger.jsonl'), 'utf-8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map(
   (l) =>
    JSON.parse(l) as { at: string; snippetId: string; budId: string; questioned: boolean },
  );

describe('runImportRepair (seeding Task 10: one Bud per dangler, one capped question, no surface)', () => {
 beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'repair-'));
  vault = createVault(root);
  queue = createQueueStore(root);
  events = [];
  nextId = 0;
 });

 afterEach(() => {
  rmSync(root, { recursive: true, force: true });
 });

 it('buds a snippet that opens with an anaphor and has no context window', () => {
  const s = danglingSnippet('This is what made the whole thing work.');
  const r = runImportRepair({ ...buildDeps(), snippets: [s] });
  expect(r.budded).toBe(1);
  expect(budsOnDisk(root)[0]!.failures).toEqual(['dangling-referent']);
 });

 it('leaves a dangler alone when the 073 context window is there to resolve it', () => {
  const s = windowedSnippet('That approach was ours.');
  expect(runImportRepair({ ...buildDeps(), snippets: [s] }).budded).toBe(0);
  expect(budsOnDisk(root)).toHaveLength(0);
 });

 it('mints one queue question that quotes the snippet and claims no Target', () => {
  const s = danglingSnippet('This is what made the whole thing work.');
  runImportRepair({ ...buildDeps(), snippets: [s] });
  const e = queue.list({ source: 'import-repair' })[0]!;
  expect(e.quotedFragment).toBe(s.prose);
  expect('target' in e).toBe(false);
  expect(e.cites).toEqual(['d1@1']);
 });

 it('cannot make a model call — the module imports no LLM path', () => {
  const src = readFileSync('src/import/repair.ts', 'utf-8');
  expect(src).not.toMatch(/from ['"][^'"]*llm|from ['"][^'"]*harvester|: Complete\b/);
 });

 it('BUDS every dangler over the cap, and defers only the questions', () => {
  seedLive(2);
  const d1 = danglingSnippet('This one.');
  const d2 = danglingSnippet('That one.');
  const d3 = danglingSnippet('It happened then.');
  const r = runImportRepair({ ...buildDeps(), snippets: [d1, d2, d3] });
  expect(r.budded).toBe(3); // ← not 0. Q-72 wants the Buds.
  expect(r.questioned).toBe(0);
  expect(r.deferred).toBe(3);
  expect(budsOnDisk(root)).toHaveLength(3);
  expect(logged('repair-question-capped')).toHaveLength(1);
 });

 it('mints the deferred questions on a later run when the cap frees up', () => {
  seedLive(2);
  runImportRepair({
   ...buildDeps(),
   snippets: [
    danglingSnippet('This one.'),
    danglingSnippet('That one.'),
    danglingSnippet('It happened then.'),
   ],
  });
  // FREE the cap: close the two live entries.
  for (const e of queue.list({ source: 'import-repair' })) queue.markAnswered(e.id);
  const later = runImportRepair({ ...buildDeps(), snippets: [] }); // NO new snippets
  expect(later.questioned).toBe(2);
  expect(later.budded).toBe(0); // already budded, never twice
 });

 it('mints nothing twice for the same snippet, across a restart', () => {
  const s = danglingSnippet('This one.');
  runImportRepair({ ...buildDeps(), snippets: [s] });
  const again = runImportRepair({
   ...buildDeps(),
   queue: createQueueStore(root),
   vault: createVault(root),
   snippets: [s],
  });
  expect(again.budded).toBe(0);
  expect(again.questioned).toBe(0);
 });
});
