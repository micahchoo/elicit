import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readPendingHarvest } from '../src/harvester/pending.js';
import { detectRepeats, REPEAT_JACCARD_THRESHOLD } from '../src/harvester/dedupe.js';
import { repeatSentence } from '../web/deps.js';
import type { Complete, CutProposal, Provenance } from '../src/types.js';

// ── Helpers (the harvest-queue suite's pattern) ──

async function post(app: Hono, path: string, body?: unknown): Promise<Response> {
 const init: RequestInit = { method: 'POST' };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 }
 return app.fetch(new Request(`http://127.0.0.1${path}`, init), { remoteAddr: '127.0.0.1' });
}

async function get(app: Hono, path: string): Promise<Response> {
 return app.fetch(new Request(`http://127.0.0.1${path}`), { remoteAddr: '127.0.0.1' });
}

async function poll<T>(fn: () => Promise<T | null>): Promise<T> {
 const deadline = Date.now() + 5000;
 for (;;) {
  const value = await fn();
  if (value !== null) return value;
  if (Date.now() >= deadline) throw new Error('poll timed out after 5s');
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

/** The older passage the harvest will repeat, and its near-duplicate twin. */
const OLDER = 'I keep circling back to the same worry about money. It is not the number, it is what the number stands in for.';
/** Near, not byte-identical: one added word ('really'), so the word-set
 * Jaccard sits at 0.875 — above the 0.85 threshold, and untouched by the
 * old exact-body path. */
const NEAR_DUP = 'I keep circling back to the same worry about money. It is not the number, it is what the number stands for, really.';
/** A genuinely fresh passage — shares no content words with OLDER. */
const FRESH = 'The garden needs water before the heat of the afternoon settles over the beds.';

/** A fixed capture date for the seeded older snippet (a Tuesday, UTC). */
const OLDER_CAPTURED = '2026-08-04T10:00:00.000Z';

function keyedComplete(payload: string): Complete {
 return async (system) => (system.includes('harvesting agent for Elicit') ? payload : '');
}

function cutPayload(text: string): string {
 return JSON.stringify({
  cuts: [
   {
    text,
    sourceTurn: 0,
    facet: 'construct',
    stance: 'self-observation',
    reading: 'Money is a stand-in for something else',
    standalone: true,
   },
  ],
 });
}

async function makeApp(vaultDir: string, complete: Complete): Promise<Hono> {
 const vault = createVault(vaultDir);
 const queue = createQueueStore(vaultDir);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(vaultDir, '.auth.json'));
 return createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
}

/**
 * Seed the corpus with an older snippet whose capture date the test
 * controls: write the snippet's v1.md directly, the way the vault reads
 * it back (id/version/captured/provenance frontmatter + prose body).
 */
function seedSnippet(vaultDir: string, text: string, captured: string): string {
 const id = `seed-${Math.random().toString(36).slice(2, 10)}`;
 const dir = join(vaultDir, 'snippets', id);
 mkdirSync(dir, { recursive: true });
 const provenance: Provenance = {
  kind: 'harvest',
  session: 'older-session',
  question: 'What worries you about money?',
  questionForm: 'deliberative',
 };
 const fm = { id, version: 1, captured, provenance };
 const content =
  '---\n' +
  `id: ${id}\n` +
  'version: 1\n' +
  `captured: ${captured}\n` +
  'provenance:\n' +
  '  kind: harvest\n' +
  '  session: older-session\n' +
  '  question: What worries you about money?\n' +
  '  questionForm: deliberative\n' +
  '---\n' +
  text +
  '\n';
 writeFileSync(join(dir, 'v1.md'), content, 'utf-8');
 return id;
}

/** Run one unprompted harvest and wait for its pending record. */
async function harvestOnce(
 app: Hono,
 text: string,
 complete: Complete,
): Promise<{ sessionId: string; record: { proposals: unknown[]; repeats?: unknown[] } }> {
 const res = await post(app, '/api/unprompted', { text });
 expect(res.status).toBe(200);
 const { sessionId } = (await res.json()) as { sessionId: string };
 const record = await poll(async () => {
  const r = await get(app, `/api/harvest-queue/${sessionId}`);
  if (r.status !== 200) return null;
  return (await r.json()) as { proposals: unknown[]; repeats?: unknown[] };
 });
 return { sessionId, record };
}

// ── The detection seam (pure) ──

describe('detectRepeats — the intake dedupe seam (§12.1)', () => {
 const proposal = (text: string): CutProposal => ({
  text,
  sourceTurn: 0,
  facet: 'value',
  stance: 'avowal',
  reading: 'r',
  question: 'q',
  questionForm: 'deliberative',
 });

 it('flags a near-duplicate proposal with the older snippet id and capture date', () => {
  const index = {
   snippets: {
    'old-1': { id: 'old-1', version: 1, captured: OLDER_CAPTURED, prose: OLDER, provenance: {} as Provenance },
   },
   readings: {},
   buds: {},
  };
  const flags = detectRepeats([proposal(NEAR_DUP), proposal(FRESH)], index);
  expect(flags).toEqual([{ proposal: 0, olderSnippetId: 'old-1', olderCaptured: OLDER_CAPTURED }]);
 });

 it('leaves a fresh passage unflagged', () => {
  const index = {
   snippets: {
    'old-1': { id: 'old-1', version: 1, captured: OLDER_CAPTURED, prose: OLDER, provenance: {} as Provenance },
   },
   readings: {},
   buds: {},
  };
  expect(detectRepeats([proposal(FRESH)], index)).toEqual([]);
 });

 it('keeps the threshold named and high (0.85 — a repeat, not a theme)', () => {
  expect(REPEAT_JACCARD_THRESHOLD()).toBe(0.85);
 });
});

// ── The intake path, end to end ──

describe('intake dedupe — the flag rides the pending record (§12.1)', () => {
 it('a near-duplicate at intake lands the flag with the older passage date, and keep-both keeps both', async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-intake-dedupe-'));
  try {
   const seedId = seedSnippet(vaultDir, OLDER, OLDER_CAPTURED);
   const app = await makeApp(vaultDir, keyedComplete(cutPayload(NEAR_DUP)));

   const { sessionId, record } = await harvestOnce(app, NEAR_DUP, keyedComplete(cutPayload(NEAR_DUP)));
   expect(record.proposals).toHaveLength(1);
   // The flag rides the record, written at intake: which proposal repeats
   // which older snippet, and when the older passage was captured.
   expect(record.repeats).toEqual([{ proposal: 0, olderSnippetId: seedId, olderCaptured: OLDER_CAPTURED }]);

   // The on-disk record carries it too (the wire is a projection).
   const disk = readPendingHarvest(vaultDir, sessionId);
   expect(disk!.repeats).toEqual([{ proposal: 0, olderSnippetId: seedId, olderCaptured: OLDER_CAPTURED }]);

   // The list projection exposes the count for the review row.
   const listRes = await get(app, '/api/harvest-queue');
   const { pending } = (await listRes.json()) as {
    pending: Array<{ sessionId: string; repeatsCount: number }>;
   };
   expect(pending).toHaveLength(1);
   expect(pending[0]!.repeatsCount).toBe(1);

   // Decide: keep-both is the outcome — the new passage is kept (the old
   // silent exact-drop is gone), and the receipt response carries the
   // sentence for the kept passage, dated by the OLDER capture.
   const harvestRes = await post(app, `/api/session/${sessionId}/harvest`, {
    decisions: [{ proposal: 0, action: 'approve' }],
   });
   expect(harvestRes.status).toBe(200);
   const body = (await harvestRes.json()) as {
    snippets: Array<{ prose: string; repeats?: { olderSnippetId: string; olderCaptured: string } }>;
   };
   expect(body.snippets).toHaveLength(1);
   expect(body.snippets[0]!.prose).toBe(NEAR_DUP);
   expect(body.snippets[0]!.repeats).toEqual({ olderSnippetId: seedId, olderCaptured: OLDER_CAPTURED });

   // Nothing was dropped or merged: the older snippet is still there.
   const index = createVault(vaultDir).rebuildIndex();
   expect(Object.values(index.snippets)).toHaveLength(2);
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('a fresh passage lands no flag and no sentence', async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-intake-fresh-'));
  try {
   seedSnippet(vaultDir, OLDER, OLDER_CAPTURED);
   const app = await makeApp(vaultDir, keyedComplete(cutPayload(FRESH)));

   const { record } = await harvestOnce(app, FRESH, keyedComplete(cutPayload(FRESH)));
   expect(record.repeats).toBeUndefined();

   const detailRes = await get(app, '/api/harvest-queue');
   const { pending } = (await detailRes.json()) as { pending: Array<{ repeatsCount: number }> };
   expect(pending[0]!.repeatsCount).toBe(0);

   // The decide response carries no repeat sentence.
   const list = await get(app, '/api/harvest-queue');
   const { pending: p2 } = (await list.json()) as { pending: Array<{ sessionId: string }> };
   const harvestRes = await post(app, `/api/session/${p2[0]!.sessionId}/harvest`, {
    decisions: [{ proposal: 0, action: 'approve' }],
   });
   const body = (await harvestRes.json()) as { snippets: Array<{ prose: string; repeats?: unknown }> };
   expect(body.snippets[0]!.prose).toBe(FRESH);
   expect(body.snippets[0]!.repeats).toBeUndefined();
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('the flagged record survives a restart', async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-intake-restart-'));
  try {
   seedSnippet(vaultDir, OLDER, OLDER_CAPTURED);
   const appA = await makeApp(vaultDir, keyedComplete(cutPayload(NEAR_DUP)));
   const { sessionId } = await harvestOnce(appA, NEAR_DUP, keyedComplete(cutPayload(NEAR_DUP)));

   // A fresh app over the same vault: the live maps are gone, the disk
   // record is all that is left — and it still carries the flag.
   const appB = await makeApp(vaultDir, async () => '');
   const listRes = await get(appB, '/api/harvest-queue');
   const { pending } = (await listRes.json()) as {
    pending: Array<{ sessionId: string; repeatsCount: number }>;
   };
   expect(pending).toHaveLength(1);
   expect(pending[0]!.sessionId).toBe(sessionId);
   expect(pending[0]!.repeatsCount).toBe(1);

   const detailRes = await get(appB, `/api/harvest-queue/${sessionId}`);
   const detail = (await detailRes.json()) as { repeats?: unknown[] };
   expect(detail.repeats).toEqual([{ proposal: 0, olderSnippetId: expect.any(String), olderCaptured: OLDER_CAPTURED }]);
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });
});

// ── The sentence copy, pinned ──

describe('repeatSentence — the ONE dedupe copy (§12.1)', () => {
 it('names the day the older passage was captured', () => {
  // 2026-08-04 is a Tuesday (UTC); the sentence's day is the older
  // passage's day, per the user ruling. The day name is derived the same
  // way production derives it (the process's own locale), so the copy is
  // pinned without tying the test to a timezone.
  const captured = '2026-08-04T10:00:00.000Z';
  const day = new Date(captured).toLocaleDateString(undefined, { weekday: 'long' });
  expect(day).toBe('Tuesday');
  expect(repeatSentence(captured)).toBe(`this repeats what you said ${day} \u2014 keep both?`);
 });

 it('degrades to the plain date, never a blank sentence, when the timestamp is unparseable', () => {
  expect(repeatSentence('not-a-date')).toBe('this repeats what you said not-a-date \u2014 keep both?');
 });
});
