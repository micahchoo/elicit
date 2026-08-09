/**
 * Ticket 119 — Cover read-side consumer: the opener job tiles history
 * through cover() and passes summary context into composeOpener.
 *
 * Tests:
 *  1. e2e — runDocket with seeded summaries passes tile block to composeOpener
 *  2. echo guard rejects a question that lifts summary wording, passes topic overlap
 *  3. gap rendering — unsummarized sessions appear as a named count
 *  4. budgetChars=0 — no verbatim transcript text in the block
 *  5. prompt format — history section presence/absence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { composeOpener } from '../src/clerk/composed.js';
import type {
  Complete,
  Turn,
  Snippet,
  QueueDraft,
  LexicalIndex,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Scripted fake Complete
// ---------------------------------------------------------------------------

function fakeComplete(...responses: string[]): Complete {
  let i = 0;
  return async (_system: string, _turns: Turn[], _opts?: { temperature?: number }) => {
    if (i >= responses.length) throw new Error(`fakeComplete exhausted after ${responses.length} response(s)`);
    return responses[i++]!;
  };
}

/** Capture the prompt text a Complete call received. */
function capturePrompt(prompts: string[]): Complete {
  return async (system: string, turns: Turn[]) => {
    prompts.push(system.length > 0 ? system : (turns[0]?.text ?? ''));
    return 'Framed response.';
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
    },
    prose: 'I value deep work over shallow productivity. Meetings steal my best hours.',
    ...overrides,
  };
}

type SessionRef = { session: string; started: string; turnCount: number; chars: number };
type RangeSummary = { sessions: string[]; line: string; model: string; at: string };

// ---------------------------------------------------------------------------
// Test 1: e2e — runDocket propagates tile block to composeOpener prompt
// ---------------------------------------------------------------------------

describe('opener tile block end-to-end', () => {
  let runDocket: (deps: any) => Promise<{ minted: unknown[] }>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/clerk/docket.js');
    runDocket = mod.runDocket;
  });

  const IDX: LexicalIndex = { _brand: 'LexicalIndex' } as LexicalIndex;

  it('passes historyBlock and summaryLines to composeOpener when summaries exist', async () => {
    const snippet = makeSnippet({ provenance: { ...makeSnippet().provenance, session: 'sess-b' } });

    const composeOpenerSpy = vi.fn().mockResolvedValue({
      source: 'composed' as const,
      license: 'CC0',
      question: 'What about deep work?',
      questionForm: 'deliberative' as const,
      horizon: 'session' as const,
      cites: [`${snippet.id}@${snippet.version}`],
      quotedFragment: 'deep work',
    } satisfies QueueDraft);

    const listSessions = vi.fn().mockReturnValue([
      { session: 'sess-b', started: '2026-06-15T10:00:00Z', turnCount: 5, chars: 500 },
      { session: 'sess-a', started: '2026-06-10T10:00:00Z', turnCount: 3, chars: 300 },
      { session: 'sess-old', started: '2026-05-01T10:00:00Z', turnCount: 10, chars: 1000 },
    ] as SessionRef[]);

    const loadSummaries = vi.fn().mockReturnValue([
      { sessions: ['sess-old'], line: 'Focused on career anxiety and workplace transitions', model: 'bonsai-27b', at: '2026-06-20T00:00:00Z' },
    ] as RangeSummary[]);

    await runDocket({
      vault: {
        rebuildIndex: vi.fn().mockReturnValue({ snippets: { [snippet.id]: snippet }, readings: {}, buds: {} }),
      },
      queue: { list: vi.fn().mockReturnValue([]), add: vi.fn().mockReturnValue({ id: 'qe-1' }), expire: vi.fn().mockReturnValue(0) },
      complete: vi.fn(),
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: composeOpenerSpy,
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      listSessions,
      loadSummaries,
      vaultRoot: '/tmp/fake',
    });

    expect(composeOpenerSpy).toHaveBeenCalled();
    const call = composeOpenerSpy.mock.calls[0]!;
    expect(call.length).toBe(5);

    const historyBlock = call[3] as string | undefined;
    expect(historyBlock).toBeDefined();
    expect(historyBlock!.length).toBeGreaterThan(0);

    const summaryLines = call[4] as string[] | undefined;
    expect(summaryLines).toBeDefined();
    expect(summaryLines!.length).toBeGreaterThan(0);
  });

  it('historyBlock contains summary text when summaries are seeded', async () => {
    const snippet = makeSnippet({ provenance: { ...makeSnippet().provenance, session: 'sess-b' } });

    const composeOpenerSpy = vi.fn().mockResolvedValue({
      source: 'composed' as const,
      license: 'CC0',
      question: 'What about deep work?',
      questionForm: 'deliberative' as const,
      horizon: 'session' as const,
      cites: [`${snippet.id}@${snippet.version}`],
      quotedFragment: 'deep work',
    } satisfies QueueDraft);

    const listSessions = vi.fn().mockReturnValue([
      { session: 'sess-b', started: '2026-06-15T10:00:00Z', turnCount: 5, chars: 500 },
      { session: 'sess-a', started: '2026-06-10T10:00:00Z', turnCount: 3, chars: 300 },
    ] as SessionRef[]);

    const summaryText = 'Career anxiety and workplace transitions dominated this period';
    const loadSummaries = vi.fn().mockReturnValue([
      { sessions: ['sess-a'], line: summaryText, model: 'bonsai-27b', at: '2026-06-20T00:00:00Z' },
    ] as RangeSummary[]);

    await runDocket({
      vault: {
        rebuildIndex: vi.fn().mockReturnValue({ snippets: { [snippet.id]: snippet }, readings: {}, buds: {} }),
      },
      queue: { list: vi.fn().mockReturnValue([]), add: vi.fn().mockReturnValue({ id: 'qe-1' }), expire: vi.fn().mockReturnValue(0) },
      complete: vi.fn(),
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: composeOpenerSpy,
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      listSessions,
      loadSummaries,
      vaultRoot: '/tmp/fake',
    });

    const historyBlock = composeOpenerSpy.mock.calls[0]![3] as string;
    expect(historyBlock).toContain('Career anxiety');
  });
});

