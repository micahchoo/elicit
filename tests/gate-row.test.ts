/**
 * Ticket 159, slice 4: reflective is a machine instance (its one-phase
 * ways-in machine wraps the P1/P2/P3 flow — the machine question is the
 * P3-equivalent, so P1 juxtaposition and P2 red-light stay the dominant
 * channels), and the gate row is the standard control surface on EVERY
 * sitting: continue / park, depth kept / another day, with skip surviving
 * as a quiet link beside the gate.
 *
 * Wire surface (the plan's VERB MAPPING, pinned):
 * - 'another day' = the old harvest-now wire: POST /api/session/:id/end,
 *   harvest behind the response, the review queue is the destination.
 * - 'park' enters the closing door through POST /api/session/:id/gate (the
 *   machine side-record is slice 5); harvest happens at /end.
 * - 'continue' is a no-op — the person just answers.
 * - 'skip' keeps its route (the skip-rate metrics stay live).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { startSession, userTurn } from '../src/elicitor/elicitor.js';
import { CLOSING_DOOR_QUESTION } from '../src/elicitor/protocol.js';
import type { Complete, QueueStore, Snippet, Turn, Vault } from '../src/types.js';
import type { CutProposal } from '../src/types.js';

/** The machine shape every turn response's phase field now carries. */
const WAYS_IN_META = { id: 'ways-in', label: 'follow the thread', step: 1, of: 1 };

// ── Direct-elicitor fixtures (the protocol-machine-sitting pattern) ──

function makeFakeVault() {
 const transcripts: Record<string, { turns: Turn[] }> = {};
 const vault = {
  saveSnippet: () => { throw new Error('unexpected saveSnippet call'); },
  saveVersion: () => { throw new Error('unexpected saveVersion call'); },
  saveReading: () => { throw new Error('unexpected saveReading call'); },
  saveBud: () => { throw new Error('unexpected saveBud call'); },
  rebuildIndex: () => ({ snippets: {}, readings: {}, buds: {} }),
  startTranscript(session: string) {
   transcripts[session] = { turns: [] };
  },
  appendTurn(session: string, turn: Turn) {
   const t = transcripts[session];
   if (!t) throw new Error(`no transcript for session ${session}`);
   t.turns.push(turn);
  },
  _turns(session: string): Turn[] {
   return transcripts[session]!.turns;
  },
 } satisfies Vault & { _turns(session: string): Turn[] };
 return vault;
}

function makeFakeQueue(): QueueStore {
 return {
  add(draft) {
   return {
    ...draft,
    id: 'fake-id',
    created: new Date().toISOString(),
    status: 'pending' as const,
   };
  },
  list: () => [],
  get: () => undefined,
  draw: () => null,
  markAsked: () => {},
  markAnswered: () => {},
  markPending: () => {},
  defer: () => {},
  park: () => {},
  unpark: () => {},
  expire: () => 0,
  expireTailBeyond: () => 0,
  markExpired: () => {},
  recordReplyDisengagement: () => false,
  noteSittingStarted: () => {},
 };
}

// ── Wire harness (the sounding-routes pattern) ──

const roots: string[] = [];

afterAll(() => {
 for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function makeApp(script: string[]): Promise<{ app: Hono; root: string; queue: QueueStore }> {
 const root = mkdtempSync(join(tmpdir(), 'elicit-gate-row-'));
 roots.push(root);
 const vault = createVault(root);
 const complete = makeScriptedComplete(script);
 const queue = createQueueStore(root);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(root, '.auth.json'));
 const app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore });
 return { app, root, queue };
}

/** POST and parse JSON; T is the asserted response shape, checked at the call site. */
async function post<T>(app: Hono, path: string, body?: unknown): Promise<T> {
 const init: RequestInit =
  body === undefined
   ? { method: 'POST' }
   : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
 const res = await app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
 return (await res.json()) as T;
}

/** POST and return the raw Response (status assertions). */
async function postRaw(app: Hono, path: string, body?: unknown): Promise<Response> {
 const init: RequestInit =
  body === undefined
   ? { method: 'POST' }
   : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
 return app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
}

/** GET and return the raw Response (status assertions). */
async function getRaw(app: Hono, path: string): Promise<Response> {
 return app.fetch(new Request(`http://localhost${path}`, { method: 'GET' }), {
  remoteAddr: '127.0.0.1',
 });
}

