import { describe, it, expect, vi } from 'vitest';
import {
  isOtherMindsCandidate,
  composeOtherMindsExpedition,
} from '../src/clerk/composed.js';
import { runDocket } from '../src/clerk/docket.js';
import type {
  Bud,
  Complete,
  Facet,
  LexicalIndex,
  Provenance,
  QueueEntry,
  QueueDraft,
  QueueStore,
  Reading,
  Snippet,
  Stance,
  Turn,
  Vault,
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
    sharpness: 'weak',
    horizon: 'now',
    created: '2026-06-01T12:00:00Z',
    ...overrides,
  };
}

/** A snippet that passes the expedition gates: fact-facet reading, 2 asked cites. */
function expeditionEligible(): {
  snippet: Snippet;
  readings: Record<string, Reading>;
  queueEntries: QueueEntry[];
} {
  const snippet = makeSnippet();
  const readings = {
    r1: makeReading({ id: 'r1', facet: 'fact', cites: ['s1@3'] }),
  };
  const queueEntries = [
    makeQueueEntry({ id: 'q-a1', status: 'asked', cites: ['s1@3'] }),
    makeQueueEntry({ id: 'q-a2', status: 'asked', cites: ['s1@3'] }),
  ];
  return { snippet, readings, queueEntries };
}

function makeGazetteer(entities: { name: string; kind: string }[]) {
  return { byMentionCount: vi.fn((_threshold: number) => entities) };
}

// ---------------------------------------------------------------------------
// isOtherMindsCandidate
// ---------------------------------------------------------------------------

