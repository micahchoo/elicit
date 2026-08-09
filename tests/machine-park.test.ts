/**
 * The machine side-record (ticket 159, slice 5): park persists the machine
 * state to vault/machines/<sessionId>.json, the resumed sitting continues
 * the exact phase, a corrupt record degrades to a phase-0 restart with a
 * log, and normal ends remove the record.
 *
 * Wire tests drive createApp + /api/session + /api/session/:id/turn +
 * /api/session/:id/gate + /api/session/:id/machine/resume (the
 * protocol-machine-sitting harness pattern) with scripted completes. The
 * mode carries a topic so the opener is the deterministic "You mentioned …"
 * form. The parked sitting runs cdm; the resumed sitting runs reflective on
 * purpose — the machine's own protocol must stay authoritative across the
 * resume, and the reflective branch proves the machine question still
 * serves through the P1/P2-first flow.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readMachineState } from '../src/protocols/park.js';
import type { QueueStore } from '../src/types.js';

// ── Wire types (the asserted surface; extra fields are ignored) ──

interface TurnResponse {
 kind: string;
 text?: string;
 questionForm?: string;
 phase?: { id: string; label: string; step: number; of: number };
}

interface SessionResponse {
 sessionId: string;
 protocol?: string;
}

// ── Wire harness (the protocol-machine-sitting pattern) ──

const roots: string[] = [];

afterAll(() => {
 for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function makeApp(script: string[]): Promise<{ app: Hono; root: string; queue: QueueStore }> {
 const root = mkdtempSync(join(tmpdir(), 'elicit-machine-park-'));
 roots.push(root);
 const vault = createVault(root);
 const complete = makeScriptedComplete(script);
 const queue = createQueueStore(root);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(root, '.auth.json'));
 // The route can no longer select cdm (the pick and the rotation are dead,
 // canon §10), so the createApp protocolName seam drives the machine.
 const app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore, protocolName: 'cdm' });
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

async function newSession(
 app: Hono,
 extra?: { target?: 'self' | 'domain' },
): Promise<string> {
 const body: { mode: { target?: string; topic: string } } = {
  mode: {
   topic: 'the orchard',
   ...(extra?.target !== undefined ? { target: extra.target } : {}),
  },
 };
 const res = await post<SessionResponse>(app, '/api/session', body);
 expect(res.sessionId).toBeTruthy();
 return res.sessionId;
}

/** The cdm phase meta constants, pinned by the defs. */
const RECALL = { id: 'recall', label: 'recall a hard call', step: 1, of: 3 };
const ACCOUNT = { id: 'account', label: 'walk it through', step: 2, of: 3 };
const DECISION = { id: 'decision-probes', label: 'decision probes', step: 3, of: 3 };

/** The script that walks a cdm sitting to the account phase (a ratified
 *  advance writes the side-record on the way). */
const TO_ACCOUNT = [
 'What made that moment a genuine crossroads for you?',
 '[NEXT_PHASE:account]',
 'What did you notice first as the situation began to move?',
];

/**
 * Park the sitting at the account phase and return the parked-machine
 * pointer (and the parked session id) for the resume tests.
 */
async function parkAtAccount(
 app: Hono,
 queue: QueueStore,
): Promise<{ parkedSession: string; pointerId: string }> {
 const parkedSession = await newSession(app, { target: 'domain' });
 await post<TurnResponse>(app, `/api/session/${parkedSession}/turn`, { text: 'I remember the call that cost us the quarter.' });
 await post<TurnResponse>(app, `/api/session/${parkedSession}/turn`, { text: 'The stakes were higher than the plan admitted.' });

 const gate = await post<{ kind: string; phase: string }>(app, `/api/session/${parkedSession}/gate`, { choice: 'park' });
 expect(gate.kind).toBe('door');

 const pointer = queue.list({ source: 'parked-machine' })[0]!;
 expect(pointer).toBeDefined();
 expect(pointer.machineId).toBe(parkedSession);
 expect(pointer.machineProtocol).toBe('cdm');
 return { parkedSession, pointerId: pointer.id };
}

// ── The wire: park persists, resume continues, ends clean up ──

