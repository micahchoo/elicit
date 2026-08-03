import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createQueueStore, MAX_OPEN_QUESTIONS } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import type { QueueEntry, QueueStore } from '../src/types.js';

/**
 * QR-6: the flood bound on GET /api/queue.
 *
 * The open array is sorted (user-declared first, then newest first),
 * capped at MAX_OPEN_QUESTIONS, and the truncated tail is expired on disk —
 * the queue the person sees and the queue on disk never disagree.
 */

let root: string;
let queue: QueueStore;
let app: Hono;

/** A pending open entry with a controlled creation time. */
function openEntry(created: string, overrides: Partial<QueueEntry> = {}): QueueEntry {
 return {
  id: `q-${created}`,
  status: 'pending',
  source: 'composed',
  license: 'CC0',
  question: `Open question from ${created}`,
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'days',
  created,
  ...overrides,
 };
}

/** Write an entry straight to disk with the created date it was built with. */
function seedEntry(entry: QueueEntry): void {
 const { id, status, source, question, questionForm, sharpness, horizon, ...rest } = entry;
 const fm: Record<string, unknown> = {
  id, status, source, question, questionForm, sharpness, horizon, ...rest, created: entry.created,
 };
 mkdirSync(join(root, 'queue'), { recursive: true });
 writeFileSync(join(root, 'queue', `${entry.id}.md`), matter.stringify('', fm), 'utf-8');
}

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'elicit-queue-bound-'));
 queue = createQueueStore(root);
 // The one-time template sweep must not eat seeded entries during the boot
 // docket: declare it done before the app exists.
 writeFileSync(join(root, '.template-sweep-done'), new Date().toISOString(), 'utf-8');
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

async function boot(): Promise<void> {
 const vault = createVault(root);
 const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
 const authStore = createFileAuth(join(root, '.auth.json'));
 app = await createApp({
  vault,
  complete: makeFakeComplete(),
  queue,
  index,
  vaultRoot: root,
  authStore,
 });
}

async function get(path: string): Promise<Response> {
 return await app.fetch(new Request(`http://127.0.0.1${path}`, { method: 'GET' }), {
  remoteAddr: '127.0.0.1',
 });
}

it('caps open at MAX_OPEN_QUESTIONS, sorts user-declared first, and expires the truncated tail', async () => {
 // 3 user-declared open entries, oldest of all.
 for (let i = 0; i < 3; i++) {
  seedEntry(openEntry(`2026-06-0${i + 1}T00:00:00.000Z`, { source: 'user-declared' }));
 }
 // 25 agent-minted open entries, spread over July.
 for (let i = 0; i < 25; i++) {
  const day = String(i + 1).padStart(2, '0');
  seedEntry(openEntry(`2026-07-${day}T00:00:00.000Z`));
 }
 await boot();

 const res = await get('/api/queue');
 expect(res.status).toBe(200);
 const body = (await res.json()) as {
  pending: Array<{ source: string; question: string }>;
  open: Array<{ source: string; question: string; horizon: string }>;
 };

 // The bound holds.
 expect(body.open.length).toBe(MAX_OPEN_QUESTIONS);

 // User-declared first, in recency order among themselves.
 expect(body.open.slice(0, 3).map((e) => e.source)).toEqual([
  'user-declared',
  'user-declared',
  'user-declared',
 ]);

 // Then the NEWEST agent entries — 3 kept slots went to the user-declared
 // entries, so the 17 newest of the 25 survive.
 const keptAgentQuestions = body.open.slice(3).map((e) => e.question);
 expect(keptAgentQuestions).toHaveLength(MAX_OPEN_QUESTIONS - 3);
 expect(keptAgentQuestions[0]).toBe('Open question from 2026-07-25T00:00:00.000Z');

 // The truncated tail is expired ON DISK, not just hidden. The store's
 // bound (Part B) keeps the top MAX_OPEN_QUESTIONS of the NON-user-declared
 // open entries — user-declared entries are never candidates — so 25 - 20 =
 // 5 of the oldest agent entries expire.
 const fresh = createQueueStore(root);
 const expired = fresh.list({ status: 'expired' }).filter((e) => e.source === 'composed');
 expect(expired).toHaveLength(5);
 // The five OLDEST agent entries: July 1 through July 5.
 expect(expired.map((e) => e.question).sort()).toEqual(
  Array.from({ length: 5 }, (_, i) => `Open question from 2026-07-0${i + 1}T00:00:00.000Z`).sort(),
 );
 // The newest agent entry survives, as do the 20 the store kept.
 const pendingAgents = fresh.list({ status: 'pending' }).filter((e) => e.source === 'composed');
 expect(pendingAgents).toHaveLength(20);
 expect(pendingAgents.map((e) => e.question)).toContain('Open question from 2026-07-25T00:00:00.000Z');
 // The entries the store kept but the display window cut (July 6-8) stay
 // pending on disk — they roll into view as newer ones are answered.
 expect(pendingAgents.map((e) => e.question)).toContain('Open question from 2026-07-06T00:00:00.000Z');

 // User-declared entries are untouched on disk.
 const udOnDisk = fresh.list().filter((e) => e.source === 'user-declared');
 expect(udOnDisk).toHaveLength(3);
 expect(udOnDisk.every((e) => e.status === 'pending')).toBe(true);
});

it('a queue already under the cap is returned untouched — nothing is expired', async () => {
 for (let i = 0; i < 5; i++) {
  seedEntry(openEntry(`2026-07-0${i + 1}T00:00:00.000Z`));
 }
 await boot();

 const res = await get('/api/queue');
 const body = (await res.json()) as { open: Array<{ source: string }> };
 expect(body.open.length).toBe(5);

 const fresh = createQueueStore(root);
 expect(fresh.list({ status: 'expired' })).toHaveLength(0);
});