// ---------------------------------------------------------------------------
// Test 2: echo guard — rejects summary wording lift, passes topic overlap
// ---------------------------------------------------------------------------

describe('echo guard (Q-86)', () => {
  const snippet = makeSnippet();
  const summaryLine = 'Focused on career anxiety and workplace transitions';
  const historyBlock = `Sessions 2026-05-01 to 2026-06-01 — ${summaryLine}`;

  it('rejects a question that lifts summary content words verbatim', async () => {
    // This lifts "career anxiety and workplace" — 4 content words
    const liftQuestion = 'You wrote: "deep work over shallow productivity." Has your career anxiety and workplace situation changed since then?';
    const complete = fakeComplete(liftQuestion, liftQuestion);

    const result = await composeOpener(snippet, complete, undefined, historyBlock, [summaryLine]);
    expect(result).toBeNull();
  });

  it('accepts a question that shares only topic words with the summary', async () => {
    // "career" alone is 1 content word — below the 3-word threshold
    const topicQuestion = 'You wrote: "deep work over shallow productivity." How has your career evolved since you wrote that?';
    const complete = fakeComplete(topicQuestion);

    const result = await composeOpener(snippet, complete, undefined, historyBlock, [summaryLine]);
    expect(result).not.toBeNull();
    expect(result!.question).toBe(topicQuestion);
  });

  it('accepts a question when no summaryLines are provided', async () => {
    const question = 'You wrote: "deep work over shallow productivity." Has your workplace become more meeting-heavy?';
    const complete = fakeComplete(question);

    const result = await composeOpener(snippet, complete, undefined, historyBlock, undefined);
    expect(result).not.toBeNull();
    expect(result!.question).toBe(question);
  });

  it('includes historyBlock in the prompt sent to the model', async () => {
    const prompts: string[] = [];
    const capture = capturePrompt(prompts);

    await composeOpener(snippet, capture, undefined, historyBlock, [summaryLine]);

    expect(prompts.length).toBeGreaterThan(0);
    const prompt = prompts[0]!;
    expect(prompt).toContain('Recent session history');
    expect(prompt).toContain('career anxiety');
  });
});

