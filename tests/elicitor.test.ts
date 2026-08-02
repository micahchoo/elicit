import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Turn, Vault, QueueStore, QueueDraft, QueueEntry, LexicalIndex } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { startSession, userTurn, skipQuestion } from '../src/elicitor/elicitor.js';
import { CLOSING_DOOR_QUESTION, CLOSING_BOOKMARK_QUESTION } from '../src/elicitor/protocol.js';
import { getProtocol } from '../src/protocols/registry.js';
import { readEvents } from '../src/log/activity.js';
import { buildIndex, resonate } from '../src/index/lexical.js';

/** In-memory fake Vault that records turns for inspection. */
function makeFakeVault() {
 const transcripts: Record<
  string,
  { meta: { mode: unknown; protocol: string; started: string }; turns: Turn[] }
 > = {};

 const vault = {
  saveSnippet: () => {
   throw new Error('unexpected saveSnippet call');
  },
  saveVersion: () => {
   throw new Error('unexpected saveVersion call');
  },
  saveReading: () => {
   throw new Error('unexpected saveReading call');
  },
  saveBud: () => {
   throw new Error('unexpected saveBud call');
  },
  rebuildIndex: () => ({ snippets: {}, readings: {}, buds: {} }),
  startTranscript(
   session: string,
   meta: { mode: unknown; protocol: string; started: string },
  ) {
   transcripts[session] = { meta, turns: [] };
  },
  appendTurn(session: string, turn: Turn) {
   const t = transcripts[session];
   if (!t) throw new Error(`no transcript for session ${session}`);
   t.turns.push(turn);
  },
  /** Test helper: read back recorded turns. */
  _turns(session: string): Turn[] {
   return transcripts[session]!.turns;
  },
 } satisfies Vault & { _turns(session: string): Turn[] };

 return vault;
}

/** Fake queue: draw returns null (bank fallback), add is a recording stub. */
function makeFakeQueue(): QueueStore & { _adds: QueueDraft[] } {
 const adds: QueueDraft[] = [];
 return {
  add(draft) {
   adds.push(draft);
   return {
    ...draft,
    id: 'fake-id',
    created: new Date().toISOString(),
    status: 'pending' as const,
   };
  },
  list: () => [],
  draw: () => null,
  markAsked: () => { },
  markAnswered: () => { },
  defer: () => { },
  expire: () => 0,
  _adds: adds,
 };
}

/** Empty lexical index — resonate returns no hits. */
function makeFakeIndex(): LexicalIndex {
 return buildIndex([]);
}

/**
 * Build a scripted-complete response array for N userTurn calls.
 * Each turn consumes 2 complete calls: 1 for redLights ('{}' → empty lights),
 * 1 for the generic probe.
 */
function turnResponses(probes: string[]): string[] {
 const out: string[] = [];
 for (const p of probes) {
  out.push('{}'); // redLights — no lights
  out.push(p);    // generic probe
 }
 return out;
}

