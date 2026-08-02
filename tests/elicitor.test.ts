import { describe, expect, test } from 'vitest';
import type { Turn, Vault, QueueStore, LexicalIndex } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';
import { startSession, userTurn, skipQuestion } from '../src/elicitor/elicitor.js';
import { CLOSING_DOOR_QUESTION, CLOSING_BOOKMARK_QUESTION } from '../src/elicitor/protocol.js';
import { buildIndex } from '../src/index/lexical.js';

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
function makeFakeQueue(): QueueStore & { _adds: Array<{ question: string }> } {
 const adds: Array<{ question: string }> = [];
 return {
  add(draft) {
   adds.push({ question: draft.question });
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

  const result = await userTurn(session, 'Not much to say really.');

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
  expect(session.protocol).toBe('self');
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
