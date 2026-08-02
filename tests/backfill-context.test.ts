import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import {
  backfillContext,
  parseUserTurns,
  readAllSnippets,
  stampContext,
  isBackfillCandidate,
} from '../scripts/backfill-context.js';
import type { Provenance } from '../src/types.js';

// ---------------------------------------------------------------------------
// Backfill behavior (ticket 073): the script locates each harvest snippet's
// text in its source transcript, takes the EARLIEST user turn that contains
// it, and stamps up to two preceding sentences into provenance.context —
// without ever overwriting a context that is already there.
// ---------------------------------------------------------------------------

describe('backfill context logic', () => {
  it('earliest turn wins when the snippet appears in multiple turns', () => {
    // A transcript exactly as vault.appendTurn writes it: frontmatter, then
    // `## agent` / `## user` blocks. The snippet text "I value Y." appears in
    // BOTH user turns — the backfill must use the earlier one.
    const transcript = [
      '---\nsession: sess-1\nmode: sitting\nprotocol: cdm\nstarted: 2026-08-02T00:00:00.000Z\n---\n',
      '## agent\n\nWhat do you value?\n\n',
      '## user\n\nI think X. I value Y.\n\n',
      '## agent\n\nTell me more.\n\n',
      '## user\n\nI now think Z. I value Y. Also W.\n',
    ].join('');

    const turns = parseUserTurns(transcript);
    expect(turns).toHaveLength(2);

    // The main loop takes the first turn whose text contains the prose verbatim.
    const prose = 'I value Y.';
    const earliest = turns.findIndex((t) => t.includes(prose));
    expect(earliest).toBe(0);

    const context = backfillContext(turns[earliest]!, prose);
    expect(context).toBe('I think X.');

    // The later turn would have produced a different context — proving the
    // earliest match is the one that matters.
    expect(backfillContext(turns[1]!, prose)).toBe('I now think Z.');
  });

  it('parses user turns out of a vault transcript, skipping agent turns', () => {
    const transcript = [
      '---\nsession: sess-1\nmode: sitting\nprotocol: cdm\nstarted: 2026-08-02T00:00:00.000Z\n---\n',
      '## agent\n\nOpening probe.\n\n',
      '## user\n\nFirst thing I said.\n\n',
      '## agent\n\nTell me more.\n\n',
      '## user\n\nSecond thing I said, with no trailing heading.\n',
    ].join('');

    expect(parseUserTurns(transcript)).toEqual([
      'First thing I said.',
      'Second thing I said, with no trailing heading.',
    ]);
  });

  it('round-trip: stamped context survives a vault write and read', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-bc-test-'));
    try {
      const filePath = join(root, 'snippets', 'test-id', 'v1.md');
      mkdirSync(join(root, 'snippets', 'test-id'), { recursive: true });

      const provenance: Provenance = {
        kind: 'harvest',
        session: 'sess-1',
        question: 'What did you learn?',
        questionForm: 'deliberative',
      };
      writeFileSync(
        filePath,
        matter.stringify('The snippet text itself.', {
          id: 'test-id',
          version: 1,
          captured: '2026-08-02T00:00:00.000Z',
          provenance,
        }),
        'utf-8',
      );

      expect(stampContext(filePath, 'Preceding sentence that sets this up.')).toBe(true);

      const parsed = matter.read(filePath);
      const data = parsed.data as {
        id: string;
        version: number;
        captured: string;
        provenance: Provenance;
      };
      expect(data.provenance.context).toBe('Preceding sentence that sets this up.');
      // The prose is untouched by the stamp.
      expect(parsed.content.trimEnd()).toBe('The snippet text itself.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('idempotent: never overwrites an already-stamped context', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-bc-test-'));
    try {
      const filePath = join(root, 'snippets', 'test-id', 'v1.md');
      mkdirSync(join(root, 'snippets', 'test-id'), { recursive: true });

      writeFileSync(
        filePath,
        matter.stringify('The snippet text itself.', {
          id: 'test-id',
          version: 1,
          captured: '2026-08-02T00:00:00.000Z',
          provenance: {
            kind: 'harvest',
            session: 'sess-1',
            question: 'What did you learn?',
            questionForm: 'deliberative',
            context: 'The original context, already on disk.',
          },
        }),
        'utf-8',
      );

      // A second stamp with a different value must be refused...
      expect(stampContext(filePath, 'A replacement context.')).toBe(false);

      // ...and the original value must still be what the file carries.
      const parsed = matter.read(filePath);
      const data = parsed.data as { provenance: Provenance };
      expect(data.provenance.context).toBe('The original context, already on disk.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('candidate predicate: harvest snippets without context only', () => {
    expect(
      isBackfillCandidate({
        kind: 'harvest',
        session: 's',
        question: 'q',
        questionForm: 'deliberative',
      }),
    ).toBe(true);
    expect(
      isBackfillCandidate({
        kind: 'harvest',
        session: 's',
        question: 'q',
        questionForm: 'deliberative',
        context: '',
      }),
    ).toBe(true);
    expect(
      isBackfillCandidate({
        kind: 'harvest',
        session: 's',
        question: 'q',
        questionForm: 'deliberative',
        context: 'existing',
      }),
    ).toBe(false);
    // Restatements are the reviewer's rewrite — never verbatim in the
    // transcript, so never locatable. Unprompted material has no question.
    expect(
      isBackfillCandidate({
        kind: 'restatement',
        session: 's',
        question: 'q',
        questionForm: 'deliberative',
      }),
    ).toBe(false);
    expect(
      isBackfillCandidate({
        kind: 'unprompted',
        session: 's',
        question: '',
        questionForm: 'deliberative',
      }),
    ).toBe(false);
  });

  it('vault scanner reads a stamped snippet back with its context intact', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-bc-test-'));
    try {
      const dir = join(root, 'snippets', 'test-id');
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'v1.md'),
        matter.stringify('The snippet text itself.', {
          id: 'test-id',
          version: 1,
          captured: '2026-08-02T00:00:00.000Z',
          provenance: {
            kind: 'harvest',
            session: 'sess-1',
            question: 'What did you learn?',
            questionForm: 'deliberative',
            context: 'Preceding sentence that sets this up.',
          },
        }),
        'utf-8',
      );

      // readAllSnippets accepts the vault root explicitly, so a temp vault
      // can be scanned without touching the environment or re-importing.
      const entries = readAllSnippets(root);

      expect(entries).toHaveLength(1);
      expect(entries[0]!.provenance.context).toBe('Preceding sentence that sets this up.');
      expect(entries[0]!.prose).toBe('The snippet text itself.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
