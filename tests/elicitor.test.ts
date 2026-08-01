import { describe, expect, test } from 'vitest';
import type { Turn, Vault } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';
import { startSession, userTurn, skipQuestion } from '../src/elicitor/elicitor.js';
import { starterBank, MAX_PROBES } from '../src/elicitor/protocol.js';

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

describe('elicitor', () => {
  test('opener from starter bank when no topic', () => {
    const vault = makeFakeVault();
    const complete = makeScriptedComplete([]);
    const session = startSession(
      { minutes: 30, energy: 'medium' },
      { complete, vault },
    );

    const starterTexts = starterBank.map((s) => s.text);
    expect(starterTexts).toContain(session.turns[0]!.text);
    expect(session.turns[0]!.questionForm).toBeDefined();
    expect(session.turns[0]!.role).toBe('agent');
  });

  test('opener from topic when mode.topic is set', () => {
    const vault = makeFakeVault();
    const complete = makeScriptedComplete([]);
    const session = startSession(
      { minutes: 30, energy: 'medium', topic: 'regret' },
      { complete, vault },
    );

    expect(session.turns[0]!.text).toContain('regret');
    expect(session.turns[0]!.questionForm).toBe('deliberative');
  });

  test('probe text returned verbatim from fake', async () => {
    const vault = makeFakeVault();
    const complete = makeScriptedComplete(['What makes you say that?']);
    const session = startSession(
      { minutes: 30, energy: 'medium' },
      { complete, vault },
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
    const complete = makeScriptedComplete(['Probe one', 'Probe two']);
    const session = startSession(
      { minutes: 30, energy: 'medium' },
      { complete, vault },
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
    const complete = makeScriptedComplete(['[SATURATED]']);
    const session = startSession(
      { minutes: 30, energy: 'medium' },
      { complete, vault },
    );

    const result = await userTurn(session, 'Not much to say really.');

    expect(result.kind).toBe('saturated');
    // User turn still recorded; no agent turn follows saturation.
    expect(vault._turns(session.id)).toHaveLength(2); // opener + user
  });

  test('7th probe never happens — max-probe saturation', async () => {
    const vault = makeFakeVault();
    // Queue exactly 5 responses: probes 2 through 6 (opener is probe 1).
    const complete = makeScriptedComplete(['P2', 'P3', 'P4', 'P5', 'P6']);
    const session = startSession(
      { minutes: 30, energy: 'medium' },
      { complete, vault },
    );

    // userTurn calls that produce probes 2–6
    await userTurn(session, 'A1');
    await userTurn(session, 'A2');
    await userTurn(session, 'A3');
    await userTurn(session, 'A4');
    await userTurn(session, 'A5');

    // After 6 probes, the next userTurn must return saturated without
    // calling complete (the fake would throw if called again).
    const result = await userTurn(session, 'A6');

    expect(result.kind).toBe('saturated');

    // Verify all 5 queued responses were consumed.
    // We can't directly check the queue, but if complete was called a 6th
    // time the fake would have thrown — reaching here proves it wasn't.

    // Transcript: opener + 5 user turns + 5 probes = 11 turns.
    // The 6th user turn ("A6") is still appended before saturation check.
    expect(vault._turns(session.id)).toHaveLength(12);
    // turns: agent(opener) user(A1) agent(P2) user(A2) agent(P3) user(A3)
    //        agent(P4) user(A4) agent(P5) user(A5) agent(P6) user(A6)
  });

  test('session transcript carries mode metadata', () => {
    const vault = makeFakeVault();
    const complete = makeScriptedComplete([]);
    const session = startSession(
      { minutes: 15, energy: 'low' },
      { complete, vault },
    );

    expect(session.mode.minutes).toBe(15);
    expect(session.mode.energy).toBe('low');
    expect(session.protocol).toBe('reflective-interview');
    expect(session.id).toBeTruthy();
  });

  test('every turn is in transcript before userTurn returns', async () => {
    const vault = makeFakeVault();
    const complete = makeScriptedComplete(['Elaborate?']);
    const session = startSession(
      { minutes: 30, energy: 'high' },
      { complete, vault },
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
    const s = startSession({ minutes: 25, energy: 'medium' }, { complete, vault });
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
    const s = startSession({ minutes: 25, energy: 'medium' }, { complete, vault });
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

  test('skip does not count toward MAX_PROBES', async () => {
    const vault = makeFakeVault();
    // 5 probe responses
    const complete = makeScriptedComplete([
      'What do you mean by that?',
      'Can you say more?',
      'How did that feel?',
      'What happened next?',
      'Why was that important?',
    ]);
    const s = startSession({ minutes: 25, energy: 'medium' }, { complete, vault });

    // skip the opener
    const skipResult = skipQuestion(s);
    expect(skipResult.kind).toBe('question');

    // 5 probes still fit (MAX_PROBES=6, probeCount after skip = 1 not-skipped agent)
    for (let i = 0; i < 5; i++) {
      const r = await userTurn(s, `answer ${i}`);
      expect(r.kind).toBe('probe');
    }

    // 6th should saturate
    const saturated = await userTurn(s, 'one too many');
    expect(saturated.kind).toBe('saturated');
  });

  test('skip exhausts after all 10 starters used', () => {
    const vault = makeFakeVault();
    const complete = makeScriptedComplete([]);
    const s = startSession({ minutes: 25, energy: 'medium' }, { complete, vault });

    // Skip 9 times — the opener used 1 starter, so 9 more skips use the remaining 9
    for (let i = 0; i < 9; i++) {
      const r = skipQuestion(s);
      expect(r.kind).toBe('question');
    }

    // 10th skip should exhaust (all 10 starters used)
    const exhausted = skipQuestion(s);
    expect(exhausted.kind).toBe('exhausted');

    // No new turn appended on exhaustion
    const agentTurns = s.turns.filter((t) => t.role === 'agent');
    expect(agentTurns.length).toBe(10); // 1 opener + 9 replacements, no 10th
  });
});
