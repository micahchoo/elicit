/**
 * Ticket 151: the five routes the working tree called and the server never
 * registered — POST /api/queue/:id/answer|park|unpark and
 * POST /api/jobs/stop|resume. Each route is the QueueStore verb plus its
 * activity-log event (Q-23: every actor speaks through the log); the answer
 * route also makes the answer harvestable, because the surface promises
 * "its harvest will reach your inbox for review".
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import { listPendingHarvests } from '../src/harvester/pending.js';
import type { QueueDraft, QueueStore } from '../src/types.js';

type TestApp = {
 app: Hono;
 root: string;
 queue: QueueStore;
};

const roots: string[] = [];
afterAll(() => {
 for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** The app plus a scripted clerk. The empty vault boots a docket that
 * makes no model calls (no snippets → no minting), so an empty script is
 * safe; the answer route's background harvest consumes the responses. */
async function makeApp(script: string[] = []): Promise<TestApp> {
 const root = mkdtempSync(join(tmpdir(), 'elicit-queue-routes-'));
 roots.push(root);
 const vault = createVault(root);
 const complete = makeScriptedComplete(script);
 const queue = createQueueStore(join(root, 'queue'));
 const index = buildIndex([]);
 const authStore = createFileAuth(join(root, '.auth.json'));
 const app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore });
 return { app, root, queue };
}

