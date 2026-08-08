import { describe, expect, test, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import type { GuardVerdict } from '../src/language/guards.js';
import type { ParkedLadder, QueueEntry, Rung, Turn } from '../src/types.js';
import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { parkPointer, readLadder, writeLadder } from '../src/sounding/park.js';
import { resumeSounding } from '../src/sounding/resume.js';
import { composeFromCompacted } from '../src/clerk/sounding-rung.js';
import { addRung } from '../src/sounding/ladder.js';

/**
 * A parked ladder with three rungs, every foothold a verbatim substring of
 * the answer before it (the backwards chain the resume must not break). The
 * allowance 8 is the OLD sitting's number — the resume recomputes it.
 */
const NOW = '2026-08-02T12:00:00.000Z';
const LICENSING = 'I keep returning to the old workshop where I first felt the pull of the work.';
const LAST_ANSWER = 'I believed the work was real the afternoon I finished the first shelf.';

function parkedLadder(): ParkedLadder {
 const rungs: Rung[] = [
  {
   question: 'You wrote: "the old workshop." What still draws you there?',
   foothold: 'the old workshop',
   answer: 'The old workshop smells of sawdust and engine oil every time I open the door.',
   at: NOW,
  },
  {
   question: 'You wrote: "sawdust and engine oil." What does that smell carry for you?',
   foothold: 'sawdust and engine oil',
   answer: 'Sawdust and engine oil mean the work was real and my hands were in it.',
   at: NOW,
  },
  {
   question: 'You wrote: "the work was real." When did you last believe that?',
   foothold: 'the work was real',
   answer: LAST_ANSWER,
   at: NOW,
  },
 ];
 return {
  id: '01K0RESUME000000000000000A',
  session: 'sess-parked',
  started: NOW,
  ended: NOW,
  endedBy: 'park',
  construct: 'the thread',
  licensingAnswer: LICENSING,
  allowance: 8,
  checkpointRung: 4,
  rungs,
 };
}

/** The red-light phrase the scripted complete flags: a substring of the LAST kept answer. */
const PHRASE = 'finished the first shelf';
const FOLLOW_UP = `You wrote: "${PHRASE}." What did finishing it change for you?`;
const SCRIPT: string[] = [
 JSON.stringify({ lights: [{ kind: 'unexplored-referent', phrase: PHRASE }] }),
 FOLLOW_UP,
];

const okGuard = (): GuardVerdict => 'ok';

describe('sounding resume (plan Task 12)', () => {
 const roots: string[] = [];

 afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
 });

 function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'elicit-sounding-resume-'));
  roots.push(root);
  return root;
 }

 /** Write the ladder and mint its queue pointer; returns the pointer. */
 function parkedEntry(root: string, l: ParkedLadder): QueueEntry {
  const queue = createQueueStore(root);
  writeLadder(root, l);
  return parkPointer(queue, l);
 }

 test('resuming composes a question that is not the parked one', async () => {
  const root = makeRoot();
  const l = parkedLadder();
  const entry = parkedEntry(root, l);
  const resumed = resumeSounding(root, entry, { minutes: 20, energy: 'medium' }, 4, 'the descent moved from the workshop to the shelf');
  expect(resumed).not.toBeNull();
  const q = await composeFromCompacted(resumed!.compacted, makeScriptedComplete(SCRIPT), okGuard);
  expect(q).not.toBeNull();
  expect(q!.text).not.toBe(l.rungs.at(-1)!.question);
  expect(q!.text).toBe(FOLLOW_UP);
 });

 test('the resumed foothold chains from the last kept answer', async () => {
  const root = makeRoot();
  const l = parkedLadder();
  const entry = parkedEntry(root, l);
  const resumed = resumeSounding(root, entry, { minutes: 20, energy: 'medium' }, 4, null);
  expect(resumed).not.toBeNull();
  const q = await composeFromCompacted(resumed!.compacted, makeScriptedComplete(SCRIPT), okGuard);
  expect(q).not.toBeNull();
  // The foothold is a verbatim substring of the last kept answer…
  expect(resumed!.compacted.verbatim.at(-1)!.answer).toContain(q!.foothold);
  // …so addRung's backwards check passes one turn later.
  expect(() => addRung(resumed!.state, q!.text, q!.foothold, 'a new answer here', NOW)).not.toThrow();
 });

 test('the allowance comes from the new sitting, not the old one', () => {
  const root = makeRoot();
  const l = parkedLadder();
  const entry = parkedEntry(root, l);
  expect(l.allowance).toBe(8); // the parked ladder's number, for contrast
  const { state } = resumeSounding(root, entry, { minutes: 20, energy: 'high' }, 4, null)!;
  expect(state.allowance).toBe(12);
  expect(state.checkpointRung).toBe(6);
 });

 test('the licensing answer is carried forward, not rewritten', () => {
  const root = makeRoot();
  const l = parkedLadder();
  const entry = parkedEntry(root, l);
  const { state } = resumeSounding(root, entry, { minutes: 20, energy: 'medium' }, 4, null)!;
  expect(state.licensingAnswer).toBe(l.licensingAnswer);
 });

 test('resumed rungs append to the same file', async () => {
  const root = makeRoot();
  const l = parkedLadder();
  const entry = parkedEntry(root, l);
  const { state } = resumeSounding(root, entry, { minutes: 20, energy: 'medium' }, 4, null)!;
  const grown = addRung(state, 'a fresh question', PHRASE, 'a new answer here', NOW);
  writeLadder(root, { ...grown, ended: NOW, endedBy: 'park' });
  const reloaded = readLadder(root, entry.soundingId!);
  expect(reloaded).not.toBeNull();
  expect(reloaded!.rungs).toHaveLength(l.rungs.length + 1);
  expect(reloaded!.rungs.at(-1)!.answer).toBe('a new answer here');
 });

 test('a pointer to a missing ladder is a dead entry, not a crash', () => {
  const root = makeRoot();
  const queue = createQueueStore(root);
  const pointerToNothing = queue.add({
   source: 'parked-sounding',
   license: 'user',
   question: 'a parked question',
   questionForm: 'deliberative',
   sharpness: 'weak',
   horizon: 'session',
   soundingId: '01K0MISSING00000000000000A',
  });
  expect(resumeSounding(root, pointerToNothing, { minutes: 20, energy: 'medium' }, 4, null)).toBe(null);
 });

 test('picking it up clears it from the waiting surface', async () => {
  const root = makeRoot();
  const l = parkedLadder();
  const queue = createQueueStore(root);
  writeLadder(root, l);
  const entry = parkPointer(queue, l);
  const vault = createVault(root);
  const app = await createApp({
   vault,
   complete: makeScriptedComplete(SCRIPT),
   queue,
   index: buildIndex([]),
   vaultRoot: root,
   authStore: createFileAuth(join(root, '.auth.json')),
  });

  const id = await newSession(app);
  const res = await post(app, `/api/session/${id}/sounding/resume`, { queueEntryId: entry.id });
  expect(res.kind).toBe('probe');
  expect(res.text).toBe(FOLLOW_UP);
  expect(queue.list({ source: 'parked-sounding' })[0]!.status).toBe('answered');
 });

 async function post(app: Hono, path: string, body?: unknown): Promise<any> {
  const init: RequestInit =
   body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
  return res.json();
 }

 async function newSession(app: Hono): Promise<string> {
  const res = await post(app, '/api/session', { mode: { minutes: 20, energy: 'medium' } });
  expect(res.sessionId).toBeTruthy();
  return res.sessionId as string;
 }
});
