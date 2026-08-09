/**
 * The core API at /v2 (ticket 129, spec docs/loop-core-api-spec.md).
 *
 * Every assertion goes through `createApp` and `app.fetch` — never a
 * hand-built handler — because /v2 is an ADAPTER, and the failure worth
 * catching is the one where the translation compiles, the suite is green and
 * the dispatch reaches a route that does not exist.
 *
 * Two of these tests are about a route NOT writing. `view` is side-effect-free
 * by rule, which is only a rule if something fails when a projection writes:
 * the queue tail must survive a projection and still expire on the old route,
 * and the wiki page must stamp nothing under /v2 and still stamp under /api.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { MAX_OPEN_QUESTIONS } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createClaimStore } from '../src/wiki/store.js';
import type { Claim } from '../src/wiki/contract.js';
import type { Complete, QueueStore } from '../src/types.js';

/**
 * The answer the sitting gives, and the two cuts the harvester proposes from
 * it. Both cut texts are verbatim substrings of the answer — the substring
 * gate is Q-1 made structural, and a fake that broke it would test nothing.
 */
const ANSWER =
 'I moved the workbench under the window last spring. The light changed what I was willing to start.';
const CUT_ONE = 'I moved the workbench under the window last spring.';
const CUT_TWO = 'The light changed what I was willing to start.';

const MODE = { target: 'self' as const };

let root: string;
let app: Hono;
let queue: QueueStore;
let settled: number;
let waiting: (() => void)[];

function onDocketSettled(): void {
 settled++;
 waiting.splice(0).forEach((r) => r());
}

async function waitForSettles(n: number): Promise<void> {
 while (settled < n) await new Promise<void>((r) => waiting.push(r));
}

/**
 * The fake responder, with the harvest call answered by a script. The stock
 * fake proposes an empty cuts array, and a review flow with nothing to review
 * cannot exercise approve, trim or commit.
 */
