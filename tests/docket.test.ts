import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Vault,
  QueueStore,
  QueueEntry,
  QueueDraft,
  Snippet,
  LexicalIndex,
  DocketReport,
  Complete,
} from '../src/types.js';

type SessionRef = { session: string; started: string; turnCount: number; chars: number };
type RangeSummary = { sessions: string[]; line: string; model: string; at: string };

type DocketDeps = {
  vault: Vault;
  queue: QueueStore;
  complete: Complete;
  buildIndex: (snippets: Snippet[]) => LexicalIndex;
  composeOpener: (s: Snippet, c: Complete) => Promise<QueueDraft | null>;
  composeStillTrue: (s: Snippet, c: Complete) => Promise<QueueDraft | null>;
  log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
  nextConsolidation?: (sessions: SessionRef[], summaries: RangeSummary[]) => string[] | null;
  saveSummary?: (root: string, s: RangeSummary) => void;
  loadSummaries?: (root: string) => RangeSummary[];
  listSessions?: (root: string) => SessionRef[];
  readTranscript?: (root: string, session: string) => string;
  modelName?: string;
  vaultRoot: string;
};

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

type SnippetOpts = { captured?: string; provenance?: Partial<Snippet['provenance']>; prose?: string };

function makeSnippet(id: string, opts?: SnippetOpts): Snippet {
  return {
    id,
    version: 1,
    captured: opts?.captured ?? new Date().toISOString(),
    provenance: {
      kind: 'harvest' as const,
      session: 's-default',
      question: 'What matters?',
      questionForm: 'deliberative' as const,
      ...opts?.provenance,
    } as Snippet['provenance'],
    prose: opts?.prose ?? `Snippet ${id} prose.`,
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
      snippets: Object.fromEntries(snippets.map(s => [s.id, s])),
      readings: {},
      buds: {},
    }),
  };
}

function makeFakeQueue(entries?: QueueEntry[]): QueueStore & { _entries: QueueEntry[]; _expireCalls: number[] } {
  const _entries: QueueEntry[] = entries ? [...entries] : [];
  const _expireCalls: number[] = [];
  return {
    _entries,
    _expireCalls,
    add(e: QueueDraft): QueueEntry {
      const entry: QueueEntry = {
        ...e,
        id: `q-${_entries.length}`,
        status: 'pending',
        created: new Date().toISOString(),
      } as QueueEntry;
      _entries.push(entry);
      return entry;
    },
    list(filter?) {
      if (!filter) return [..._entries];
      return _entries.filter(e => {
        if (filter.status !== undefined && e.status !== filter.status) return false;
        if (filter.source !== undefined && e.source !== filter.source) return false;
        return true;
      });
    },
    draw() { return null; },
    markAsked() { },
    markAnswered() { },
    defer() { },
    expire(olderThanDays: number): number {
      _expireCalls.push(olderThanDays);
      return 0;
    },
  };
}

let runDocket: (deps: DocketDeps) => Promise<DocketReport>;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../src/clerk/docket.js');
  runDocket = mod.runDocket;
});

