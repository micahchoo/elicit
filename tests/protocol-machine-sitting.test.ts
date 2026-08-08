/**
 * The phase machine in the sitting (ticket 159, slice 3): machine priority
 * before P1, the recorder/advance/close control flow, the people-grid
 * gazetteer degradation, and the phase meta on the turn response.
 *
 * The wire tests drive createApp + /api/session + /api/session/:id/turn
 * (the sounding-routes harness pattern) with scripted completes. The mode
 * carries a topic so the opener is the deterministic "You mentioned …"
 * form — the near-duplicate guard compares against prior agent turns, and
 * a fixed opener keeps the scripted questions provably distinct.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { createGazetteerStore, type GazetteerStore } from '../src/clerk/gazetteer-store.js';
import { startSession, userTurn } from '../src/elicitor/elicitor.js';
import { CLOSING_DOOR_QUESTION } from '../src/elicitor/protocol.js';
import type { Complete, QueueStore, Turn, Vault } from '../src/types.js';

// ── Wire types (the asserted surface; extra fields are ignored) ──

interface TurnResponse {
 kind: string;
 text?: string;
 questionForm?: string;
/** The machine phase meta — the turn response's phase field is always this shape (ticket 159, slice 4); the renderer and the triad names ride it when the phase declares the chip surface (slice 7). */
 phase?: { id: string; label: string; step: number; of: number; renderer?: string; triad?: { names: string[] } };
}

interface SessionResponse {
 sessionId: string;
 protocol?: string;
 question?: string;
}

// ── Wire harness (the sounding-routes pattern) ──

const roots: string[] = [];