describe('the machine side-record (ticket 159, slice 5)', () => {
 it('park writes the record with the phase, and the phase advance already wrote it', async () => {
  const { app, root, queue } = await makeApp([...TO_ACCOUNT]);
  const id = await newSession(app, { target: 'domain' });

  await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I remember the call that cost us the quarter.' });
  // The second answer ratifies [NEXT_PHASE:account]: the side-record is
  // written on the advance itself, before any park word.
  await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'The stakes were higher than the plan admitted.' });

  const advanceRecord = readMachineState(root, id);
  expect(advanceRecord).not.toBeNull();
  expect(advanceRecord!.phaseIndex).toBe(1);
  expect(advanceRecord!.protocol).toBe('cdm');

  const gate = await post<{ kind: string }>(app, `/api/session/${id}/gate`, { choice: 'park' });
  expect(gate.kind).toBe('door');

  // The park write persists the exact park-time state — the record file
  // exists with the machine at the account phase.
  const recordPath = join(root, 'machines', `${id}.json`);
  expect(existsSync(recordPath)).toBe(true);
  const parked = readMachineState(root, id);
  expect(parked).not.toBeNull();
  expect(parked!.phaseIndex).toBe(1);
  expect(parked!.exchanges).toEqual([1, 0, 0]);

  // …and the park mints the resume pointer, which survives a queue reload.
  const pointer = queue.list({ source: 'parked-machine' })[0]!;
  expect(pointer.machineId).toBe(id);
  expect(pointer.machineProtocol).toBe('cdm');
  expect(queue.list({ source: 'parked-machine' })[0]!.status).toBe('pending');
  const reloaded = createQueueStore(root).list().find((e) => e.id === pointer.id)!;
  expect(reloaded.machineId).toBe(id);
  expect(reloaded.machineProtocol).toBe('cdm');
 });

 it('resume reads the record and continues the exact phase, in a sitting running another protocol', async () => {
  const { app, root, queue } = await makeApp([
   ...TO_ACCOUNT,
   // The resumed machine's account question, composed fresh at resume.
   'What did you notice first as the situation began to move?',
   // The resumed sitting answers it; P2 red-lights, then the machine
   // ratifies the next advance and composes the decision probe.
   '{}',
   '[NEXT_PHASE:decision-probes]',
   'What did you weigh hardest before committing to that choice?',
  ]);
  const { parkedSession, pointerId } = await parkAtAccount(app, queue);
  expect(existsSync(join(root, 'machines', `${parkedSession}.json`))).toBe(true);

  // The person resumes the parked machine inside a REFLECTIVE sitting — the
  // machine's own protocol must stay authoritative across the resume.
  const resumedSession = await newSession(app, { target: 'self' });
  const resumed = await post<TurnResponse>(app, `/api/session/${resumedSession}/machine/resume`, {
   queueEntryId: pointerId,
  });
  // The exact phase continues: account, step 2 of 3 — not a restart.
  expect(resumed.kind).toBe('probe');
  expect(resumed.text).toBe('What did you notice first as the situation began to move?');
  expect(resumed.phase).toEqual(ACCOUNT);

  // The pointer is consumed; the record stays until the resumed sitting
  // finishes (the record is the truth, the pointer only points).
  expect(queue.list({ source: 'parked-machine' }).find((e) => e.id === pointerId)!.status).toBe('answered');
  expect(existsSync(join(root, 'machines', `${parkedSession}.json`))).toBe(true);

  // The resumed sitting answers; the machine advances to the decision
  // probes — the same instrument, one phase further, not phase 0.
  const next = await post<TurnResponse>(app, `/api/session/${resumedSession}/turn`, { text: 'I weighed the risk of being wrong more than anything.' });
  expect(next.kind).toBe('probe');
  expect(next.text).toBe('What did you weigh hardest before committing to that choice?');
  expect(next.phase).toEqual(DECISION);
 });

 it('a corrupt record is skipped with a log and the machine restarts at phase 0', async () => {
  const { app, root, queue } = await makeApp([
   ...TO_ACCOUNT,
   'What made that moment a genuine crossroads for you?',
  ]);
  const { parkedSession, pointerId } = await parkAtAccount(app, queue);

  // Corrupt the record: a half-written file must degrade, never crash.
  writeFileSync(join(root, 'machines', `${parkedSession}.json`), '{ "protocol": "cdm", "phaseIndex": ', 'utf-8');

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
   const resumedSession = await newSession(app, { target: 'self' });
   const resumed = await post<TurnResponse>(app, `/api/session/${resumedSession}/machine/resume`, {
    queueEntryId: pointerId,
   });
   // The machine restarts at phase 0 — the recall question serves.
   expect(resumed.kind).toBe('probe');
   expect(resumed.text).toBe('What made that moment a genuine crossroads for you?');
   expect(resumed.phase).toEqual(RECALL);
   expect(warn).toHaveBeenCalledWith(expect.stringContaining('restarting cdm at phase 0'));
  } finally {
   warn.mockRestore();
  }
 });

 it('end and another-day remove the record the ending sitting owns', async () => {
  // A fresh sitting whose phase advances wrote a record: /end removes it.
  // The harvest runs behind the response and needs one cuts draft per user
  // turn — each quoting that turn's own words (the substring rule).
  const CUT1 = JSON.stringify({ cuts: [{ text: 'I remember the call that cost us the quarter.', sourceTurn: 0, facet: 'construct', stance: 'self-observation', reading: 'the risk mattered', standalone: true }] });
  const CUT2 = JSON.stringify({ cuts: [{ text: 'The stakes were higher than the plan admitted.', sourceTurn: 1, facet: 'construct', stance: 'self-observation', reading: 'the stakes mattered', standalone: true }] });
  const { app, root } = await makeApp([...TO_ACCOUNT, CUT1, CUT2]);
  const fresh = await newSession(app, { target: 'domain' });
  await post<TurnResponse>(app, `/api/session/${fresh}/turn`, { text: 'I remember the call that cost us the quarter.' });
  await post<TurnResponse>(app, `/api/session/${fresh}/turn`, { text: 'The stakes were higher than the plan admitted.' });
  expect(existsSync(join(root, 'machines', `${fresh}.json`))).toBe(true);
  await post<{ status: string }>(app, `/api/session/${fresh}/end`, {});
  expect(existsSync(join(root, 'machines', `${fresh}.json`))).toBe(false);

  // A resumed sitting that ends (without a single answer — the empty end)
  // still consumes the record it resumed, before the empty-sitting guard.
  const { app: app2, root: root2, queue: queue2 } = await makeApp([
   ...TO_ACCOUNT,
   'What did you notice first as the situation began to move?',
  ]);
  const { parkedSession, pointerId } = await parkAtAccount(app2, queue2);
  const resumedSession = await newSession(app2, { target: 'self' });
  await post<TurnResponse>(app2, `/api/session/${resumedSession}/machine/resume`, { queueEntryId: pointerId });
  expect(existsSync(join(root2, 'machines', `${parkedSession}.json`))).toBe(true);

  const ended = await post<{ status: string }>(app2, `/api/session/${resumedSession}/gate`, { choice: 'another-day' });
  expect(ended.status).toBe('empty');
  expect(existsSync(join(root2, 'machines', `${parkedSession}.json`))).toBe(false);
 });
});
