import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import { readPendingHarvest } from '../src/harvester/pending.js';
import type { Complete } from '../src/types.js';

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

/** GET through the same loopback env, matching the post helper. */
async function get(app: Hono, path: string): Promise<Response> {
 return app.fetch(new Request(`http://127.0.0.1${path}`), {
  remoteAddr: '127.0.0.1',
 });
}

/**
 * Poll a predicate every 25ms until it answers, or throw after 5s. The
 * harvest runs behind the /unprompted response (ticket 084), so every
 * assertion about its outcome waits on the queue it writes.
 *
 * Real wall-clock polling is deliberate here: the background run is
 * scheduled by the server on setImmediate with no promise a test could
 * await, so fake timers would freeze the very work being waited on.
 */
async function poll<T>(fn: () => Promise<T | null>): Promise<T> {
 const deadline = Date.now() + 5000;
 for (; ;) {
  const value = await fn();
  if (value !== null) return value;
  if (Date.now() >= deadline) throw new Error('poll timed out after 5s');
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

// ── The harvest the tests drive ──

const entryText =
 'I keep circling back to the same worry about money. It is not the number, it is what the number stands in for.';
const entryCut = 'It is not the number, it is what the number stands in for.';

/**
 * Keyed responder: the harvest prompt gets the payload, every other caller
 * (boot docket, post-harvest docket) gets '' and degrades gracefully.
 * Same keying tests/log-format.test.ts uses, so scripted cuts cannot be
 * eaten by the docket calls that surround a harvest.
 */
function keyedComplete(payload: string): Complete {
 return async (system) => (system.includes('harvesting agent for Elicit') ? payload : '');
}

/** One valid cut as the harvest model would return it. */
function oneCutPayload(): string {
 return JSON.stringify({
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
 });
}

/** A full app over a vault dir, the way the other suite tests build one. */
async function makeApp(vaultDir: string, complete: Complete): Promise<Hono> {
 const vault = createVault(vaultDir);
 const queue = createQueueStore(vaultDir);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(vaultDir, '.auth.json'));
 return createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
}

// ── The review queue (ticket 084) ──

describe('harvest review queue', () => {
 it('survives a restart: the record lists, decides, and carries the capture channel', async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-harvest-queue-restart-'));
  try {
   // App A harvests one cut; its docket calls see '' and degrade.
   const appA = await makeApp(vaultDir, keyedComplete(oneCutPayload()));

   const entryRes = await post(appA, '/api/unprompted', {
    text: entryText,
    channel: 'pasted',
   });
   expect(entryRes.status).toBe(200);
   const entry = (await entryRes.json()) as { status: string; sessionId: string };
   expect(entry.status).toBe('harvesting');
   const sessionId = entry.sessionId;
   expect(sessionId).toBeTypeOf('string');

   // The harvest runs behind the response — wait for the record on disk.
   const record = await poll(async () => {
    const res = await get(appA, `/api/harvest-queue/${sessionId}`);
    if (res.status !== 200) return null;
    return (await res.json()) as { proposals: unknown[] };
   });
   expect(record.proposals).toHaveLength(1);

   // Simulate a restart: a fresh app over the same vault. Its live maps are
   // empty, so the disk record is the only thing left to decide from.
   const appB = await makeApp(vaultDir, async () => '');

   const listRes = await get(appB, '/api/harvest-queue');
   expect(listRes.status).toBe(200);
   const { pending } = (await listRes.json()) as {
    pending: Array<{ sessionId: string; proposalCount: number }>;
   };
   expect(pending).toHaveLength(1);
   expect(pending[0]!.sessionId).toBe(sessionId);
   expect(pending[0]!.proposalCount).toBe(1);

   const detailRes = await get(appB, `/api/harvest-queue/${sessionId}`);
   expect(detailRes.status).toBe(200);
   const detail = (await detailRes.json()) as { proposals: unknown[] };
   expect(detail.proposals).toHaveLength(1);

   // Decide on B. The record must supply the origin AND the capture channel
   // (ticket 048) — the live maps B never had.
   const harvestRes = await post(appB, `/api/session/${sessionId}/harvest`, {
    decisions: [{ proposal: 0, action: 'approve' }],
   });
   expect(harvestRes.status).toBe(200);
   const { snippets } = (await harvestRes.json()) as {
    snippets: Array<{ provenance: { kind: string; channel?: string } }>;
   };
   expect(snippets).toHaveLength(1);
   expect(snippets[0]!.provenance.kind).toBe('unprompted');
   expect(snippets[0]!.provenance.channel).toBe('pasted');

   // Deciding removed the record.
   const afterRes = await get(appB, '/api/harvest-queue');
   const after = (await afterRes.json()) as { pending: unknown[] };
   expect(after.pending).toHaveLength(0);
   expect(readPendingHarvest(vaultDir, sessionId)).toBeNull();
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('logs a failed harvest distinctly from an empty one (034 rule)', async () => {
  // (a) Every chunk failed: harvest-failed, no record, nothing to review.
  const failDir = mkdtempSync(join(tmpdir(), 'elicit-harvest-queue-fail-'));
  try {
   const failApp = await makeApp(failDir, keyedComplete('this is not json at all'));
   const failRes = await post(failApp, '/api/unprompted', { text: entryText });
   expect(failRes.status).toBe(200);

   // No record is written, so the failure verdict is the only signal.
   await poll(async () => {
    return readEvents(failDir).some((e) => e.kind === 'harvest-failed') ? true : null;
   });

   const failEvents = readEvents(failDir);
   const failed = failEvents.filter((e) => e.kind === 'harvest-failed');
   expect(failed).toHaveLength(1);
   expect(failEvents.some((e) => e.kind === 'harvest-started')).toBe(true);
   expect(failEvents.some((e) => e.kind === 'harvest-proposed')).toBe(false);

   const queueRes = await get(failApp, '/api/harvest-queue');
   const queue = (await queueRes.json()) as { pending: unknown[] };
   expect(queue.pending).toHaveLength(0);
  } finally {
   rmSync(failDir, { recursive: true, force: true });
  }

  // (b) Parsed fine, zero cuts: harvest-proposed with proposals=0, and the
  // record EXISTS — ran-and-found-nothing is reviewable, not did-not-run.
  const emptyDir = mkdtempSync(join(tmpdir(), 'elicit-harvest-queue-empty-'));
  try {
   const emptyApp = await makeApp(emptyDir, keyedComplete(JSON.stringify({ cuts: [] })));
   const emptyRes = await post(emptyApp, '/api/unprompted', { text: entryText });
   expect(emptyRes.status).toBe(200);
   const { sessionId } = (await emptyRes.json()) as { sessionId: string };

   const record = await poll(async () => {
    const res = await get(emptyApp, `/api/harvest-queue/${sessionId}`);
    if (res.status !== 200) return null;
    const r = (await res.json()) as { proposals: unknown[] };
    if (r.proposals.length !== 0) return null;
    // Wait for the announcement too, so the log reads settled below.
    return readEvents(emptyDir).some((e) => e.kind === 'harvest-proposed') ? r : null;
   });
   expect(record.proposals).toHaveLength(0);

   const emptyEvents = readEvents(emptyDir);
   const proposed = emptyEvents.filter((e) => e.kind === 'harvest-proposed');
   expect(proposed).toHaveLength(1);
   expect(proposed[0]!.detail).toContain('proposals=0');
   expect(emptyEvents.some((e) => e.kind === 'harvest-failed')).toBe(false);
   expect(readPendingHarvest(emptyDir, sessionId)).not.toBeNull();
  } finally {
   rmSync(emptyDir, { recursive: true, force: true });
  }
 });

 it('a decided harvest leaves the queue and the disk', async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-harvest-queue-decide-'));
  try {
   const app = await makeApp(vaultDir, keyedComplete(oneCutPayload()));
   const entryRes = await post(app, '/api/unprompted', { text: entryText });
   expect(entryRes.status).toBe(200);
   const { sessionId } = (await entryRes.json()) as { sessionId: string };

   await poll(async () => {
    const res = await get(app, `/api/harvest-queue/${sessionId}`);
    return res.status === 200 ? true : null;
   });

   const listRes = await get(app, '/api/harvest-queue');
   const { pending } = (await listRes.json()) as { pending: unknown[] };
   expect(pending).toHaveLength(1);

   const harvestRes = await post(app, `/api/session/${sessionId}/harvest`, {
    decisions: [{ proposal: 0, action: 'approve' }],
   });
   expect(harvestRes.status).toBe(200);

   const afterRes = await get(app, '/api/harvest-queue');
   const after = (await afterRes.json()) as { pending: unknown[] };
   expect(after.pending).toHaveLength(0);

   const pendingDir = join(vaultDir, 'harvest', 'pending');
   expect(readdirSync(pendingDir)).toHaveLength(0);
   expect(readPendingHarvest(vaultDir, sessionId)).toBeNull();
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });
});
