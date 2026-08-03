import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { ulid } from 'ulid';
import { createPieceStore } from '../src/piece/store.js';
import { createAnnotationStore } from '../src/clerk/annotation-store.js';
import type { AnnotationStore } from '../src/clerk/annotation-store.js';
import type { PieceStore } from '../src/piece/contract.js';

import { createApp } from '../src/server.js';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex as realBuildIndex } from '../src/index/lexical.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readEvents } from '../src/log/activity.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { appendSweepDeferral, createClaimStore, readStillTrueCursor, writeStillTrueCursor } from '../src/wiki/store.js';
import { clerkRouter } from './fixtures/clerk-flow.js';
import type { Claim } from '../src/wiki/contract.js';
import type {
 Vault,
 QueueStore,
 QueueEntry,
 QueueDraft,
 Snippet,
 LexicalIndex,
 DocketReport,
 Complete,
 Turn,
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
 stalePinSweep?: () => Promise<number>;
 dormancySweep?: () => Promise<number>;
 referentAnnotations?: () => Promise<{ annotated: number; silent: number; failed: number }>;
 stillTrueCursor?: { read: () => number; write: (offset: number) => void };
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
type PieceSweepDeps = {
 pieces: PieceStore;
 snippets: () => Record<string, Snippet>;
 log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
};
let runStalePinSweep: (deps: PieceSweepDeps) => Promise<number>;
let runDormancySweep: (deps: PieceSweepDeps) => Promise<number>;
type AnnotationJobDeps = {
 snippets: () => Record<string, Snippet>;
 annotations: AnnotationStore;
 complete: Complete;
 modelName: string;
 log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
 cap?: number;
};
let runReferentAnnotations: (deps: AnnotationJobDeps) => Promise<{ annotated: number; silent: number; failed: number }>;

beforeEach(async () => {
 vi.resetModules();
 const mod = await import('../src/clerk/docket.js');
 runDocket = mod.runDocket;
 runStalePinSweep = mod.runStalePinSweep;
 runDormancySweep = mod.runDormancySweep;
 runReferentAnnotations = mod.runReferentAnnotations;
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

 // ── 075: still-true rotation with a shared cursor ──
 it('rotates still-true candidates across runs with a shared cursor', async () => {
  const old1 = makeSnippet('old1', { captured: daysAgo(100) });
  const old2 = makeSnippet('old2', { captured: daysAgo(99) });
  const old3 = makeSnippet('old3', { captured: daysAgo(98) });
  const old4 = makeSnippet('old4', { captured: daysAgo(97) });

  let offset = 0;
  const cursor = {
   read: () => offset,
   write: (o: number) => { offset = o; },
  };

  const composeStillTrue = vi.fn<(s: Snippet, c: Complete) => Promise<QueueDraft | null>>()
   .mockResolvedValue(null);
  const dir = mkdtempSync(join(tmpdir(), 'docket-075-rotation-'));
  const deps = {
   vault: fakeVault([old1, old2, old3, old4]),
   queue: makeFakeQueue(),
   complete: vi.fn() as unknown as Complete,
   buildIndex: vi.fn().mockReturnValue(IDX),
   composeOpener: vi.fn().mockResolvedValue(null),
   composeStillTrue,
   log: vi.fn(),
   vaultRoot: dir,
   stillTrueCursor: cursor,
  };
  try {
   await runDocket(deps);
   expect(composeStillTrue.mock.calls.map(c => c[0].id)).toEqual(['old1', 'old2']);
   composeStillTrue.mockClear();
   await runDocket(deps);
   expect(composeStillTrue.mock.calls.map(c => c[0].id)).toEqual(['old3', 'old4']);
   composeStillTrue.mockClear();
   await runDocket(deps);
   expect(composeStillTrue.mock.calls.map(c => c[0].id)).toEqual(['old1', 'old2']);
   // The cursor advanced past every candidate OFFERED — nulls included.
   expect(offset).toBe(6);
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
 });

 // ── 075: still-true cursor persisted across a simulated restart ──
 it('persists the still-true cursor to disk across restarts', async () => {
  const old1 = makeSnippet('old1', { captured: daysAgo(100) });
  const old2 = makeSnippet('old2', { captured: daysAgo(99) });
  const old3 = makeSnippet('old3', { captured: daysAgo(98) });
  const old4 = makeSnippet('old4', { captured: daysAgo(97) });

  const dir = mkdtempSync(join(tmpdir(), 'docket-075-persist-'));
  const makeDeps = (composeStillTrue: (s: Snippet, c: Complete) => Promise<QueueDraft | null>) => ({
   vault: fakeVault([old1, old2, old3, old4]),
   queue: makeFakeQueue(),
   complete: vi.fn() as unknown as Complete,
   buildIndex: vi.fn().mockReturnValue(IDX),
   composeOpener: vi.fn().mockResolvedValue(null),
   composeStillTrue,
   log: vi.fn(),
   vaultRoot: dir,
   stillTrueCursor: {
    read: () => readStillTrueCursor(dir),
    write: (o: number) => writeStillTrueCursor(dir, o),
   },
  });
  try {
   const composeStillTrue1 = vi.fn<(s: Snippet, c: Complete) => Promise<QueueDraft | null>>()
    .mockResolvedValue(null);
   await runDocket(makeDeps(composeStillTrue1));
   expect(composeStillTrue1.mock.calls.map(c => c[0].id)).toEqual(['old1', 'old2']);
   expect(readStillTrueCursor(dir)).toBe(2);
   expect(existsSync(join(dir, 'wiki', 'still-true-cursor.json'))).toBe(true);

   // Simulate a restart: fresh module registry, fresh cursor object, same file.
   vi.resetModules();
   const mod = await import('../src/clerk/docket.js');
   const composeStillTrue2 = vi.fn<(s: Snippet, c: Complete) => Promise<QueueDraft | null>>()
    .mockResolvedValue(null);
   await mod.runDocket(makeDeps(composeStillTrue2));
   expect(composeStillTrue2.mock.calls.map(c => c[0].id)).toEqual(['old3', 'old4']);
   expect(readStillTrueCursor(dir)).toBe(4);
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
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

// ===========================================================================
// The wiki jobs, as the docket's last job (Task 13)
// ===========================================================================

describe('the wiki jobs inside a docket run', () => {
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
   vault: fakeVault([makeSnippet('sn1', { provenance: { session: 's1' } })]),
   queue: makeFakeQueue(),
   complete: vi.fn() as unknown as Complete,
   buildIndex: vi.fn().mockReturnValue(IDX),
   composeOpener: vi.fn().mockResolvedValue(opener),
   composeStillTrue: vi.fn().mockResolvedValue(null),
   log: vi.fn(),
   listSessions: vi.fn().mockReturnValue([
    { session: 's1', started: daysAgo(0), turnCount: 1, chars: 10 },
   ]),
   vaultRoot: '/tmp/fake',
   ...extra,
  };
 }

 it('leaves report.wiki absent when no runWikiJobs is injected', async () => {
  const report = await runDocket(base());
  expect(report.wiki).toBeUndefined();
 });

 it("carries the wiki jobs' own report on DocketReport.wiki", async () => {
  const runWikiJobs = vi.fn().mockResolvedValue(WIKI);
  const report = await runDocket(base({ runWikiJobs }));

  expect(runWikiJobs).toHaveBeenCalledTimes(1);
  expect(report.wiki).toEqual(WIKI);
 });

 it('runs the wiki jobs last, after the index, the minting and the expiry', async () => {
  const order: string[] = [];
  const q = makeFakeQueue();
  const expire = q.expire.bind(q);
  q.expire = (days: number): number => {
   order.push('expire');
   return expire(days);
  };

  await runDocket(base({
   queue: q,
   composeOpener: vi.fn().mockImplementation(async () => {
    order.push('opener');
    return opener;
   }),
   runWikiJobs: vi.fn().mockImplementation(async () => {
    order.push('wiki');
    return WIKI;
   }),
  }));

  expect(order).toEqual(['opener', 'expire', 'wiki']);
 });

 it('a wiki failure costs the wiki report and nothing else in the run', async () => {
  const log = vi.fn();
  const q = makeFakeQueue();
  const report = await runDocket(base({
   queue: q,
   log,
   runWikiJobs: vi.fn().mockRejectedValue(new Error('the wiki work fell over')),
  }));

  // Everything the docket does on its own still happened and still reports.
  expect(report.index).toBe(IDX);
  expect(report.reindexed).toBe(1);
  expect(report.minted).toHaveLength(1);
  expect(q._expireCalls).toEqual([30]);
  expect(report.wiki).toBeUndefined();

  const failed = log.mock.calls.map((c) => c[0] as { kind: string; detail: string })
   .filter((e) => e.kind === 'wiki-jobs-failed');
  expect(failed).toHaveLength(1);
  expect(failed[0]!.detail).toContain('the wiki work fell over');
 });
});

// ===========================================================================
// The seam: a real run puts the wiki's own events in the Activity Log
//
// Ticket 063's oracle found that nothing connected `src/wiki/*`'s LogFn to
// `appendEvent` — server.ts built a real log for the docket and none for the
// wiki layer, so `shadow-decision`, `threshold-clipped` and both clip records
// were written into whatever a caller passed, and in production there was no
// caller. Q-35 graduates a mechanism on its shadow record and Q-56 makes a
// bound owe its clip record, so a record that reaches nowhere is the mechanism
// not existing.
//
// These tests therefore boot the real server against a real vault directory
// and READ THE LOG FILE BACK. A test that asserts the code calls `log` is
// precisely the assumption that failed here.
// ===========================================================================

describe('a real docket run and the Activity Log', () => {
 let dir: string;

 beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elicit-docket-seam-'));
 });

 afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
 });

 /** Counts settled docket runs. server.ts catches its own failures. */
 function barrier() {
  let settled = 0;
  return {
   onDocketSettled(): void { settled++; },
   async settle(): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (settled < 1) {
     if (Date.now() > deadline) throw new Error('no docket run settled');
     await new Promise((r) => setTimeout(r, 5));
    }
    const failed = readEvents(dir).filter((e) => e.kind === 'docket-run-failed');
    if (failed.length > 0) throw new Error(`docket run failed: ${failed.map((e) => e.detail).join('; ')}`);
   },
  };
 }

 function boot(embed?: { embed: (t: string[]) => Promise<number[][]>; model: string }) {
  const b = barrier();
  const app = createApp({
   vault: createVault(dir),
   complete: makeFakeComplete(),
   queue: createQueueStore(dir),
   index: realBuildIndex([]),
   vaultRoot: dir,
   authStore: createFileAuth(join(dir, '.auth.json')),
   onDocketSettled: b.onDocketSettled,
   ...(embed ? { embed } : {}),
  });
  return { app, settled: b.settle };
 }

 function claim(id: string, body: string): Claim {
  const at = new Date().toISOString();
  return {
   id, body, range: 'at work', status: 'unconfirmed', cites: ['snip-1@1'],
   facet: 'construct', referents: [], fromReadings: [], attested: false,
   readLog: [], model: 'test-model', modelAt: at, created: at, updated: at,
  };
 }

 /** Polls until `cond` holds, failing fast on a docket-run-failed event. */
 async function waitFor(cond: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!cond()) {
   if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
   const failed = readEvents(dir).filter((e) => e.kind === 'docket-run-failed');
   if (failed.length > 0) throw new Error(`docket run failed: ${failed.map((e) => e.detail).join('; ')}`);
   await new Promise<void>((r) => setTimeout(r, 5));
  }
 }

 /** The `remaining` field of one sweep-deferral line, narrowed not cast. */
 function deferralRemaining(line: string): number {
  const parsed: unknown = JSON.parse(line);
  if (
   typeof parsed === 'object' && parsed !== null &&
   'remaining' in parsed && typeof parsed.remaining === 'number'
  ) {
   return parsed.remaining;
  }
  throw new Error(`malformed sweep-deferral line: ${line}`);
 }

 /**
  * Asserts the drain chain did NOT start another run. Real clock on purpose:
  * the timer under test is server.ts's own setTimeout (ELICIT_DOCKET_DRAIN_DELAY_MS),
  * and the settle signal is the only deterministic completion — a fake clock
  * would make the absence assertion vacuous.
  */
 async function expectNoFurtherRun(settled: () => number, count: number): Promise<void> {
  const quiet = Date.now() + 150;
  while (settled() < count + 1 && Date.now() < quiet) {
   await new Promise<void>((r) => setTimeout(r, 5));
  }
  expect(settled()).toBe(count);
 }

 it('writes the wiki jobs own events into the vault Activity Log', async () => {
  const { app, settled } = boot();
  await app;
  await settled();

  const kinds = readEvents(dir).map((e) => e.kind);
  // `clash-checked` is emitted on EVERY run including the zero one, so it is
  // the one wiki event a run over an empty vault must produce. Its presence
  // in the file is the whole claim: the wiki layer's LogFn is appendEvent.
  expect(kinds).toContain('clash-checked');
  const checked = readEvents(dir).find((e) => e.kind === 'clash-checked')!;
  expect(checked.actor).toBe('clerk');
 });

 it('writes the embedding channel shadow record, which needs prime before the pool', async () => {
  const store = createClaimStore(dir);
  store.writeClaim(claim('01KA000000000000000000000A', 'I choose the work that looks impressive.'));
  store.writeClaim(claim('01KA000000000000000000000B', 'I keep picking the impressive-looking work.'));

  const embed = {
   model: 'fake-embed',
   // Identical vectors: every pair scores 1.0, so the only thing that can
   // keep the record out of the log is a cache nobody filled.
   embed: async (texts: string[]): Promise<number[][]> => texts.map(() => [1, 1]),
  };

  const { app, settled } = boot(embed);
  await app;
  await settled();

  const shadows = readEvents(dir).filter((e) => e.kind === 'shadow-decision');
  const embedding = shadows.filter((e) => e.detail.includes('threshold=clash.embeddingCosine'));
  expect(embedding.length).toBeGreaterThan(0);
  expect(embedding[0]!.detail).toContain('would=pool');
 });

 it('drains a quota-clipped sweep across self-triggered runs, with no harvest', async () => {
  vi.stubEnv('ELICIT_DOCKET_DRAIN_DELAY_MS', '5');
  try {
   const vault = createVault(dir);
   const snip = vault.saveSnippet('A seed for the drain chain.', {
    kind: 'harvest',
    session: 's-seed',
    question: 'What matters?',
    questionForm: 'deliberative',
   });
   for (let n = 1; n <= 30; n++) {
    vault.saveReading({
     facet: 'fact',
     stance: 'avowal',
     reading: `Reading ${n}: something specific and ordinary happened.`,
     cites: [`${snip.id}@1`],
    });
   }

   const store = createClaimStore(dir);
   const router = clerkRouter({ store });
   let settled = 0;
   const app = createApp({
    vault,
    complete: router.complete,
    queue: createQueueStore(dir),
    index: realBuildIndex([]),
    vaultRoot: dir,
    authStore: createFileAuth(join(dir, '.auth.json')),
    onDocketSettled: () => { settled++; },
   });
   await app;

   // boot + two self-triggered drains: 12 + 12 + 6 of the 30 readings.
   await waitFor(() => settled >= 3, 'the drain chain to finish');
   await expectNoFurtherRun(() => settled, 3);

   expect(store.sweptReadingIds().size).toBe(30);
   expect(router.count('harvest')).toBe(0);

   const clips = readEvents(dir)
    .filter((e) => e.kind === 'threshold-clipped' && e.detail.includes('threshold=mint.callsPerRun'))
    .map((e) => Number(e.detail.split('clipped=')[1]!.split(/\s+/)[0]!));
   expect(clips).toEqual([18, 6]);

   const deferrals = readFileSync(join(dir, 'wiki', 'sweep-deferral.jsonl'), 'utf-8')
    .trim()
    .split('\n')
    .map(deferralRemaining);
   expect(deferrals).toEqual([18, 6, 0]);
  } finally {
   vi.unstubAllEnvs();
  }
 });

 it('a boot run claims a deferral left by an interrupted chain', async () => {
  vi.stubEnv('ELICIT_DOCKET_DRAIN_DELAY_MS', '5');
  try {
   const vault = createVault(dir);
   const snip = vault.saveSnippet('A seed for the drain chain.', {
    kind: 'harvest',
    session: 's-seed',
    question: 'What matters?',
    questionForm: 'deliberative',
   });
   for (let n = 1; n <= 3; n++) {
    vault.saveReading({
     facet: 'fact',
     stance: 'avowal',
     reading: `Reading ${n}: something specific and ordinary happened.`,
     cites: [`${snip.id}@1`],
    });
   }

   // A chain that crashed mid-drain: the deferral says 7 readings are
   // left, but the vault has nothing unswept. The boot run must claim the
   // stale deferral (append the terminal 0) and schedule nothing further.
   appendSweepDeferral(dir, 7);

   const store = createClaimStore(dir);
   const router = clerkRouter({ store });
   let settled = 0;
   const app = createApp({
    vault,
    complete: router.complete,
    queue: createQueueStore(dir),
    index: realBuildIndex([]),
    vaultRoot: dir,
    authStore: createFileAuth(join(dir, '.auth.json')),
    onDocketSettled: () => { settled++; },
   });
   await app;

   await waitFor(() => settled >= 1, 'the boot run');
   await expectNoFurtherRun(() => settled, 1);

   const deferrals = readFileSync(join(dir, 'wiki', 'sweep-deferral.jsonl'), 'utf-8')
    .trim()
    .split('\n')
    .map(deferralRemaining);
   expect(deferrals).toEqual([7, 0]);
  } finally {
   vi.unstubAllEnvs();
  }
 });
});

