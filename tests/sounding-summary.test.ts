import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type { ParkedLadder, Vault } from '../src/types.js';
import { writeLadder } from '../src/sounding/park.js';
import {
  summarizeLadder,
  saveLadderSummary,
  loadLadderSummary,
  runLadderSummaries,
} from '../src/clerk/sounding-summary.js';
import { makeScriptedComplete } from './fakes.js';

/**
 * The ladder summary (011 T11): one line standing for the rungs a
 * compaction drops, written in the background by the clerk model and filed
 * in marginalia — never a Snippet. Every test drives a SCRIPTED completer
 * (tests/fakes.ts); the live model is never called from here.
 */

const MODEL = 'qwen3.6:35b';
const LINE = 'it ran from being seen to a shed nobody entered';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-sounding-summary-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A full 9-rung ladder; `ladderOf(n)` takes its LAST n rungs (T10's fixture shape). */
const rungs = Array.from({ length: 9 }, (_, i) => ({
  question: `question ${i}`,
  foothold: `foothold ${i}`,
  answer: `answer ${i}`,
  at: `2026-08-02T12:00:0${i}.000Z`,
}));

function ladderOf(n: number): ParkedLadder {
  return {
    id: ulid(),
    session: ulid(),
    started: '2026-08-02T12:00:00.000Z',
    construct: 'the pull',
    licensingAnswer: 'I keep feeling "the pull"',
    allowance: n,
    checkpointRung: Math.ceil(n / 2),
    rungs: rungs.slice(-n),
    ended: '2026-08-02T12:30:00.000Z',
    endedBy: 'park',
  };
}

describe('the ladder summary (011 T11)', () => {
  test('the summary is one line, stamped with the clerk model', async () => {
    const s = await summarizeLadder(ladderOf(9), makeScriptedComplete([LINE]), MODEL);
    expect(s).not.toBeNull();
    expect(s!.line).not.toContain('\n');
    expect(s!.line).toBe(LINE);
    expect(s!.model).toBe(MODEL);
  });

  test('an empty completion writes nothing', async () => {
    const l = ladderOf(9);
    writeLadder(root, l);
    expect(await summarizeLadder(l, makeScriptedComplete(['']), MODEL)).toBe(null);
    // nothing was saved: the ladder reads back as having no summary
    expect(loadLadderSummary(root, l.id)).toBe(null);
  });

  test('a ladder with a summary is not summarized twice', async () => {
    const l = ladderOf(9);
    writeLadder(root, l);
    // One scripted response: the second run must not call the model at all,
    // or the scripted completer throws and the test fails.
    const deps = { root, complete: makeScriptedComplete([LINE]), model: MODEL, log: () => {} };
    expect((await runLadderSummaries(deps)).summarized).toBe(1);
    expect((await runLadderSummaries(deps)).summarized).toBe(0);
    expect(loadLadderSummary(root, l.id)).toBe(LINE);
  });

  test('a summary never becomes a snippet', async () => {
    const l = ladderOf(9);
    writeLadder(root, l);
    // A vault whose saveSnippet would explode. It rides along in the deps
    // object and is never reached: the job's whole write surface is the
    // marginalia directory, and it has no path to a snippet. The test
    // passes exactly because saveSnippet is never called.
    const vault = {
      saveSnippet: (): never => {
        throw new Error('saveSnippet must never be called');
      },
    } as unknown as Vault;
    const events: { at: string; actor: string; kind: string; detail: string }[] = [];
    const deps = { root, complete: makeScriptedComplete([LINE]), model: MODEL, log: (e: { at: string; actor: string; kind: string; detail: string }) => events.push(e), vault };
    const r = await runLadderSummaries(deps);
    expect(r.summarized).toBe(1);
    expect(events.map((e) => e.kind)).toContain('sounding-summarized');
    // The one line sits in marginalia, and no snippet directory exists.
    expect(existsSync(join(root, 'marginalia', 'sounding-summaries', `${l.id}.md`))).toBe(true);
    expect(existsSync(join(root, 'snippets'))).toBe(false);
  });

  test('a saved summary round-trips through markdown with its stamp', async () => {
    const l = ladderOf(9);
    saveLadderSummary(root, l.id, { line: LINE, model: MODEL, at: '2026-08-02T12:40:00.000Z' });
    expect(loadLadderSummary(root, l.id)).toBe(LINE);
    // loadLadderSummary never returns a summary that is not on disk
    expect(loadLadderSummary(root, 'missing')).toBe(null);
  });

  test('the job summarizes only ladders with `ended` set', async () => {
    const l = ladderOf(9);
    writeLadder(root, l);
    // A live descent's file: same shape, no `ended` stamp. Written directly
    // because writeLadder always stamps `ended`.
    const live = ladderOf(3);
    const fm: Record<string, unknown> = {
      id: live.id,
      session: live.session,
      started: live.started,
      construct: live.construct,
      licensingAnswer: live.licensingAnswer,
      allowance: live.allowance,
      checkpointRung: live.checkpointRung,
      rungs: live.rungs,
      endedBy: live.endedBy,
    };
    writeFileSync(join(root, 'soundings', `${live.id}.md`), matter.stringify('', fm), 'utf-8');
    const r = await runLadderSummaries({
      root,
      complete: makeScriptedComplete([LINE]),
      model: MODEL,
      log: () => {},
    });
    expect(r.summarized).toBe(1);
    expect(loadLadderSummary(root, l.id)).toBe(LINE);
    expect(loadLadderSummary(root, live.id)).toBe(null);
  });
});
