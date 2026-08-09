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
import { createCoachStore, type CoachStore } from '../src/coach/store.js';
import { createClaimStore } from '../src/wiki/store.js';
import type { Claim } from '../src/wiki/contract.js';
import type { AdviceNote } from '../src/coach/contract.js';
import type { Complete, QueueStore } from '../src/types.js';

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

 it('GET /api/coach/directions lists only the coached doors, sorted by name (wave 5)', async () => {
  // no doors yet — a quiet list, never an error
  expect(await jsonOf<{ directions: { slug: string; name: string }[] }>(await get('/api/coach/directions')))
   .toEqual({ directions: [] });

  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/direction', { name: 'Biking' });
  await post('/api/coach/direction', { name: 'Gardening' });

  // the door closes when the lens goes off (Q-73) — the record stays on disk
  await post('/api/coach/direction/cooking/uncoach');

  const r = await get('/api/coach/directions');
  expect(r.status).toBe(200);
  const body = await jsonOf<{ directions: { slug: string; name: string }[] }>(r);
  expect(body.directions).toEqual([
   { slug: 'biking', name: 'Biking' },
   { slug: 'gardening', name: 'Gardening' },
  ]);
 });

 it('the coach routes are registered under the /api lock', () => {
  const paths = app.routes.map((r) => r.path);
  expect(paths).toContain('/api/coach/direction');
  expect(paths).toContain('/api/coach/direction/:slug/uncoach');
  expect(paths).toContain('/api/coach/direction/:slug/decline-offer');
  expect(paths).toContain('/api/coach/waiting');
  expect(paths).toContain('/api/coach/directions');
 });
});

// ===========================================================================
// The quest, artifact and return routes (090 T10) — the capture wiring.
// ===========================================================================
// These tests need a scripted model: the advice mint and the background
// harvest both call it, in an order the routes decide asynchronously, so the
// fake routes by PROMPT CONTENT instead of script order. The vault is seeded
// with claims BEFORE createApp so the advice mint has something to cite.

