import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
import { readLadder } from '../src/sounding/park.js';
import type { ParkedLadder, QueueStore } from '../src/types.js';

type TestApp = {
 app: Hono;
 root: string;
 queue: QueueStore;
};

/**
 * One thread of shared vocabulary, so the license's sustained check (mean
 * adjacent Jaccard over the last three turns, >= 0.15) fires at the ninth
 * turn. Every text is >= 8 words (so the content-free pivot never fires),
 * and each contains its red-light phrase verbatim, in the same case.
 */
const THREAD = [
 'I keep noticing the pull toward the work even when I resist it.',
 'What I keep wanting is being seen in the work, and the pull agrees.',
 'Somehow the work and the pull both circle around being seen.',
 'When the pull arrives, I notice being seen in the work more clearly.',
 'I value being seen more than the pull being easy.',
 'I find the work asks me to follow the pull even when being seen stretches me.',
 'I notice the pull is quieter now, but being seen in the work keeps me honest.',
 'What I keep coming back to is being seen in the work.',
 'I suspect the work would be nothing without the pull of being seen honestly.',
] as const;

/** The red-light phrase the nth pre-offer turn is scripted to flag. */
const THREAD_PHRASES = ['the pull', 'being seen', 'the work'] as const;

/** A follow-up question in the one shape every composed question takes (040). */
function followUp(phrase: string, tail: string): string {
 return `You wrote: "${phrase}." ${tail}`;
}

/**
 * The pre-offer turns' scripted questions. Pairwise word-set Jaccard stays
 * under the near-duplicate guard's 0.5 bar (checked across all 17 fixtures),
 * and each quotes its phrase verbatim inside quotation marks.
 */
const PRE_TAILS = [
 'When did you first notice the pull in your days?',
 'What does being seen make possible for you?',
 'How does the work choose what needs doing?',
 'What would it take to follow the pull this week?',
 'Who sees the work when you are in it?',
 'What part of the work asks the most of you?',
 'Where does the pull leave you at the end of a week?',
 'How much of yourself shows up when you write?',
 'What keeps you coming back to the work at all?',
] as const;

/** The descent's answers, each >= 8 words and holding its scripted phrase. */
const RUNG_ANSWERS = [
 'For the first time today I let the pull carry the whole sitting forward.',
 'It took me a while to admit that being seen changes how the room feels.',
 'I left the work on the desk overnight and found it waiting this morning.',
 'Each day the pull returns with the coffee and stays past the last line.',
 'What I resist about being seen is the part that wants to stay hidden.',
 'Until I name it, the work keeps circling the same unfinished paragraph.',
 'Late in the afternoon the pull asks again what I am avoiding in the page.',
 'I can hear the work and the pull arguing about being seen in the margins.',
 'The margins hold the work where neither voice could settle before the morning came back.',
 'I brought the pull to the window and let the light name it for the first time.',
 'being seen by the work taught me something the room could not hold on its own.',
 'The work and the pull, finally quiet together on the same page this morning.',
] as const;

/**
 * The rung questions, indexed by the rung they ask (0 = rung 0, composed from
 * the licensing answer). The answers above never share a trigram, so the echo
 * check in descentEnd cannot mistake them for convergence.
 */
const RUNG_TAILS = [
 'What would the work be without the pull of being seen?',
 'What does the pull ask of you right now?',
 'Where does being seen lead when you follow it?',
 'When did the work last ask you to sit down and name it?',
 'How does the pull sit with the work so far?',
 'What would change if nobody watched the page?',
 'What would you notice next if you stayed with the page?',
 'What keeps the pull present in your afternoons?',
 'What stays with being seen when the arguing rests?',
 'What did the light name when you brought the pull to the window?',
 'What happens when the room cannot hold what being seen taught you?',
 'What changes now that the work and the pull lie quiet on the same page?',
] as const;

/** The red-light phrase the rung k question quotes (RUNG_ANSWERS[k-1] holds it). */
const RUNG_PHRASES = ['the work', 'the pull', 'being seen', 'the work', 'the pull', 'being seen', 'the work', 'the pull', 'being seen', 'the work', 'the pull', 'being seen'] as const;

function aRichAnswer(i: number): string {
 return RUNG_ANSWERS[i - 1]!;
}

/** The scripted complete pair for one composed turn: red-light JSON, then the question. */
function turnScript(phrase: string, question: string): string[] {
 return [
  JSON.stringify({ lights: [{ kind: 'abstraction-no-episode', phrase }] }),
  question,
 ];
}

/**
 * The whole script a session that reaches the cap consumes, in call order:
 * six pre-offer turns, the accept route's rung-0 composition, turns 1-5,
 * the gate continue past the checkpoint, turns 7-11. The checkpoint turn and
 * the cap turn compose nothing. (Allowance 12, checkpoint 6 — re-derived 2026-08-05 gate-repair.)
 */
