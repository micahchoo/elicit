import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Prosody, Turn, Vault, QueueStore, QueueDraft, LexicalIndex } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';
import { buildIndex } from '../src/index/lexical.js';
import { startSession, userTurn } from '../src/elicitor/elicitor.js';
import { createVault } from '../src/vault/vault.js';

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
  get: () => undefined,
  draw: () => null,
  markAsked: () => { },
  markAnswered: () => { },
  markPending: () => { },
  defer: () => { },
  park: () => { },
  unpark: () => { },
  expire: () => 0,
  expireTailBeyond: () => 0,
  markExpired: () => { },
    recordReplyDisengagement: () => false,
    noteSittingStarted: () => {},
  _adds: adds,
 };
}

/** Empty lexical index — resonate returns no hits. */
function makeFakeIndex(): LexicalIndex {
 return buildIndex([]);
}

/**
 * Build a scripted-complete response array for N userTurn calls.
 * Each turn consumes 1 complete call: the generic probe (the red-light channel is cut, 2026-08-09).
 * 1 for the generic probe.
 */
function turnResponses(probes: string[]): string[] {
 const out: string[] = [];
 for (const p of probes) {
  out.push(p);    // generic probe
 }
 return out;
}

describe('prosody', () => {
 it('spoken turn carries prosody fields', async () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete(turnResponses(['What makes you say that?']));
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   {},
   { complete, vault, queue: q, index: idx },
  );

  const mockProsody: Prosody = {
   decodeDurationMs: 1234,
   audioDurationMs: 5678,
   tokenCount: 42,
   tokensPerSec: 3.5,
   pauseCount: 2,
  };

  await userTurn(session, 'spoken text', true, mockProsody);

  const userTurns = session.turns.filter((t) => t.role === 'user');
  expect(userTurns).toHaveLength(1);
  expect(userTurns[0]!.spoken).toBe(true);
  expect(userTurns[0]!.prosody).toEqual(mockProsody);
 });

 it('typed turn carries no prosody key', async () => {
  const vault = makeFakeVault();
  const complete = makeScriptedComplete(turnResponses(['What makes you say that?']));
  const q = makeFakeQueue();
  const idx = makeFakeIndex();
  const session = startSession(
   {},
   { complete, vault, queue: q, index: idx },
  );

  await userTurn(session, 'typed text');

  const userTurns = session.turns.filter((t) => t.role === 'user');
  expect(userTurns).toHaveLength(1);
  expect('prosody' in userTurns[0]!).toBe(false);
 });

 it('no snippet record carries prosody fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'elicit-prosody-'));
  try {
   const vault = createVault(dir);
   const snippet = vault.saveSnippet('test prose', {
    kind: 'unprompted',
    session: 'test',
    question: '',
    questionForm: 'deliberative',
   });
   expect('prosody' in snippet).toBe(false);
   expect(Object.keys(snippet)).not.toContain('prosody');
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
 });
});
