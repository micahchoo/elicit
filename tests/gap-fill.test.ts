import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { runGapFillSweep } from '../src/clerk/gap-fill.js';
import type { GapFillLog } from '../src/clerk/gap-fill.js';
import type { Vault, QueueStore, Snippet } from '../src/types.js';

let root: string;
let vault: Vault;
let queue: QueueStore;
let events: Array<{ at: string; actor: string; kind: string; detail: string; refs?: string[] }>;
let log: GapFillLog;

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'elicit-gap-fill-test-'));
 vault = createVault(root);
 queue = createQueueStore(root);
 events = [];
 log = (e) => {
  events.push(e);
 };
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

function runSweep() {
 return runGapFillSweep({ vault, queue, log });
}

/** A snippet with the minimal provenance the vault's frontmatter needs. */
function saveSnippet(prose: string): Snippet {
 return vault.saveSnippet(prose, {
  kind: 'harvest',
  session: 's1',
  question: 'what changed?',
  questionForm: 'deliberative',
 });
}

/**
 * Write a queue entry file directly, the same shape `QueueStoreImpl.#write`
 * produces (frontmatter id/status/source/license/question/questionForm/
 * sharpness/horizon/created + join keys), with the status the API cannot
 * set — `add` always writes 'pending'. Used to prove the ever-minted dedupe
 * blocks on 'asked'/'expired'/'answered' as well as 'pending'.
 */
function writeQueueEntry(id: string, overrides: Record<string, unknown>): void {
 const fm = {
  id,
  status: 'pending',
  source: 'gap-fill',
  license: 'CC0',
  question: 'pre-existing question',
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'session',
  created: new Date().toISOString(),
  ...overrides,
 };
 const dir = join(root, 'queue');
 mkdirSync(dir, { recursive: true });
 writeFileSync(join(dir, `${id}.md`), matter.stringify('', fm), 'utf-8');
}

// ── Sweep A: Buds ──

describe('runGapFillSweep — the Bud sweep', () => {
 it('mints one gap-fill question per recorded failure with the full entry shape', async () => {
  const bud = vault.saveBud('and then it just clicked', ['mid-sentence'], 's1');

  const result = await runSweep();
  expect(result).toEqual({ minted: 1, budQuestions: 1, constructQuestions: 0 });

  const entries = queue.list({ source: 'gap-fill' });
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  expect(entry.question).toBe(`"${bud.fragment}" — this picks up mid-thought. What were you saying?`);
  expect(entry.question).toContain(bud.fragment);
  expect(entry.bud).toBe(bud.id);
  expect(entry.failure).toBe('mid-sentence');
  expect(entry.source).toBe('gap-fill');
  expect(entry.license).toBe('CC0');
  expect(entry.questionForm).toBe('deliberative');
  expect(entry.sharpness).toBe('weak');
  expect(entry.horizon).toBe('session');
  // No target/topic/direction/modeNeeds: absent is not a guess (Q-60).
  expect(entry.target).toBeUndefined();
  expect(entry.topic).toBeUndefined();
  expect(entry.direction).toBeUndefined();
  expect(entry.modeNeeds).toBeUndefined();

  // The join keys survive a restart: a fresh store on the same root reads
  // them back from disk (disk persistence).
  const fresh = createQueueStore(root);
  const reread = fresh.list({ source: 'gap-fill' });
  expect(reread).toHaveLength(1);
  expect(reread[0]!.bud).toBe(bud.id);
  expect(reread[0]!.failure).toBe('mid-sentence');
 });

 it('mints one question per failure literal, each with its own template', async () => {
  vault.saveBud('a held-back thought', ['mid-sentence', 'label'], 's1');

  const result = await runSweep();
  expect(result).toEqual({ minted: 2, budQuestions: 2, constructQuestions: 0 });

  const entries = queue.list({ source: 'gap-fill' });
  expect(entries).toHaveLength(2);
  expect(entries.map((e) => e.question).sort()).toEqual(
   [
    `"a held-back thought" — this picks up mid-thought. What were you saying?`,
    `"a held-back thought" — what kind of thing is this for you?`,
   ].sort(),
  );
  expect(entries.map((e) => e.failure).sort()).toEqual(['label', 'mid-sentence']);
 });

 it('falls back to the standalone template for an unknown failure literal', async () => {
  vault.saveBud('a mystery fragment', ['whisper-mode'], 's1');

  await runSweep();
  const entries = queue.list({ source: 'gap-fill' });
  expect(entries).toHaveLength(1);
  expect(entries[0]!.question).toBe(`"a mystery fragment" — what were you saying with this?`);
  expect(entries[0]!.failure).toBe('whisper-mode');
 });

 it('never re-mints across runs: exactly one entry, however often the sweep runs', async () => {
  vault.saveBud('one-time fragment', ['mid-sentence'], 's1');

  const r1 = await runSweep();
  expect(r1).toEqual({ minted: 1, budQuestions: 1, constructQuestions: 0 });
  const r2 = await runSweep();
  expect(r2).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });
  const r3 = await runSweep();
  expect(r3).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });

  expect(queue.list({ source: 'gap-fill' })).toHaveLength(1);
 });

 it('never re-offers a failure in ANY existing status — asked, expired, answered', async () => {
  const askedBud = vault.saveBud('asked about', ['mid-sentence'], 's1');
  const expiredBud = vault.saveBud('let go of', ['mid-sentence'], 's1');
  const answeredBud = vault.saveBud('grown past', ['mid-sentence'], 's1');
  writeQueueEntry('asked-1', { status: 'asked', bud: askedBud.id, failure: 'mid-sentence' });
  writeQueueEntry('expired-1', { status: 'expired', bud: expiredBud.id, failure: 'mid-sentence' });
  writeQueueEntry('answered-1', { status: 'answered', bud: answeredBud.id, failure: 'mid-sentence' });

  const result = await runSweep();
  expect(result).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });
  // The three pre-existing entries are still the only ones.
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(3);
  // Dormancy is signal: an expired question is a declined Bud, never
  // re-offered (Q-24/Q-41/Q-72).
  expect(events.filter((e) => e.kind === 'gap-fill-minted')).toHaveLength(0);
 });

 it('mints a new Bud while skipping a held one', async () => {
  const held = vault.saveBud('held fragment', ['mid-sentence'], 's1');
  vault.saveBud('fresh fragment', ['mid-sentence'], 's1');
  writeQueueEntry('held-1', { status: 'expired', bud: held.id, failure: 'mid-sentence' });

  const result = await runSweep();
  expect(result).toEqual({ minted: 1, budQuestions: 1, constructQuestions: 0 });

  const entries = queue.list({ source: 'gap-fill' });
  expect(entries).toHaveLength(2);
  const mintedEntry = entries.find((e) => e.id !== 'held-1')!;
  expect(mintedEntry.bud).not.toBe(held.id);
  expect(mintedEntry.question).toContain('fresh fragment');
 });
});