describe('isOtherMindsCandidate', () => {
  it('returns ineligible when the gazetteer has no person entities', () => {
    const { snippet, readings, queueEntries } = expeditionEligible();
    const gazetteer = makeGazetteer([
      { name: 'The Office', kind: 'place' },
      { name: 'Project X', kind: 'project' },
    ]);

    const result = isOtherMindsCandidate(snippet, readings, queueEntries, [snippet], gazetteer);

    expect(result).toEqual({ eligible: false });
    expect(gazetteer.byMentionCount).toHaveBeenCalledWith(1);
  });

  it('returns ineligible when the gazetteer is empty', () => {
    const { snippet, readings, queueEntries } = expeditionEligible();
    const gazetteer = makeGazetteer([]);

    const result = isOtherMindsCandidate(snippet, readings, queueEntries, [snippet], gazetteer);

    expect(result).toEqual({ eligible: false });
  });

  it('returns eligible with the most-mentioned person when one exists', () => {
    const { snippet, readings, queueEntries } = expeditionEligible();
    const gazetteer = makeGazetteer([
      { name: 'Ada', kind: 'person' },
      { name: 'The Office', kind: 'place' },
    ]);

    const result = isOtherMindsCandidate(snippet, readings, queueEntries, [snippet], gazetteer);

    expect(result).toEqual({ eligible: true, person: 'Ada' });
  });

  it('returns ineligible when the snippet is not an expedition candidate at all', () => {
    const snippet = makeSnippet();
    // episode-facet sibling in the same session makes the region non-shallow
    const sibling = makeSnippet({ id: 's2' });
    const readings = {
      r1: makeReading({ id: 'r1', facet: 'episode', cites: ['s1@3'] }),
    };
    const queueEntries = [
      makeQueueEntry({ id: 'q-a1', status: 'asked', cites: ['s1@3'] }),
      makeQueueEntry({ id: 'q-a2', status: 'asked', cites: ['s1@3'] }),
    ];
    const gazetteer = makeGazetteer([{ name: 'Ada', kind: 'person' }]);

    const result = isOtherMindsCandidate(snippet, readings, queueEntries, [snippet, sibling], gazetteer);

    expect(result).toEqual({ eligible: false });
    expect(gazetteer.byMentionCount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// composeOtherMindsExpedition
// ---------------------------------------------------------------------------

describe('composeOtherMindsExpedition', () => {
  const snippet = makeSnippet();

  it('stamps errandKind and errandPerson on the draft', async () => {
    const complete = fakeComplete(
      'Go ask Ada about "Meetings steal my best hours" — whether they still believe that. What surprised you, and what does it change?',
    );

    const result = await composeOtherMindsExpedition(snippet, 'Ada', complete);

    expect(result).not.toBeNull();
    const draft = result!;
    expect(draft.errandKind).toBe('other-minds');
    expect(draft.errandPerson).toBe('Ada');
    expect(draft.source).toBe('composed');
    expect(draft.horizon).toBe('days');
    expect(draft.sharpness).toBe('weak');
    expect(draft.license).toBe('CC0');
    expect(draft.questionForm).toBe('deliberative');
    expect(draft.cites).toEqual(['s1@3']);
    expect(draft.question).toContain('Ada');
    expect(snippet.prose).toContain(draft.quotedFragment!);
  });

  it('names the person in the send-out prompt', async () => {
    let capturedPrompt = '';
    const complete: Complete = async (system: string, turns: Turn[]) => {
      capturedPrompt = turns[0]?.text ?? '';
      return 'Go ask Ada about "Meetings steal my best hours". What surprised you, and what does it change?';
    };

    const result = await composeOtherMindsExpedition(snippet, 'Ada', complete);

    expect(result).not.toBeNull();
    expect(capturedPrompt).toContain('Ada');
    expect(capturedPrompt).toContain('go ask Ada');
    expect(capturedPrompt).toContain('What surprised you, and what does it change?');
  });

  it('returns null when the question quotes no fragment of the snippet', async () => {
    const complete = fakeComplete(
      'Ask Ada about their research habits. What surprised you, and what does it change?',
      'Just reflect on what Ada told you.',
    );

    const result = await composeOtherMindsExpedition(snippet, 'Ada', complete);

    expect(result).toBeNull();
  });

  it('succeeds on retry when the second response quotes the snippet', async () => {
    const complete = fakeComplete(
      'Ask Ada how they stay focused.',
      'Go ask Ada whether "Meetings steal my best hours" matches their own experience. What surprised you, and what does it change?',
    );

    const result = await composeOtherMindsExpedition(snippet, 'Ada', complete);

    expect(result).not.toBeNull();
    expect(result!.question).toContain('Meetings steal my best hours');
    expect(result!.errandKind).toBe('other-minds');
    expect(result!.errandPerson).toBe('Ada');
  });
});

// ---------------------------------------------------------------------------
// Docket other-minds minting
// ---------------------------------------------------------------------------

const MOCK_IDX = { _brand: 'LexicalIndex' } as unknown as LexicalIndex;

type ClerkLogEvent = { at: string; actor: string; kind: string; detail: string; refs?: string[] };

function fakeVault(snippets: Snippet[], readings: Reading[] = []): Vault {
  const snMap: Record<string, Snippet> = {};
  for (const s of snippets) snMap[s.id] = s;
  const rdMap: Record<string, Reading> = {};
  for (const r of readings) rdMap[r.id] = r;
  return {
    saveSnippet: vi.fn() as unknown as (prose: string, provenance: Provenance) => Snippet,
    saveVersion: vi.fn() as unknown as (snippetId: string, prose: string) => Snippet,
    saveReading: vi.fn() as unknown as (r: { facet: Facet; stance: Stance; reading: string; cites: string[] }) => Reading,
    saveBud: vi.fn() as unknown as (fragment: string, failures: string[], session: string) => Bud,
    startTranscript: vi.fn(),
    appendTurn: vi.fn(),
    rebuildIndex: vi.fn().mockReturnValue({ snippets: snMap, readings: rdMap, buds: {} }),
  };
}

function makeQueueStore(entries: QueueEntry[] = []): QueueStore & { _entries: QueueEntry[] } {
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

function otherMindsDraft(person: string): QueueDraft {
  return {
    source: 'composed' as const,
    license: 'CC0',
    question: `Go ask ${person} about "Meetings steal my best hours". What surprised you, and what does it change?`,
    questionForm: 'deliberative' as const,
    sharpness: 'weak' as const,
    horizon: 'days' as const,
    cites: ['sn1@3'],
    quotedFragment: 'Meetings steal my best hours',
    errandKind: 'other-minds' as const,
    errandPerson: person,
  } satisfies QueueDraft;
}

describe('runDocket other-minds expedition minting', () => {
  const snippet = makeSnippet({ id: 'sn1' });
  const readings: Reading[] = [makeReading({ id: 'r1', facet: 'fact', cites: ['sn1@3'] })];
  const qe: QueueEntry[] = [
    makeQueueEntry({ id: 'q-a1', status: 'asked', cites: ['sn1@3'] }),
    makeQueueEntry({ id: 'q-a2', status: 'asked', cites: ['sn1@3'] }),
  ];

  it('mints an other-minds expedition when the regular expedition finds nothing', async () => {
    const queue = makeQueueStore(qe);
    const gazetteer = makeGazetteer([{ name: 'Ada', kind: 'person' }]);
    const composeOtherMindsExpedition = vi.fn().mockResolvedValue(otherMindsDraft('Ada'));
    const log = vi.fn<(e: ClerkLogEvent) => void>();

    const report = await runDocket({
      vault: fakeVault([snippet], readings),
      queue,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(MOCK_IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeStillTrue: vi.fn().mockResolvedValue(null),
      composeExpedition: vi.fn().mockResolvedValue(null),
      composeOtherMindsExpedition,
      gazetteerStore: gazetteer,
      log,
      listSessions: vi.fn().mockReturnValue([]),
      vaultRoot: '/tmp/fake',
    });

    expect(composeOtherMindsExpedition).toHaveBeenCalledTimes(1);
    expect(composeOtherMindsExpedition).toHaveBeenCalledWith(
      snippet,
      expect.any(Function),
      'Ada',
      expect.anything(),
    );
    expect(report.minted).toHaveLength(1);
    expect(report.minted[0]!.errandKind).toBe('other-minds');
    expect(report.minted[0]!.errandPerson).toBe('Ada');
    expect(report.minted[0]!.horizon).toBe('days');

    const expLog = log.mock.calls.find((c) => c[0] && c[0].kind === 'expedition-minted');
    expect(expLog).toBeDefined();
    expect(expLog?.[0]?.detail).toContain('other-minds');
  });

  it('does not try other-minds when the regular expedition minted', async () => {
    const queue = makeQueueStore(qe);
    const gazetteer = makeGazetteer([{ name: 'Ada', kind: 'person' }]);
    const composeOtherMindsExpedition = vi.fn();

    const report = await runDocket({
      vault: fakeVault([snippet], readings),
      queue,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(MOCK_IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeStillTrue: vi.fn().mockResolvedValue(null),
      composeExpedition: vi.fn().mockResolvedValue({
        source: 'composed' as const,
        license: 'CC0',
        question: 'Research "Meetings steal my best hours". What surprised you, and what does it change?',
        questionForm: 'deliberative' as const,
        sharpness: 'weak' as const,
        horizon: 'days' as const,
        cites: ['sn1@3'],
        quotedFragment: 'Meetings steal my best hours',
      } satisfies QueueDraft),
      composeOtherMindsExpedition,
      gazetteerStore: gazetteer,
      log: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      vaultRoot: '/tmp/fake',
    });

    expect(composeOtherMindsExpedition).not.toHaveBeenCalled();
    expect(report.minted).toHaveLength(1);
    expect(report.minted[0]!.errandKind).toBeUndefined();
  });

  it('mints nothing when there are no people in the gazetteer', async () => {
    const queue = makeQueueStore(qe);
    const gazetteer = makeGazetteer([{ name: 'The Office', kind: 'place' }]);
    const composeOtherMindsExpedition = vi.fn();

    const report = await runDocket({
      vault: fakeVault([snippet], readings),
      queue,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(MOCK_IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeStillTrue: vi.fn().mockResolvedValue(null),
      composeExpedition: vi.fn().mockResolvedValue(null),
      composeOtherMindsExpedition,
      gazetteerStore: gazetteer,
      log: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      vaultRoot: '/tmp/fake',
    });

    expect(composeOtherMindsExpedition).not.toHaveBeenCalled();
    expect(report.minted).toHaveLength(0);
  });
});