function capScript(): string[] {
 const out: string[] = [];
 for (let i = 0; i < 6; i++) {
  out.push(...turnScript(THREAD_PHRASES[i % 3]!, followUp(THREAD_PHRASES[i % 3]!, PRE_TAILS[i]!)));
 }
 out.push(...turnScript(RUNG_PHRASES[0]!, followUp(RUNG_PHRASES[0]!, RUNG_TAILS[0]!)));
 for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
  out.push(...turnScript(RUNG_PHRASES[k]!, followUp(RUNG_PHRASES[k]!, RUNG_TAILS[k]!)));
 }
 return out;
}

/** The ladder file for a session, wherever it sits in {root}/soundings/. */
function readLadderForSession(root: string, sessionId: string): ParkedLadder | null {
 const dir = join(root, 'soundings');
 if (!existsSync(dir)) return null;
 for (const file of readdirSync(dir)) {
  if (!file.endsWith('.md')) continue;
  const data = matter(readFileSync(join(dir, file), 'utf-8')).data as Record<string, unknown>;
  if (data.session === sessionId) return data as unknown as ParkedLadder;
 }
 return null;
}

describe('sounding routes', () => {
 const roots: string[] = [];

 afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
 });

 async function makeApp(script: string[]): Promise<TestApp> {
  const root = mkdtempSync(join(tmpdir(), 'elicit-sounding-'));
  roots.push(root);
  const vault = createVault(root);
  const complete = makeScriptedComplete(script);
  const queue = createQueueStore(root);
  const index = buildIndex([]);
  const authStore = createFileAuth(join(root, '.auth.json'));
  const app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore });
  return { app, root, queue };
 }

 async function post(app: Hono, path: string, body?: unknown): Promise<any> {
  const init: RequestInit =
   body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
  return res.json();
 }

 async function postRaw(app: Hono, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit =
   body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  return app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
 }

 async function newSession(app: Hono, minutes = 20): Promise<string> {
  const res = await post(app, '/api/session', { mode: { minutes, energy: 'medium' } });
  expect(res.sessionId).toBeTruthy();
  return res.sessionId;
 }

 /** Drive turns until the response carries the offer; returns that response. */
 async function turnUntilLicensed(app: Hono, sessionId: string): Promise<any> {
  for (let i = 0; i < 12; i++) {
   const res = await post(app, `/api/session/${sessionId}/turn`, { text: THREAD[i % THREAD.length]! });
   if (res.soundingOffer) return res;
  }
  throw new Error('the offer never arrived');
 }

 /** Accept, answer every rung (continue at the checkpoint), until the cap closes. */
 async function answerUntilCap(app: Hono, sessionId: string): Promise<any> {
  await turnUntilLicensed(app, sessionId);
  await post(app, `/api/session/${sessionId}/sounding`, { accept: true });
  for (let i = 1; i <= 12; i++) {
   const res = await post(app, `/api/session/${sessionId}/turn`, { text: aRichAnswer(i) });
   if (res.descentClosed) return res;
   if (i === 6) {
    const gate = await post(app, `/api/session/${sessionId}/sounding/gate`, { choice: 'continue' });
    expect(gate.kind).toBe('probe');
   }
  }
  throw new Error('the cap never closed the descent');
 }

 it('the offer appears once and states its length', async () => {
  const { app, root } = await makeApp([...capScript(), ...turnScript('the pull', followUp('the pull', 'What does the pull ask of you right now?'))]);
  const id = await newSession(app);
  const res = await turnUntilLicensed(app, id);
  expect(res.soundingOffer).toBeDefined();
  expect(res.soundingOffer.sentence).toContain(String(res.soundingOffer.allowance));
  // The offer is at most once: later turns never carry it again.
  for (let i = 0; i < 2; i++) {
   const later = await post(app, `/api/session/${id}/turn`, { text: THREAD[i]! });
   expect(later.soundingOffer).toBeUndefined();
  }
 });

 it('a decline is recorded and never offered again in the sitting', async () => {
  const script = capScript();
  for (let i = 0; i < 4; i++) {
   script.push(...turnScript(THREAD_PHRASES[i % 3]!, followUp(THREAD_PHRASES[i % 3]!, PRE_TAILS[i]!)));
  }
  const { app } = await makeApp(script);
  const id = await newSession(app);
  await turnUntilLicensed(app, id);
  const declined = await post(app, `/api/session/${id}/sounding`, { accept: false });
  expect(declined).toEqual({ kind: 'declined' });
  for (let i = 0; i < 4; i++) {
   const res = await post(app, `/api/session/${id}/turn`, { text: THREAD[i]! });
   expect(res.soundingOffer).toBeUndefined();
  }
 });

 it('rung 0 quotes the answer that licensed the descent', async () => {
  const { app, root } = await makeApp(capScript().slice(0, 22));
  const id = await newSession(app);
  await turnUntilLicensed(app, id);
  const accepted = await post(app, `/api/session/${id}/sounding`, { accept: true });
  expect(accepted.kind).toBe('probe');
  expect(accepted.sounding).toEqual({ rung: 0, of: expect.any(Number), checkpoint: false });
  // Answer rung 0, then park so the ladder is written to disk.
  await post(app, `/api/session/${id}/turn`, { text: aRichAnswer(1) });
  const closed = await post(app, `/api/session/${id}/sounding/gate`, { choice: 'park' });
  expect(closed.kind).toBe('descent-closed');
  const ladder = readLadderForSession(root, id);
  expect(ladder).not.toBeNull();
  // The on-disk ladder is the truth: the answer that licensed the descent
  // holds the foothold rung 0 was built from, verbatim.
  expect(ladder!.licensingAnswer).toBe(THREAD[5]);
  expect(ladder!.licensingAnswer).toContain(ladder!.rungs[0]!.foothold);
  expect(ladder!.rungs[0]!.question).toContain(ladder!.rungs[0]!.foothold);
 });

 it('every ordinary rung carries the gate and the next question together', async () => {
  const { app } = await makeApp(capScript().slice(0, 26));
  const id = await newSession(app);
  await turnUntilLicensed(app, id);
  await post(app, `/api/session/${id}/sounding`, { accept: true });
  for (let i = 1; i <= 3; i++) {
   const res = await post(app, `/api/session/${id}/turn`, { text: aRichAnswer(i) });
   expect(res.kind).toBe('probe');
   expect(res.sounding).toEqual({ rung: i, of: expect.any(Number), checkpoint: false });
   expect(res.text).toBeTruthy();
  }
 });

 it('the checkpoint rung returns no question until a gate word arrives', async () => {
  const { app } = await makeApp(capScript().slice(0, 30));
  const id = await newSession(app);
  await turnUntilLicensed(app, id);
  await post(app, `/api/session/${id}/sounding`, { accept: true });
  for (let i = 1; i <= 5; i++) {
   await post(app, `/api/session/${id}/turn`, { text: aRichAnswer(i) });
  }
  const res = await post(app, `/api/session/${id}/turn`, { text: aRichAnswer(6) });
  expect(res.kind).toBe('checkpoint');
  expect(res.text).toBeUndefined();
  expect(res.sounding).toEqual({ rung: 6, of: expect.any(Number), checkpoint: true });
  const gate = await post(app, `/api/session/${id}/sounding/gate`, { choice: 'continue' });
  expect(gate.kind).toBe('probe');
 });

 it('a descent that reaches its cap closes without the gate being touched', async () => {
  const { app, root } = await makeApp(capScript());
  const id = await newSession(app);
  const res = await answerUntilCap(app, id);
  expect(res.descentClosed).toBe('cap');
  expect(res.soundingId).toBeTruthy();
  const ladder = readLadder(root, res.soundingId);
  expect(ladder).not.toBeNull();
  expect(ladder!.endedBy).toBe('cap');
  expect(ladder!.rungs.length).toBe(12);
 });

 it('park writes the ladder, queues the pointer, and closes with the door question', async () => {
  const { app, root, queue } = await makeApp(capScript().slice(0, 22));
  const id = await newSession(app);
  await turnUntilLicensed(app, id);
  await post(app, `/api/session/${id}/sounding`, { accept: true });
  await post(app, `/api/session/${id}/turn`, { text: aRichAnswer(1) });
  const res = await post(app, `/api/session/${id}/sounding/gate`, { choice: 'park' });
  expect(res.kind).toBe('descent-closed');
  expect(res.phase).toBe('closing-door');
  const ladder = readLadder(root, res.soundingId);
  expect(ladder).not.toBeNull();
  expect(ladder!.rungs.length).toBeGreaterThan(0);
  expect(queue.list({ source: 'parked-sounding' })).toHaveLength(1);
  // The door question was already asked, so the next turn moves to the bookmark.
  const next = await post(app, `/api/session/${id}/turn`, { text: 'nothing else' });
  // The turn response's phase field is now the machine shape (ticket 159,
  // slice 4 — every sitting carries the machine); the session phase string
  // still rides the gate routes and the session response.
  expect(next.phase).toEqual({ id: 'ways-in', label: 'follow the thread', step: 1, of: 1 });
 });

 it('an unknown gate word is a 400, not a guess', async () => {
  const { app } = await makeApp([]);
  const id = await newSession(app);
  const res = await postRaw(app, `/api/session/${id}/sounding/gate`, { choice: 'stop' });
  expect(res.status).toBe(400);
 });

 it('resume 404s on a pointer that is not a parked descent', async () => {
  const { app } = await makeApp([]);
  const id = await newSession(app);
  const res = await postRaw(app, `/api/session/${id}/sounding/resume`, { queueEntryId: 'x' });
  expect(res.status).toBe(404);
 });
});