// ── Sweep B: half-Constructs ──

describe('runGapFillSweep — the half-Construct sweep', () => {
 it('mints one contrast question per half-Construct reading', async () => {
  const snippet = saveSnippet('I value directness in every exchange.');
  vault.saveReading({
   facet: 'construct',
   stance: 'avowal',
   reading: 'The person values directness.',
   cites: [`${snippet.id}@1`],
  });

  const result = await runSweep();
  expect(result).toEqual({ minted: 1, budQuestions: 0, constructQuestions: 1 });

  const entries = queue.list({ source: 'gap-fill' });
  expect(entries).toHaveLength(1);
  const entry = entries[0]!;
  expect(entry.snippet).toBe(snippet.id);
  expect(entry.cites).toEqual([`${snippet.id}@1`]);
  expect(entry.question).toBe(`"${snippet.prose}" — what is the opposite of this for you?`);
  expect(entry.question).toContain(snippet.prose);
  expect(entry.source).toBe('gap-fill');
  expect(entry.license).toBe('CC0');
  expect(entry.questionForm).toBe('deliberative');
  expect(entry.sharpness).toBe('weak');
  expect(entry.horizon).toBe('session');
 });

 it('a fact-facet reading mints nothing', async () => {
  const snippet = saveSnippet('It happened on a Tuesday.');
  vault.saveReading({
   facet: 'fact',
   stance: 'report-of-fact',
   reading: 'It happened on a Tuesday.',
   cites: [`${snippet.id}@1`],
  });

  const result = await runSweep();
  expect(result).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(0);
 });

 it('two construct-facet readings of the SAME snippet mint exactly one entry', async () => {
  // Must pass the QR-1 pole gate (ticket 114) or the snippet is skipped
  // before the dedupe is ever exercised.
  const snippet = saveSnippet('I believe one pole is enough.');
  vault.saveReading({
   facet: 'construct',
   stance: 'avowal',
   reading: 'First reading of the pole.',
   cites: [`${snippet.id}@1`],
  });
  vault.saveReading({
   facet: 'construct',
   stance: 'self-observation',
   reading: 'Second reading of the same pole.',
   cites: [`${snippet.id}@1`],
  });

  const result = await runSweep();
  expect(result).toEqual({ minted: 1, budQuestions: 0, constructQuestions: 1 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(1);
 });

 it('a reading whose cite names a snippet the vault no longer holds is skipped', async () => {
  vault.saveReading({
   facet: 'construct',
   stance: 'avowal',
   reading: 'A pole that cites a missing snippet.',
   cites: ['does-not-exist@1'],
  });

  const result = await runSweep();
  expect(result).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(0);
 });

 it('skips a construct-facet snippet whose prose has no pole (QR-1 gate)', async () => {
  const snippet = saveSnippet("It's raining outside.");
  vault.saveReading({
   facet: 'construct',
   stance: 'avowal',
   reading: 'The person reports the weather.',
   cites: [`${snippet.id}@1`],
  });

  const result = await runSweep();
  expect(result).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(0);
  const kinds = events.map((e) => e.kind);
  expect(kinds).toContain('gap-fill-pole-skip');
  expect(events.find((e) => e.kind === 'gap-fill-pole-skip')?.refs).toEqual([
   `${snippet.id}@1`,
  ]);
 });

 it('mints past the pole gate when the prose carries a stance', async () => {
  const snippet = saveSnippet('I believe one pole is enough.');
  vault.saveReading({
   facet: 'construct',
   stance: 'avowal',
   reading: 'The person believes one pole is enough.',
   cites: [`${snippet.id}@1`],
  });

  const result = await runSweep();
  expect(result).toEqual({ minted: 1, budQuestions: 0, constructQuestions: 1 });
  expect(events.map((e) => e.kind)).not.toContain('gap-fill-pole-skip');
 });
});

// ── Cap, logging, and the whole-run picture ──

describe('runGapFillSweep — cap, logging, empty vault', () => {
 it('enforces the run cap, counts the clipped candidate, and catches up next run', async () => {
  for (let i = 0; i < 4; i++) {
   vault.saveBud(`bud number ${i}`, ['mid-sentence'], 's1');
  }

  const r1 = await runSweep();
  expect(r1).toEqual({ minted: 3, budQuestions: 3, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(3);
  const clippedEvent = events.find((e) => e.kind === 'gap-fill-clipped');
  expect(clippedEvent).toBeDefined();
  expect(clippedEvent!.detail).toBe('cap=3 clipped=1');
  const mintedEvent1 = events.find((e) => e.kind === 'gap-fill-minted');
  expect(mintedEvent1).toBeDefined();
  expect(mintedEvent1!.detail).toBe('minted=3 budQuestions=3 constructQuestions=0');
  expect(mintedEvent1!.actor).toBe('clerk');

  // The clipped Bud was never minted, so the next run offers it.
  events = [];
  const r2 = await runSweep();
  expect(r2).toEqual({ minted: 1, budQuestions: 1, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(4);

  events = [];
  const r3 = await runSweep();
  expect(r3).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(4);
  expect(events).toHaveLength(0);
 });

 it('counts every held-back candidate: the clip is the backlog, not a flag', async () => {
  for (let i = 0; i < 5; i++) {
   vault.saveBud(`bud number ${i}`, ['mid-sentence'], 's1');
  }

  const r1 = await runSweep();
  expect(r1).toEqual({ minted: 3, budQuestions: 3, constructQuestions: 0 });
  const clippedEvent = events.find((e) => e.kind === 'gap-fill-clipped');
  expect(clippedEvent).toBeDefined();
  // Both candidates past the cap are counted, so the log names the true
  // backlog the cap held back (threshold-clipped's shape, ticket 027).
  expect(clippedEvent!.detail).toBe('cap=3 clipped=2');

  events = [];
  const r2 = await runSweep();
  expect(r2).toEqual({ minted: 2, budQuestions: 2, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(5);
 });

 it('logs gap-fill-minted with the right per-sweep counts', async () => {
  vault.saveBud('a bud', ['mid-sentence'], 's1');
  const snippet = saveSnippet('I believe a pole must have a contrast.');
  vault.saveReading({
   facet: 'construct',
   stance: 'avowal',
   reading: 'The pole.',
   cites: [`${snippet.id}@1`],
  });

  await runSweep();
  const mintedEvent = events.find((e) => e.kind === 'gap-fill-minted');
  expect(mintedEvent).toBeDefined();
  expect(mintedEvent!.detail).toBe('minted=2 budQuestions=1 constructQuestions=1');
  expect(mintedEvent!.actor).toBe('clerk');
  expect(events.filter((e) => e.kind === 'gap-fill-clipped')).toHaveLength(0);
 });

 it('mints nothing and stays silent on an empty vault', async () => {
  const result = await runSweep();
  expect(result).toEqual({ minted: 0, budQuestions: 0, constructQuestions: 0 });
  expect(queue.list({ source: 'gap-fill' })).toHaveLength(0);
  // No minted event, no clipped event: the sweep had nothing to say.
  expect(events).toHaveLength(0);
 });

 it('is zero-LLM by construction: the module never references the model call', () => {
  const source = readFileSync(new URL('../src/clerk/gap-fill.ts', import.meta.url), 'utf-8');
  expect(source).not.toMatch(/\bcomplete\b/);
 });
});
