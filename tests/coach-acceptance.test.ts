/**
 * The Coach slice acceptance (090 T12) — the whole loop through createApp,
 * and the four things the design makes impossible: a second unread note, a
 * re-offered decline, a pointer reaching the model, and a guilt artifact
 * (rate/streak/deadline/failure) existing anywhere. Plus the empty-corpus
 * block (090's data note): everything answers quiet, nothing blocks, and
 * no model call fires.
 *
 * The model is scripted and routed by PROMPT CONTENT, because the advice
 * mint and the background harvest call it in an order the routes decide
 * asynchronously: advice prompts answer options, harvest prompts answer a
 * verbatim cut, and every other call (the docket's composers) answers
 * 'padding', which fails composition and mints nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import { createCoachStore, readSittingTags, type CoachStore } from '../src/coach/store.js';
import { createClaimStore } from '../src/wiki/store.js';
import type { Claim } from '../src/wiki/contract.js';
import type { Complete, QueueStore, Snippet } from '../src/types.js';

const NOW = '2026-08-03T09:00:00.000Z';
const POINTER = '/home/me/notes/secret.pdf';
const RETURN_TEXT = 'I burnt the rice. Then I tried again.';
const ADVICE_MARKER = 'composing an advice note';
const HARVEST_MARKER = 'harvesting agent for Elicit';
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

/** A Complete routed by prompt content, recording every call. */
function routedComplete(): { complete: Complete; calls: { system: string; text: string }[] } {
 const calls: { system: string; text: string }[] = [];
 const complete: Complete = async (system, turns) => {
  calls.push({ system, text: turns[0]?.text ?? '' });
  if (system.includes(ADVICE_MARKER)) return ADVICE_JSON;
  if (system.includes(HARVEST_MARKER)) return CUT_JSON;
  return 'padding'; // the docket's composers fail composition and mint nothing
 };
 return { complete, calls };
}

let root: string;
let app: Hono;
let queue: QueueStore;
let store: CoachStore;
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

/** The loop's app: a seeded snippet + three claims, and a routed fake. */
async function makeLoopApp(): Promise<{ calls: { system: string; text: string }[] }> {
 root = mkdtempSync(join(tmpdir(), 'elicit-coach-accept-'));
 settled = 0;
 waiting = [];
 const vault = createVault(root);
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
 const routed = routedComplete();
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
 store = createCoachStore(root);
 return { calls: routed.calls };
}

async function makeEmptyApp(): Promise<{ calls: string[] }> {
 root = mkdtempSync(join(tmpdir(), 'elicit-coach-accept-'));
 settled = 0;
 waiting = [];
 const vault = createVault(root);
 queue = createQueueStore(root);
 const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
 const calls: string[] = [];
 const complete: Complete = async (system) => {
  calls.push(system);
  return 'padding';
 };
 app = await createApp({
  vault,
  complete,
  queue,
  index,
  vaultRoot: root,
  authStore: createFileAuth(join(root, '.auth.json')),
  onDocketSettled,
 });
 await waitForSettles(1);
 store = createCoachStore(root);
 return { calls };
}

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