// ===========================================================================
// The piece jobs (Task 10 — the stale-pin sweep and auto-set-down)
// ===========================================================================
// The REAL job functions over a REAL vault directory, because the sweep
// writes through putArrangement, which validates pins against the store's
// own disk read of snippets — so the snippet files must exist on disk.

describe('the piece jobs on a real vault (010 T10)', () => {
 let dir: string;

 beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elicit-piece-jobs-'));
 });

 afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
 });

 it('sets a dormant piece down once, on disk, and never again', async () => {
  const vault = createVault(dir);
  const snip = vault.saveSnippet('a paragraph pinned long ago', {
   kind: 'harvest',
   session: 's-old',
   question: 'what changed?',
   questionForm: 'deliberative',
  });
  // Age the pinned snippet's captured to 60 days ago, body preserved.
  const v1 = matter.read(join(dir, 'snippets', snip.id, 'v1.md'));
  v1.data.captured = daysAgo(60);
  writeFileSync(join(dir, 'snippets', snip.id, 'v1.md'), matter.stringify(v1.content, v1.data), 'utf-8');

  const store = createPieceStore(dir);
  const piece = store.create([{ id: ulid(), kind: 'pin', snippet: snip.id, version: 1 }]);
  // The piece and its arrangement were created just now; age them too, so
  // every candidate for lastTouched is 60 days old.
  const pm = matter.read(join(dir, 'pieces', piece.id, 'piece.md'));
  pm.data.created = daysAgo(60);
  writeFileSync(join(dir, 'pieces', piece.id, 'piece.md'), matter.stringify(pm.content, pm.data), 'utf-8');
  const am = matter.read(join(dir, 'pieces', piece.id, 'arrangements', piece.current + '.md'));
  am.data.created = daysAgo(60);
  writeFileSync(join(dir, 'pieces', piece.id, 'arrangements', piece.current + '.md'), matter.stringify(am.content, am.data), 'utf-8');

  const emitted: string[] = [];
  const log = (e: { kind: string }) => { emitted.push(e.kind); };
  const first = await runDormancySweep({
   pieces: store,
   snippets: () => vault.rebuildIndex().snippets,
   log,
  });
  expect(first).toBe(1);
  const onDisk = matter.read(join(dir, 'pieces', piece.id, 'piece.md')).data as {
   setDownAt?: string;
   setDownBy?: string;
  };
  expect(onDisk.setDownAt).toBeDefined();
  expect(onDisk.setDownBy).toBe('dormancy');
  expect(emitted.filter((k) => k === 'piece-set-down-auto')).toHaveLength(1);

  // A second run over the same vault emits nothing and changes nothing.
  const second = await runDormancySweep({
   pieces: store,
   snippets: () => vault.rebuildIndex().snippets,
   log,
  });
  expect(second).toBe(0);
  expect(emitted.filter((k) => k === 'piece-set-down-auto')).toHaveLength(1);
 });

 it('flags a stale pin as Marginalia, leaves the pin alone, and never duplicates', async () => {
  const vault = createVault(dir);
  const snip = vault.saveSnippet('v1 prose', {
   kind: 'harvest',
   session: 's-old',
   question: 'what changed?',
   questionForm: 'deliberative',
  });
  const store = createPieceStore(dir);
  const piece = store.create([{ id: ulid(), kind: 'pin', snippet: snip.id, version: 1 }]);
  // The snippet moves on — v2 exists on disk; the pin still names v1.
  vault.saveVersion(snip.id, 'v2 prose');

  const emitted: string[] = [];
  const log = (e: { kind: string }) => { emitted.push(e.kind); };
  const first = await runStalePinSweep({
   pieces: store,
   snippets: () => vault.rebuildIndex().snippets,
   log,
  });
  expect(first).toBe(1);
  const current = store.get(piece.id)!.arrangements.find((a) => a.id === piece.current)!;
  const flags = current.marginalia.filter((m) => m.note === 'stale-pin');
  expect(flags).toHaveLength(1);
  expect(flags[0]!.on).toBe(piece.arrangements[0]!.entries[0]!.id);
  // The pin itself is untouched — still version 1 (Q-39).
  const pin = current.entries[0]!;
  expect(pin.kind).toBe('pin');
  if (pin.kind === 'pin') expect(pin.version).toBe(1);
  expect(emitted).toContain('stale-pin-flagged');

  // A second run dedupes by (on, note): no duplicate Marginalia, no event.
  const second = await runStalePinSweep({
   pieces: store,
   snippets: () => vault.rebuildIndex().snippets,
   log,
  });
  expect(second).toBe(0);
  const after = store.get(piece.id)!.arrangements.find((a) => a.id === piece.current)!;
  expect(after.marginalia.filter((m) => m.note === 'stale-pin')).toHaveLength(1);
  expect(emitted.filter((k) => k === 'stale-pin-flagged')).toHaveLength(1);
 });

 it('a docket run whose complete rejects still completes both piece jobs', async () => {
  const vault = createVault(dir);
  const snip = vault.saveSnippet('v1 prose', {
   kind: 'harvest',
   session: 's-old',
   question: 'what changed?',
   questionForm: 'deliberative',
  });
  vault.saveVersion(snip.id, 'v2 prose');
  const store = createPieceStore(dir);
  const piece = store.create([{ id: ulid(), kind: 'pin', snippet: snip.id, version: 1 }]);

  const stalePinSweep = vi.fn().mockResolvedValue(1);
  const dormancySweep = vi.fn().mockResolvedValue(1);
  const log = vi.fn();
  await runDocket({
   vault,
   queue: makeFakeQueue(),
   complete: vi.fn().mockRejectedValue(new Error('boom')),
   buildIndex: (snippets) => realBuildIndex(snippets),
   composeOpener: async () => null,
   composeStillTrue: async () => null,
   log,
   vaultRoot: dir,
   stalePinSweep,
   dormancySweep,
  });
  // Neither job received the Complete; both ran to completion.
  expect(stalePinSweep).toHaveBeenCalledTimes(1);
  expect(dormancySweep).toHaveBeenCalledTimes(1);
 });
});