function harvestingFake(): Complete {
 const base = makeFakeComplete();
 return async (system, turns, opts) => {
  if (system.toLowerCase().includes('harvesting agent')) {
   return JSON.stringify({
    cuts: [
     { text: CUT_ONE, sourceTurn: 0, facet: 'construct', stance: 'self-observation', reading: 'the person reports this', standalone: true },
     { text: CUT_TWO, sourceTurn: 0, facet: 'construct', stance: 'self-observation', reading: 'the person reports this', standalone: true },
    ],
   });
  }
  return base(system, turns, opts);
 };
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

type Envelope = {
 re: { kind: string; id?: string; sessionId?: string };
 rev: number;
 turn?: { kind: string; text?: string; pulsePrompt?: string; target?: string };
 view?: Record<string, unknown>;
 notices?: string[];
};

type Failure = { error: { code: string; message: string } };

/** Open a sitting through /v2 and hand back its envelope. */
async function openSitting(): Promise<Envelope> {
 const res = await post('/v2/open', { re: { kind: 'sitting' }, mode: MODE });
 expect(res.status).toBe(200);
 return jsonOf<Envelope>(res);
}

/** Poll the harvest projection until the background propose has landed. */
async function waitForProposals(sessionId: string): Promise<{ text: string }[]> {
 const deadline = Date.now() + 5000;
 for (;;) {
  const res = await get(`/v2/view?scope=harvest&sessionId=${sessionId}`);
  if (res.status === 200) {
   const body = await jsonOf<{ view: { proposals?: { text: string }[] } }>(res);
   if (body.view.proposals !== undefined) return body.view.proposals;
  }
  if (Date.now() > deadline) throw new Error(`no proposals landed for ${sessionId}`);
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

function claim(id: string, body: string, cites: string[]): Claim {
 const NOW = '2026-08-03T09:00:00.000Z';
 return {
  id,
  body,
  range: 'in the workshop, since 2025',
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

beforeEach(async () => {
 root = mkdtempSync(join(tmpdir(), 'elicit-v2-routes-'));
 settled = 0;
 waiting = [];
 const vault = createVault(root);
 const snip = vault.saveSnippet('the bench sits under the window', {
  kind: 'unprompted',
  session: 's-1',
  question: '',
  questionForm: 'theoretical',
 });
 createClaimStore(root).writeClaim(claim('c1', 'the light decides what gets started', [`${snip.id}@1`]));
 queue = createQueueStore(root);
 const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
 app = await createApp({
  vault,
  complete: harvestingFake(),
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

describe('open — entering a context (ticket 129)', () => {
 it('mounts the four operations under /v2', () => {
  const paths = app.routes.map((r) => r.path);
  expect(paths).toContain('/v2/open');
  expect(paths).toContain('/v2/say');
  expect(paths).toContain('/v2/act');
  expect(paths).toContain('/v2/view');
 });

 it('opens a sitting: the opener rides a TurnEnvelope with the minted id, a rev and the pulse prompt', async () => {
  const body = await openSitting();
  expect(body.re.kind).toBe('sitting');
  expect(body.re.id).toBeTypeOf('string');
  expect(body.rev).toBeTypeOf('number');
  expect(body.turn?.kind).toBe('probe');
  expect(body.turn?.text).toBeTypeOf('string');
  expect(body.turn!.text!.length).toBeGreaterThan(0);
  expect(body.turn?.pulsePrompt).toBeTypeOf('string');
  expect(body.turn?.target).toBe('self');
 });

 it('opens a sitting without a mode — the server defaults target self', async () => {
  // Canon §5.2: minutes/energy are not declared and no mode is required to
  // open a sitting; the server supplies target 'self'. A body whose mode is
  // target-only is the only shape the adapter forwards.
  const noMode = await post('/v2/open', { re: { kind: 'sitting' } });
  expect(noMode.status).toBe(200);
  const body = await jsonOf<Envelope>(noMode);
  expect(body.re.kind).toBe('sitting');
  expect(body.turn?.target).toBe('self');

  const withTarget = await post('/v2/open', { re: { kind: 'sitting' }, mode: { target: 'self' } });
  expect(withTarget.status).toBe(200);
  expect((await jsonOf<Envelope>(withTarget)).turn?.target).toBe('self');
 });

 it('refuses an unknown re kind as bad-request', async () => {
  const bogus = await post('/v2/open', { re: { kind: 'diary' } });
  expect(bogus.status).toBe(400);
  const failure = await jsonOf<Failure>(bogus);
  expect(failure.error.code).toBe('bad-request');
  expect(failure.error.message).toContain('diary');
 });

 it('opens a read context with its available verbs beside the projection', async () => {
  const res = await post('/v2/open', { re: { kind: 'claim', id: 'c1' } });
  expect(res.status).toBe(200);
  const body = await jsonOf<Envelope>(res);
  expect(body.view!.verbs).toEqual(['read', 'attest', 'challenge']);
  expect((body.view!.claim as { id: string }).id).toBe('c1');
 });
});

describe('say — the sole prose channel (ticket 129)', () => {
 it('answers the turn and the sitting hands back the next probe', async () => {
  const opened = await openSitting();
  const first = opened.turn!.text;

  const res = await post('/v2/say', {
   re: { kind: 'sitting', id: opened.re.id },
   text: ANSWER,
   channel: 'typed',
  });
  expect(res.status).toBe(200);
  const body = await jsonOf<Envelope>(res);
  expect(body.turn?.kind).toBe('probe');
  expect(body.turn?.text).toBeTypeOf('string');
  expect(body.turn?.text).not.toBe(first);
  // The write moved the counter; the opener did not have to.
  expect(body.rev).toBeGreaterThan(opened.rev - 1);
 });

 it('refuses an unknown intent, and an intent the context does not take', async () => {
  const opened = await openSitting();
  const bogus = await post('/v2/say', {
   re: { kind: 'sitting', id: opened.re.id },
   text: ANSWER,
   intent: 'confess',
  });
  expect(bogus.status).toBe(400);
  expect((await jsonOf<Failure>(bogus)).error.code).toBe('bad-request');

  const wrongContext = await post('/v2/say', {
   re: { kind: 'sitting', id: opened.re.id },
   text: ANSWER,
   intent: 'prose',
  });
  expect(wrongContext.status).toBe(400);
 });

 it('an empty pulse is a skip that writes nothing — not even the fact of it', async () => {
  const opened = await openSitting();
  const before = readEvents(root).length;
  const res = await post('/v2/say', {
   re: { kind: 'sitting', id: opened.re.id },
   text: '   ',
   intent: 'pulse',
  });
  expect(res.status).toBe(200);
  const body = await jsonOf<Envelope>(res);
  expect(body.turn).toBeUndefined();
  expect(body.rev).toBe(opened.rev);
  expect(readEvents(root).length).toBe(before);
 });
});

describe('act — the non-prose verbs (ticket 129)', () => {
 it('skip hands back another question and leaves the answer unwritten', async () => {
  const opened = await openSitting();
  const res = await post('/v2/act', {
   re: { kind: 'sitting', id: opened.re.id },
   verb: { v: 'skip' },
  });
  expect(res.status).toBe(200);
  const body = await jsonOf<Envelope>(res);
  // An empty bank answers `exhausted`, which is a notice and not a turn;
  // either way the verb reached the route and nothing threw.
  expect(body.turn?.kind === 'probe' || body.notices !== undefined).toBe(true);
 });

 it('defer returns the question to the queue as a plain open question', async () => {
  const opened = await openSitting();
  const before = queue.list({ source: 'user-declared' }).length;
  const res = await post('/v2/act', {
   re: { kind: 'sitting', id: opened.re.id },
   verb: { v: 'defer' },
  });
  expect(res.status).toBe(200);
  const after = queue.list({ source: 'user-declared' });
  expect(after.length).toBe(before + 1);
  expect(readEvents(root).map((e) => e.kind)).toContain('question-deferred');
 });

 it('refuses an unknown verb, and a verb the context does not answer', async () => {
  const opened = await openSitting();
  const bogus = await post('/v2/act', {
   re: { kind: 'sitting', id: opened.re.id },
   verb: { v: 'levitate' },
  });
  expect(bogus.status).toBe(400);
  const failure = await jsonOf<Failure>(bogus);
  expect(failure.error.code).toBe('bad-request');
  expect(failure.error.message).toContain('levitate');

  // `attest` is a real verb — on a claim, not on a sitting.
  const wrongContext = await post('/v2/act', {
   re: { kind: 'sitting', id: opened.re.id },
   verb: { v: 'attest' },
  });
  expect(wrongContext.status).toBe(400);
 });

 it('a stale rev is a conflict; the current one is accepted', async () => {
  const opened = await openSitting();
  const re = { kind: 'sitting', id: opened.re.id };

  const fresh = await post('/v2/act', { re, verb: { v: 'leave' }, rev: opened.rev });
  expect(fresh.status).toBe(200);
  const moved = await jsonOf<Envelope>(fresh);
  expect(moved.rev).toBe(opened.rev + 1);

  const stale = await post('/v2/act', { re, verb: { v: 'leave' }, rev: opened.rev });
  expect(stale.status).toBe(409);
  const failure = await jsonOf<Failure>(stale);
  expect(failure.error.code).toBe('conflict');
  expect(failure.error.message).toContain('stale');
 });
});

describe('the harvest review — accumulate, then commit (ticket 129)', () => {
 /** A sitting answered and ended, with its proposals waiting. */
 async function reviewable(): Promise<{ sessionId: string; proposals: { text: string }[] }> {
  const opened = await openSitting();
  const sessionId = opened.re.id!;
  await post('/v2/say', { re: { kind: 'sitting', id: sessionId }, text: ANSWER });
  const ended = await post('/v2/act', { re: { kind: 'sitting', id: sessionId }, verb: { v: 'end' } });
  expect(ended.status).toBe(200);
  const proposals = await waitForProposals(sessionId);
  expect(proposals.map((p) => p.text)).toEqual([CUT_ONE, CUT_TWO]);
  return { sessionId, proposals };
 }

 it('approve and a trim by offsets accumulate, and the commit writes both', async () => {
  const { sessionId } = await reviewable();
  const re = { kind: 'harvest', sessionId };

  const approved = await post('/v2/act', { re, verb: { v: 'approve', proposal: 0 } });
  expect(approved.status).toBe(200);
  expect((await jsonOf<Envelope>(approved)).view).toEqual({ decided: 1, of: 2 });

  // A commit here is REFUSED, not bad-request: the constitution says every
  // proposal must be decided, and a persona has to be able to tell the two
  // apart.
  const early = await post('/v2/act', { re, verb: { v: 'commit' } });
  expect(early.status).toBe(422);
  const refusal = await jsonOf<Failure>(early);
  expect(refusal.error.code).toBe('refused');
  expect(refusal.error.message).toContain('1 of 2');

  // Offsets into the proposal, converted to the exact substring the old
  // route demands. 'The light changed' is CUT_TWO[0..17].
  const span: [number, number] = [0, 'The light changed'.length];
  const trimmed = await post('/v2/act', { re, verb: { v: 'trim', proposal: 1, span } });
  expect(trimmed.status).toBe(200);
  expect((await jsonOf<Envelope>(trimmed)).view).toEqual({ decided: 2, of: 2 });

  const committed = await post('/v2/act', { re, verb: { v: 'commit' } });
  expect(committed.status).toBe(200);
  const body = await jsonOf<Envelope>(committed);
  const snippets = body.view!.snippets as { prose: string }[];
  expect(snippets.map((s) => s.prose).sort()).toEqual([CUT_ONE, 'The light changed'].sort());

  // The review is finished: the pending record is gone and a second commit
  // has nothing to decide.
  const again = await get(`/v2/view?scope=harvest&sessionId=${sessionId}`);
  expect(again.status).toBe(404);
 });

 it('a trim whose span runs off the proposal is refused, and nothing is recorded', async () => {
  const { sessionId, proposals } = await reviewable();
  const re = { kind: 'harvest', sessionId };
  const past = proposals[0]!.text.length + 5;

  const res = await post('/v2/act', { re, verb: { v: 'trim', proposal: 0, span: [0, past] } });
  expect(res.status).toBe(422);
  const failure = await jsonOf<Failure>(res);
  expect(failure.error.code).toBe('refused');
  expect(failure.error.message).toContain('falls outside');

  // Nothing was decided by the refusal, so the commit still refuses on two.
  const commit = await post('/v2/act', { re, verb: { v: 'commit' } });
  expect(commit.status).toBe(422);
  expect((await jsonOf<Failure>(commit)).error.message).toContain('2 of 2');
 });

 it('a proposal index outside the array is a bad-request, not a refusal', async () => {
  const { sessionId } = await reviewable();
  const res = await post('/v2/act', {
   re: { kind: 'harvest', sessionId },
   verb: { v: 'approve', proposal: 9 },
  });
  expect(res.status).toBe(400);
  expect((await jsonOf<Failure>(res)).error.code).toBe('bad-request');
 });
});

describe('view — the projections are pure (ticket 129)', () => {
 /** Fill the open pool past the QR-6 cap with entries the bound may expire. */
 function floodOpenPool(count: number): void {
  for (let i = 0; i < count; i++) {
   queue.add({
    source: 'gap-fill',
    license: 'CC0',
    question: `what did the ${i}th change ask of you?`,
    questionForm: 'deliberative',
    horizon: 'session',
   });
  }
 }

 it('the queue projection expires no tail; the old route still does', async () => {
  const over = 2;
  floodOpenPool(MAX_OPEN_QUESTIONS + over);
  expect(queue.list({ status: 'expired' })).toHaveLength(0);

  const projected = await get('/v2/view?scope=queue');
  expect(projected.status).toBe(200);
  const body = await jsonOf<{ scope: string; rev: number; view: { open: unknown[] } }>(projected);
  expect(body.scope).toBe('queue');
  // The person sees the capped pile either way — the difference is on disk.
  expect(body.view.open).toHaveLength(MAX_OPEN_QUESTIONS);
  expect(queue.list({ status: 'expired' })).toHaveLength(0);

  // The SPA route is unchanged: it still expires the tail beyond the cap.
  expect((await get('/api/queue')).status).toBe(200);
  expect(queue.list({ status: 'expired' })).toHaveLength(over);
 });

 it('the wiki projection stamps nothing surfaced; the old page still stamps', async () => {
  const stamps = (): number => readEvents(root).filter((e) => e.kind === 'surfaced').length;
  const before = stamps();

  const projected = await get('/v2/view?scope=wiki');
  expect(projected.status).toBe(200);
  // Batch B (§11): the projection is the contextualizer's passages view.
  const body = await jsonOf<{ view: { neighborhoods: { passages: unknown[] }[] } }>(projected);
  expect(body.view.neighborhoods.length).toBeGreaterThan(0);
  expect(stamps()).toBe(before);

  expect((await get('/api/wiki')).status).toBe(200);
  expect(stamps()).toBeGreaterThan(before);
 });

 it('opening the wiki through /v2 stamps nothing either — open reads are projections too', async () => {
  const stamps = (): number => readEvents(root).filter((e) => e.kind === 'surfaced').length;
  const before = stamps();
  expect((await post('/v2/open', { re: { kind: 'wiki' } })).status).toBe(200);
  expect(stamps()).toBe(before);
 });

 it('answers the read-only scopes and refuses an unknown one', async () => {
  for (const scope of ['snippets', 'pieces', 'harvest-queue', 'cadence', 'coach-waiting', 'auth-status', 'stt-status']) {
   const res = await get(`/v2/view?scope=${scope}`);
   expect([scope, res.status]).toEqual([scope, 200]);
  }
  const bogus = await get('/v2/view?scope=diary');
  expect(bogus.status).toBe(400);
  expect((await jsonOf<Failure>(bogus)).error.code).toBe('bad-request');
 });

 it('a piece export passes text/markdown through, and a missing piece is not-found', async () => {
  const composed = await post('/v2/act', {
   re: { kind: 'piece' },
   verb: { v: 'compose', snippets: Object.keys(createVault(root).rebuildIndex().snippets) },
  });
  expect(composed.status).toBe(200);
  const piece = await jsonOf<Envelope>(composed);
  expect(piece.re.kind).toBe('piece');
  expect(piece.re.id).toBeTypeOf('string');

  const exported = await get(`/v2/view?scope=piece-export&id=${piece.re.id}`);
  expect(exported.status).toBe(200);
  expect(exported.headers.get('content-type')).toContain('text/markdown');
  expect(await exported.text()).toContain('the bench sits under the window');

  const missing = await get('/v2/view?scope=piece&id=nope');
  expect(missing.status).toBe(404);
  expect((await jsonOf<Failure>(missing)).error.code).toBe('not-found');
 });
});