function makeDraft(overrides?: Partial<QueueDraft>): QueueDraft {
 return {
  source: 'composed',
  license: 'test-license',
  question: 'What do you think about X?',
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'now',
  ...overrides,
 };
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
 // The env carries remoteAddr so the /api loopback gate passes, exactly as
 // the sounding-routes harness does.
 return await app.fetch(new Request(`http://localhost${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
 }), { remoteAddr: '127.0.0.1' });
}

function eventsOf(root: string, kind: string) {
 return readEvents(root).filter((e) => e.kind === kind);
}

function tick(ms: number): Promise<void> {
 // The executor form is required: this project's TS lib target predates
 // Promise.withResolvers (es2024). Same shape as the piece-routes harness.
 return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Poll until `fn` returns a value; the background harvest runs on
 * setImmediate after the route responds, so the pending record lands a
 * few ticks later. */
async function until<T>(fn: () => T | null | undefined, timeoutMs = 3000): Promise<T> {
 const start = Date.now();
 for (;;) {
  const v = fn();
  if (v) return v;
  if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
  await tick(20);
 }
}

/** Let the boot docket finish — the run-started / docket-run pair is the
 * signal, never a fixed sleep. */
async function settleBootDocket(root: string): Promise<void> {
 await until(() => (eventsOf(root, 'docket-run').length > 0 ? true : null));
}

const ANSWER =
 'The work pulls at me even when I resist it, and I keep noticing it at my desk.';

/** A scripted harvest cut: the text is a verbatim substring of ANSWER, the
 * shape matches the constrained JSON schema the harvester parses. */
const HARVEST_CUTS = JSON.stringify({
 cuts: [
  {
   text: 'The work pulls at me even when I resist it',
   sourceTurn: 0,
   facet: 'construct',
   stance: 'avowal',
   reading: 'The person names a recurring pull toward their work.',
   standalone: true,
  },
 ],
});

describe('queue mutation routes (ticket 151)', () => {
 it('answer marks the entry answered, writes the transcript, and logs the act', async () => {
  const { app, root, queue } = await makeApp();
  const entry = queue.add(makeDraft());
  const res = await post(app, `/api/queue/${entry.id}/answer`, { text: ANSWER, channel: 'typed' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });

  const updated = queue.list().find((e) => e.id === entry.id)!;
  expect(updated.status).toBe('answered');
  expect(updated.answeredAt).toBeTypeOf('string');

  // The answer is its own one-turn sitting: the transcript exists on disk.
  const transcripts = readdirSync(join(root, 'transcripts'));
  expect(transcripts).toHaveLength(1);

  const ev = eventsOf(root, 'question-answered-direct');
  expect(ev).toHaveLength(1);
  expect(ev[0]!.detail).toMatch(/^session=\S+ chars=\d+$/);
 });

 it('the answer reaches the pending harvest queue for review', async () => {
  const { app, root, queue } = await makeApp([HARVEST_CUTS]);
  const entry = queue.add(makeDraft({ question: 'What pulls at you these days?' }));
  const res = await post(app, `/api/queue/${entry.id}/answer`, { text: ANSWER });
  expect(res.status).toBe(200);

  const pending = await until(() => {
   const list = listPendingHarvests(root);
   return list.length > 0 ? list[0] : null;
  });
  expect(pending.origin).toBe('harvest');
  expect(pending.protocol).toBe('queue-answer');
  expect(pending.proposals).toHaveLength(1);
  expect(pending.proposals[0]!.text).toBe('The work pulls at me even when I resist it');
  // The queue question rode as the eliciting probe — lineage, not lost.
  expect(pending.proposals[0]!.question).toBe('What pulls at you these days?');
 });

 it('answer rejects empty text without touching the entry', async () => {
  const { app, queue } = await makeApp();
  const entry = queue.add(makeDraft());
  const res = await post(app, `/api/queue/${entry.id}/answer`, { text: '   ' });
  expect(res.status).toBe(400);
  expect(queue.list().find((e) => e.id === entry.id)!.status).toBe('pending');
 });

 it('answer 404s on an unknown id', async () => {
  const { app } = await makeApp();
  const res = await post(app, '/api/queue/does-not-exist/answer', { text: 'x' });
  expect(res.status).toBe(404);
 });

 it('park moves a pending entry to parked and logs the act', async () => {
  const { app, root, queue } = await makeApp();
  const entry = queue.add(makeDraft());
  const res = await post(app, `/api/queue/${entry.id}/park`, {});
  expect(res.status).toBe(200);
  expect(queue.list().find((e) => e.id === entry.id)!.status).toBe('parked');
  expect(eventsOf(root, 'question-parked')).toHaveLength(1);
 });

 it('unpark moves a parked entry back to pending with a refreshed created stamp', async () => {
  const { app, root, queue } = await makeApp();
  const entry = queue.add(makeDraft());
  queue.park(entry.id);
  const parkedCreated = queue.list().find((e) => e.id === entry.id)!.created;
  const res = await post(app, `/api/queue/${entry.id}/unpark`, {});
  expect(res.status).toBe(200);
  const back = queue.list().find((e) => e.id === entry.id)!;
  expect(back.status).toBe('pending');
  // The store refreshes `created` to now; same-ms ISO stamps compare equal.
  expect(back.created >= parkedCreated).toBe(true);
  expect(eventsOf(root, 'question-unparked')).toHaveLength(1);
 });

 it('park 404s on an unknown id', async () => {
  const { app } = await makeApp();
  const res = await post(app, '/api/queue/does-not-exist/park', {});
  expect(res.status).toBe(404);
 });
});

describe('the jobs switch (ticket 151)', () => {
 it('stop returns the client contract and logs it; resume clears it', async () => {
  const { app, root } = await makeApp();
  await settleBootDocket(root);

  const stop = await post(app, '/api/jobs/stop', {});
  expect(stop.status).toBe(200);
  const body = (await stop.json()) as { ok: boolean; inFlight: boolean };
  expect(body.ok).toBe(true);
  // The boot run may or may not have cleared docketRunning yet; the wire
  // contract only promises the boolean, never its value.
  expect(typeof body.inFlight).toBe('boolean');

  const stopped = eventsOf(root, 'jobs-stopped');
  expect(stopped).toHaveLength(1);
  expect(stopped[0]!.detail).toMatch(/^inFlight=(true|false)$/);

  const resume = await post(app, '/api/jobs/resume', {});
  expect(resume.status).toBe(200);
  expect(await resume.json()).toEqual({ ok: true });
  expect(eventsOf(root, 'jobs-resumed')).toHaveLength(1);
 });

 it('resume schedules a drain — a run starts on its own once the switch is cleared', async () => {
  vi.stubEnv('ELICIT_DOCKET_DRAIN_DELAY_MS', '5');
  try {
   const { app, root } = await makeApp();
   await settleBootDocket(root);
   const startedBefore = eventsOf(root, 'run-started').length;

   await post(app, '/api/jobs/stop', {});
   // Ticket 156: resume clears the switch AND schedules the drain, so a
   // stopped-and-lagging server starts catching up without a second
   // trigger. The observable proof is a run-started event that appears on
   // its own — the 5ms drain fires startDocket('drain'), whose run emits
   // run-started before it settles.
   await post(app, '/api/jobs/resume', {});

   await until(() => (eventsOf(root, 'run-started').length > startedBefore ? true : null));
  } finally {
   vi.unstubAllEnvs();
  }
 });

 it('while stopped, a docket trigger starts no run', async () => {
  const { app, root } = await makeApp();
  await settleBootDocket(root);
  const startedBefore = eventsOf(root, 'run-started').length;

  await post(app, '/api/jobs/stop', {});
  // The import trigger calls startDocket unconditionally, even for an
  // empty folder — the exact path a stopped server must refuse.
  const folder = mkdtempSync(join(tmpdir(), 'elicit-queue-routes-empty-'));
  roots.push(folder);
  const scan = await post(app, '/api/import/scan', { folder });
  expect(scan.status).toBe(200);
  // Absence assertion: nothing to await, so a short window is the only
  // honest check — a stopped server must not start a run in it. The window
  // is the drain delay (2s) minus margin, so a gated run cannot hide.
  await tick(150);

  expect(eventsOf(root, 'run-started').length).toBe(startedBefore);
  expect(eventsOf(root, 'docket-cut-short')).toHaveLength(0);

  await post(app, '/api/jobs/resume', {});
 });
});
