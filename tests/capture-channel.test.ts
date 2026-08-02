import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { decide } from '../src/harvester/harvester.js';
import type { CaptureChannel, CutProposal, Provenance } from '../src/types.js';

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

/**
 * A fresh app over a fresh temp vault with one scripted Complete list.
 * Per-test isolation: no two tests share a scripted consumption order.
 */
async function boot(scripted: string[]): Promise<{ app: Hono; vaultDir: string }> {
 const vaultDir = mkdtempSync(join(tmpdir(), 'elicit-capture-channel-'));
 const vault = createVault(vaultDir);
 const complete = makeScriptedComplete(scripted);
 const queue = createQueueStore(vaultDir);
 const index = buildIndex(Object.values(vault.rebuildIndex().snippets));
 const authStore = createFileAuth(join(vaultDir, '.auth.json'));
 const app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
 return { app, vaultDir };
}

/** The one scripted probe a turn needs — clean against every probe guard. */
const PROBE = 'Tell me more about that.';
const PROBE_TWO = 'What does that look like in practice?';

/** Padding: post-harvest docket composeOpener calls (may retry). */
const PADDING = Array.from({ length: 8 }, (_, i) => `padding ${i}`);

/** A session over an empty vault, in the repo's default mode. */
const MODE = { minutes: 10, energy: 'medium', target: 'self' } as const;

/**
 * One cut of a full turn — the shortest path from a turn to a saved snippet.
 * The model is only ever asked for sourceTurn 0; propose() corrects it to the
 * real ordinal, so every chunk says 0 and this test never does the arithmetic.
 */
function cutOf(text: string): string {
 return JSON.stringify({
  cuts: [
   {
    text,
    sourceTurn: 0,
    facet: 'value',
    stance: 'avowal',
    reading: 'States a value plainly',
    standalone: true,
   },
  ],
 });
}

/** Approve proposal 0 and return the harvest body. */
async function approveFirst(app: Hono, sessionId: string) {
 const harvestRes = await post(app, `/api/session/${sessionId}/harvest`, {
  decisions: [{ proposal: 0, action: 'approve' }],
 });
 expect(harvestRes.status).toBe(200);
 return (await harvestRes.json()) as {
  snippets: Array<{ id: string; provenance: Provenance }>;
  buds: unknown[];
 };
}

// ── The three capture paths, end to end (ticket 048) ──