describe('the quest, artifact and return routes (090 T10)', () => {
 const NOW = '2026-08-03T09:00:00.000Z';
 const ADVICE_MARKER = 'composing an advice note';
 const ADVICE_JSON = JSON.stringify({
  options: [
   { text: 'Cook one new recipe', cites: ['c1'] },
   { text: 'Write down your knife setup', cites: ['c2'] },
   { text: 'Plan a week of meals', cites: ['c3'] },
  ],
 });
 const CUT_JSON = JSON.stringify({
  cuts: [
   {
    text: 'I burnt the rice.',
    sourceTurn: 0,
    facet: 'construct',
    stance: 'self-observation',
    reading: 'the person reports this',
    standalone: true,
   },
  ],
 });

 function routedComplete(): { complete: Complete; calls: { system: string; text: string }[] } {
  const calls: { system: string; text: string }[] = [];
  const complete: Complete = async (system, turns) => {
   calls.push({ system, text: turns[0]?.text ?? '' });
   return system.includes(ADVICE_MARKER) ? ADVICE_JSON : CUT_JSON;
  };
  return { complete, calls };
 }

 function claim(id: string, body: string, cites: string[]): Claim {
  return {
   id,
   body,
   range: 'in the kitchen, since 2024',
   status: 'unconfirmed',
   cites,
   facet: 'fact',
   referents: [],
   fromReadings: [],
   attested: false,
   readLog: [],
   model: 'test-model',
   modelAt: NOW,
   created: NOW,
   updated: NOW,
  };
 }

 let queue: QueueStore;
 let routed: { complete: Complete; calls: { system: string; text: string }[] };

 beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'elicit-coach-routes-'));
  settled = 0;
  waiting = [];
  const vault = createVault(root);
  // One snippet and three claims sharing the 'cooking' name-term — the
  // offer floor's worth, so the advice mint has a citable pool.
  const snip = vault.saveSnippet('a paragraph about cooking', {
   kind: 'unprompted',
   session: 's-1',
   question: '',
   questionForm: 'theoretical',
  });
  const claimStore = createClaimStore(root);
  claimStore.writeClaim(claim('c1', 'cooking changed how I plan meals', [`${snip.id}@1`]));
  claimStore.writeClaim(claim('c2', 'cooking is a daily craft', [`${snip.id}@1`]));
  claimStore.writeClaim(claim('c3', 'cooking taught me patience', [`${snip.id}@1`]));
  queue = createQueueStore(root);
  const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
  routed = routedComplete();
  app = await createApp({
   vault,
   complete: routed.complete,
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

 /**
  * Poll disk until the advice note exists (and, optionally, is newer than a
  * stamp). The mint runs on the server's setImmediate and exposes no signal
  * to await — the same why the harvest-queue suite polls /api/harvest-queue.
  */
 async function waitForNote(slug: string, newerThan?: string): Promise<AdviceNote> {
  const deadline = Date.now() + 3000;
  for (;;) {
   const note = createCoachStore(root).readAdvice(slug);
   if (note && (newerThan === undefined || note.mintedAt > newerThan)) return note;
   if (Date.now() > deadline) {
    throw new Error(
     `advice note never minted for ${slug}; root=${root}; ` +
     `events=${JSON.stringify(readEvents(root).map((e) => e.kind))}; ` +
     `note=${JSON.stringify(createCoachStore(root).readAdvice(slug))}`,
    );
   }
   await new Promise<void>((r) => setTimeout(r, 25));
  }
 }

 /**
  * Poll /api/harvest-queue until the pending record lands. The propose
  * runs on the server's setImmediate and exposes no signal to await — the
  * same why the harvest-queue suite polls.
  */
 async function waitForHarvest(sessionId: string): Promise<void> {
  const deadline = Date.now() + 5000;
  for (;;) {
   const res = await get(`/api/harvest-queue/${sessionId}`);
   if (res.status === 200) return;
   if (Date.now() > deadline) throw new Error(`pending harvest for ${sessionId} never landed`);
   await new Promise<void>((r) => setTimeout(r, 25));
  }
 }

 it('adopt mints a quest; return leaves a tagged transcript, two reflections, a pending harvest, and a replaced note', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });

  // The first read licenses a mint (page-opened) — the note appears in the
  // background, and the page then shows it with the empty-state opening.
  await post('/api/coach/cooking/read');
  const note1 = await waitForNote('cooking');
  expect(note1.options).toHaveLength(3);

  const page = await get('/api/coach/cooking');
  expect(page.status).toBe(200);
  const pageBody = await jsonOf<{ name: string; opening: string; advice: { unread: boolean } | null }>(page);
  expect(pageBody.name).toBe('Cooking');
  expect(pageBody.opening).toBe('nothing here yet — this page fills as you act');
  expect(pageBody.advice!.unread).toBe(true);

  // Adopt an option — the quest record is minted (Q-74).
  const adopt = await post('/api/coach/cooking/adopt', { optionId: note1.options[0]!.id });
  expect(adopt.status).toBe(200);
  const adopted = await jsonOf<{ quest: { id: string; direction: string; act: string; cites: string[] } }>(adopt);
  expect(adopted.quest.direction).toBe('cooking');
  expect(adopted.quest.act).toBe(note1.options[0]!.text);
  expect(adopted.quest.cites).toEqual(['c1']);

  // Return — ordinary capture with the quest tag (T4 wired: assert the FILE).
  const ret = await post(`/api/coach/quest/${adopted.quest.id}/return`, {
   text: 'I burnt the rice. Then I tried again.',
  });
  expect(ret.status).toBe(200);
  const retBody = await jsonOf<{ sessionId: string; reflections: number }>(ret);
  expect(retBody.reflections).toBe(2);

  const transcript = readFileSync(join(root, 'transcripts', `${retBody.sessionId}.md`), 'utf-8');
  expect(transcript).toContain(`quest: ${adopted.quest.id}`);
  expect(transcript).toContain('direction: cooking');

  // Two quest-reflection entries, quoted, deduped on the (quest, session) pair.
  const reflections = queue.list({ source: 'quest-reflection' });
  expect(reflections).toHaveLength(2);
  for (const e of reflections) {
   expect(e.quest).toBe(adopted.quest.id);
   expect(e.direction).toBe('cooking');
   expect('I burnt the rice. Then I tried again.').toContain(e.quotedFragment!);
   expect(e.license).toBe(`Q-75 quest return quest=${adopted.quest.id} session=${retBody.sessionId}`);
  }

  // A pending harvest for the return (the ordinary review queue).
  await waitForHarvest(retBody.sessionId);
  const hq = await get(`/api/harvest-queue/${retBody.sessionId}`);
  expect(hq.status).toBe(200);
  const hqBody = await jsonOf<{ proposals: unknown[] }>(hq);
  expect(hqBody.proposals).toHaveLength(1);

  // The return licensed a fresh mint — the note was replaced (Q-77).
  const note2 = await waitForNote('cooking', note1.mintedAt);
  expect(note2.mintedAt > note1.mintedAt).toBe(true);

  const kinds = readEvents(root).map((e) => e.kind);
  expect(kinds).toContain('coach-page-read');
  expect(kinds).toContain('quest-adopted');
  expect(kinds).toContain('quest-returned');
  expect(kinds).toContain('reflection-minted');
  expect(kinds).toContain('advice-minted');
 });

 it('an artifact declaration captures the sentence; the pointer reaches neither the model nor the log (Q-78)', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/cooking/read');
  const note1 = await waitForNote('cooking');
  const pointer = '/home/me/notes/secret.pdf';

  const art = await post('/api/coach/cooking/artifact', {
   pointer,
   name: 'the kitchen log',
   sentence: 'this log holds my knife decisions',
  });
  expect(art.status).toBe(200);
  const artBody = await jsonOf<{ sessionId: string }>(art);

  const records = createCoachStore(root).listArtifacts('cooking');
  expect(records).toHaveLength(1);
  expect(records[0]!.pointer).toBe(pointer);
  expect(records[0]!.name).toBe('the kitchen log');
  expect(records[0]!.sentenceSession).toBe(artBody.sessionId);

  // The artifact licensed a fresh mint, so the advice call ran after the
  // declaration — and the pointer still never entered any recorded prompt.
  const note2 = await waitForNote('cooking', note1.mintedAt);
  expect(note2).toBeDefined();
  const allPrompts = routed.calls.map((c) => c.system + c.text).join('\n');
  expect(allPrompts).toContain('the kitchen log');
  expect(allPrompts).not.toContain('secret.pdf');
  expect(allPrompts).not.toContain('/home/me/notes');
  for (const e of readEvents(root)) {
   expect(e.detail).not.toContain('secret.pdf');
   expect(e.detail).not.toContain('/home/me/notes');
  }
  expect(readEvents(root).map((e) => e.kind)).toContain('artifact-declared');
 });

 it('rejects an artifact missing any of the three fields', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });
  const r = await post('/api/coach/cooking/artifact', { pointer: '/x', name: 'the log' });
  expect(r.status).toBe(400);
 });

 it('retire is the person\'s verb — no confirmation, no reason (Q-75)', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/cooking/read');
  const note = await waitForNote('cooking');
  const adopt = await post('/api/coach/cooking/adopt', { optionId: note.options[0]!.id });
  const { quest } = await jsonOf<{ quest: { id: string } }>(adopt);

  const ret = await post(`/api/coach/quest/${quest.id}/retire`);
  expect(ret.status).toBe(200);
  const retired = createCoachStore(root).getQuest(quest.id)!;
  expect(retired.retiredAt).toBeTypeOf('string');
  expect(readEvents(root).map((e) => e.kind)).toContain('quest-retired');
  expect((await post('/api/coach/quest/nope/retire')).status).toBe(404);
 });

 it('adopting an option from a replaced note is 404 — nothing mints from an evaporated option (Q-74)', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/cooking/read');
  const note1 = await waitForNote('cooking');

  // The note is replaced on disk before the person acts.
  createCoachStore(root).writeAdvice({
   direction: 'cooking',
   mintedAt: new Date().toISOString(),
   license: 'page-opened',
   options: [{ id: 'opt-9', text: 'The new option', cites: ['c1'] }],
  });

  const adopt = await post('/api/coach/cooking/adopt', { optionId: note1.options[0]!.id });
  expect(adopt.status).toBe(404);
  expect(createCoachStore(root).listQuests('cooking')).toEqual([]);
 });

 it('a declined option never appears in the next minted note (Q-77)', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/cooking/read');
  const note1 = await waitForNote('cooking');
  const declined = note1.options[1]!;

  const dec = await post('/api/coach/cooking/decline-option', { optionId: declined.id });
  expect(dec.status).toBe(200);
  expect(readEvents(root).map((e) => e.kind)).toContain('coach-option-declined');

  // A second read re-mints; the declined text is dropped by the guard.
  await post('/api/coach/cooking/read');
  const note2 = await waitForNote('cooking', note1.mintedAt);
  expect(note2.options.map((o) => o.text)).not.toContain(declined.text);
  expect(note2.options).toHaveLength(2);
 });

 it('the page 404s when the lens is off (Q-73)', async () => {
  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/direction/cooking/uncoach');
  expect((await get('/api/coach/cooking')).status).toBe(404);
 });
});