async function waitForNote(slug: string, newerThan?: string): Promise<NonNullable<ReturnType<CoachStore['readAdvice']>>> {
 const deadline = Date.now() + 5000;
 for (;;) {
  const note = store.readAdvice(slug);
  if (note && (newerThan === undefined || note.mintedAt > newerThan)) return note;
  if (Date.now() > deadline) throw new Error(`advice note never minted for ${slug}`);
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

async function waitForHarvest(sessionId: string): Promise<void> {
 const deadline = Date.now() + 5000;
 for (;;) {
  const res = await get(`/api/harvest-queue/${sessionId}`);
  if (res.status === 200) return;
  if (Date.now() > deadline) throw new Error(`pending harvest for ${sessionId} never landed`);
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

 describe('the whole loop, through createApp (090 T12)', () => {
  it('declare → artifact → note → adopt → return → review → quoted page → retire → uncoach, files intact', async () => {
  await makeLoopApp();

  // The person's declaration — the ONLY door (Q-73).
  const declared = await post('/api/coach/direction', { name: 'Cooking' });
  expect(declared.status).toBe(200);

  // License via artifact: the declaration happened, the artifact is newer.
  const art = await post('/api/coach/cooking/artifact', {
   pointer: POINTER,
   name: 'the kitchen log',
   sentence: 'this log holds my knife decisions',
  });
  expect(art.status).toBe(200);
  const note1 = await waitForNote('cooking');
  expect(note1.options).toHaveLength(3);

  // Adopt an option — the quest record is minted.
  const adopt = await post('/api/coach/cooking/adopt', { optionId: note1.options[0]!.id });
  expect(adopt.status).toBe(200);
  const { quest } = await jsonOf<{ quest: { id: string; direction: string; cites: string[] } }>(adopt);
  expect(quest.direction).toBe('cooking');

  // Return — ordinary capture with the quest tag on the transcript (T4).
  const ret = await post(`/api/coach/quest/${quest.id}/return`, { text: RETURN_TEXT });
  expect(ret.status).toBe(200);
  const retBody = await jsonOf<{ sessionId: string; reflections: number }>(ret);
  expect(retBody.reflections).toBe(2);

  // The return licensed a fresh mint — ONE advice file, replaced (Q-77).
  await waitForNote('cooking', note1.mintedAt);
  expect(readdirSync(join(root, 'coach', 'advice'))).toEqual(['cooking.md']);

  // Review the pending harvest through the EXISTING decisions route.
  await waitForHarvest(retBody.sessionId);
  const decided = await post(`/api/session/${retBody.sessionId}/harvest`, {
   decisions: [{ action: 'approve', proposal: 0 }],
  });
  expect(decided.status).toBe(200);
  const decidedBody = await jsonOf<{ snippets: Snippet[] }>(decided);
  expect(decidedBody.snippets).toHaveLength(1);

  // Q-75's provenance, asserted FROM DISK: the return-Snippet's session
  // resolves to a quest-tagged transcript.
  const snippetId = decidedBody.snippets[0]!.id;
  const onDisk = matter.read(join(root, 'snippets', snippetId, 'v1.md')).data as { provenance: { session: string } };
  expect(onDisk.provenance.session).toBe(retBody.sessionId);
  const tags = readSittingTags(root);
  const tag = tags.find((t) => t.session === retBody.sessionId)!;
  expect(tag.quest).toBe(quest.id);
  expect(tag.direction).toBe('cooking');

  // The Coach page quotes the return — the person's words, on the page.
  const page = await get('/api/coach/cooking');
  expect(page.status).toBe(200);
  const pageBody = await jsonOf<{ log: { sentence: string; quote?: string }[] }>(page);
  const returned = pageBody.log.find((e) => e.sentence.includes('came back'))!;
  expect(returned.quote).toBe('I burnt the rice.');

  // The reflection entries are ordinary pending queue questions — answered
  // through the store's answer write, the same one the elicitor uses.
  const reflections = queue.list({ source: 'quest-reflection' });
  expect(reflections).toHaveLength(2);
  for (const e of reflections) {
   queue.markAnswered(e.id);
  }
  expect(queue.list({ source: 'quest-reflection' }).every((e) => e.status === 'answered')).toBe(true);

  // Retire — the person's verb.
  const retired = await post(`/api/coach/quest/${quest.id}/retire`);
  expect(retired.status).toBe(200);
  expect(store.getQuest(quest.id)!.retiredAt).toBeTypeOf('string');

  // Uncoach — the lens off, files intact (Q-73).
  const uncoached = await post('/api/coach/direction/cooking/uncoach');
  expect(uncoached.status).toBe(200);
  expect((await get('/api/coach/cooking')).status).toBe(404);
  expect(readFileSync(join(root, 'coach', 'directions', 'cooking.md'), 'utf-8')).toContain('coached: false');
  expect(store.getQuest(quest.id)).not.toBeNull();
  expect(store.listArtifacts('cooking')).toHaveLength(1);
 }, 15000);
});

describe('the four impossibilities (090 T12)', () => {
 it('(a) two licensing events in a row leave ONE advice file — replaced, never stacked (Q-77)', async () => {
  await makeLoopApp();
  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/cooking/read');
  const note1 = await waitForNote('cooking');
  await post('/api/coach/cooking/read');
  const note2 = await waitForNote('cooking', note1.mintedAt);
  expect(note2.mintedAt > note1.mintedAt).toBe(true);
  expect(readdirSync(join(root, 'coach', 'advice'))).toEqual(['cooking.md']);
 }, 15000);

 it('(b) after decline-offer, fifty waiting evaluations never offer that Direction again, and each wrote a coach-offer line (Q-62)', async () => {
  await makeLoopApp();
  // A never-declared candidate with enough claims WOULD qualify — then it is
  // declined, and the decline is forever (Q-43).
  await post('/api/coach/direction/gardening/decline-offer');
  for (let i = 0; i < 50; i++) {
   const w = await get('/api/coach/waiting');
   const body = await jsonOf<{ offer: unknown; lines: unknown[] }>(w);
   expect(body.offer).toBeNull();
   expect(body.lines).toEqual([]);
  }
  const offers = readEvents(root).filter((e) => e.kind === 'coach-offer');
  expect(offers).toHaveLength(50);
 }, 15000);

 it('(c) the pointer never reaches the model — every recorded prompt, joined, lacks it (Q-78)', async () => {
  const { calls } = await makeLoopApp();
  await post('/api/coach/direction', { name: 'Cooking' });
  const art = await post('/api/coach/cooking/artifact', {
   pointer: POINTER,
   name: 'the kitchen log',
   sentence: 'this log holds my knife decisions',
  });
  expect(art.status).toBe(200);
  await waitForNote('cooking');
  const joined = calls.map((c) => c.system + c.text).join('\n');
  expect(joined).not.toContain('secret.pdf');
  expect(joined).not.toContain('/home/me/notes');
 }, 15000);

 it('(d) no serialized coach record carries a rate, streak, deadline, completion or failure key (Q-24/Q-75)', async () => {
  await makeLoopApp();
  await post('/api/coach/direction', { name: 'Cooking' });
  await post('/api/coach/cooking/read');
  const note = await waitForNote('cooking');
  await post('/api/coach/cooking/adopt', { optionId: note.options[0]!.id });
  await post('/api/coach/cooking/artifact', {
   pointer: POINTER,
   name: 'the kitchen log',
   sentence: 'this log holds my knife decisions',
  });

  const serialized = JSON.stringify({
   directions: store.listDirections(),
   quests: store.listQuests(),
   artifacts: store.listArtifacts(),
   advice: store.readAdvice('cooking'),
   page: await (await get('/api/coach/cooking')).json(),
  });
  expect(serialized).not.toMatch(/rate|streak|deadline|complete|fail/i);
 }, 15000);
});

describe('the empty corpus (090 data note, T12)', () => {
 it('everything answers 200-shaped quiet, the offer logs qualified=0, and no model call fires', async () => {
  const { calls } = await makeEmptyApp();

  // Declaring works with no claims — the lens is the person's verb (Q-73).
  const declared = await post('/api/coach/direction', { name: 'Cooking' });
  expect(declared.status).toBe(200);

  const w = await get('/api/coach/waiting');
  expect(w.status).toBe(200);
  expect(await jsonOf<{ offer: unknown; lines: unknown[] }>(w)).toEqual({ offer: null, lines: [] });

  const page = await get('/api/coach/cooking');
  expect(page.status).toBe(200);
  const pageBody = await jsonOf<{ opening: string; advice: unknown }>(page);
  expect(pageBody.opening).toBe('nothing here yet — this page fills as you act');
  expect(pageBody.advice).toBeNull();

  // The read licenses a mint attempt, but nothing is citable (Q-74): the
  // mint withholds before the model is ever asked.
  const read = await post('/api/coach/cooking/read');
  expect(read.status).toBe(200);
  await new Promise<void>((r) => setTimeout(r, 300));
  expect(store.readAdvice('cooking')).toBeNull();

  const offers = readEvents(root).filter((e) => e.kind === 'coach-offer');
  expect(offers.at(-1)!.detail).toBe('directions=0 qualified=0 offered=none');
  expect(calls).toHaveLength(0);
 }, 15000);
});
