/**
 * The sitting a snippet came from (045).
 *
 * These tests never hand-write a transcript. `Vault.startTranscript` writes
 * the frontmatter and `readSitting` reads it, so the format has one owner —
 * if the writer changes shape, these fail instead of passing against a stale
 * copy of the format kept here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createVault } from '../src/vault/vault.js';
import { readSitting, sittingCache } from '../src/clerk/sitting.js';
import type { Mode, Snippet, Vault, QueueEntry, QueueDraft, LexicalIndex, QueueStore } from '../src/types.js';
import type { SittingContext } from '../src/clerk/composed.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-sitting-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function startSitting(session: string, mode: Mode): void {
  createVault(root).startTranscript(session, {
    mode,
    protocol: 'unstructured',
    started: new Date().toISOString(),
  });
}

describe('readSitting', () => {
  it('reads the Target and topic a sitting declared', () => {
    startSitting('s-domain', {
      target: 'domain',
      topic: 'sourdough bread baking',
    });

    expect(readSitting(root, 's-domain')).toEqual({
      target: 'domain',
      topic: 'sourdough bread baking',
    });
  });

  it('reads a self sitting as self', () => {
    startSitting('s-self', { target: 'self' });
    expect(readSitting(root, 's-self')).toEqual({ target: 'self' });
  });

  // Absent is the load-bearing case: an entry with no Target claim stays
  // eligible for either sitting, so guessing here would silence half the queue.
  it('claims nothing when the sitting declared no Target', () => {
    startSitting('s-bare', {});
    expect(readSitting(root, 's-bare')).toEqual({});
  });

  it('claims nothing when the transcript is missing', () => {
    expect(readSitting(root, 's-never-existed')).toEqual({});
  });

  it('claims nothing when the transcript will not parse', () => {
    mkdirSync(join(root, 'transcripts'), { recursive: true });
    writeFileSync(join(root, 'transcripts', 's-broken.md'), '---\nmode: [unclosed\n', 'utf-8');
    expect(readSitting(root, 's-broken')).toEqual({});
  });

  it('rejects a Target that is not one of the two', () => {
    mkdirSync(join(root, 'transcripts'), { recursive: true });
    writeFileSync(
      join(root, 'transcripts', 's-odd.md'),
      '---\nsession: s-odd\nmode:\n  target: sideways\n---\n',
      'utf-8',
    );
    expect(readSitting(root, 's-odd')).toEqual({});
  });
});

describe('sittingCache', () => {
  it('reads each session once, however many snippets ask', () => {
    const read = vi.fn().mockReturnValue({ target: 'domain' as const });
    const sittingFor = sittingCache(root, read);

    sittingFor('s-1');
    sittingFor('s-1');
    sittingFor('s-2');
    sittingFor('s-1');

    expect(read).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The whole point: what the docket mints carries the sitting's Target.
// ---------------------------------------------------------------------------

function makeSnippet(id: string, session: string): Snippet {
  return {
    id,
    version: 1,
    captured: new Date().toISOString(),
    provenance: {
      kind: 'harvest',
      session,
      question: 'What matters?',
      questionForm: 'deliberative',
    },
    prose: `Snippet ${id} prose.`,
  };
}

function fakeVault(snippets: Snippet[]): Vault {
  return {
    saveSnippet: vi.fn(),
    saveVersion: vi.fn(),
    saveReading: vi.fn(),
    saveBud: vi.fn(),
    startTranscript: vi.fn(),
    appendTurn: vi.fn(),
    rebuildIndex: vi.fn().mockReturnValue({
      snippets: Object.fromEntries(snippets.map((s) => [s.id, s])),
      readings: {},
      buds: {},
    }),
  };
}

function fakeQueue(): QueueStore & { _entries: QueueEntry[] } {
  const _entries: QueueEntry[] = [];
  return {
    _entries,
    add(d: QueueDraft): QueueEntry {
      const entry = { ...d, id: `q-${_entries.length}`, status: 'pending', created: new Date().toISOString() } as QueueEntry;
      _entries.push(entry);
      return entry;
    },
    list() { return [..._entries]; },
    get(id: string): QueueEntry | undefined { return _entries.find((e) => e.id === id); },
    draw() { return null; },
    markAsked() {},
    markAnswered() {},
    markPending() { },
    defer() {},
    park() {},
    unpark() {},
    expire() { return 0; },
    expireTailBeyond() { return 0; },
    markExpired() {},
    recordReplyDisengagement() { return false; },
    noteSittingStarted() {},
  };
}

describe('runDocket carries the sitting Target onto what it mints', () => {
  it('hands composeOpener the Target of the sitting the snippet came from', async () => {
    const { runDocket } = await import('../src/clerk/docket.js');

    startSitting('s-domain', { target: 'domain', topic: 'sourdough' });
    startSitting('s-self', { target: 'self' });

    const snDomain = makeSnippet('sn-d', 's-domain');
    const snSelf = makeSnippet('sn-s', 's-self');

    const seen: Array<{ id: string; sitting: SittingContext | undefined }> = [];
    const composeOpener = vi.fn(
      async (s: Snippet, _c: unknown, sitting?: SittingContext) => {
        seen.push({ id: s.id, sitting });
        return {
          source: 'composed',
          license: 'CC0',
          question: `About "${s.prose}"?`,
          questionForm: 'deliberative',
          cites: [`${s.id}@1`],
          quotedFragment: s.prose,
          horizon: 'session',
          ...(sitting?.target ? { target: sitting.target } : {}),
          ...(sitting?.topic ? { topic: sitting.topic } : {}),
        } as QueueDraft;
      },
    );

    const queue = fakeQueue();
    await runDocket({
      vault: fakeVault([snDomain, snSelf]),
      queue,
      complete: vi.fn(),
      buildIndex: () => ({ _brand: 'LexicalIndex' } as unknown as LexicalIndex),
      composeOpener: composeOpener as never,
      listSessions: () => [
        { session: 's-domain', started: '2026-08-01T10:00:00Z', turnCount: 4, chars: 100 },
        { session: 's-self', started: '2026-08-01T09:00:00Z', turnCount: 4, chars: 100 },
      ],
      log: () => {},
      vaultRoot: root,
    });

    expect(seen).toEqual([
      { id: 'sn-d', sitting: { target: 'domain', topic: 'sourdough' } },
      { id: 'sn-s', sitting: { target: 'self' } },
    ]);

    // And the Target reaches the stored entry, which is what draw() filters on.
    expect(queue._entries.map((e) => [e.cites?.[0], e.target])).toEqual([
      ['sn-d@1', 'domain'],
      ['sn-s@1', 'self'],
    ]);
  });

  it('leaves the Target absent when the sitting declared none', async () => {
    const { runDocket } = await import('../src/clerk/docket.js');

    startSitting('s-bare', {});
    const sn = makeSnippet('sn-b', 's-bare');

    let handed: SittingContext | undefined = { target: 'self' };
    const composeOpener = vi.fn(async (_s: Snippet, _c: unknown, sitting?: SittingContext) => {
      handed = sitting;
      return null;
    });

    await runDocket({
      vault: fakeVault([sn]),
      queue: fakeQueue(),
      complete: vi.fn(),
      buildIndex: () => ({ _brand: 'LexicalIndex' } as unknown as LexicalIndex),
      composeOpener: composeOpener as never,
      listSessions: () => [{ session: 's-bare', started: '2026-08-01T10:00:00Z', turnCount: 4, chars: 100 }],
      log: () => {},
      vaultRoot: root,
    });

    expect(handed).toEqual({});
  });
});