describe('elicitor', () => {
 test('opener from starter bank when no topic', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const bank = [
   { text: 'What do you value?', questionForm: 'deliberative' as const },
   { text: 'Why are you here?', questionForm: 'why' as const },
  ];
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  const bankTexts = bank.map((s) => s.text);
  expect(bankTexts).toContain(session.turns[0]!.text);
  expect(session.turns[0]!.questionForm).toBeDefined();
  expect(session.turns[0]!.role).toBe('agent');
 });

 test('opener Turn carries questionSource when drawn from bank', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const bank = [
   {
    text: 'What?',
    questionForm: 'deliberative' as const,
    source: { channel: 'ch', blockId: 42 },
   },
  ];
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );
  expect(session.turns[0]!.questionSource).toEqual({
   channel: 'ch',
   blockId: 42,
  });
 });

 test('session.bank is stored', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const bank = [
   { text: 'Q1?', questionForm: 'deliberative' as const },
   { text: 'Q2?', questionForm: 'why' as const },
  ];
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 25, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );
  expect(session.bank).toEqual(bank);
 });

 test('opener from topic when mode.topic is set', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium', topic: 'regret' },
   { complete, vault, queue: q, index: idx },
  );

  expect(session.turns[0]!.text).toContain('regret');
  expect(session.turns[0]!.questionForm).toBe('deliberative');
 });

 test('probe text returned verbatim from fake', async () => {
  const vault = makeFakeVault();
  // 1 userTurn → 2 complete calls: redLights + probe
  const complete = makeScriptedComplete(turnResponses(['What makes you say that?']));
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  const result = await userTurn(session, 'I think routines matter.');

  expect(result.kind).toBe('probe');
  if (result.kind === 'probe') {
   expect(result.text).toBe('What makes you say that?');
   expect(result.questionForm).toBe('deliberative');
  }
 });

 // ── facet intent on questions (ticket 042) ──

 test('a composed follow-up carries the facet its Red Light asks for', async () => {
  const vault = makeFakeVault();
  // Long enough to escape the content-free pivot, which would draw instead.
  const answer = 'Routines are the only thing that hold my life together, mostly.';
  const complete = makeScriptedComplete([
   JSON.stringify({
    lights: [{ kind: 'abstraction-no-episode', phrase: 'hold my life together' }],
   }),
   'You said routines "hold my life together" — what did that look like this week?',
  ]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  const result = await userTurn(session, answer);

  expect(result.kind).toBe('probe');
  if (result.kind === 'probe') {
   expect(result.provenance).toBe('composed');
   // An abstraction with no episode under it wants the episode.
   expect(result.targetFacet).toBe('episode');
  }
 });

 test('a generic probe claims no facet rather than guessing one', async () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete(turnResponses(['What makes you say that?']));
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  const result = await userTurn(session, 'I think routines matter.');
  if (result.kind === 'probe') {
   expect(result.targetFacet).toBeUndefined();
  }
 });

 // ── target no longer defaults inward by reflex (Q-19, ticket 042) ──

 test('an absent target falls back to the caller default, not to self', () => {
  const vault = makeFakeVault();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   {
    complete: makeScriptedComplete([]),
    vault,
    queue: makeFakeQueue(),
    index: makeFakeIndex(),
    defaultTarget: 'domain',
   },
  );
  expect(session.mode.target).toBe('domain');
 });

 test('a declared target outranks the caller default', () => {
  const vault = makeFakeVault();
  const session = startSession(
   { minutes: 30, energy: 'medium', target: 'self' },
   {
    complete: makeScriptedComplete([]),
    vault,
    queue: makeFakeQueue(),
    index: makeFakeIndex(),
    defaultTarget: 'domain',
   },
  );
  expect(session.mode.target).toBe('self');
 });

 test('an absent target still starts a session when no default is given', () => {
  const vault = makeFakeVault();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   {
    complete: makeScriptedComplete([]),
    vault,
    queue: makeFakeQueue(),
    index: makeFakeIndex(),
   },
  );
  expect(session.mode.target).toBe('self');
 });

 test('transcript receives all turns in order via vault', async () => {
  const vault = makeFakeVault();
  // 2 userTurns → 4 complete calls
  const complete = makeScriptedComplete(turnResponses(['Probe one', 'Probe two']));
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  await userTurn(session, 'Answer one');
  await userTurn(session, 'Answer two');

  const turns = vault._turns(session.id);
  expect(turns).toHaveLength(5); // agent, user, agent, user, agent
  expect(turns[0]!.role).toBe('agent'); // opener
  expect(turns[1]!.role).toBe('user');
  expect(turns[1]!.text).toBe('Answer one');
  expect(turns[2]!.role).toBe('agent'); // Probe one
  expect(turns[3]!.role).toBe('user');
  expect(turns[3]!.text).toBe('Answer two');
  expect(turns[4]!.role).toBe('agent'); // Probe two
 });

 test('[SATURATED] from fake ends exchange', async () => {
  const vault = makeFakeVault();
  // 1 userTurn → redLights + [SATURATED] probe
  const complete = makeScriptedComplete(['{}', '[SATURATED]']);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  const result = await userTurn(session, 'I think I have said everything I wanted to say about this topic.');

  // [SATURATED] triggers close — closing-door question is returned
  expect(result.kind).toBe('probe');
  expect(session.phase).toBe('closing-door');
 });

 test('budget saturation: session closes after budget questions', async () => {
  const vault = makeFakeVault();
  // minutes=5 → budget = min(20, max(10, 5)) = 10
  // Budget-2 = 8. After opener (qCount=1) + 7 probes (qCount→8),
  // the 8th userTurn triggers closing-door.
  // 7 userTurns × 2 complete calls = 14 responses
  const complete = makeScriptedComplete(
   turnResponses(['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']),
  );
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 5, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  // 7 probe turns
  for (let i = 0; i < 7; i++) {
   await userTurn(session, `A${i + 1}`);
  }

  // 8th turn: closing-door triggers (qCount=8 >= budget-2=8)
  const door = await userTurn(session, 'A8');
  expect(door.kind).toBe('probe');
  if (door.kind === 'probe') expect(door.text).toBe(CLOSING_DOOR_QUESTION);
  expect(session.phase).toBe('closing-door');

  // 9th turn: closing-bookmark
  const bookmark = await userTurn(session, 'A9');
  expect(bookmark.kind).toBe('probe');
  if (bookmark.kind === 'probe') expect(bookmark.text).toBe(CLOSING_BOOKMARK_QUESTION);
  expect(session.phase).toBe('closing-bookmark');

  // 10th turn: bookmark answer → saturated, answer lands in queue
  const result = await userTurn(session, 'I want to remember this.');
  expect(result.kind).toBe('saturated');
  expect(q._adds).toHaveLength(1);
  expect(q._adds[0]!.question).toBe('I want to remember this.');
 });

 test('the bookmark entry carries the sitting Target and topic', async () => {
  // Same drive to the bookmark as above; the point is what the entry records.
  const vault = makeFakeVault();
  const complete = makeScriptedComplete(
   turnResponses(['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']),
  );
  const q = makeFakeQueue();
  const session = startSession(
   { minutes: 5, energy: 'medium', target: 'domain', topic: 'sourdough bread baking' },
   { complete, vault, queue: q, index: makeFakeIndex() },
  );

  for (let i = 0; i < 9; i++) await userTurn(session, `A${i + 1}`);
  const result = await userTurn(session, 'Come back to the hydration question.');

  expect(result.kind).toBe('saturated');
  expect(q._adds[0]!.target).toBe('domain');
  expect(q._adds[0]!.topic).toBe('sourdough bread baking');
 });

 test('session transcript carries mode metadata', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 15, energy: 'low' },
   { complete, vault, queue: q, index: idx },
  );

  expect(session.mode.minutes).toBe(15);
  expect(session.mode.energy).toBe('low');
  expect(session.protocol).toBe('reflective');
  expect(session.id).toBeTruthy();
 });

 test('every turn is in transcript before userTurn returns', async () => {
  const vault = makeFakeVault();
  // 1 userTurn → 2 complete calls
  const complete = makeScriptedComplete(turnResponses(['Elaborate?']));
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'high' },
   { complete, vault, queue: q, index: idx },
  );

  // Before userTurn, only the opener is recorded.
  expect(vault._turns(session.id)).toHaveLength(1);

  const result = await userTurn(session, 'I value honesty above all.');

  // After userTurn returns, both the user turn and the agent probe
  // must be in the transcript.
  if (result.kind === 'probe') {
   expect(vault._turns(session.id)).toHaveLength(3);
  }
 });

 test('skip returns a different starter than the skipped one', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const s = startSession(
   { minutes: 25, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );
  const originalText = s.turns[s.turns.length - 1]!.text;
  const result = skipQuestion(s);
  expect(result.kind).toBe('question');
  if (result.kind === 'question') {
   expect(result.text).not.toBe(originalText);
  }
  // the skipped turn should be marked
  const skippedTurn = s.turns[s.turns.length - 2]!;
  expect(skippedTurn.skipped).toBe(true);
  expect(skippedTurn.text).toBe(originalText);
 });

 test('skip appends replacement turn after the skipped turn in vault', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const s = startSession(
   { minutes: 25, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );
  const result = skipQuestion(s);
  expect(result.kind).toBe('question');
  const turns = vault._turns(s.id);
  expect(turns.length).toBe(2);
  expect(turns[0]!.skipped).toBe(true);
  expect(turns[1]!.skipped).toBeUndefined();
  if (result.kind === 'question') {
   expect(turns[1]!.text).toBe(result.text);
  }
 });

 test('skip does not count toward budget', async () => {
  const vault = makeFakeVault();
  // minutes=5 → budget=10. Skip opener, then 7 probes still fit.
  // 7 userTurns × 2 = 14 responses
  const complete = makeScriptedComplete(
   turnResponses(['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']),
  );
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const s = startSession(
   { minutes: 5, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  // skip the opener — should not consume budget
  const skipResult = skipQuestion(s);
  expect(skipResult.kind).toBe('question');

  // 7 probes still fit
  for (let i = 0; i < 7; i++) {
   const r = await userTurn(s, `answer ${i}`);
   expect(r.kind).toBe('probe');
  }

  // closing-door triggers
  const door = await userTurn(s, 'A8');
  expect(door.kind).toBe('probe');

  // closing-bookmark
  const bookmark = await userTurn(s, 'A9');
  expect(bookmark.kind).toBe('probe');

  // bookmark answer → saturated
  const saturated = await userTurn(s, 'my bookmark');
  expect(saturated.kind).toBe('saturated');
 });

 test('skip exhausts after all bank starters used', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const bank = [
   { text: 'Q1?', questionForm: 'deliberative' as const },
   { text: 'Q2?', questionForm: 'deliberative' as const },
  ];
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const s = startSession(
   { minutes: 25, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  // opener used 1 bank question, 1 skip uses the other
  const r1 = skipQuestion(s);
  expect(r1.kind).toBe('question');

  // 2nd skip should exhaust (both used)
  const exhausted = skipQuestion(s);
  expect(exhausted.kind).toBe('exhausted');

  // 1 opener + 1 replacement, no 3rd
  expect(s.turns.filter((t) => t.role === 'agent').length).toBe(2);
 });

 test('skip replacement carries questionSource', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const bank = [
   {
    text: 'Q1?',
    questionForm: 'deliberative' as const,
    source: { channel: 'ch', blockId: 42 },
   },
   {
    text: 'Q2?',
    questionForm: 'deliberative' as const,
    source: { channel: 'ch2', blockId: 43 },
   },
  ];
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const s = startSession(
   { minutes: 25, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  const r = skipQuestion(s);
  expect(r.kind).toBe('question');

  const replacement = s.turns[s.turns.length - 1]!;
  const entry = bank.find((q2) => q2.text === replacement.text)!;
  expect(replacement.questionSource).toEqual(entry.source);
 });
});

describe('guards', () => {
 test('conversation-referential probe is rejected and retried', async () => {
  const vault = makeFakeVault();
  // 3 complete calls: redLights, bad probe (triggers guard), retry probe
  const complete = makeScriptedComplete([
   '{}',                                                    // redLights
   'What are you trying to achieve in this conversation?',  // triggers guard
   'What drives you?',                                      // retry — passes
  ]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  const result = await userTurn(session, 'I think a lot about meaning.');
  expect(result.kind).toBe('probe');
  if (result.kind === 'probe') {
   expect(result.text).toBe('What drives you?');
   expect(result.text).not.toMatch(/\bthis conversation\b/i);
  }
 });

 test('conversation-referential retry also fails → fallback to bank', async () => {
  const vault = makeFakeVault();
  const bank = [
   { text: 'What do you value?', questionForm: 'deliberative' as const },
   { text: 'Why are you here?', questionForm: 'why' as const },
  ];
  // 3 complete calls: redLights, bad probe, retry (still bad)
  const complete = makeScriptedComplete([
   '{}',
   'What is this conversation about?',
   'Is this conversation helping you?',
  ]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  const result = await userTurn(session, 'OK.');
  if (result.kind === 'probe') {
   // Should fall back to the unused bank entry
   expect(['What do you value?', 'Why are you here?']).toContain(result.text);
   expect(result.provenance).toBe('bank');
  }
 });

 test('a twice-rejected probe with an empty fallback is replaced by the protocol floor (079)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elicit-guard-floor-'));
  try {
   const vault = makeFakeVault();
   // One bank question, consumed by the opener — so the fallback bank is empty.
   const bank = [{ text: 'What do you value?', questionForm: 'deliberative' as const }];
   // 3 complete calls: redLights, bad probe (triggers guard), retry (still bad)
   const complete = makeScriptedComplete([
    '{}',
    'What are you trying to achieve in this conversation?',
    'Is this conversation helping you?',
   ]);
   // A real, empty queue — draw returns null and logs its own queue-floor.
   const q = createQueueStore(root);
   const idx = makeFakeIndex();
   const session = startSession(
    { minutes: 30, energy: 'medium' },
    { complete, vault, queue: q, index: idx, bank, vaultRoot: root },
   );

   const result = await userTurn(session, 'OK.');
   expect(result.kind).toBe('probe');
   if (result.kind === 'probe') {
    // The floor is the active protocol's own fixed probe — never the text the
    // guard rejected twice.
    expect(result.text).toBe(getProtocol(session.protocol)!.floorProbe);
    expect(result.text).not.toContain('conversation');
    expect(result.text).not.toBe('Is this conversation helping you?');
   }

   // The guard floor is logged honestly: a distinct kind, elicitor actor.
   const events = readEvents(root).filter((e) => e.kind === 'guard-floor');
   expect(events).toHaveLength(1);
   expect(events[0]!.actor).toBe('elicitor');
   expect(events[0]!.detail).toContain('protocol=reflective');
   expect(events[0]!.detail).toContain('verdict=conversation-referential');
  } finally {
   rmSync(root, { recursive: true, force: true });
  }
 });

 test('near-duplicate probe is rejected and retried', async () => {
  const vault = makeFakeVault();
  const bank = [
   { text: 'What is your earliest memory?', questionForm: 'deliberative' as const },
  ];
  // 3 complete calls: redLights, near-dup, retry
  const complete = makeScriptedComplete([
   '{}',
   'What is your earliest memory of childhood?',  // near-dup of bank opener
   'When did you first notice that pattern?',     // retry — fresh
  ]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  const result = await userTurn(session, 'I remember a lot from childhood.');
  expect(result.kind).toBe('probe');
  if (result.kind === 'probe') {
   expect(result.text).toBe('When did you first notice that pattern?');
  }
 });

 test('near-duplicate retry also fails → fallback to queue', async () => {
  const vault = makeFakeVault();
  const bank = [
   { text: 'What do you value?', questionForm: 'deliberative' as const },
  ];
  // 3 complete calls: redLights, near-dup, retry (still near-dup)
  const complete = makeScriptedComplete([
   '{}',
   'What do you value the most?',     // near-dup of opener
   'What do you value above all?',     // still near-dup (4/7 = 0.571)
  ]);
  // Queue that returns a fallback draw
  const fallbackText = 'What matters to you?';
  const q: QueueStore & { _adds: Array<{ question: string }> } = {
   _adds: [],
   add(draft) { this._adds.push({ question: draft.question }); return { ...draft, id: 'q', created: '', status: 'pending' as const }; },
   list: () => [],
   draw: (_mode, phase) => {
    if (phase === 'mid') return { id: 'fb', question: fallbackText, questionForm: 'deliberative' as const, source: 'composed', license: 'machine', sharpness: 'sharp', horizon: 'now', status: 'pending', created: '' };
    return null;
   },
   markAsked: () => { },
   markAnswered: () => { },
   defer: () => { },
   expire: () => 0,
  };
  const idx = makeFakeIndex();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  const result = await userTurn(session, 'I think about values.');
  expect(result.kind).toBe('probe');
  if (result.kind === 'probe') {
   expect(result.text).toBe(fallbackText);
   expect(result.provenance).toBe('bank');
  }
 });
});

describe('guard scope — every branch, not just the generic probe', () => {
 /** A snippet whose phrase the user is about to echo, so resonance fires. */
 function makeEchoIndex(): LexicalIndex {
  return buildIndex([
   {
    id: 's1',
    version: 1,
    captured: '2026-03-01T10:00:00Z',
    provenance: {
     kind: 'harvest' as const,
     session: 'sess-0',
     question: 'What do you do when a claim is popular?',
     questionForm: 'deliberative' as const,
    },
    prose: 'I default to hedging in whichever direction is socially cheaper.',
   },
  ]);
 }

 const ANSWER_A =
  'I default to hedging in whichever direction is socially cheaper, honestly.';
 const ANSWER_B =
  'Yes, I default to hedging in whichever direction is socially cheaper, still.';

 test('a near-duplicate juxtaposition is caught and falls through to the next priority', async () => {
  const idx = makeEchoIndex();
  // Build both juxtapositions from the phrase resonance will actually return,
  // so the test asserts the guard, not the phrase extractor.
  const phrase = resonate(idx, ANSWER_A)[0]!.sharedPhrase;
  const first = `Back in March you wrote "${phrase}" — what did that cost you?`;
  const second = `Back in March you wrote "${phrase}" — what has that cost you?`;

  const vault = makeFakeVault();
  const bank = [{ text: 'What is on your mind?', questionForm: 'deliberative' as const }];
  const complete = makeScriptedComplete([
   first,                                          // turn 1: juxtaposition, accepted
   second,                                         // turn 2: juxtaposition, near-duplicate
   '{}',                                           // turn 2: redLights — no lights
   'When did you first notice yourself doing that?', // turn 2: generic probe
  ]);
  const q = makeFakeQueue();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  const one = await userTurn(session, ANSWER_A);
  expect(one.kind).toBe('probe');
  if (one.kind === 'probe') {
   expect(one.text).toBe(first);
   expect(one.provenance).toBe('juxtaposition');
  }

  const two = await userTurn(session, ANSWER_B);
  expect(two.kind).toBe('probe');
  if (two.kind === 'probe') {
   expect(two.text).not.toBe(second);
   expect(two.text).toBe('When did you first notice yourself doing that?');
   expect(two.provenance).toBe('probe');
  }

  // The rejected juxtaposition never reached the transcript or the budget.
  expect(vault._turns(session.id).some((t) => t.text === second)).toBe(false);
 });

 test('a conversation-referential composed follow-up falls through to the generic probe', async () => {
  const vault = makeFakeVault();
  const bank = [{ text: 'What is on your mind?', questionForm: 'deliberative' as const }];
  const complete = makeScriptedComplete([
   JSON.stringify({ lights: [{ kind: 'odd-term', phrase: 'socially cheaper' }] }),
   'You wrote "socially cheaper". What are you trying to achieve in this conversation?',
   'When did you last notice yourself doing that?',
  ]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex(); // empty — no juxtaposition
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  const result = await userTurn(
   session,
   'I hedge in whichever direction is socially cheaper.',
  );

  expect(result.kind).toBe('probe');
  if (result.kind === 'probe') {
   expect(result.text).toBe('When did you last notice yourself doing that?');
   expect(result.provenance).toBe('probe');
   expect(result.text).not.toMatch(/\bthis conversation\b/i);
  }
 });

 test('a guard rejection in priority 1 costs no budget', async () => {
  const idx = makeEchoIndex();
  const phrase = resonate(idx, ANSWER_A)[0]!.sharedPhrase;
  const first = `Back in March you wrote "${phrase}" — what did that cost you?`;
  const second = `Back in March you wrote "${phrase}" — what has that cost you?`;

  const vault = makeFakeVault();
  const bank = [{ text: 'What is on your mind?', questionForm: 'deliberative' as const }];
  const complete = makeScriptedComplete([
   first,
   second,
   '{}',
   'When did you first notice yourself doing that?',
  ]);
  const q = makeFakeQueue();
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  await userTurn(session, ANSWER_A);
  await userTurn(session, ANSWER_B);

  // opener + one juxtaposition + one probe — the rejected question is not counted
  expect(session.questionCount).toBe(3);
 });
});

describe('startSession invariants', () => {
 test('exactly one opener turn per session', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const bank = [
   { text: 'What do you value?', questionForm: 'deliberative' as const },
  ];

  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx, bank },
  );

  // Exactly one turn, which is the agent opener
  expect(session.turns).toHaveLength(1);
  expect(session.turns[0]!.role).toBe('agent');

  // The vault also has exactly one turn
  const vaultTurns = vault._turns(session.id);
  expect(vaultTurns).toHaveLength(1);
  expect(vaultTurns[0]!.role).toBe('agent');
 });

 test('opener is never null or empty', () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete([]);
  const q = makeFakeQueue();
  const idx = makeFakeIndex();

  // No bank — uses starterBank from protocol
  const session = startSession(
   { minutes: 30, energy: 'medium' },
   { complete, vault, queue: q, index: idx },
  );

  expect(session.turns[0]!.text.length).toBeGreaterThan(0);
  expect(session.turns[0]!.text).toBeTruthy();
 });
});

