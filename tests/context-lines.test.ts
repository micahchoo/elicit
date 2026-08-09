/**
 * Context-line composition tests — Batch B2, §11 of the redesign.
 *
 * The job (src/clerk/context-lines.ts) composes one context line per
 * passage without one: MECHANICAL facts (when, what question drew it,
 * what stood before it, the resonance echoes) plus ONE model call that
 * turns them into the echo/clash sentence. These tests pin the line
 * shape, the Q-34 stamp, the read-then-upsert merge rule, the coverage
 * sentence (§12: starvation is a sentence), the quota clip, and the
 * prompt's discipline — the line describes the utterance and its
 * circumstances, never the person, and quotes no prose from the person.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVault } from '../src/vault/vault.js';
import { readTranscriptBody } from '../src/vault/transcripts.js';
import { createQueueStore } from '../src/queue/queue.js';
import type { Vault, Complete, LexicalIndex } from '../src/types.js';
import {
  runContextLines,
  composeContextLine,
  CONTEXT_LINE_SYSTEM,
} from '../src/clerk/context-lines.js';
import { readContextLines, writeContextLines } from '../src/wiki/store.js';
import { runDocket } from '../src/clerk/docket.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'elicit-context-lines-'));
}

/** A Complete that records every call and returns one scripted line. */
function capturingComplete(line: string, calls: { system: string; user: string }[]): Complete {
  return async (system, turns) => {
    calls.push({ system, user: turns.map((t) => t.text).join('\n') });
    return line;
  };
}

const NOW = '2026-08-01T10:00:00Z';

/** One sitting with an eliciting question and one verbatim answer turn. */
function setupVault(root: string): { vault: Vault; passages: { id: string; prose: string }[] } {
  const vault = createVault(root);
  vault.startTranscript('s1', { mode: { target: 'self' }, protocol: 'reflective', started: NOW });
  vault.appendTurn('s1', { role: 'agent', text: 'What has been on your mind lately?', at: NOW });
  vault.appendTurn('s1', {
    role: 'user',
    text: 'I keep coming back to the same question about the garden.',
    at: NOW,
  });
  const a = vault.saveSnippet('I keep coming back to the same question about the garden.', {
    kind: 'harvest',
    session: 's1',
    question: 'What has been on your mind lately?',
    questionForm: 'deliberative',
  });
  const b = vault.saveSnippet('The same question about the garden came up again last week.', {
    kind: 'harvest',
    session: 's1',
    question: 'What has been on your mind lately?',
    questionForm: 'deliberative',
  });
  return { vault, passages: [{ id: a.id, prose: a.prose }, { id: b.id, prose: b.prose }] };
}

