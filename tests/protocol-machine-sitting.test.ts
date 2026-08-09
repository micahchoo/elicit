/**
 * The phase machine in the sitting (ticket 159, slice 3): machine priority
 * before P1, the recorder/advance/close control flow, the people-grid
 * gazetteer degradation, and the phase meta on the turn response.
 *
 * The machine-shape tests drive the elicitor directly (startSession +
 * userTurn) with scripted completes, decoupled from the route: the protocol
 * pick and the rotation are both dead (canon §10 — patterns are drawn, not
 * chosen), so the route can no longer select a machine protocol. The mode
 * carries a topic so the opener is the deterministic "You mentioned …"
 * form — the near-duplicate guard compares against prior agent turns, and
 * a fixed opener keeps the scripted questions provably distinct.
 */

import { describe, it, expect } from 'vitest';

import { makeScriptedComplete } from './fakes.js';
import { buildIndex } from '../src/index/lexical.js';
import { startSession, userTurn } from '../src/elicitor/elicitor.js';
import { machinePhaseMeta } from '../src/protocols/machine.js';
import { CLOSING_DOOR_QUESTION } from '../src/elicitor/protocol.js';
import type { Complete, QueueStore, Turn, Vault } from '../src/types.js';

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
  // The route can no longer select cdm (the protocol pick and the rotation
  // are both dead — canon §10), so drive the elicitor directly with the
  // protocolName seam, the way the concept-sorting and people-grid tests do.
  const session = startSession(
   { target: 'domain', topic: 'the orchard' },
   {
    complete: makeScriptedComplete(script),
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    protocolName: 'cdm',
   },
  );

  const t1 = await userTurn(session, 'I remember the call that cost us the quarter.');
  expect(t1.kind).toBe('probe');
  if (t1.kind === 'probe') expect(t1.text).toBe('What made that moment a genuine crossroads for you?');
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });

  const t2 = await userTurn(session, 'The stakes were higher than the plan admitted.');
  if (t2.kind === 'probe') expect(t2.text).toBe('What did you notice first as the situation began to move?');
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'account', label: 'walk it through', step: 2, of: 3 });

  const t3 = await userTurn(session, 'First came the silence, then the numbers.');
  if (t3.kind === 'probe') expect(t3.text).toBe('What did you weigh hardest before committing to that choice?');
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'decision-probes', label: 'decision probes', step: 3, of: 3 });

  // [SATURATED] at the last phase closes through the ordinary door flow.
  const t4 = await userTurn(session, 'I weighed the risk of being wrong more than anything.');
  expect(t4.kind).toBe('probe');
  if (t4.kind === 'probe') expect(t4.text).toBe(CLOSING_DOOR_QUESTION);
 });

 it('a twice-rejected machine question falls through to the ordinary channel; the machine resumes the same phase next turn', async () => {
  const script = [
   // Turn 1: the recall question is served.
   'What made that moment a genuine crossroads for you?',
   // Turn 2: the machine's composition is rejected twice (both attempts
   // parrot the phase prompt)…
   'ask the person to recall one specific challenging case',
   'ask the person to recall one specific challenging case',
   // …so the ordinary channels serve this turn: the generic probe (the
   // red-light channel is cut — canon §10).
   'What made that call so hard to make?',
   // Turn 3: the machine resumes at the SAME phase.
   'What did you learn about yourself from that call?',
  ];
  // The route can no longer select cdm — drive the elicitor directly (the
  // protocolName seam), like the concept-sorting and people-grid tests.
  const session = startSession(
   { target: 'domain', topic: 'the orchard' },
   {
    complete: makeScriptedComplete(script),
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    protocolName: 'cdm',
   },
  );

  const t1 = await userTurn(session, 'I remember the call that cost us the quarter.');
  expect(t1.kind).toBe('probe');
  if (t1.kind === 'probe') expect(t1.text).toBe('What made that moment a genuine crossroads for you?');
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });

  const t2 = await userTurn(session, 'The stakes were higher than the plan admitted.');
  // The generic probe served this turn — the machine question never reached the person.
  if (t2.kind === 'probe') expect(t2.text).toBe('What made that call so hard to make?');
  // The machine state is untouched: same phase, same step.
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });

  const t3 = await userTurn(session, 'I felt the weight of choosing alone.');
  // The machine resumed and served its own question at the SAME phase.
  if (t3.kind === 'probe') expect(t3.text).toBe('What did you learn about yourself from that call?');
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'recall', label: 'recall a hard call', step: 1, of: 3 });
 });

 it('a declarative echo from the machine is rejected as not-interrogative, retried once, and falls through to a real question', async () => {
  const script = [
   // Turn 1: the name-the-kinds question is served.
   'What kinds of work keep showing up for you?',
   // Turn 2: the machine hands the person's own words back — no question
   // mark — on BOTH the first attempt and the corrective retry…
   'You wrote: "I mostly deal with contracts and budgets."',
   'You wrote: "I mostly deal with contracts and budgets."',
   // …so the ordinary channels serve this turn: red-lights, then P3.
   '{}',
   'Which of the piles you named would be hardest to give up?',
  ];
  // concept-sorting is unreachable by rotation (only cdm/laddered-grid rotate
  // for 'domain' at a fresh vault), so drive the elicitor directly — the
  // machine-shape assertion, decoupled from the rotation (canon §10).
  const session = startSession(
   { target: 'domain', topic: 'the work I take on' },
   {
    complete: makeScriptedComplete(script),
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    protocolName: 'concept-sorting',
   },
  );

  const t1 = await userTurn(session, 'I mostly deal with contracts, budgets, and timelines.');
  expect(t1.kind).toBe('probe');
  if (t1.kind === 'probe') expect(t1.text).toBe('What kinds of work keep showing up for you?');
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'name-the-kinds', label: 'name the kinds', step: 1, of: 3 });

  const t2 = await userTurn(session, 'Budgets are the ones I keep putting off.');
  // The echo never reached the person: the P3 channel served this turn.
  expect(t2.kind).toBe('probe');
  if (t2.kind === 'probe') expect(t2.text).toBe('Which of the piles you named would be hardest to give up?');
  // The machine state is untouched: same phase, same step.
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'name-the-kinds', label: 'name the kinds', step: 1, of: 3 });
 });

 it('people-grid with fewer than three people degrades to reflective, which now carries its own machine meta', async () => {
  // people-grid is rotation:false (canon §10 — patterns are drawn, not
  // chosen), so the machine-shape tests drive the elicitor directly.
  const session = startSession(
   { target: 'self', topic: 'the people at work' },
   {
    complete: makeScriptedComplete(['{}', 'What makes you say that?']),
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    protocolName: 'people-grid',
    peopleSource: () => ['Ana'],
   },
  );

  // The degradation is decided inside startSession; the client hears the
  // effective protocol, not the picked one.
  expect(session.protocol).toBe('reflective');

  const t1 = await userTurn(session, 'I keep comparing the people I trust with the people I admire.');
  expect(t1.kind).toBe('probe');
  // P1 finds nothing and P2 lights nothing, so the machine question serves
  // — reflective is a machine instance (ticket 159, slice 4), its ways-in
  // prompt the P3-equivalent.
  if (t1.kind === 'probe') expect(t1.text).toBe('What makes you say that?');
  // …and the phase meta is present: every sitting now carries the machine.
  expect(machinePhaseMeta(session.protocolMachine)).toEqual({ id: 'ways-in', label: 'follow the thread', step: 1, of: 1 });
 });

 it('people-grid triads: the phase meta carries the chip renderer and the names; a tapped pair submits cleanly', async () => {
  const script = [
   // Turn 1: the triads question (the names ride the composed prompt).
   // Guard-safe: the def prompt quotes the floor question, so a scripted
   // answer parroting it would be rejected by the parrot guard.
   'If these three stood in a room together, which two would understand each other first?',
   // Turn 2: after the tapped pair + reasoning, the contrast move.
   'What do the two you chose share that the third one lacks?',
  ];
  // people-grid is rotation:false — drive the elicitor directly, as the
  // people-source section below does (canon §10).
  const session = startSession(
   { target: 'self', topic: 'the people at work' },
   {
    complete: makeScriptedComplete(script),
    vault: makeFakeVault(),
    queue: makeFakeQueue(),
    index: buildIndex([]),
    protocolName: 'people-grid',
    peopleSource: () => ['Ana', 'Bea', 'Cleo'],
   },
  );

  const t1 = await userTurn(session, 'I keep comparing the people I trust with the people I admire.');
  expect(t1.kind).toBe('probe');
  if (t1.kind === 'probe') expect(t1.text).toBe('If these three stood in a room together, which two would understand each other first?');
  // The phase meta carries the renderer contract (slice 6) plus the three
  // names the chips render (slice 7) — the same people source as the
  // composed prompt, so the chips can never name a set the model did not.
  expect(machinePhaseMeta(session.protocolMachine, () => ['Ana', 'Bea', 'Cleo'])).toEqual({
   id: 'triads',
   label: 'which two are alike',
   step: 1,
   of: 2,
   renderer: 'triads',
   triad: { names: expect.arrayContaining(['Ana', 'Bea', 'Cleo']) },
  });
  expect(machinePhaseMeta(session.protocolMachine, () => ['Ana', 'Bea', 'Cleo'])?.triad?.names).toHaveLength(3);

  // The tapped pair rides the answer as an additive optional field; the
  // elicitor records it into the machine ui and the contrast move serves.
  const t2 = await userTurn(session, "they're both the ones I turn to first", undefined, undefined, ['Ana', 'Bea']);
  expect(t2.kind).toBe('probe');
  if (t2.kind === 'probe') expect(t2.text).toBe('What do the two you chose share that the third one lacks?');
  // Still the triads phase — the machine advances only on a ratified marker.
  expect(machinePhaseMeta(session.protocolMachine, () => ['Ana', 'Bea', 'Cleo'])).toEqual({
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
   { target: 'self' },
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
   { target: 'self' },
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