/**
 * Persona 3, eval 2026-08-02: a sitting declared `target: domain, topic:
 * sourdough bread baking` and opened on a composed question minted from
 * unrelated self material, because the queue draw outranks the topic opener
 * and nothing in the draw looked at the Target (045). These run against the
 * real QueueStore — a fake queue would only test the fake.
 */
describe('startSession honours the declared Target', () => {
 /** Run `fn` with a real, empty queue over a throwaway vault root. */
 function withQueue(fn: (queue: QueueStore) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'elicit-elicitor-target-'));
  try {
   fn(createQueueStore(root));
  } finally {
   rmSync(root, { recursive: true, force: true });
  }
 }

 const selfEntry: QueueDraft = {
  source: 'composed',
  license: 'CC0',
  question: 'You wrote: "a resonance I long lost." What returned it to you?',
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'session',
  target: 'self',
 };

 test('a domain sitting opens on its topic rather than self material', () => {
  withQueue((queue) => {
   queue.add(selfEntry);

   const session = startSession(
    { minutes: 30, energy: 'medium', target: 'domain', topic: 'sourdough bread baking' },
    {
     complete: makeScriptedComplete([]),
     vault: makeFakeVault(),
     queue,
     index: makeFakeIndex(),
    },
   );

   expect(session.turns[0]!.text).toContain('sourdough bread baking');
   expect(session.turns[0]!.text).not.toBe(selfEntry.question);
   // The self entry was passed over, not spent — a self sitting still gets it.
   expect(queue.list({ status: 'pending' })).toHaveLength(1);
  });
 });

 test('a domain sitting still opens on a domain queue entry', () => {
  withQueue((queue) => {
   queue.add(selfEntry);
   const domain = queue.add({
    ...selfEntry,
    question: 'You wrote: "the starter smelled of acetone." What did you change?',
    target: 'domain',
   });

   const session = startSession(
    { minutes: 30, energy: 'medium', target: 'domain', topic: 'sourdough bread baking' },
    {
     complete: makeScriptedComplete([]),
     vault: makeFakeVault(),
     queue,
     index: makeFakeIndex(),
    },
   );

   expect(session.turns[0]!.text).toBe(domain.question);
  });
 });

 test('a self sitting opens on self material and never on domain material', () => {
  withQueue((queue) => {
   queue.add({ ...selfEntry, question: 'Domain question?', target: 'domain' });
   queue.add(selfEntry);

   const session = startSession(
    { minutes: 30, energy: 'medium', target: 'self' },
    {
     complete: makeScriptedComplete([]),
     vault: makeFakeVault(),
     queue,
     index: makeFakeIndex(),
    },
   );

   expect(session.turns[0]!.text).toBe(selfEntry.question);
  });
 });
});

