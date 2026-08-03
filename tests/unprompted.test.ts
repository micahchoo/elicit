import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import type { CutProposal, QueueEntry } from '../src/types.js';

// ── Helpers ──

/** POST to the app directly. Loopback remoteAddr — no auth file, so the gate opens. */
async function post(app: Hono, path: string, body?: unknown): Promise<Response> {
 const init: RequestInit = { method: 'POST' };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 }
 return app.fetch(new Request(`http://127.0.0.1${path}`, init), {
  remoteAddr: '127.0.0.1',
 });
}

/** GET from the app directly. Loopback remoteAddr — no auth file, so the gate opens. */
async function get(app: Hono, path: string): Promise<Response> {
 return app.fetch(new Request(`http://127.0.0.1${path}`, { method: 'GET' }), {
  remoteAddr: '127.0.0.1',
 });
}

/**
 * The harvest runs behind the response and lands in the review queue on disk
 * (ticket 084). Polling is the only wait available: the record appears from a
 * background setImmediate in the server process, which fake timers cannot
 * advance, so this deliberately polls the real clock.
 */
async function waitForProposals(
 request: (path: string) => Promise<Response>,
 sessionId: string,
 timeoutMs = 5000,
): Promise<CutProposal[]> {
 const deadline = Date.now() + timeoutMs;
 for (; ;) {
  const res = await request(`/api/harvest-queue/${sessionId}`);
  if (res.status === 200) {
   const body = (await res.json()) as { proposals: CutProposal[] };
   return body.proposals;
  }
  if (Date.now() > deadline) throw new Error(`harvest for ${sessionId} never landed`);
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

// ── Unprompted entry ──

const entryText =
 'I keep circling back to the same worry about money. It is not the number, it is what the number stands in for.';
const entryCut = 'It is not the number, it is what the number stands in for.';

const unpromptedScripted = [
 JSON.stringify({
  cuts: [
   {
    text: entryCut,
    sourceTurn: 0,
    facet: 'construct',
    stance: 'self-observation',
    reading: 'Money is a stand-in for something else',
    standalone: true,
   },
  ],
 }),
 // Padding: post-harvest docket composeOpener calls (may retry)
 'padding a',
 'padding b',
 'padding c',
 'padding d',
];

describe('unprompted entry', () => {
 let app: Hono;
 let vaultDir: string;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-unprompted-'));
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(unpromptedScripted);
  const queue = createQueueStore(vaultDir);
  const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('routes written prose through propose → review → decide, keeping unprompted provenance', async () => {
  // ── Write, with no question asked ──
  const entryRes = await post(app, '/api/unprompted', { text: entryText });
  expect(entryRes.status).toBe(200);
  const entry = (await entryRes.json()) as { status: string; sessionId: string };
  expect(entry.status).toBe('harvesting');
  expect(entry.sessionId).toBeTypeOf('string');
  const proposals = await waitForProposals((p) => get(app, p), entry.sessionId);
  expect(proposals.length).toBe(1);
  expect(proposals[0]!.text).toBe(entryCut);
  // No eliciting question — nothing asked for these words
  expect(proposals[0]!.question).toBe('');

  // The transcript exists and carries the unprompted protocol
  const transcriptFile = join(vaultDir, 'transcripts', `${entry.sessionId}.md`);
  expect(existsSync(transcriptFile)).toBe(true);
  const transcript = matter.read(transcriptFile);
  expect(transcript.data.protocol).toBe('unprompted');
  expect(transcript.content).toContain(entryCut);

  // ── The ordinary decide path takes the proposals ──
  const harvestRes = await post(app, `/api/session/${entry.sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'approve' }],
  });
  expect(harvestRes.status).toBe(200);
  const { snippets } = (await harvestRes.json()) as {
   snippets: Array<{ id: string; provenance: { kind: string; session: string } }>;
  };
  expect(snippets.length).toBe(1);
  expect(snippets[0]!.provenance.kind).toBe('unprompted');
  expect(snippets[0]!.provenance.session).toBe(entry.sessionId);

  // ── On disk, with the same origin ──
  const snippetFile = join(vaultDir, 'snippets', snippets[0]!.id, 'v1.md');
  expect(existsSync(snippetFile)).toBe(true);
  const saved = matter.read(snippetFile);
  expect(saved.content.trimEnd()).toBe(entryCut);
  expect(saved.data.provenance.kind).toBe('unprompted');
 });

 it('logs the entry by size, never by content', async () => {
  const events = readEvents(vaultDir);
  const entered = events.filter((e) => e.kind === 'unprompted-entry');
  expect(entered.length).toBe(1);
  expect(entered[0]!.detail).toContain(`chars=${entryText.length}`);
  expect(entered[0]!.detail).not.toContain('money');
  // The proposal step still announces itself
  expect(events.some((e) => e.kind === 'harvest-proposed')).toBe(true);
 });

 it('refuses an empty page', async () => {
  const res = await post(app, '/api/unprompted', { text: '   ' });
  expect(res.status).toBe(400);
 });
});

// ── Defer ──

const deferAnswer = 'The shelter work is what changed how I read my own restlessness.';

const deferScripted = [
 // The single answered turn: redLights, then probe
 '{}',
 'What did the restlessness look like before that?',
];

describe('defer verb', () => {
 let app: Hono;
 let vaultDir: string;
 let queue: ReturnType<typeof createQueueStore>;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-defer-'));
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(deferScripted);
  queue = createQueueStore(vaultDir);
  const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('re-queues the question with declared needs, returns the next one, and spends no budget', async () => {
  const sessionRes = await post(app, '/api/session', {
   mode: { minutes: 10, energy: 'low' },
  });
  expect(sessionRes.status).toBe(200);
  const { sessionId, question } = (await sessionRes.json()) as {
   sessionId: string;
   question: string;
  };

  // ── "when I have more energy" ──
  const energyRes = await post(app, `/api/session/${sessionId}/defer`, { need: 'energy' });
  expect(energyRes.status).toBe(200);
  const energyNext = (await energyRes.json()) as { kind: string; text?: string };
  expect(energyNext.kind).toBe('question');
  expect(energyNext.text).toBeTruthy();
  expect(energyNext.text).not.toBe(question);

  const energyEntry = queue.list().find((e) => e.question === question);
  expect(energyEntry).toBeDefined();
  expect(energyEntry!.source).toBe('user-declared');
  expect(energyEntry!.status).toBe('pending');
  expect(energyEntry!.sharpness).toBe('weak');
  // 'session' keeps it drawable and visible on the waiting surface; 'days' is never drawn
  expect(energyEntry!.horizon).toBe('session');
  // Declared low energy — the question waits for the next level up
  expect(energyEntry!.modeNeeds).toEqual({ energy: 'medium' });

  // ── "when I have more time" — next sitting length above 10 minutes ──
  const timeRes = await post(app, `/api/session/${sessionId}/defer`, { need: 'time' });
  expect(timeRes.status).toBe(200);
  const timeNext = (await timeRes.json()) as { kind: string; text?: string };
  expect(timeNext.kind).toBe('question');

  const timeEntry = queue.list().find((e) => e.question === energyNext.text);
  expect(timeEntry).toBeDefined();
  expect(timeEntry!.modeNeeds).toEqual({ minMinutes: 25 });

  // ── Deferred with no declared need — no Mode needs recorded ──
  const plainRes = await post(app, `/api/session/${sessionId}/defer`);
  expect(plainRes.status).toBe(200);
  const plainNext = (await plainRes.json()) as { kind: string; text?: string };
  expect(plainNext.kind).toBe('question');

  const plainEntry = queue.list().find((e) => e.question === timeNext.text);
  expect(plainEntry).toBeDefined();
  expect(plainEntry!.modeNeeds).toBeUndefined();

  // ── Budget: 10 minutes closes at the 8th question. Four more defers
  // (seven in all) would exhaust it if deferring counted — it must not. ──
  for (let i = 0; i < 4; i++) {
   const res = await post(app, `/api/session/${sessionId}/defer`);
   expect(res.status).toBe(200);
   expect(((await res.json()) as { kind: string }).kind).toBe('question');
  }
  expect(queue.list().filter((e: QueueEntry) => e.status === 'pending').length).toBe(7);

  const turnRes = await post(app, `/api/session/${sessionId}/turn`, { text: deferAnswer });
  expect(turnRes.status).toBe(200);
  const turn = (await turnRes.json()) as { kind: string; phase?: string };
  expect(turn.kind).toBe('probe');
  // Still open — the close sequence has not been triggered
  expect(turn.phase).toBe('open');
 });

 it('logs deferral distinctly from skip, with the declared need', async () => {
  const events = readEvents(vaultDir);
  const deferrals = events.filter((e) => e.kind === 'question-deferred');
  expect(deferrals.length).toBe(7);
  expect(deferrals[0]!.detail).toContain('needs=energy');
  expect(deferrals[1]!.detail).toContain('needs=time');
  expect(deferrals[2]!.detail).toContain('needs=none');
  expect(events.some((e) => (e.kind as string) === 'question-skipped')).toBe(false);
 });

 it('rejects a need it does not know', async () => {
  const sessionRes = await post(app, '/api/session', {
   mode: { minutes: 25, energy: 'medium' },
  });
  const { sessionId } = (await sessionRes.json()) as { sessionId: string };
  const res = await post(app, `/api/session/${sessionId}/defer`, { need: 'patience' });
  expect(res.status).toBe(400);
 });

 it('404s an unknown session', async () => {
  const res = await post(app, '/api/session/no-such-session/defer', {});
  expect(res.status).toBe(404);
 });
});

// ── The constrained harvest variant (ticket 078) ──
//
// The seam this pins: `deps.clerk.harvestComplete` exists so the harvest
// cuts ride the grammar-constrained completion while the wiki mint jobs
// keep the unconstrained clerk. An optional dep no caller passes ships
// inert — this test is the caller, proving propose() reaches the variant.

describe('harvest rides the constrained clerk variant (ticket 078)', () => {
 it('propose() uses harvestComplete when the deps carry one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'elicit-harvest-variant-'));
  try {
   const vault = createVault(dir);
   const roles: string[] = [];
   const harvestComplete = async () => {
    roles.push('harvest');
    return unpromptedScripted[0]!;
   };
   const clerkComplete = async () => {
    roles.push('clerk');
    return 'padding';
   };
   const complete = makeScriptedComplete(['padding a', 'padding b', 'padding c']);
   const queue = createQueueStore(dir);
   const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
   const authStore = createFileAuth(join(dir, '.auth.json'));
   const app = await createApp({
    vault,
    complete,
    clerk: { complete: clerkComplete, modelName: 'clerk-test', harvestComplete },
    queue,
    index,
    vaultRoot: dir,
    authStore,
   });

   const res = await post(app, '/api/unprompted', { text: entryText });
   expect(res.status).toBe(200);
   const body = (await res.json()) as { status: string; sessionId: string };
   expect(body.status).toBe('harvesting');
   // The proposal text comes from harvestComplete's scripted cuts — the
   // constrained variant answered the harvest, not the wiki clerk. The harvest
   // runs behind the response now, so the roles check waits for the record.
   const proposals = await waitForProposals((p) => get(app, p), body.sessionId);
   expect(roles).toContain('harvest');
   expect(proposals.length).toBe(1);
   expect(proposals[0]!.text).toBe(entryCut);
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
 });
});
