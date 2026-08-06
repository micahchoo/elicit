import { describe, it, expect, beforeEach, vi } from 'vitest';

import type {
 Vault,
 QueueStore,
 QueueDraft,
 QueueEntry,
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
 composeExpedition?: (s: Snippet, c: Complete) => Promise<QueueDraft | null>;
 log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
 nextConsolidation?: (sessions: SessionRef[], summaries: RangeSummary[]) => string[] | null;
 saveSummary?: (root: string, s: RangeSummary) => void;
 loadSummaries?: (root: string) => RangeSummary[];
 listSessions?: (root: string) => SessionRef[];
 readTranscript?: (root: string, session: string) => string;
 modelName?: string;
 vaultRoot: string;
 runWikiJobs?: () => Promise<DocketReport['wiki']>;
 runImportJobs?: () => Promise<{ extracted: number; remaining: number; failed: number }>;
 stillTrueCursor?: { read: () => number; write: (offset: number) => void };
};

function makeSnippet(id: string): Snippet {
 return {
  id,
  version: 1,
  captured: new Date().toISOString(),
  provenance: {
   kind: 'harvest' as const,
   session: 's-default',
   question: 'What matters?',
   questionForm: 'deliberative' as const,
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
  markPending() { },
  defer() { },
  park() { },
  unpark() { },
  expire(olderThanDays: number): number {
   _expireCalls.push(olderThanDays);
   return 0;
  },
  expireTailBeyond() { return 0; },
  markExpired() { },
    recordReplyDisengagement() { return false; },
    noteSittingStarted() {},
 };
}

let runDocket: (deps: DocketDeps) => Promise<DocketReport>;

beforeEach(async () => {
 // docket.ts keeps module-level state (the single-flight `running` lock and
 // the still-true cursor), so each test loads a fresh module — the same
 // reason tests/docket.test.ts resets modules here.
 vi.resetModules();
 const mod = await import('../src/clerk/docket.js');
 runDocket = mod.runDocket;
});

// ===========================================================================
// The import extraction, as the docket's last job (T6)
// ===========================================================================

describe('the import extraction inside a docket run', () => {
 const IDX: LexicalIndex = { _brand: 'LexicalIndex' } as LexicalIndex;

 /** The minimum `DocketReport['wiki']` — T12's report is a superset of it. */
 const WIKI = { swept: 4, applied: 3, rejected: 1, unprocessed: 2 };

 const opener = {
  source: 'composed' as const, license: 'CC0',
  question: 'What about sn1?', questionForm: 'deliberative' as const,
  sharpness: 'weak' as const, horizon: 'now' as const,
  cites: ['sn1@1'], quotedFragment: 'sn1 prose.',
 } satisfies QueueDraft;

 function base(extra: Partial<DocketDeps> = {}): DocketDeps {
  return {
   vault: fakeVault([makeSnippet('sn1')]),
   queue: makeFakeQueue(),
   complete: vi.fn() as unknown as Complete,
   buildIndex: vi.fn().mockReturnValue(IDX),
   composeOpener: vi.fn().mockResolvedValue(opener),
   composeStillTrue: vi.fn().mockResolvedValue(null),
   log: vi.fn(),
   listSessions: vi.fn().mockReturnValue([
    { session: 's-default', started: new Date().toISOString(), turnCount: 1, chars: 10 },
   ]),
   vaultRoot: '/tmp/fake',
   ...extra,
  };
 }

 it('runs the import job last, after the wiki jobs, and carries its counts in the report', async () => {
  const order: string[] = [];
  const report = await runDocket(base({
   runWikiJobs: async () => { order.push('wiki'); return WIKI; },
   runImportJobs: async () => { order.push('import'); return { extracted: 2, remaining: 1, failed: 0 }; },
  }));

  expect(order).toEqual(['wiki', 'import']);
  expect(report.imports).toEqual({ extracted: 2, remaining: 1, failed: 0 });
 });

 it('survives an import job that throws, and still reports the rest of the run', async () => {
  const log = vi.fn();
  const report = await runDocket(base({
   log,
   runImportJobs: async () => { throw new Error('boom'); },
  }));

  expect(report.reindexed).toBeGreaterThanOrEqual(0);
  expect(report.imports).toBeUndefined();

  const failed = log.mock.calls.map((c) => c[0] as { kind: string; detail: string })
   .filter((e) => e.kind === 'import-run-failed');
  expect(failed).toHaveLength(1);
  expect(failed[0]!.detail).toContain('boom');
 });

 it('behaves exactly as before when no import job is injected', async () => {
  const report = await runDocket(base());

  expect(report.imports).toBeUndefined();
  expect(report.reindexed).toBe(1);
  expect(report.index).toBe(IDX);
  expect(report.minted).toHaveLength(1);
  expect(report.wiki).toBeUndefined();
 });
});