describe('the open queue entry — which question the next turn answers (041)', () => {
 /** A queue that hands out a fixed pool and records what it was told. */
 function makeRecordingQueue(pool: QueueEntry[]): QueueStore & { answered: string[] } {
  const remaining = [...pool];
  const answered: string[] = [];
  return {
   add: (draft) => ({ ...draft, id: 'added', created: '', status: 'pending' as const }),
   list: () => [],
   draw: () => remaining.shift() ?? null,
   markAsked: () => { },
   markAnswered: (id) => { answered.push(id); },
   defer: () => { },
   expire: () => 0,
   answered,
  };
 }

 function entry(id: string, question: string): QueueEntry {
  return {
   id,
   status: 'pending',
   source: 'composed',
   license: 'machine',
   question,
   questionForm: 'deliberative',
   sharpness: 'weak',
   horizon: 'now',
   created: '2026-08-01T00:00:00.000Z',
  };
 }

 const BANK = [{ text: 'What are you avoiding?', questionForm: 'deliberative' as const }];
 const RICH = 'I remember deciding it, because the alternative asked more of me.';

 function open(queue: QueueStore, responses: string[]) {
  return startSession(
   { minutes: 30, energy: 'medium' },
   {
    complete: makeScriptedComplete(responses),
    vault: makeFakeVault(),
    queue,
    index: makeFakeIndex(),
    bank: BANK,
   },
  );
 }

 test('a queue opener is held open; a bank opener holds nothing', () => {
  const q = makeRecordingQueue([entry('q1', 'What did you leave behind?')]);
  expect(open(q, []).openQueueEntryId).toBe('q1');

  const bankSession = open(makeFakeQueue(), []);
  expect('openQueueEntryId' in bankSession).toBe(false);
 });

 test('one drawn question is answered once, however many turns follow', async () => {
  const q = makeRecordingQueue([entry('q1', 'What did you leave behind?')]);
  const session = open(q, turnResponses(['And what took its place?', 'Who else saw it?']));

  await userTurn(session, RICH);
  expect(q.answered).toEqual(['q1']);
  expect('openQueueEntryId' in session).toBe(false);

  await userTurn(session, 'It took the shape of a habit I could not name, and I let it.');
  expect(q.answered).toEqual(['q1']);
 });

 test('a skip drops the pairing, so the next turn marks nothing', async () => {
  const q = makeRecordingQueue([entry('q1', 'What did you leave behind?')]);
  const session = open(q, turnResponses(['And what took its place?']));

  expect(skipQuestion(session).kind).toBe('question');
  expect('openQueueEntryId' in session).toBe(false);

  await userTurn(session, RICH);
  expect(q.answered).toEqual([]);
 });

 test('a mid-session fallback draw becomes the entry the next turn answers', async () => {
  const q = makeRecordingQueue([
   entry('q1', 'What did you leave behind?'),
   entry('q2', 'What did you carry instead?'),
  ]);
  const session = open(q, turnResponses(['Who else saw it?']));

  // 'dunno' pivots to a fresh draw: q1 is answered, q2 takes its place.
  await userTurn(session, 'dunno');
  expect(q.answered).toEqual(['q1']);
  expect(session.openQueueEntryId).toBe('q2');

  await userTurn(session, RICH);
  expect(q.answered).toEqual(['q1', 'q2']);
 });
});