describe('runContextLines', () => {
  let root: string;

  beforeEach(() => {
    root = tempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('composes a stamped line from the mechanical facts with a scripted complete', async () => {
    const { vault, passages } = setupVault(root);
    const calls: { system: string; user: string }[] = [];
    const line = 'said in March, drawn by a question about what has been on the mind, echoing an older passage on the same theme.';
    const complete = capturingComplete(line, calls);
    const log = vi.fn();

    const result = await runContextLines({
      vault,
      vaultRoot: root,
      complete,
      modelName: 'test-model',
      readTranscript: readTranscriptBody,
      log,
    });

    expect(result).toEqual({ composed: 2, skipped: 0 });
    const lines = readContextLines(root);
    expect(lines).toHaveLength(2);

    // The stamp lands (Q-34): model + when.
    for (const l of lines) {
      expect(l.text).toBe(line);
      expect(l.model).toBe('test-model');
      expect(l.at).toBeTruthy();
    }

    // The passage ids are the lines' keys.
    const ids = new Set(lines.map((l) => l.passageId));
    expect(ids).toEqual(new Set(passages.map((p) => p.id)));

    // The mechanical facts reached the model: the eliciting question and
    // what stood before it in the conversation (passage A's words are in
    // the transcript; passage B's are not, so its before reads "none").
    const userA = calls.find((c) =>
      c.user.includes('I keep coming back to the same question about the garden.'),
    )!;
    expect(userA.user).toContain('question that drew it: What has been on your mind lately?');
    expect(userA.user).toContain('Q: What has been on your mind lately?');
    const userB = calls.find((c) =>
      c.user.includes('The same question about the garden came up again last week.'),
    )!;
    expect(userB.user).toContain('what stood before it: none recorded');
  });

  it('never lets a passage echo itself; the echoes cite the older passage', async () => {
    const { vault, passages } = setupVault(root);
    const complete = capturingComplete('echoes the same theme.', []);
    await runContextLines({
      vault,
      vaultRoot: root,
      complete,
      modelName: 'test-model',
      readTranscript: readTranscriptBody,
      log: vi.fn(),
    });

    const byId = new Map(readContextLines(root).map((l) => [l.passageId, l]));
    for (const p of passages) {
      const line = byId.get(p.id)!;
      expect(line.echoes).not.toContain(p.id);
      // The other passage shares its words, so it is the echo.
      const other = passages.find((x) => x.id !== p.id)!;
      expect(line.echoes).toContain(other.id);
    }
  });

  it('read-then-upserts: existing lines survive and are never recomposed', async () => {
    const { vault, passages } = setupVault(root);
    // A user-fixed line for one passage (no model stamp — the page's verbs
    // wrote it), plus a line for a passage outside the run.
    writeContextLines(root, [
      { passageId: passages[0]!.id, text: 'the person fixed this line', echoes: [], at: NOW },
    ]);
    const complete = vi.fn(async () => 'a fresh line');
    await runContextLines({
      vault,
      vaultRoot: root,
      complete,
      modelName: 'test-model',
      readTranscript: readTranscriptBody,
      log: vi.fn(),
    });

    // Exactly ONE model call: the fixed passage was not recomposed.
    expect(complete).toHaveBeenCalledTimes(1);
    const lines = readContextLines(root);
    const fixed = lines.find((l) => l.passageId === passages[0]!.id)!;
    expect(fixed.text).toBe('the person fixed this line');
    expect(fixed.model).toBeUndefined();
    // The other passage got a stamped fresh line.
    const other = lines.find((l) => l.passageId === passages[1]!.id)!;
    expect(other.text).toBe('a fresh line');
    expect(other.model).toBe('test-model');
  });

  it('clips at the per-run quota and logs the clip as skipped', async () => {
    const vault = createVault(root);
    vault.startTranscript('s1', { mode: {}, protocol: 'reflective', started: NOW });
    vault.appendTurn('s1', { role: 'agent', text: 'A question?', at: NOW });
    for (let i = 0; i < 12; i++) {
      vault.appendTurn('s1', { role: 'user', text: `passage number ${i} with distinct words to speak.`, at: NOW });
      vault.saveSnippet(`passage number ${i} with distinct words to speak.`, {
        kind: 'harvest',
        session: 's1',
        question: 'A question?',
        questionForm: 'deliberative',
      });
    }
    const complete = capturingComplete('a composed line for one passage.', []);
    const log = vi.fn();
    const result = await runContextLines({
      vault,
      vaultRoot: root,
      complete,
      modelName: 'test-model',
      readTranscript: readTranscriptBody,
      log,
    });

    // contextLines.perRun = 10: ten composed, the other two skipped.
    expect(result.composed).toBe(10);
    expect(result.skipped).toBe(2);
    const coverage = log.mock.calls.map((c) => c[0]).find((e) => e.kind === 'context-lines-composed')!;
    expect(coverage.detail).toBe('composed=10 skipped=2 cap=10');
  });

  it('logs coverage even when there is nothing to do — a zero is a sentence', async () => {
    const { vault } = setupVault(root);
    const log = vi.fn();
    // First run composes lines for both passages.
    await runContextLines({
      vault,
      vaultRoot: root,
      complete: capturingComplete('first line.', []),
      modelName: 'test-model',
      readTranscript: readTranscriptBody,
      log,
    });
    // Second run: every passage has a line; the model must not be called.
    const complete = vi.fn(async () => 'should never be called');
    await runContextLines({
      vault,
      vaultRoot: root,
      complete,
      modelName: 'test-model',
      readTranscript: readTranscriptBody,
      log,
    });
    expect(complete).not.toHaveBeenCalled();
    const coverage = log.mock.calls.map((c) => c[0]).filter((e) => e.kind === 'context-lines-composed');
    expect(coverage).toHaveLength(2);
    expect(coverage[1]!.detail).toBe('composed=0 skipped=0 cap=10');
  });

  it('logs coverage even when the vault has no passages at all', async () => {
    const vault = createVault(root);
    const log = vi.fn();
    const result = await runContextLines({
      vault,
      vaultRoot: root,
      complete: capturingComplete('never used.', []),
      modelName: 'test-model',
      log,
    });
    expect(result).toEqual({ composed: 0, skipped: 0 });
    const coverage = log.mock.calls.map((c) => c[0]).find((e) => e.kind === 'context-lines-composed')!;
    expect(coverage.detail).toBe('composed=0 skipped=0 cap=10');
  });

  it('a failed model call is a skipped passage, never a dead run', async () => {
    const { vault } = setupVault(root);
    const complete = vi.fn(async () => {
      throw new Error('model blew up');
    });
    const log = vi.fn();
    const result = await runContextLines({
      vault,
      vaultRoot: root,
      complete,
      modelName: 'test-model',
      readTranscript: readTranscriptBody,
      log,
    });
    // Both passages were eligible; both failed; none composed.
    expect(result).toEqual({ composed: 0, skipped: 2 });
    expect(readContextLines(root)).toHaveLength(0);
  });
});

describe('composeContextLine', () => {
  it('builds the user turn from the mechanical facts, one call only', async () => {
    const calls: { system: string; user: string }[] = [];
    const complete = capturingComplete('the line.', calls);
    const result = await composeContextLine({
      s: {
        id: 'p1',
        version: 1,
        captured: '2026-03-12T09:00:00Z',
        provenance: {
          kind: 'harvest',
          session: 's1',
          question: 'What changed?',
          questionForm: 'deliberative',
        },
        prose: 'The work changed shape after the move.',
      },
      before: 'Q: What changed?',
      echoes: [{ passageId: 'p2', captured: '2024-03-05T09:00:00Z', sharedPhrase: 'work changed shape', score: 3 }],
      complete,
    });

    expect(calls).toHaveLength(1);
    expect(result.text).toBe('the line.');
    expect(result.echoes).toEqual(['p2']);
    const user = calls[0]!.user;
    expect(user).toContain('when: 2026-03-12T09:00:00Z');
    expect(user).toContain('question that drew it: What changed?');
    expect(user).toContain('what stood before it: Q: What changed?');
    expect(user).toContain('passage p2 (2024-03-05) shares the phrase "work changed shape"');
  });

  it('says "unprompted" when no question drew the words', async () => {
    const calls: { system: string; user: string }[] = [];
    const complete = capturingComplete('the line.', calls);
    await composeContextLine({
      s: {
        id: 'p1',
        version: 1,
        captured: '2026-03-12T09:00:00Z',
        provenance: { kind: 'unprompted', session: '', question: '', questionForm: 'deliberative' },
        prose: 'Just words with no question behind them.',
      },
      before: '',
      echoes: [],
      complete,
    });
    expect(calls[0]!.user).toContain('question that drew it: none — these words were written unprompted');
    expect(calls[0]!.user).toContain('it echoes or clashes with: nothing found across the corpus');
  });
});

describe('the prompt discipline (the whole product)', () => {
  it('describes the utterance and its circumstances, never the person', () => {
    expect(CONTEXT_LINE_SYSTEM).toContain(
      'The line describes the utterance and its circumstances, never the person.',
    );
  });

  it('never quotes the person’s prose', () => {
    expect(CONTEXT_LINE_SYSTEM).toContain('Quote no prose from the person');
    expect(CONTEXT_LINE_SYSTEM).toContain(
      'not the passage, not any other passage, not a phrase of either',
    );
  });

  it('forbids trait sentences about the person', () => {
    expect(CONTEXT_LINE_SYSTEM).toContain('Never write a trait sentence about the person.');
  });

  it('asks for one plain sentence, no preamble', () => {
    expect(CONTEXT_LINE_SYSTEM).toContain('Reply with one plain sentence. No preamble.');
  });
});

describe('runDocket wiring', () => {
  it('calls the injected thunk, reports the counts, and logs the coverage', async () => {
    const root = tempDir();
    try {
      const { vault, passages } = setupVault(root);
      const log = vi.fn();
      const complete = capturingComplete('a line for the docket run.', []);
      const report = await runDocket({
        vault,
        queue: createQueueStore(join(root, 'vault')),
        complete: vi.fn() as unknown as Complete,
        buildIndex: (snippets) => ({ _brand: 'LexicalIndex' }) as LexicalIndex,
        composeOpener: async () => null,
        log,
        vaultRoot: root,
        runContextLines: () =>
          runContextLines({
            vault,
            vaultRoot: root,
            complete,
            modelName: 'test-model',
            readTranscript: readTranscriptBody,
            log,
          }),
      });

      expect(report.contextLines).toEqual({ composed: 2, skipped: 0 });
      // The coverage sentence hit the activity log.
      const coverage = log.mock.calls.map((c) => c[0]).find((e) => e.kind === 'context-lines-composed')!;
      expect(coverage.detail).toBe('composed=2 skipped=0 cap=10');
      // The lines landed on disk.
      const lines = readContextLines(root);
      expect(lines).toHaveLength(2);
      expect(new Set(lines.map((l) => l.passageId))).toEqual(new Set(passages.map((p) => p.id)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves report.contextLines absent when no thunk is injected', async () => {
    const root = tempDir();
    try {
      const vault = createVault(root);
      const report = await runDocket({
        vault,
        queue: createQueueStore(join(root, 'vault')),
        complete: vi.fn() as unknown as Complete,
        buildIndex: (snippets) => ({ _brand: 'LexicalIndex' }) as LexicalIndex,
        composeOpener: async () => null,
        log: vi.fn(),
        vaultRoot: root,
      });
      expect(report.contextLines).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