// ===========================================================================
// The referent annotation job (ticket 074)

describe('runReferentAnnotations', () => {
 const MODEL = 'fake-model';
 const IDX: LexicalIndex = { _brand: 'LexicalIndex' } as LexicalIndex;
 const ANNOTATE_JSON = JSON.stringify({ annotate: true, expression: 'that', referent: 'the thing it points at' });
 const SILENCE_JSON = JSON.stringify({ annotate: false });

 type Call = { system: string; turns: Turn[]; opts: { temperature?: number } | undefined };

 /** A completer that records every call and answers from a script, in order. */
 function recorder(responses: string[]): { complete: Complete; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const complete: Complete = async (system, turns, opts) => {
   calls.push({ system, turns, opts });
   const next = responses[i++];
   if (next === undefined) throw new Error(`scripted completer exhausted after ${responses.length}`);
   return next;
  };
  return { complete, calls };
 }

 let root: string;
 beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-annotate-'));
 });
 afterEach(() => {
  rmSync(root, { recursive: true, force: true });
 });

 it('annotates a missing snippet and persists the annotation record with the stamp from the result', async () => {
  const s = makeSnippet(ulid(), { prose: 'I would leave a job that took my direction away.' });
  const { complete, calls } = recorder([ANNOTATE_JSON]);
  const annotations = createAnnotationStore(join(root, 'annotations'));
  const res = await runReferentAnnotations({
   snippets: () => ({ [s.id]: s }),
   annotations,
   complete,
   modelName: MODEL,
   log: vi.fn(),
  });
  expect(res).toEqual({ annotated: 1, silent: 0, failed: 0 });
  expect(calls).toHaveLength(1);
  const rec = annotations.get(s.id);
  expect(rec).not.toBeNull();
  if (rec !== null && rec.kind === 'annotation') {
   expect(rec.snippetId).toBe(s.id);
   expect(rec.version).toBe(s.version);
   expect(rec.expression).toBe('that');
   expect(rec.referent).toBe('the thing it points at');
   // The stamp (model + modelAt) comes FROM annotateReferent's result —
   // the job never re-stamps (Q-34).
   expect(rec.model).toBe(MODEL);
   expect(typeof rec.modelAt).toBe('string');
  } else {
   throw new Error('expected an annotation record');
  }
 });

 it('persists a silence record so a judged snippet is never re-asked', async () => {
  const s = makeSnippet(ulid(), { prose: 'Some prose with a dangling it.' });
  const { complete, calls } = recorder([SILENCE_JSON]);
  const annotations = createAnnotationStore(join(root, 'annotations'));
  const res = await runReferentAnnotations({
   snippets: () => ({ [s.id]: s }),
   annotations,
   complete,
   modelName: MODEL,
   log: vi.fn(),
  });
  expect(res).toEqual({ annotated: 0, silent: 1, failed: 0 });
  expect(calls).toHaveLength(1);
  expect(annotations.get(s.id)).toEqual({
   kind: 'silence',
   snippetId: s.id,
   version: s.version,
   model: MODEL,
   modelAt: expect.any(String),
  });
 });

 it('skips a snippet whose record is current', async () => {
  const s = makeSnippet(ulid(), { prose: 'Already annotated.' });
  const annotations = createAnnotationStore(join(root, 'annotations'));
  annotations.put({ kind: 'annotation', snippetId: s.id, version: s.version, expression: 'it', referent: 'the old referent', model: MODEL, modelAt: new Date().toISOString() });
  const { complete, calls } = recorder([ANNOTATE_JSON]);
  const res = await runReferentAnnotations({
   snippets: () => ({ [s.id]: s }),
   annotations,
   complete,
   modelName: MODEL,
   log: vi.fn(),
  });
  expect(res).toEqual({ annotated: 0, silent: 0, failed: 0 });
  expect(calls).toHaveLength(0);
  const rec = annotations.get(s.id);
  if (rec !== null && rec.kind === 'annotation') {
   expect(rec.referent).toBe('the old referent');
  } else {
   throw new Error('expected the untouched annotation record');
  }
 });

 it('re-annotates a snippet whose version moved on (new text, new read)', async () => {
  const s = makeSnippet(ulid(), { prose: 'Second version of the prose.' });
  s.version = 2;
  const annotations = createAnnotationStore(join(root, 'annotations'));
  annotations.put({ kind: 'annotation', snippetId: s.id, version: 1, expression: 'it', referent: 'the old referent', model: MODEL, modelAt: new Date().toISOString() });
  const { complete } = recorder([ANNOTATE_JSON]);
  const res = await runReferentAnnotations({
   snippets: () => ({ [s.id]: s }),
   annotations,
   complete,
   modelName: MODEL,
   log: vi.fn(),
  });
  expect(res).toEqual({ annotated: 1, silent: 0, failed: 0 });
  const rec = annotations.get(s.id);
  if (rec !== null && rec.kind === 'annotation') {
   expect(rec.version).toBe(2);
   expect(rec.referent).toBe('the thing it points at');
  } else {
   throw new Error('expected a fresh annotation record');
  }
 });

 it('processes at most cap candidates (the cap bounds model calls)', async () => {
  const snips = Array.from({ length: 7 }, () => makeSnippet(ulid()));
  const { complete, calls } = recorder(Array.from({ length: 7 }, () => ANNOTATE_JSON));
  const annotations = createAnnotationStore(join(root, 'annotations'));
  const res = await runReferentAnnotations({
   snippets: () => Object.fromEntries(snips.map((x) => [x.id, x])),
   annotations,
   complete,
   modelName: MODEL,
   log: vi.fn(),
   cap: 3,
  });
  expect(res).toEqual({ annotated: 3, silent: 0, failed: 0 });
  expect(calls).toHaveLength(3);
 });

 it('counts a model failure and logs referent-annotation-failed', async () => {
  const s = makeSnippet(ulid(), { prose: 'Prose that makes the model explode.' });
  // Empty script: the first call throws, and a throw is a counted failure,
  // never a silence.
  const { complete } = recorder([]);
  const annotations = createAnnotationStore(join(root, 'annotations'));
  const log = vi.fn();
  const res = await runReferentAnnotations({
   snippets: () => ({ [s.id]: s }),
   annotations,
   complete,
   modelName: MODEL,
   log,
  });
  expect(res).toEqual({ annotated: 0, silent: 0, failed: 1 });
  const events = log.mock.calls.map((call) => call[0] as { kind: string; detail: string });
  const failed = events.find((e) => e.kind === 'referent-annotation-failed');
  expect(failed).toBeTruthy();
  if (failed !== undefined) {
   expect(failed.detail).toContain(s.id);
   expect(failed.detail).toContain('scripted completer exhausted');
  }
  // The summary line logs even when everything failed.
  const summary = events.find((e) => e.kind === 'referent-annotated');
  expect(summary).toBeTruthy();
  if (summary !== undefined) expect(summary.detail).toBe('annotated=0 silent=0 failed=1');
 });

 it('processes candidates newest-first', async () => {
  const old = makeSnippet(ulid(), { captured: daysAgo(2), prose: 'oldest prose' });
  const mid = makeSnippet(ulid(), { captured: daysAgo(1), prose: 'middle prose' });
  const fresh = makeSnippet(ulid(), { captured: daysAgo(0), prose: 'newest prose' });
  const { complete, calls } = recorder([ANNOTATE_JSON, ANNOTATE_JSON, ANNOTATE_JSON]);
  const annotations = createAnnotationStore(join(root, 'annotations'));
  const res = await runReferentAnnotations({
   snippets: () => ({ [old.id]: old, [mid.id]: mid, [fresh.id]: fresh }),
   annotations,
   complete,
   modelName: MODEL,
   log: vi.fn(),
  });
  expect(res).toEqual({ annotated: 3, silent: 0, failed: 0 });
  const texts = calls.map((call) => call.turns[0]!.text);
  expect(texts[0]).toContain('newest prose');
  expect(texts[1]).toContain('middle prose');
  expect(texts[2]).toContain('oldest prose');
 });

 it('runDocket calls an injected referentAnnotations thunk and reports its counts', async () => {
  const sn = makeSnippet('sn1', { provenance: { session: 's1' } });
  const referentAnnotations = vi.fn().mockResolvedValue({ annotated: 2, silent: 1, failed: 0 });
  const report = await runDocket({
   vault: fakeVault([sn]),
   queue: makeFakeQueue(),
   complete: vi.fn() as unknown as Complete,
   buildIndex: vi.fn().mockReturnValue(IDX),
   composeOpener: vi.fn(),
   composeStillTrue: vi.fn(),
   log: vi.fn(),
   listSessions: vi.fn().mockReturnValue([]),
   referentAnnotations,
   vaultRoot: '/tmp/fake',
  });
  expect(referentAnnotations).toHaveBeenCalledTimes(1);
  expect(report.annotations).toEqual({ annotated: 2, silent: 1, failed: 0 });
 });
});
