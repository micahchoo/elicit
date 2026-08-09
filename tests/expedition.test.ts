import { describe, it, expect, vi } from 'vitest';
import {
  isExpeditionCandidate,
  composeExpedition,
} from '../src/clerk/composed.js';
import { runDocket } from '../src/clerk/docket.js';
import type {
  Complete,
  Snippet,
  Reading,
  QueueEntry,
  QueueDraft,
  Turn,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Scripted fake Complete — returns queued responses in order
// ---------------------------------------------------------------------------

function fakeComplete(...responses: string[]): Complete {
  let i = 0;
  return async (_system: string, _turns: Turn[], _opts?: { temperature?: number }) => {
    if (i >= responses.length) {
      throw new Error(`fakeComplete exhausted after ${responses.length} response(s)`);
    }
    return responses[i++]!;
  };
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

function makeSnippet(overrides?: Partial<Snippet>): Snippet {
  return {
    id: 's1',
    version: 3,
    captured: '2026-01-15T10:00:00Z',
    provenance: {
      kind: 'harvest',
      session: 'sess-1',
      question: 'What do you value most?',
      questionForm: 'deliberative',
      span: { start: 0, end: 50 },
    },
    prose: 'I value deep work over shallow productivity. Meetings steal my best hours.',
    ...overrides,
  };
}

function makeReading(overrides?: Partial<Reading>): Reading {
  return {
    id: 'r1',
    facet: 'fact',
    stance: 'avowal',
    cites: ['s1@3'],
    reading: 'The user values deep work.',
    ...overrides,
  };
}

function makeQueueEntry(overrides?: Partial<QueueEntry>): QueueEntry {
  return {
    id: 'q1',
    status: 'asked',
    source: 'composed',
    license: 'CC0',
    question: 'What do you think?',
    questionForm: 'deliberative',
    horizon: 'now',
    created: '2026-06-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isExpeditionCandidate
// ---------------------------------------------------------------------------

describe('isExpeditionCandidate', () => {
  it('returns true when snippet has fact facet, cited by ≥2 asked, no episode sibling', () => {
    const snippet = makeSnippet();
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'fact', cites: ['s1@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(true);
  });

  it('returns true for construct facet', () => {
    const snippet = makeSnippet();
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'construct', cites: ['s1@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(true);
  });

  it('returns false when no reading has fact or construct facet', () => {
    const snippet = makeSnippet();
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'episode', cites: ['s1@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(false);
  });

  it('returns false when no reading cites the snippet', () => {
    const snippet = makeSnippet();
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'fact', cites: ['s2@1'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(false);
  });

  it('returns false when cited by fewer than 2 total queue entries', () => {
    const snippet = makeSnippet();
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'fact', cites: ['s1@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(false);
  });

  it('returns true when cited by ≥2 entries regardless of status', () => {
    const snippet = makeSnippet();
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'fact', cites: ['s1@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'pending', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(true);
  });


  it('returns true even when an episode-facet sibling exists in same session — veto is per-candidate (ticket 140)', () => {
    const snippet = makeSnippet({ id: 's1' });
    const sibling = makeSnippet({ id: 's2', provenance: { ...makeSnippet().provenance, session: 'sess-1' } });
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'fact', cites: ['s1@3'] }),
      r2: makeReading({ id: 'r2', facet: 'episode', cites: ['s2@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet, sibling];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(true);
  });

  it('returns true when a non-episode sibling exists in same session', () => {
    const snippet = makeSnippet({ id: 's1' });
    const sibling = makeSnippet({ id: 's2', provenance: { ...makeSnippet().provenance, session: 'sess-1' } });
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'construct', cites: ['s1@3'] }),
      r2: makeReading({ id: 'r2', facet: 'value', cites: ['s2@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet, sibling];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(true);
  });

  it('ignores episode siblings in different sessions', () => {
    const snippet = makeSnippet({ id: 's1', provenance: { ...makeSnippet().provenance, session: 'sess-1' } });
    const other = makeSnippet({ id: 's2', provenance: { ...makeSnippet().provenance, session: 'sess-2' } });
    const readings: Record<string, Reading> = {
      r1: makeReading({ facet: 'fact', cites: ['s1@3'] }),
      r2: makeReading({ id: 'r2', facet: 'episode', cites: ['s2@3'] }),
    };
    const queueEntries: QueueEntry[] = [
      makeQueueEntry({ status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q2', status: 'asked', cites: ['s1@3'] }),
    ];
    const allSnippets: Snippet[] = [snippet, other];

    expect(isExpeditionCandidate(snippet, readings, queueEntries, allSnippets)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// composeExpedition
// ---------------------------------------------------------------------------

describe('composeExpedition', () => {
  const snippet = makeSnippet();

  it('creates QueueDraft with horizon days and a question quoting the snippet', async () => {
    const complete = fakeComplete(
      'Go read Cal Newport\'s "Deep Work" and think about how "I value deep work over shallow productivity" applies to your team. What surprised you, and what does it change?',
    );

    const result = await composeExpedition(snippet, complete);

    expect(result).not.toBeNull();
    const draft = result!;
    expect(draft.source).toBe('composed');
    expect(draft.horizon).toBe('days');
    expect(draft.license).toBe('CC0');
    expect(draft.questionForm).toBe('deliberative');
    expect(draft.cites).toEqual(['s1@3']);
    expect(draft.quotedFragment).toBeDefined();
    expect(snippet.prose).toContain(draft.quotedFragment!);
    expect(draft.question).toContain(draft.quotedFragment!);
  });

  it('returns null when the question quotes no fragment of the snippet', async () => {
    const complete = fakeComplete(
      'Research productivity techniques and report back. What surprised you, and what does it change?',
      'Just think about your work habits.',
    );

    const result = await composeExpedition(snippet, complete);

    expect(result).toBeNull();
  });

  it('succeeds on retry when second response quotes the snippet', async () => {
    const complete = fakeComplete(
      'Go research productivity strategies.',
      'Read about deep work and consider: you said "Meetings steal my best hours" — what would change if you protected those hours? What surprised you, and what does it change?',
    );

    const result = await composeExpedition(snippet, complete);

    expect(result).not.toBeNull();
    expect(result!.question).toContain('Meetings steal my best hours');
    expect(result!.horizon).toBe('days');
  });

  it('uses empty system prompt (user-role only, llama.cpp compat)', async () => {
    let capturedSystem = 'NOT_CALLED';
    const complete: Complete = async (system: string, _turns: Turn[]) => {
      capturedSystem = system;
      return 'Go research "deep work" and see if your views on "Meetings steal my best hours" hold up. What surprised you, and what does it change?';
    };

    await composeExpedition(snippet, complete);

    expect(capturedSystem).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Docket expedition minting
// ---------------------------------------------------------------------------

const MOCK_IDX = { _brand: 'LexicalIndex' } as unknown as import('../src/types.js').LexicalIndex;

function fakeVault(snippets: Snippet[], readings: Reading[] = []): import('../src/types.js').Vault {
  const snMap: Record<string, Snippet> = {};
  for (const s of snippets) snMap[s.id] = s;
  const rdMap: Record<string, Reading> = {};
  for (const r of readings) rdMap[r.id] = r;
  return {
    saveSnippet: vi.fn() as unknown as (prose: string, provenance: import('../src/types.js').Provenance) => Snippet,
    saveVersion: vi.fn() as unknown as (snippetId: string, prose: string) => Snippet,
    saveReading: vi.fn() as unknown as (r: { facet: import('../src/types.js').Facet; stance: import('../src/types.js').Stance; reading: string; cites: string[] }) => Reading,
    saveBud: vi.fn() as unknown as (fragment: string, failures: string[], session: string) => import('../src/types.js').Bud,
    startTranscript: vi.fn(),
    appendTurn: vi.fn(),
    rebuildIndex: vi.fn().mockReturnValue({ snippets: snMap, readings: rdMap, buds: {} }),
  };
}

function makeQueueStore(entries: QueueEntry[] = []): import('../src/types.js').QueueStore & { _entries: QueueEntry[] } {
  const _entries: QueueEntry[] = [...entries];
  return {
    _entries,
    add: vi.fn((draft: QueueDraft) => {
      const entry: QueueEntry = {
        ...draft,
        id: `qe-${_entries.length}`,
        status: 'pending',
        created: new Date().toISOString(),
      };
      _entries.push(entry);
      return entry;
    }),
    list: vi.fn(() => _entries),
    get: (id: string) => _entries.find((e) => e.id === id),
    draw: vi.fn(),
    markAsked: vi.fn(),
    markAnswered: vi.fn(),
    markPending: () => { },
    defer: vi.fn(),
    park: vi.fn(),
    unpark: vi.fn(),
    expire: vi.fn().mockReturnValue(0),
    expireTailBeyond: vi.fn().mockReturnValue(0),
    markExpired: vi.fn(),
      recordReplyDisengagement() { return false; },
    noteSittingStarted() {},
  };
}

describe('runDocket expedition minting', () => {
  it('mints at most one expedition per docket run', async () => {
    const snippet = makeSnippet({ id: 'sn1' });
    const second = makeSnippet({ id: 'sn2' });

    const readings: Reading[] = [
      makeReading({ id: 'r1', facet: 'fact', cites: ['sn1@3'] }),
      makeReading({ id: 'r2', facet: 'fact', cites: ['sn2@3'] }),
    ];

    const qe: QueueEntry[] = [
      makeQueueEntry({ id: 'q-a1', status: 'asked', cites: ['sn1@3'] }),
      makeQueueEntry({ id: 'q-a2', status: 'asked', cites: ['sn1@3'] }),
      makeQueueEntry({ id: 'q-a3', status: 'asked', cites: ['sn2@3'] }),
      makeQueueEntry({ id: 'q-a4', status: 'asked', cites: ['sn2@3'] }),
    ];

    const queue = makeQueueStore(qe);

    let expeditionCallCount = 0;
    const composeExpedition = vi.fn().mockImplementation(async () => {
      expeditionCallCount++;
      return {
        source: 'composed' as const,
        license: 'CC0',
        question: 'Research deep work. What surprised you, and what does it change?',
        questionForm: 'deliberative' as const,
        horizon: 'days' as const,
        cites: ['sn1@3'],
        quotedFragment: 'deep work',
      } satisfies QueueDraft;
    });

    const report = await runDocket({
      vault: fakeVault([snippet, second], readings),
      queue,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(MOCK_IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeExpedition,
      log: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      vaultRoot: '/tmp/fake',
    });

    // Both snippets are candidates, but only ONE expedition is minted
    expect(expeditionCallCount).toBe(1);
    // Expedition should appear in minted report
    expect(report.minted).toHaveLength(1);
    expect(report.minted[0]!.horizon).toBe('days');
  });

  it('logs expedition-minted when expedition is created', async () => {
    const snippet = makeSnippet({ id: 'sn1' });
    const readings: Reading[] = [
      makeReading({ id: 'r1', facet: 'fact', cites: ['sn1@3'] }),
    ];
    const qe: QueueEntry[] = [
      makeQueueEntry({ id: 'q-a1', status: 'asked', cites: ['sn1@3'] }),
      makeQueueEntry({ id: 'q-a2', status: 'asked', cites: ['sn1@3'] }),
    ];
    const queue = makeQueueStore(qe);
    const log = vi.fn();

    await runDocket({
      vault: fakeVault([snippet], readings),
      queue,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(MOCK_IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeExpedition: vi.fn().mockResolvedValue({
        source: 'composed' as const,
        license: 'CC0',
        question: 'Research deep work. What surprised you, and what does it change?',
        questionForm: 'deliberative' as const,
        horizon: 'days' as const,
        cites: ['sn1@3'],
        quotedFragment: 'deep work',
      } satisfies QueueDraft),
      log,
      listSessions: vi.fn().mockReturnValue([]),
      vaultRoot: '/tmp/fake',
    });

    const expLog = log.mock.calls.find(
      (c: unknown[]) => (c[0] as { kind: string }).kind === 'expedition-minted',
    );
    expect(expLog).toBeDefined();
  });

  it('logs expedition-failed when composeExpedition throws', async () => {
    const snippet = makeSnippet({ id: 'sn1' });
    const readings: Reading[] = [
      makeReading({ id: 'r1', facet: 'fact', cites: ['sn1@3'] }),
    ];
    const qe: QueueEntry[] = [
      makeQueueEntry({ id: 'q-a1', status: 'asked', cites: ['sn1@3'] }),
      makeQueueEntry({ id: 'q-a2', status: 'asked', cites: ['sn1@3'] }),
    ];
    const queue = makeQueueStore(qe);
    const log = vi.fn();

    await runDocket({
      vault: fakeVault([snippet], readings),
      queue,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(MOCK_IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeExpedition: vi.fn().mockRejectedValue(new Error('model timeout')),
      log,
      listSessions: vi.fn().mockReturnValue([]),
      vaultRoot: '/tmp/fake',
    });

    const failLog = log.mock.calls.find(
      (c: unknown[]) => (c[0] as { kind: string }).kind === 'expedition-failed',
    );
    expect(failLog).toBeDefined();
  });

  it('does not mint expedition when no candidate exists', async () => {
    const snippet = makeSnippet({ id: 'sn1' });
    const readings: Reading[] = [
      makeReading({ id: 'r1', facet: 'episode', cites: ['sn1@3'] }),
    ];
    const qe: QueueEntry[] = [
      makeQueueEntry({ id: 'q-a1', status: 'asked', cites: ['sn1@3'] }),
      makeQueueEntry({ id: 'q-a2', status: 'asked', cites: ['sn1@3'] }),
    ];
    const queue = makeQueueStore(qe);
    const composeExpedition = vi.fn();

    await runDocket({
      vault: fakeVault([snippet], readings),
      queue,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(MOCK_IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeExpedition,
      log: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      vaultRoot: '/tmp/fake',
    });

    expect(composeExpedition).not.toHaveBeenCalled();
  });
});