async function newSession(app: Hono): Promise<string> {
 const res = await post<{ sessionId: string }>(app, '/api/session', {});
 expect(res.sessionId).toBeTruthy();
 return res.sessionId;
}

/**
 * The harvest runs behind the response and lands in the review queue on disk
 * (ticket 084). Polling is the only wait available: the record appears from
 * a background setImmediate in the server process, which fake timers cannot
 * advance, so this deliberately polls the real clock (the established
 * unprompted.test.ts pattern).
 */
async function waitForProposals(
 app: Hono,
 sessionId: string,
 timeoutMs = 5000,
): Promise<CutProposal[]> {
 const deadline = Date.now() + timeoutMs;
 for (; ;) {
  const res = await getRaw(app, `/api/harvest-queue/${sessionId}`);
  if (res.status === 200) {
   const body = (await res.json()) as { proposals: CutProposal[] };
   return body.proposals;
  }
  if (Date.now() > deadline) throw new Error(`harvest for ${sessionId} never landed`);
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

// ── Reflective is a machine instance; P1/P2 stay dominant ──

describe('reflective is a machine instance (ticket 159, slice 4)', () => {
 const SEED: Snippet = {
  id: 'seed-career-direction',
  version: 1,
  captured: new Date().toISOString(),
  provenance: {
   kind: 'harvest',
   session: 'seed',
   question: 'What matters?',
   questionForm: 'deliberative',
  },
  prose: 'The career direction question keeps returning in my writing.',
 };

 it('P1 juxtaposition still serves first — the machine never composes on a resonant turn', async () => {
  const complete = makeScriptedComplete([
   'You wrote: "career direction question." What has changed about that since?',
  ]);
  const session = startSession(
   { target: 'self' },
   {
    complete,
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([SEED]),
    bank: [{ text: 'What are you working on?', questionForm: 'deliberative' as const }],
    protocolName: 'reflective',
   },
  );

  const result = await userTurn(session, 'I keep circling back to the same career direction question.');
  expect(result.kind).toBe('probe');
  if (result.kind !== 'probe') return;
  // The P1 channel served: provenance is the juxtaposition, and the machine
  // never composed (its question would have consumed a script entry and set
  // machineLastServed).
  expect(result.provenance).toBe('juxtaposition');
  expect(result.text).toBe('You wrote: "career direction question." What has changed about that since?');
  expect(session.machineLastServed).toBeUndefined();
  expect(session.protocolMachine).toBeDefined();
  expect(session.protocolMachine!.phaseIndex).toBe(0);
 });

 it('the ways-in machine question is the P3-equivalent: it serves only when P1 and P2 are quiet', async () => {
  const complete = makeScriptedComplete([
   '{}', // P2 redLights — no lights
   'What did the restlessness look like before that?',
  ]);
  const session = startSession(
   { target: 'self' },
   {
    complete,
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    bank: [{ text: 'What are you working on?', questionForm: 'deliberative' as const }],
    protocolName: 'reflective',
   },
  );

  const result = await userTurn(session, 'The shelter work changed how I read my own restlessness.');
  expect(result.kind).toBe('probe');
  if (result.kind !== 'probe') return;
  expect(result.provenance).toBe('machine');
  expect(result.text).toBe('What did the restlessness look like before that?');
  // The machine question served — the next turn counts the exchange.
  expect(session.machineLastServed).toBe(true);
 });
});

// ── The gate row is the standard control surface ──

describe('the gate row is the standard control surface (ticket 159, slice 4)', () => {
 const ANSWER =
  'The shelter work is what changed how I read my own restlessness.';
 const CUTS = JSON.stringify({
  cuts: [
   {
    text: ANSWER,
    sourceTurn: 0,
    facet: 'construct',
    stance: 'self-observation',
    reading: 'The shelter work reframed the restlessness',
    standalone: true,
   },
  ],
 });

 it("'another-day' ends the sitting through the /end flow and harvests", async () => {
  const { app, root } = await makeApp(['{}', 'What did the restlessness look like before that?', CUTS]);
  const id = await newSession(app);

  const turn = await post<{ kind: string; text: string }>(app, `/api/session/${id}/turn`, { text: ANSWER });
  expect(turn.kind).toBe('probe');

  const gate = await post<{ status: string; sessionId: string }>(
   app,
   `/api/session/${id}/gate`,
   { choice: 'another-day' },
  );
  expect(gate.status).toBe('harvesting');
  expect(gate.sessionId).toBe(id);

  // The end flow's closing section lands on the transcript (the last turn
  // was an agent question)…
  const transcript = matter.read(join(root, 'transcripts', `${id}.md`));
  expect(transcript.content).toContain('## closing');
  // …and the harvest lands in the review queue.
  const proposals = await waitForProposals(app, id);
  expect(proposals.length).toBe(1);
  expect(proposals[0]!.text).toBe(ANSWER);
 });

 it("'park' enters the closing door; the sitting continues to saturation and never harvests", async () => {
  const { app, root } = await makeApp(['{}', 'What did the restlessness look like before that?']);
  const id = await newSession(app);

  await post(app, `/api/session/${id}/turn`, { text: ANSWER });

  const gate = await post<{ kind: string; text: string; phase: string }>(
   app,
   `/api/session/${id}/gate`,
   { choice: 'park' },
  );
  // The Sounding precedent: the sitting proceeds to the closing door; the
  // machine side-record is slice 5.
  expect(gate.kind).toBe('door');
  expect(gate.text).toBe(CLOSING_DOOR_QUESTION);
  expect(gate.phase).toBe('closing-door');

  // The door answer saturates — the close questions are fixed text, so no
  // script entries are consumed, and the close creates no queue entry.
  const door = await post<{ kind: string }>(
   app,
   `/api/session/${id}/turn`,
   { text: 'Nothing else for now.' },
  );
  expect(door.kind).toBe('saturated');

  // Park did not harvest: no pending record, no closing section.
  const pending = await getRaw(app, `/api/harvest-queue/${id}`);
  expect(pending.status).toBe(404);
  const transcript = matter.read(join(root, 'transcripts', `${id}.md`));
  expect(transcript.content).not.toContain('## closing');
 });

 it("'continue' is a no-op: the sitting is untouched and the next turn serves normally", async () => {
  const { app } = await makeApp(['{}', 'What did the restlessness look like before that?', '{}', 'What else comes to mind?']);
  const id = await newSession(app);

  await post(app, `/api/session/${id}/turn`, { text: ANSWER });

  const gate = await post<{ kind: string; phase: string }>(
   app,
   `/api/session/${id}/gate`,
   { choice: 'continue' },
  );
  // The gate route carries the session phase string (the machine shape is
  // the TURN route's wire; the strings still ride the gate routes).
  expect(gate.kind).toBe('continue');
  expect(gate.phase).toBe('open');

  // The person just answers — the next turn is the continuation. (The
  // answer must be substantive: the content-free pivot draws a fresh
  // question instead of composing.)
  const next = await post<{ kind: string; text: string }>(app, `/api/session/${id}/turn`, { text: 'And then the garden took over, and I noticed how much it changed everything.' });
  expect(next.kind).toBe('probe');
  expect(next.text).toBe('What else comes to mind?');
 });

 it("'skip' still works through the quiet link's route (the skip-rate metrics stay live)", async () => {
  const { app } = await makeApp([]);
  const id = await newSession(app);

  const res = await post<{ kind: string; text?: string }>(app, `/api/session/${id}/skip`, {});
  expect(res.kind).toBe('question');
  expect(res.text).toBeTruthy();
 });

 it('an unknown gate word is a 400, not a guess', async () => {
  const { app } = await makeApp([]);
  const id = await newSession(app);

  const bad = await postRaw(app, `/api/session/${id}/gate`, { choice: 'stop' });
  expect(bad.status).toBe(400);
  const empty = await postRaw(app, `/api/session/${id}/gate`, {});
  expect(empty.status).toBe(400);
  const missing = await postRaw(app, `/api/session/${id}/gate`);
  expect(missing.status).toBe(400);
 });

 it('every sitting now carries the phase meta on its turn responses', async () => {
  // A default sitting degrades people-grid → reflective (no gazetteer), and
  // reflective is a machine instance: the turn response's phase field is
  // the machine shape, not the session phase string.
  const { app } = await makeApp(['{}', 'What did the restlessness look like before that?']);
  const id = await newSession(app);

  const turn = await post<{ kind: string; phase: typeof WAYS_IN_META }>(app, `/api/session/${id}/turn`, { text: ANSWER });
  expect(turn.kind).toBe('probe');
  expect(turn.phase).toEqual(WAYS_IN_META);
 });
});