describe('runDocket', () => {
  const IDX: LexicalIndex = { _brand: 'LexicalIndex' } as LexicalIndex;

  // ── 1a: openers only for uncited, last 2 sessions ──
  it('mints openers only for uncited snippets from the last 2 sessions', async () => {
    const oldDate = daysAgo(1);
    const midDate = daysAgo(0.5);
    const newDate = daysAgo(0);

    const sn1 = makeSnippet('sn1', { provenance: { session: 's-oldest' } });
    const sn2 = makeSnippet('sn2', { provenance: { session: 's-oldest' } });
    const sn3 = makeSnippet('sn3', { provenance: { session: 's-mid' } });
    const sn4 = makeSnippet('sn4', { provenance: { session: 's-newest' } });
    const sn5 = makeSnippet('sn5', { provenance: { session: 's-newest' } });

    const existingQe: QueueEntry = {
      id: 'existing', status: 'pending', source: 'composed',
      license: 'CC0', question: 'Existing?', questionForm: 'deliberative',
      sharpness: 'weak', horizon: 'now', created: newDate, cites: ['sn3@1'],
    };
    const q = makeFakeQueue([existingQe]);

    const composeOpener = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        source: 'composed' as const, license: 'CC0',
        question: 'What about sn5?', questionForm: 'deliberative' as const,
        sharpness: 'weak' as const, horizon: 'now' as const,
        cites: ['sn5@1'], quotedFragment: 'sn5 prose.',
      } satisfies QueueDraft);

    const buildIndex = vi.fn().mockReturnValue(IDX);

    const listSessions = vi.fn().mockReturnValue([
      { session: 's-newest', started: newDate, turnCount: 3, chars: 100 },
      { session: 's-mid', started: midDate, turnCount: 5, chars: 200 },
      { session: 's-oldest', started: oldDate, turnCount: 2, chars: 50 },
    ] as SessionRef[]);

    const report = await runDocket({
      vault: fakeVault([sn1, sn2, sn3, sn4, sn5]),
      queue: q,
      complete: vi.fn() as unknown as Complete,
      buildIndex,
      composeOpener,
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      listSessions,
      vaultRoot: '/tmp/fake',
    });

    expect(composeOpener).toHaveBeenCalledTimes(2);
    const calledIds = composeOpener.mock.calls.map((c: unknown[]) => (c[0] as Snippet).id);
    expect(calledIds).toContain('sn4');
    expect(calledIds).toContain('sn5');

    expect(report.minted).toHaveLength(1);
    expect(report.minted[0]!.question).toBe('What about sn5?');
  });

  // ── 1b: dedupe ──
  it('deduplicates opener minting by snippet id', async () => {
    const sn = makeSnippet('sn1', { provenance: { session: 's1' } });
    const composeOpener = vi.fn().mockResolvedValue(null);
    await runDocket({
      vault: fakeVault([sn]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener,
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      listSessions: vi.fn().mockReturnValue([
        { session: 's1', started: daysAgo(0), turnCount: 1, chars: 10 },
      ]),
      vaultRoot: '/tmp/fake',
    });

    expect(composeOpener).toHaveBeenCalledTimes(1);
  });

  // ── 2: still-true > 90d, quota 2 ──
  it('mints still-true only for snippets captured > 90 days ago, max 2', async () => {
    const old1 = makeSnippet('old1', { captured: daysAgo(100), provenance: { session: 's-old' } });
    const old2 = makeSnippet('old2', { captured: daysAgo(95), provenance: { session: 's-old' } });
    const old3 = makeSnippet('old3', { captured: daysAgo(91), provenance: { session: 's-old' } });
    const recent = makeSnippet('recent', { captured: daysAgo(10), provenance: { session: 's-new' } });

    const composeStillTrue = vi.fn()
      .mockResolvedValueOnce({
        source: 'still-true' as const, license: 'CC0',
        question: 'Still true for old1?', questionForm: 'deliberative' as const,
        sharpness: 'weak' as const, horizon: 'now' as const,
        cites: ['old1@1'], quotedFragment: 'old1',
      } satisfies QueueDraft)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        source: 'still-true' as const, license: 'CC0',
        question: 'SHOULD NOT APPEAR', questionForm: 'deliberative' as const,
        sharpness: 'weak' as const, horizon: 'now' as const,
      } satisfies QueueDraft);

    const report = await runDocket({
      vault: fakeVault([old1, old2, old3, recent]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeStillTrue,
      log: vi.fn(),
      listSessions: vi.fn().mockReturnValue([
        { session: 's-new', started: daysAgo(10), turnCount: 2, chars: 50 },
        { session: 's-old', started: daysAgo(100), turnCount: 5, chars: 200 },
      ]),
      vaultRoot: '/tmp/fake',
    });

    expect(composeStillTrue).toHaveBeenCalledTimes(2);
    expect(report.minted).toHaveLength(1);
    expect(report.minted[0]!.question).toBe('Still true for old1?');
  });

  // ── 3: expire(30) once ──
  it('calls queue.expire(30) exactly once', async () => {
    const q = makeFakeQueue();
    await runDocket({
      vault: fakeVault([]),
      queue: q,
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn(),
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      vaultRoot: '/tmp/fake',
    });

    expect(q._expireCalls).toEqual([30]);
  });

  // ── 4: at most one consolidation ──
  it('performs at most one consolidation per run', async () => {
    let callCount = 0;
    const nextConsolidation = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return ['s1', 's2'];
      return null;
    });
    const saveSummary = vi.fn();
    const loadSummaries = vi.fn().mockReturnValue([]);

    await runDocket({
      vault: fakeVault([]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn(),
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      vaultRoot: '/tmp/fake',
      nextConsolidation,
      saveSummary,
      loadSummaries,
      listSessions: vi.fn().mockReturnValue([]),
    });

    expect(saveSummary).toHaveBeenCalledTimes(1);
  });

  it('skips consolidation when nextConsolidation returns null', async () => {
    const nextConsolidation = vi.fn().mockReturnValue(null);
    const saveSummary = vi.fn();

    await runDocket({
      vault: fakeVault([]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn(),
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      vaultRoot: '/tmp/fake',
      nextConsolidation,
      saveSummary,
      loadSummaries: vi.fn().mockReturnValue([]),
      listSessions: vi.fn().mockReturnValue([]),
    });

    expect(saveSummary).not.toHaveBeenCalled();
  });

  // ── 5: log emissions ──
  it('emits log events for each job phase', async () => {
    const logCalls: Array<{ actor: string; kind: string; detail: string }> = [];
    const log = vi.fn((e: typeof logCalls[number]) => { logCalls.push(e); });

    const sn = makeSnippet('sn1', { provenance: { session: 's1' } });
    const q = makeFakeQueue();
    const expireSpy = vi.fn().mockReturnValue(3);

    const composeOpener = vi.fn().mockResolvedValue({
      source: 'composed' as const, license: 'CC0',
      question: 'Opener q?', questionForm: 'deliberative' as const,
      sharpness: 'weak' as const, horizon: 'now' as const,
      cites: ['sn1@1'], quotedFragment: 'sn1 prose.',
    } satisfies QueueDraft);

    await runDocket({
      vault: fakeVault([sn]),
      queue: { ...q, expire: expireSpy },
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener,
      composeStillTrue: vi.fn(),
      log,
      listSessions: vi.fn().mockReturnValue([
        { session: 's1', started: daysAgo(0), turnCount: 1, chars: 10 },
      ]),
      vaultRoot: '/tmp/fake',
    });

    const kinds = logCalls.map(c => c.kind);
    expect(kinds).toContain('run-started');
    expect(kinds).toContain('index-rebuilt');
    expect(kinds).toContain('opener-minted');
    expect(kinds).toContain('expired');

    for (const c of logCalls) {
      expect(c.actor).toBe('clerk');
    }

    const expiredLog = logCalls.find(c => c.kind === 'expired');
    expect(expiredLog).toBeDefined();
    expect(expiredLog!.detail).toContain('3');

    const indexLog = logCalls.find(c => c.kind === 'index-rebuilt');
    expect(indexLog).toBeDefined();
    expect(indexLog!.detail).toContain('1');
  });

  // ── 6: concurrent lock ──
  it('concurrent run returns skipped report via in-process lock', async () => {
    let resolveOpener!: (v: QueueDraft | null) => void;
    const openerPromise = new Promise<QueueDraft | null>(r => { resolveOpener = r; });

    const sn = makeSnippet('sn1', { provenance: { session: 's1' } });
    const composeOpener = vi.fn().mockReturnValue(openerPromise);

    function makeDeps() {
      return {
        vault: fakeVault([sn]),
        queue: makeFakeQueue(),
        complete: vi.fn() as unknown as Complete,
        buildIndex: vi.fn().mockReturnValue(IDX),
        composeOpener,
        composeStillTrue: vi.fn(),
        log: vi.fn(),
        listSessions: vi.fn().mockReturnValue([
          { session: 's1', started: daysAgo(0), turnCount: 1, chars: 10 },
        ]),
        vaultRoot: '/tmp/fake',
      };
    }

    const run1 = runDocket(makeDeps());
    const run2 = await runDocket(makeDeps());

    expect(run2.reindexed).toBe(0);
    expect(run2.minted).toEqual([]);
    expect(run2.expired).toBe(0);

    resolveOpener({
      source: 'composed' as const, license: 'CC0',
      question: 'Opener q?', questionForm: 'deliberative' as const,
      sharpness: 'weak' as const, horizon: 'now' as const,
      cites: ['sn1@1'], quotedFragment: 'sn1 prose.',
    } satisfies QueueDraft);

    const result1 = await run1;
    expect(result1.reindexed).toBe(1);
  });

  // ── 7: report counts match ──
  it('report counts match fake-store effects', async () => {
    const sn1 = makeSnippet('sn1', { provenance: { session: 's1' } });
    const sn2 = makeSnippet('sn2', { provenance: { session: 's2' } });
    const oldSn = makeSnippet('oldSn', { captured: daysAgo(100), provenance: { session: 's-old' } });

    const q = makeFakeQueue();
    const expireSpy = vi.fn().mockReturnValue(5);

    const composeOpener = vi.fn()
      .mockResolvedValueOnce({
        source: 'composed' as const, license: 'CC0',
        question: 'Opener 1?', questionForm: 'deliberative' as const,
        sharpness: 'weak' as const, horizon: 'now' as const,
        cites: ['sn1@1'], quotedFragment: 'sn1',
      } satisfies QueueDraft)
      .mockResolvedValueOnce(null);

    const composeStillTrue = vi.fn()
      .mockResolvedValueOnce({
        source: 'still-true' as const, license: 'CC0',
        question: 'Still true?', questionForm: 'deliberative' as const,
        sharpness: 'weak' as const, horizon: 'now' as const,
        cites: ['oldSn@1'], quotedFragment: 'oldSn',
      } satisfies QueueDraft);

    const report = await runDocket({
      vault: fakeVault([sn1, sn2, oldSn]),
      queue: { ...q, expire: expireSpy },
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener,
      composeStillTrue,
      log: vi.fn(),
      listSessions: vi.fn().mockReturnValue([
        { session: 's2', started: daysAgo(1), turnCount: 1, chars: 10 },
        { session: 's1', started: daysAgo(0), turnCount: 1, chars: 10 },
        { session: 's-old', started: daysAgo(100), turnCount: 1, chars: 10 },
      ]),
      vaultRoot: '/tmp/fake',
    });

    expect(report.reindexed).toBe(3);
    expect(report.minted).toHaveLength(2);
    expect(report.expired).toBe(5);
  });

  // ── 8: index is freshly built ──
  it('report.index is the freshly built lexical index', async () => {
    const buildIndex = vi.fn().mockReturnValue(IDX);

    const report = await runDocket({
      vault: fakeVault([]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex,
      composeOpener: vi.fn(),
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      vaultRoot: '/tmp/fake',
    });

    expect(report.index).toBe(IDX);
  });

  // ── Edge: empty vault ──
  it('empty vault produces zero counts but valid report', async () => {
    const report = await runDocket({
      vault: fakeVault([]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn(),
      composeStillTrue: vi.fn(),
      log: vi.fn(),
      vaultRoot: '/tmp/fake',
    });

    expect(report.reindexed).toBe(0);
    expect(report.minted).toEqual([]);
    expect(report.expired).toBe(0);
    expect(report.index._brand).toBe('LexicalIndex');
  });

  // ── Edge: no listSessions → skip openers ──
  it('skips opener phase when listSessions is absent but runs still-true and expire', async () => {
    const oldSn = makeSnippet('old', { captured: daysAgo(100) });
    const composeStillTrue = vi.fn().mockResolvedValue({
      source: 'still-true' as const, license: 'CC0',
      question: 'Still?', questionForm: 'deliberative' as const,
      sharpness: 'weak' as const, horizon: 'now' as const,
    } satisfies QueueDraft);
    const composeOpener = vi.fn();

    const report = await runDocket({
      vault: fakeVault([oldSn]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener,
      composeStillTrue,
      log: vi.fn(),
      vaultRoot: '/tmp/fake',
    });

    expect(composeOpener).not.toHaveBeenCalled();
    expect(composeStillTrue).toHaveBeenCalledTimes(1);
    expect(report.reindexed).toBe(1);
    expect(report.minted).toHaveLength(1);
  });

  // ── Edge: still-true exactly 2 ──
  it('mints still-true for exactly 2 old snippets', async () => {
    const old1 = makeSnippet('old1', { captured: daysAgo(100) });
    const old2 = makeSnippet('old2', { captured: daysAgo(95) });
    const composeStillTrue = vi.fn()
      .mockResolvedValueOnce({
        source: 'still-true' as const, license: 'CC0', question: 'Q1?',
        questionForm: 'deliberative' as const, sharpness: 'weak' as const,
        horizon: 'now' as const,
      } satisfies QueueDraft)
      .mockResolvedValueOnce({
        source: 'still-true' as const, license: 'CC0', question: 'Q2?',
        questionForm: 'deliberative' as const, sharpness: 'weak' as const,
        horizon: 'now' as const,
      } satisfies QueueDraft);

    const report = await runDocket({
      vault: fakeVault([old1, old2]),
      queue: makeFakeQueue(),
      complete: vi.fn() as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn(),
      composeStillTrue,
      log: vi.fn(),
      vaultRoot: '/tmp/fake',
    });

    expect(composeStillTrue).toHaveBeenCalledTimes(2);
    expect(report.minted).toHaveLength(2);
  });
});

// ===========================================================================
// Consolidation (ticket 030 — Cover layer wired)
// ===========================================================================

describe('consolidation', () => {
  const IDX: LexicalIndex = { _brand: 'LexicalIndex' } as LexicalIndex;

  it('summarizes the due range with transcript content and stamps the model', async () => {
    const sn = makeSnippet('sn1', { provenance: { session: 's1' } });
    const saveSummary = vi.fn();
    const complete = vi.fn().mockResolvedValue('They talked about gardens and deadlines.');
    const log = vi.fn();

    await runDocket({
      vault: fakeVault([sn]),
      queue: makeFakeQueue(),
      complete: complete as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeStillTrue: vi.fn(),
      log,
      listSessions: vi.fn().mockReturnValue([
        { session: 's1', started: daysAgo(2), turnCount: 3, chars: 100 },
        { session: 's2', started: daysAgo(1), turnCount: 3, chars: 100 },
      ]),
      nextConsolidation: vi.fn().mockReturnValue(['s1', 's2']),
      loadSummaries: vi.fn().mockReturnValue([]),
      saveSummary,
      readTranscript: vi.fn().mockReturnValue('## user\n\nThe garden taught me estimation.'),
      modelName: 'test-model',
      vaultRoot: '/tmp/fake',
    });

    expect(saveSummary).toHaveBeenCalledTimes(1);
    const saved = saveSummary.mock.calls[0]![1];
    expect(saved.sessions).toEqual(['s1', 's2']);
    expect(saved.line).toBe('They talked about gardens and deadlines.');
    expect(saved.model).toBe('test-model');

    // The prompt must carry actual transcript content, not just session ids
    const lastCall = complete.mock.calls.at(-1)!;
    expect(lastCall[1][0].text).toContain('The garden taught me estimation.');
    expect(log.mock.calls.some((c) => c[0].kind === 'consolidated')).toBe(true);
  });

  it('a consolidation failure is logged and never kills the docket run', async () => {
    const sn = makeSnippet('sn1', { provenance: { session: 's1' } });
    const log = vi.fn();

    const report = await runDocket({
      vault: fakeVault([sn]),
      queue: makeFakeQueue(),
      complete: vi.fn().mockRejectedValue(new Error('model down')) as unknown as Complete,
      buildIndex: vi.fn().mockReturnValue(IDX),
      composeOpener: vi.fn().mockResolvedValue(null),
      composeStillTrue: vi.fn(),
      log,
      listSessions: vi.fn().mockReturnValue([
        { session: 's1', started: daysAgo(2), turnCount: 3, chars: 100 },
        { session: 's2', started: daysAgo(1), turnCount: 3, chars: 100 },
      ]),
      nextConsolidation: vi.fn().mockReturnValue(['s1', 's2']),
      loadSummaries: vi.fn().mockReturnValue([]),
      saveSummary: vi.fn(),
      readTranscript: vi.fn().mockReturnValue('body'),
      vaultRoot: '/tmp/fake',
    });

    expect(report.reindexed).toBe(1);
    expect(log.mock.calls.some((c) => c[0].kind === 'consolidation-failed')).toBe(true);
  });
});