// ---------------------------------------------------------------------------
// Test 3: gap rendering — unsummarized sessions appear as a count
// ---------------------------------------------------------------------------

describe('gap rendering', () => {
  let runDocket: (deps: any) => Promise<{ minted: unknown[] }>;
  const IDX: LexicalIndex = { _brand: 'LexicalIndex' } as LexicalIndex;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/clerk/docket.js');
    runDocket = mod.runDocket;
  });

  it('renders unsummarized sessions as a named count in historyBlock', async () => {
    const snippet = makeSnippet({ provenance: { ...makeSnippet().provenance, session: 'sess-b' } });

    const composeOpenerSpy = vi.fn().mockResolvedValue({
      source: 'composed' as const,
      license: 'CC0',
      question: 'What about deep work?',
      questionForm: 'deliberative' as const,
      horizon: 'session' as const,
      cites: [`${snippet.id}@${snippet.version}`],
      quotedFragment: 'deep work',
    } satisfies QueueDraft);

    const listSessions = vi.fn().mockReturnValue([
      { session: 'sess-b', started: '2026-06-15T10:00:00Z', turnCount: 5, chars: 500 },
      { session: 'sess-a', started: '2026-06-10T10:00:00Z', turnCount: 3, chars: 300 },
      { session: 'sess-old', started: '2026-05-01T10:00:00Z', turnCount: 10, chars: 1000 },
    ] as SessionRef[]);

    const loadSummaries = vi.fn().mockReturnValue([] as RangeSummary[]);

    await runDocket({
      vault: {
        rebuildIndex: vi.fn().mockReturnValue({ snippets: { [snippet.id]: snippet }, readings: {}, buds: {} }),
      },
      queue: { list: vi.fn().mockReturnValue([]), add: vi.fn().mockReturnValue({ id: 'qe-1' }), expire: vi.fn().mockReturnValue(0) },
      complete: vi.fn(),
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: composeOpenerSpy,
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      listSessions,
      loadSummaries,
      vaultRoot: '/tmp/fake',
    });

    const historyBlock = composeOpenerSpy.mock.calls[0]![3] as string;
    expect(historyBlock).toContain('not yet consolidated');
    expect(historyBlock).toMatch(/3 sessions? not yet consolidated/);
  });
});

// ---------------------------------------------------------------------------
// Test 4: budgetChars=0 — no verbatim transcript text
// ---------------------------------------------------------------------------

describe('budgetChars=0', () => {
  let runDocket: (deps: any) => Promise<{ minted: unknown[] }>;
  const IDX: LexicalIndex = { _brand: 'LexicalIndex' } as LexicalIndex;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/clerk/docket.js');
    runDocket = mod.runDocket;
  });

  it('produces no verbatim tiles when budgetChars is 0', async () => {
    // Direct test of cover() — budgetChars=0 suppresses verbatim tiles
    const { cover } = await import('../src/memory/cover.js');

    const sessions: SessionRef[] = [
      { session: 's1', started: '2026-06-15T10:00:00Z', turnCount: 5, chars: 500 },
    ];
    const summaries: RangeSummary[] = [];

    const tiles = cover(sessions, summaries, 0);
    const verbatimTiles = tiles.filter(t => t.kind === 'verbatim');
    expect(verbatimTiles).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5: prompt format — history section presence/absence
// ---------------------------------------------------------------------------

describe('prompt format', () => {
  const snippet = makeSnippet();

  it('does not include history section when no historyBlock provided', async () => {
    const prompts: string[] = [];
    const capture = capturePrompt(prompts);

    await composeOpener(snippet, capture);

    expect(prompts[0]!).not.toContain('Recent session history');
    expect(prompts[0]!).toContain('Snippet:');
  });

  it('includes history section between snippet and framing rule when provided', async () => {
    const prompts: string[] = [];
    const capture = capturePrompt(prompts);

    const block = 'Sessions 2026-05-01 to 2026-06-01 — Early explorations';
    await composeOpener(snippet, capture, undefined, block, ['Early explorations']);

    expect(prompts[0]!).toContain('Recent session history');
    expect(prompts[0]!).toContain('Early explorations');
    expect(prompts[0]!).toContain('Snippet:');
    expect(prompts[0]!).toContain('frame the quote, never splice it');
  });
});
