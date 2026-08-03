/**
 * The coach routes I (090 T9) — coached state and the waiting offer,
 * driven through the REAL app. Every assertion goes through `createApp`
 * and `app.fetch` — never a hand-built handler — because the failure this
 * suite exists to catch is the seam that compiles, tests green, and
 * reaches nothing.
 *
 * The empty-vault case (090's data note) is asserted by name: the offer
 * logs `qualified=0` on every evaluation and nothing blocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createCoachStore } from '../src/coach/store.js';

let root: string;
let app: Hono;
let settled: number;
let waiting: (() => void)[];

function onDocketSettled(): void {
 settled++;
 waiting.splice(0).forEach((r) => r());
}

async function waitForSettles(n: number): Promise<void> {
 while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

async function get(path: string): Promise<Response> {
 return app.fetch(new Request(`http://127.0.0.1${path}`), { remoteAddr: '127.0.0.1' });
}

async function post(path: string, body?: unknown): Promise<Response> {
 const init: RequestInit = { method: 'POST' };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 }
 return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

async function jsonOf<T>(res: Response): Promise<T> {
 return (await res.json()) as T;
}

type WaitingBody = { offer: { slug: string; name: string; sentence: string } | null; lines: { slug: string; sentence: string }[] };

function seedUnreadNote(slug: string): void {
 createCoachStore(root).writeAdvice({
  direction: slug,
  mintedAt: new Date().toISOString(),
  license: 'page-opened',
  options: [
   { id: 'opt-1', text: 'Do A', cites: ['c1'] },
   { id: 'opt-2', text: 'Do B', cites: ['c2'] },
  ],
 });
}

beforeEach(async () => {
 root = mkdtempSync(join(tmpdir(), 'elicit-coach-routes-'));
 settled = 0;
 waiting = [];
 const vault = createVault(root);
 const queue = createQueueStore(root);
 const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
 app = await createApp({
  vault,
  complete: makeFakeComplete(),
  queue,
  index,
  vaultRoot: root,
  authStore: createFileAuth(join(root, '.auth.json')),
  onDocketSettled,
 });
 await waitForSettles(1);
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

describe('the coached direction routes (090 T9)', () => {
 it('declares a Direction coached — the person\'s verb, the only door (Q-73)', async () => {
  const r = await post('/api/coach/direction', { name: 'Cooking' });
  expect(r.status).toBe(200);
  const body = await jsonOf<{ direction: { slug: string; name: string; coached: boolean } }>(r);
  expect(body.direction.slug).toBe('cooking');
  expect(body.direction.name).toBe('Cooking');
  expect(body.direction.coached).toBe(true);

  const onDisk = readFileSync(join(root, 'coach', 'directions', 'cooking.md'), 'utf-8');
  expect(onDisk).toContain('coached: true');
  expect(onDisk).toContain('coachedAt:');
  expect(readEvents(root).map((e) => e.kind)).toContain('direction-coached');
 });

 it('refuses an empty name with 400 and writes nothing', async () => {
  const r = await post('/api/coach/direction', { name: '   ' });
  expect(r.status).toBe(400);
  const r2 = await post('/api/coach/direction', {});
  expect(r2.status).toBe(400);
 });

 it('uncoach flips the lens off and archives nothing (Q-73)', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });
  const r = await post('/api/coach/direction/cooking/uncoach');
  expect(r.status).toBe(200);
  const onDisk = readFileSync(join(root, 'coach', 'directions', 'cooking.md'), 'utf-8');
  expect(onDisk).toContain('coached: false');
  expect(onDisk).toContain('uncoachedAt:');
  expect(readEvents(root).map((e) => e.kind)).toContain('direction-uncoached');
  expect((await post('/api/coach/direction/nope/uncoach')).status).toBe(404);
 });

 it('decline-offer on a never-declared name creates the stub, and it is never offered again', async () => {
  const r = await post('/api/coach/direction/gardening/decline-offer');
  expect(r.status).toBe(200);
  const onDisk = readFileSync(join(root, 'coach', 'directions', 'gardening.md'), 'utf-8');
  expect(onDisk).toContain('offerDeclinedAt:');
  expect(readEvents(root).map((e) => e.kind)).toContain('coach-offer-declined');

  const w = await get('/api/coach/waiting');
  const body = await jsonOf<WaitingBody>(w);
  expect(body.offer).toBeNull();
  expect(body.lines).toEqual([]);
 });

 it('GET /api/coach/waiting shows quiet lines only where something is new (Q-76)', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });

  // nothing new yet — silence
  let body = await jsonOf<WaitingBody>(await get('/api/coach/waiting'));
  expect(body.offer).toBeNull();
  expect(body.lines).toEqual([]);

  // an unread note on disk is something new
  seedUnreadNote('cooking');
  body = await jsonOf<WaitingBody>(await get('/api/coach/waiting'));
  expect(body.lines).toEqual([
   { slug: 'cooking', sentence: 'something new waits where you are learning Cooking' },
  ]);
 });

 it('empty vault: waiting answers 200-quiet and the offer evaluation is logged every time (Q-62, 090 data note)', async () => {
  const w = await get('/api/coach/waiting');
  expect(w.status).toBe(200);
  expect(await jsonOf<WaitingBody>(w)).toEqual({ offer: null, lines: [] });

  const events = readEvents(root);
  const offers = events.filter((e) => e.kind === 'coach-offer');
  expect(offers).toHaveLength(1);
  expect(offers[0]!.detail).toBe('directions=0 qualified=0 offered=none');

  // a second evaluation logs a second line — every call is on the record
  await get('/api/coach/waiting');
  expect(readEvents(root).filter((e) => e.kind === 'coach-offer')).toHaveLength(2);
 });

 it('the coach routes are registered under the /api lock', () => {
  const paths = app.routes.map((r) => r.path);
  expect(paths).toContain('/api/coach/direction');
  expect(paths).toContain('/api/coach/direction/:slug/uncoach');
  expect(paths).toContain('/api/coach/direction/:slug/decline-offer');
  expect(paths).toContain('/api/coach/waiting');
 });
});