afterAll(() => {
 for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function makeApp(
 script: string[],
 opts?: { gazetteerPeople?: string[] },
): Promise<{ app: Hono; root: string }> {
 const root = mkdtempSync(join(tmpdir(), 'elicit-machine-'));
 roots.push(root);
 const vault = createVault(root);
 const complete = makeScriptedComplete(script);
 const queue = createQueueStore(root);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(root, '.auth.json'));
 let gazetteerStore: GazetteerStore | undefined;
 if (opts?.gazetteerPeople !== undefined) {
  gazetteerStore = createGazetteerStore(join(root, 'gazetteer'));
  opts.gazetteerPeople.forEach((name, i) => {
   gazetteerStore!.put({
    id: `person-${name.toLowerCase()}`,
    name,
    kind: 'person',
    aliases: [],
    mentions: [],
    updatedAt: new Date(Date.now() + i).toISOString(),
   });
  });
 }
 const app = await createApp({
  vault,
  complete,
  queue,
  index,
  vaultRoot: root,
  authStore,
  ...(gazetteerStore !== undefined ? { gazetteerStore } : {}),
 });
 return { app, root };
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
 extra?: { protocol?: string; target?: string; topic?: string },
): Promise<{ id: string; res: SessionResponse }> {
 const mode: { minutes: number; energy: string; target?: string; topic?: string } = {
  minutes: 20,
  energy: 'medium',
  ...(extra?.target !== undefined ? { target: extra.target } : {}),
  ...(extra?.topic !== undefined ? { topic: extra.topic } : {}),
 };
 const body: { mode: typeof mode; protocol?: string } = { mode };
 if (extra?.protocol !== undefined) body.protocol = extra.protocol;
 const res = await post<SessionResponse>(app, '/api/session', body);
 expect(res.sessionId).toBeTruthy();
 return { id: res.sessionId, res };
}

// ── Direct-elicitor fixtures (the elicitor.test.ts pattern) ──

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

// ── The wire: a structured sitting advances and closes ──

describe('the phase machine in the sitting (ticket 159, slice 3)', () => {
 it('a cdm sitting advances on markers and closes on [SATURATED], carrying phase meta', async () => {
  const script = [
   // Turn 1: the recall question (phase 1 of 3).
   'What made that moment a genuine crossroads for you?',
   // Turn 2: the model says recall is done; the driver ratifies and the
   // next phase's question is composed in the same turn.
   '[NEXT_PHASE:account]',
   'What did you notice first as the situation began to move?',
   // Turn 3: account done → decision probes.
   '[NEXT_PHASE:decision-probes]',
   'What did you weigh hardest before committing to that choice?',
   // Turn 4: saturated at the last phase → the closing door.
   '[SATURATED]',
  ];
  const { app } = await makeApp(script);
  const { id } = await newSession(app, { protocol: 'cdm', target: 'domain', topic: 'the orchard' });

  const t1 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I remember the call that cost us the quarter.' });
  expect(t1.kind).toBe('probe');
  expect(t1.text).toBe('What made that moment a genuine crossroads for you?');
  expect(t1.phase).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });

  const t2 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'The stakes were higher than the plan admitted.' });
  expect(t2.text).toBe('What did you notice first as the situation began to move?');
  expect(t2.phase).toEqual({ id: 'account', label: 'walk it through', step: 2, of: 3 });

  const t3 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'First came the silence, then the numbers.' });
  expect(t3.text).toBe('What did you weigh hardest before committing to that choice?');
  expect(t3.phase).toEqual({ id: 'decision-probes', label: 'decision probes', step: 3, of: 3 });

  // [SATURATED] at the last phase closes through the ordinary door flow.
  const t4 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I weighed the risk of being wrong more than anything.' });
  expect(t4.kind).toBe('probe');
  expect(t4.text).toBe(CLOSING_DOOR_QUESTION);
 });

 it('a twice-rejected machine question falls through to the ordinary channel; the machine resumes the same phase next turn', async () => {
  const script = [
   // Turn 1: the recall question is served.
   'What made that moment a genuine crossroads for you?',
   // Turn 2: the machine's composition is rejected twice (both attempts
   // parrot the phase prompt)…
   'ask the person to recall one specific challenging case',
   'ask the person to recall one specific challenging case',
   // …so the ordinary channels serve this turn: red-lights, then P3.
   '{}',
   'What made that call so hard to make?',
   // Turn 3: the machine resumes at the SAME phase.
   'What did you learn about yourself from that call?',
  ];
  const { app } = await makeApp(script);
  const { id } = await newSession(app, { protocol: 'cdm', target: 'domain', topic: 'the orchard' });

  const t1 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I remember the call that cost us the quarter.' });
  expect(t1.text).toBe('What made that moment a genuine crossroads for you?');
  expect(t1.phase).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });

  const t2 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'The stakes were higher than the plan admitted.' });
  // The P3 channel served this turn — the machine question never reached the person.
  expect(t2.text).toBe('What made that call so hard to make?');
  // The machine state is untouched: same phase, same step.
  expect(t2.phase).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });

  const t3 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I felt the weight of choosing alone.' });
  // The machine resumed and served its own question at the SAME phase.
  expect(t3.text).toBe('What did you learn about yourself from that call?');
  expect(t3.phase).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });
 });

 it('people-grid with fewer than three gazetteer people degrades to reflective, which now carries its own machine meta', async () => {
  const { app } = await makeApp(['{}', 'What makes you say that?'], { gazetteerPeople: ['Ana'] });
  const { id, res } = await newSession(app, { protocol: 'people-grid', target: 'self', topic: 'the people at work' });

  // The degradation is decided inside startSession; the client hears the
  // effective protocol, not the picked one.
  expect(res.protocol).toBe('reflective');

  const t1 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I keep comparing the people I trust with the people I admire.' });
  expect(t1.kind).toBe('probe');
  // P1 finds nothing and P2 lights nothing, so the machine question serves
  // — reflective is a machine instance (ticket 159, slice 4), its ways-in
  // prompt the P3-equivalent.
  expect(t1.text).toBe('What makes you say that?');
  // …and the phase meta is present: every sitting now carries the machine.
  expect(t1.phase).toEqual({ id: 'ways-in', label: 'follow the thread', step: 1, of: 1 });
 });

 it('people-grid triads: the turn response carries the chip renderer and the names; a tapped pair submits cleanly', async () => {
  const script = [
   // Turn 1: the triads question (the names ride the composed prompt).
   // Guard-safe: the def prompt quotes the floor question, so a scripted
   // answer parroting it would be rejected by the parrot guard.
   'If these three stood in a room together, which two would understand each other first?',
   // Turn 2: after the tapped pair + reasoning, the contrast move.
   'What do the two you chose share that the third one lacks?',
  ];
  const { app } = await makeApp(script, { gazetteerPeople: ['Ana', 'Bea', 'Cleo'] });
  const { id } = await newSession(app, { protocol: 'people-grid', target: 'self', topic: 'the people at work' });

  const t1 = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I keep comparing the people I trust with the people I admire.' });
  expect(t1.kind).toBe('probe');
  expect(t1.text).toBe('If these three stood in a room together, which two would understand each other first?');
  // The phase meta carries the renderer contract (slice 6) plus the three
  // names the chips render (slice 7) — the same people source as the
  // composed prompt, so the chips can never name a set the model did not.
  // (The gazetteer store orders by recency, so assert the set, not the order.)
  expect(t1.phase).toEqual({
   id: 'triads',
   label: 'which two are alike',
   step: 1,
   of: 2,
   renderer: 'triads',
   triad: { names: expect.arrayContaining(['Ana', 'Bea', 'Cleo']) },
  });
  expect(t1.phase?.triad?.names).toHaveLength(3);

  // The tapped pair rides the answer as an additive optional field; the
  // route contract is unchanged for the prose-only turn above.
  const t2 = await post<TurnResponse>(app, `/api/session/${id}/turn`, {
   text: "they're both the ones I turn to first",
   pair: ['Ana', 'Bea'],
  });
  expect(t2.kind).toBe('probe');
  expect(t2.text).toBe('What do the two you chose share that the third one lacks?');
  // Still the triads phase — the machine advances only on a ratified marker.
  expect(t2.phase).toEqual({
   id: 'triads',
   label: 'which two are alike',
   step: 1,
   of: 2,
   renderer: 'triads',
   triad: { names: expect.arrayContaining(['Ana', 'Bea', 'Cleo']) },
  });
 });
});