describe('capture channel on the capture paths (ticket 048)', () => {
 it('keeps a pasted turn channel on approve, in the response and on disk', async () => {
  const turnText = 'I keep a notebook because writing is how I think.';
  const { app, vaultDir } = await boot(['{}', PROBE, cutOf(turnText), ...PADDING]);
  try {
   const sessionRes = await post(app, '/api/session', { mode: MODE });
   expect(sessionRes.status).toBe(200);
   const { sessionId } = (await sessionRes.json()) as { sessionId: string };

   const turnRes = await post(app, `/api/session/${sessionId}/turn`, {
    text: turnText,
    channel: 'pasted',
   });
   expect(turnRes.status).toBe(200);

   const endRes = await post(app, `/api/session/${sessionId}/end`);
   expect(endRes.status).toBe(200);
   await waitForProposals((p) => get(app, p), sessionId);

   const { snippets } = await approveFirst(app, sessionId);
   expect(snippets.length).toBe(1);
   expect(snippets[0]!.provenance.channel).toBe('pasted');

   const snippetFile = join(vaultDir, 'snippets', snippets[0]!.id, 'v1.md');
   expect(existsSync(snippetFile)).toBe(true);
   const saved = matter.read(snippetFile);
   expect(saved.data.provenance.channel).toBe('pasted');
   expect(readFileSync(snippetFile, 'utf-8')).toContain('channel: pasted');
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('rides the voice path when spoken is set', async () => {
  const turnText = 'Talking it through out loud helps me see what I actually think.';
  const { app, vaultDir } = await boot(['{}', PROBE, cutOf(turnText), ...PADDING]);
  try {
   const sessionRes = await post(app, '/api/session', { mode: MODE });
   const { sessionId } = (await sessionRes.json()) as { sessionId: string };

   const turnRes = await post(app, `/api/session/${sessionId}/turn`, {
    text: turnText,
    spoken: true,
    channel: 'spoken',
   });
   expect(turnRes.status).toBe(200);

   const endRes = await post(app, `/api/session/${sessionId}/end`);
   expect(endRes.status).toBe(200);
   await waitForProposals((p) => get(app, p), sessionId);

   const { snippets } = await approveFirst(app, sessionId);
   expect(snippets[0]!.provenance.channel).toBe('spoken');
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('keeps an absent channel absent, never typed', async () => {
  const turnText = 'I have been practicing saying no at work this month.';
  // A topic opener is formed from the topic and carries no questionSource —
  // a bank opener would put a questionSource.channel line into the YAML and
  // the raw-file check below would be testing the bank, not the capture path.
  const { app, vaultDir } = await boot(['{}', PROBE, cutOf(turnText), ...PADDING]);
  try {
   const sessionRes = await post(app, '/api/session', {
    mode: { ...MODE, topic: 'autonomy' },
   });
   expect(sessionRes.status).toBe(200);
   const { sessionId } = (await sessionRes.json()) as { sessionId: string };

   const turnRes = await post(app, `/api/session/${sessionId}/turn`, { text: turnText });
   expect(turnRes.status).toBe(200);

   const endRes = await post(app, `/api/session/${sessionId}/end`);
   expect(endRes.status).toBe(200);
   await waitForProposals((p) => get(app, p), sessionId);

   const { snippets } = await approveFirst(app, sessionId);
   expect(snippets[0]!.provenance.channel).toBeUndefined();
   expect('channel' in snippets[0]!.provenance).toBe(false);

   const snippetFile = join(vaultDir, 'snippets', snippets[0]!.id, 'v1.md');
   const saved = matter.read(snippetFile);
   expect(saved.data.provenance.channel).toBeUndefined();
   expect(readFileSync(snippetFile, 'utf-8')).not.toContain('channel');
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('lets a pasted restatement carry its own channel', async () => {
  const turnText = 'I keep a notebook because writing is how I think.';
  const restate = 'Rewritten in my own words.';
  const { app, vaultDir } = await boot(['{}', PROBE, cutOf(turnText), ...PADDING]);
  try {
   const sessionRes = await post(app, '/api/session', { mode: MODE });
   const { sessionId } = (await sessionRes.json()) as { sessionId: string };

   const turnRes = await post(app, `/api/session/${sessionId}/turn`, { text: turnText });
   expect(turnRes.status).toBe(200);

   const endRes = await post(app, `/api/session/${sessionId}/end`);
   expect(endRes.status).toBe(200);
   await waitForProposals((p) => get(app, p), sessionId);

   const harvestRes = await post(app, `/api/session/${sessionId}/harvest`, {
    decisions: [{ proposal: 0, action: 'restate', text: restate, channel: 'pasted' }],
   });
   expect(harvestRes.status).toBe(200);
   const { snippets } = (await harvestRes.json()) as {
    snippets: Array<{ id: string; provenance: Provenance }>;
   };
   expect(snippets.length).toBe(1);
   expect(snippets[0]!.provenance.kind).toBe('restatement');
   expect(snippets[0]!.provenance.channel).toBe('pasted');
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('keeps a restatement without a channel absent', async () => {
  const turnText = 'I have been practicing saying no at work this month.';
  const restate = 'Rewritten in my own words.';
  const { app, vaultDir } = await boot(['{}', PROBE, cutOf(turnText), ...PADDING]);
  try {
   const sessionRes = await post(app, '/api/session', {
    mode: { ...MODE, topic: 'autonomy' },
   });
   const { sessionId } = (await sessionRes.json()) as { sessionId: string };

   const turnRes = await post(app, `/api/session/${sessionId}/turn`, { text: turnText });
   expect(turnRes.status).toBe(200);

   const endRes = await post(app, `/api/session/${sessionId}/end`);
   expect(endRes.status).toBe(200);
   await waitForProposals((p) => get(app, p), sessionId);

   const harvestRes = await post(app, `/api/session/${sessionId}/harvest`, {
    decisions: [{ proposal: 0, action: 'restate', text: restate }],
   });
   expect(harvestRes.status).toBe(200);
   const { snippets } = (await harvestRes.json()) as {
    snippets: Array<{ id: string; provenance: Provenance }>;
   };
   expect('channel' in snippets[0]!.provenance).toBe(false);

   // On disk the round-trip stays clean too — no provenance-level channel.
   const snippetFile = join(vaultDir, 'snippets', snippets[0]!.id, 'v1.md');
   const saved = matter.read(snippetFile);
   expect(saved.data.provenance.channel).toBeUndefined();
   expect(readFileSync(snippetFile, 'utf-8')).not.toContain('channel');
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('keeps channels aligned to their turns across a multi-turn sitting', async () => {
  const turnA = 'I notice I make decisions faster when I trust my gut.';
  const turnB = 'My best work happens when I am not trying to impress anyone.';
  const { app, vaultDir } = await boot([
   '{}',
   PROBE,
   '{}',
   PROBE_TWO,
   cutOf(turnA),
   cutOf(turnB),
   ...PADDING,
  ]);
  try {
   const sessionRes = await post(app, '/api/session', { mode: MODE });
   const { sessionId } = (await sessionRes.json()) as { sessionId: string };

   const turnARes = await post(app, `/api/session/${sessionId}/turn`, {
    text: turnA,
    channel: 'pasted',
   });
   expect(turnARes.status).toBe(200);
   const turnBRes = await post(app, `/api/session/${sessionId}/turn`, {
    text: turnB,
    channel: 'spoken',
   });
   expect(turnBRes.status).toBe(200);

   const endRes = await post(app, `/api/session/${sessionId}/end`);
   expect(endRes.status).toBe(200);
   await waitForProposals((p) => get(app, p), sessionId);

   const harvestRes = await post(app, `/api/session/${sessionId}/harvest`, {
    decisions: [
     { proposal: 0, action: 'approve' },
     { proposal: 1, action: 'approve' },
    ],
   });
   expect(harvestRes.status).toBe(200);
   const { snippets } = (await harvestRes.json()) as {
    snippets: Array<{ id: string; provenance: Provenance }>;
   };
   expect(snippets.length).toBe(2);
   expect(snippets[0]!.provenance.channel).toBe('pasted');
   expect(snippets[1]!.provenance.channel).toBe('spoken');
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('carries the channel on an unprompted entry', async () => {
  const entryText = 'Reading other people writing well makes me want to write again.';
  // Unprompted: one propose call up front, then padding for the post-harvest docket.
  const { app, vaultDir } = await boot([cutOf(entryText), ...PADDING]);
  try {
   const entryRes = await post(app, '/api/unprompted', {
    text: entryText,
    channel: 'pasted',
   });
   expect(entryRes.status).toBe(200);
   const entry = (await entryRes.json()) as { status: string; sessionId: string };
   expect(entry.status).toBe('harvesting');
   const proposals = await waitForProposals((p) => get(app, p), entry.sessionId);
   expect(proposals.length).toBe(1);

   const { snippets } = await approveFirst(app, entry.sessionId);
   expect(snippets.length).toBe(1);
   expect(snippets[0]!.provenance.kind).toBe('unprompted');
   expect(snippets[0]!.provenance.channel).toBe('pasted');
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });

 it('rejects a channel it does not know', async () => {
  const turnText = 'I have been practicing saying no at work this month.';
  const { app, vaultDir } = await boot(['{}', PROBE, cutOf(turnText), ...PADDING]);
  try {
   // The harvest rejection first, over a real session with proposals, so the
   // 400 comes from the channel validation and not from a missing session.
   const goodRes = await post(app, '/api/session', { mode: MODE });
   const { sessionId: goodId } = (await goodRes.json()) as { sessionId: string };
   const turnRes = await post(app, `/api/session/${goodId}/turn`, { text: turnText });
   expect(turnRes.status).toBe(200);
   const endRes = await post(app, `/api/session/${goodId}/end`);
   expect(endRes.status).toBe(200);
   // The record must exist so the 400 comes from the channel validation.
   await waitForProposals((p) => get(app, p), goodId);
   const badHarvest = await post(app, `/api/session/${goodId}/harvest`, {
    decisions: [{ proposal: 0, action: 'restate', text: 'x', channel: 'nope' }],
   });
   expect(badHarvest.status).toBe(400);

   // The turn path rejects before the words are recorded.
   const sessRes = await post(app, '/api/session', { mode: MODE });
   const { sessionId } = (await sessRes.json()) as { sessionId: string };
   const badTurn = await post(app, `/api/session/${sessionId}/turn`, {
    text: turnText,
    channel: 'shouted',
   });
   expect(badTurn.status).toBe(400);

   // The unprompted path rejects the same way.
   const badEntry = await post(app, '/api/unprompted', { text: turnText, channel: 'loud' });
   expect(badEntry.status).toBe(400);
  } finally {
   rmSync(vaultDir, { recursive: true, force: true });
  }
 });
});

// ── decide, at the seam it owns (ticket 048) ──

describe('decide carries the capture channel (ticket 048)', () => {
 const proposal: CutProposal = {
  text: 'I value autonomy at work.',
  sourceTurn: 0,
  facet: 'value',
  stance: 'avowal',
  reading: 'r',
  question: 'q',
  questionForm: 'deliberative',
 };

 it('keeps the turn channel on approve and trim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elicit-channel-decide-'));
  try {
   const vault = createVault(dir);
   const spokenOf = (): CaptureChannel => 'spoken';
   const approve = decide(
    'sess-1',
    [proposal],
    [{ proposal: 0, action: 'approve' }],
    vault,
    undefined, // origin defaults to 'harvest'
    spokenOf,
   );
   expect(approve.snippets).toHaveLength(1);
   expect(approve.snippets[0]!.provenance.channel).toBe('spoken');
   const trim = decide(
    'sess-1',
    [proposal],
    [{ proposal: 0, action: 'trim', text: 'autonomy at work' }],
    vault,
    undefined, // origin defaults to 'harvest'
    spokenOf,
   );
   expect(trim.snippets).toHaveLength(1);
   expect(trim.snippets[0]!.provenance.channel).toBe('spoken');
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
 });

 it('stays absent when channelOf reports none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elicit-channel-decide-'));
  try {
   const vault = createVault(dir);
   const { snippets } = decide(
    'sess-1',
    [proposal],
    [{ proposal: 0, action: 'approve' }],
    vault,
    undefined, // origin defaults to 'harvest'
    () => undefined,
   );
   expect(snippets).toHaveLength(1);
   expect('channel' in snippets[0]!.provenance).toBe(false);
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
 });

 it('lets a restatement take its own channel, never the turn channel', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elicit-channel-decide-'));
  try {
   const vault = createVault(dir);
   const spokenOf = (): CaptureChannel => 'spoken';
   const pasted = decide(
    'sess-1',
    [proposal],
    [
     {
      proposal: 0,
      action: 'restate',
      text: 'Autonomy is my highest workplace value.',
      channel: 'pasted',
     },
    ],
    vault,
    undefined, // origin defaults to 'harvest'
    spokenOf,
   );
   expect(pasted.snippets).toHaveLength(1);
   expect(pasted.snippets[0]!.provenance.kind).toBe('restatement');
   expect(pasted.snippets[0]!.provenance.channel).toBe('pasted');
   const bare = decide(
    'sess-1',
    [proposal],
    [{ proposal: 0, action: 'restate', text: 'Autonomy is my highest workplace value.' }],
    vault,
    undefined, // origin defaults to 'harvest'
    spokenOf,
   );
   expect('channel' in bare.snippets[0]!.provenance).toBe(false);
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
 });
});