// ── The direct elicitor: the people source annotates the composed prompt ──

describe('the machine people source (ticket 159, slice 3)', () => {
 it('people-grid with three named people starts the machine and the names ride the composed prompt', async () => {
  const systems: string[] = [];
  const recording: Complete = async (system) => {
   systems.push(system);
   return 'If these three stood in a room together, which two would understand each other first?';
  };
  const session = startSession(
   { minutes: 30, energy: 'medium', target: 'self' },
   {
    complete: recording,
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    bank: [{ text: 'What are you working on?', questionForm: 'deliberative' as const }],
    protocolName: 'people-grid',
    peopleSource: () => ['Ana', 'Bea', 'Cleo'],
   },
  );

  // Three named people → the machine starts; no degradation.
  expect(session.protocol).toBe('people-grid');
  expect(session.protocolMachine).toBeDefined();

  const result = await userTurn(session, 'I think about how my mentors and peers differ all the time.');
  expect(result.kind).toBe('probe');
  if (result.kind === 'probe') {
   expect(result.text).toBe('If these three stood in a room together, which two would understand each other first?');
  }
  // The names ride the composed system prompt (the deterministic triad
  // source — the def stays generic and the model never has to guess names).
  expect(systems[0]).toContain('Ana');
  expect(systems[0]).toContain('Bea');
  expect(systems[0]).toContain('Cleo');
 });

 it('records the tapped pair into the machine ui and grounds the next composition on it', async () => {
  const systems: string[] = [];
  const recording: Complete = async (system) => {
   systems.push(system);
   // Guard-safe: the def prompt quotes the floor and contrast sentences, so
   // a scripted answer parroting either would be rejected by the parrot guard.
   return 'If these three stood in a room together, which two would understand each other first?';
  };
  const session = startSession(
   { minutes: 30, energy: 'medium', target: 'self' },
   {
    complete: recording,
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    bank: [{ text: 'What are you working on?', questionForm: 'deliberative' as const }],
    protocolName: 'people-grid',
    peopleSource: () => ['Ana', 'Bea', 'Cleo'],
   },
  );

  // Turn 1 answers the opener; the machine serves the triads question and
  // nothing is recorded yet.
  const r1 = await userTurn(session, 'I think about how my mentors and peers differ all the time.');
  expect(r1.kind).toBe('probe');
  expect(session.protocolMachine!.ui).toBeUndefined();

  // Turn 2 taps Ana + Bea and writes the reasoning; the pair rides the call.
  const r2 = await userTurn(session, "they're both the ones I turn to first", undefined, undefined, ['Ana', 'Bea']);
  expect(r2.kind).toBe('probe');
  // The plan shape: ui.triads = [{ names, selected }], one record per round.
  // The machine's ui is Record<string, unknown>; the triads key is the
  // slice-7 shape, asserted once at this boundary.
  const uiTriads = session.protocolMachine!.ui as { triads: { names: string[]; selected: [string, string] }[] } | undefined;
  expect(uiTriads?.triads).toEqual([{ names: ['Ana', 'Bea', 'Cleo'], selected: ['Ana', 'Bea'] }]);
  // The pair reaches the model through the composition seam — the LLM
  // client strips unknown turn fields, so the grounding rides the prompt:
  // the next composed system names the pair the follow-up builds on.
  expect(systems[1]).toContain('Ana and Bea were the two chosen as alike');
 });
});
