import { describe, it, expect, vi } from 'vitest';
import {
  buildSemanticIndex,
  runCoverageEmbedding,
  type SemanticDeps,
} from '../src/index/semantic.js';
import {
  coverageQuota,
  EMBED_COVERAGE_RATIO,
  EMBED_QUOTA_FLOOR,
  embeddingChannel,
  type Embed,
  type EmbeddingIndexStore,
  type EmbeddingRecord,
} from '../src/wiki/embedding.js';
import { formatEvent } from '../src/log/format.js';
import { buildIndex } from '../src/index/lexical.js';
import { runDocket } from '../src/clerk/docket.js';
import type { ThresholdLogFn } from '../src/domain/thresholds.js';
import type { LogFn, Claim, ClaimGraph } from '../src/wiki/contract.js';
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

/**
 * §12's embedding debts, Batch C3: full-corpus coverage as a docket job,
 * quotas sized to the real corpus, and every embedding job logging its
 * coverage — starvation is a sentence on the activity log, never a silence.
 *
 * The staging of the meaning-resonance channel behind lexical is pinned in
 * `tests/semantic-resonance.test.ts` (`resonateHybrid`): lexical first,
 * semantic fills to k, no network call when lexical already filled k. This
 * file pins the debts around it: the corpus-sized quota, the coverage
 * sentences both keyspaces emit, the full-corpus docket job, and the
 * resonance verdict's evidence in the activity line.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────

function snip(id: string, prose: string): Snippet {
  return {
    id,
    version: 1,
    captured: '2026-03-14T09:00:00.000Z',
    provenance: {
      kind: 'harvest',
      session: 'coverage-fixture',
      question: 'what did you notice about yourself this week?',
      questionForm: 'deliberative',
    },
    prose,
  };
}

function corpusOf(n: number): Snippet[] {
  return Array.from({ length: n }, (_, i) => snip(`s${String(i).padStart(3, '0')}`, `body ${i}`));
}

function memoryStore(seed: EmbeddingRecord[] = []): EmbeddingIndexStore & { rows: EmbeddingRecord[] } {
  const holder = {
    rows: [...seed],
    load: () => holder.rows.map((r) => ({ ...r, vector: [...r.vector] })),
    save: (records: EmbeddingRecord[]) => {
      holder.rows = records.map((r) => ({ ...r, vector: [...r.vector] }));
    },
  };
  return holder;
}

function collector(): { log: ThresholdLogFn; lines: { kind: string; detail: string }[] } {
  const lines: { kind: string; detail: string }[] = [];
  return { log: (e) => lines.push({ kind: e.kind, detail: e.detail }), lines };
}

/** Hand-built one-hot-ish vectors, keyed by exact text. */
function axes(map: Record<string, number[]>): Embed & { calls: number } {
  const embed = async (texts: string[]) => {
    embed.calls += texts.length;
    return texts.map((t) => {
      const v = map[t];
      if (!v) throw new Error(`no vector for ${JSON.stringify(t)}`);
      return v;
    });
  };
  embed.calls = 0;
  return embed;
}

function allVectors(corpus: Snippet[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const s of corpus) out[s.prose] = [1, 0];
  return out;
}

function semDeps(over: Partial<SemanticDeps> & Pick<SemanticDeps, 'embed'>): SemanticDeps {
  return {
    model: 'test-model',
    store: memoryStore(),
    log: () => {},
    ...over,
  };
}

function claim(id: string, body: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    body,
    range: 'at work',
    status: 'unconfirmed',
    cites: ['snip-1@1'],
    facet: 'construct',
    referents: [],
    fromReadings: [],
    attested: false,
    readLog: [],
    model: 'test-model',
    modelAt: '2026-08-01T09:00:00.000Z',
    created: '2026-08-01T09:00:00.000Z',
    updated: '2026-08-01T09:00:00.000Z',
    ...extra,
  };
}

function graph(claims: Claim[]): ClaimGraph {
  return { claims, snippets: {}, readings: {}, contradictions: [], referents: [] };
}

function claimRecorder(): { log: LogFn; details: (kind: string) => string[] } {
  const events: { kind: string; detail: string }[] = [];
  return {
    log: (e) => void events.push({ kind: e.kind, detail: e.detail }),
    details: (kind) => events.filter((e) => e.kind === kind).map((e) => e.detail),
  };
}

// ── The quota, sized to the real corpus (§12) ─────────────────────────────

describe('the corpus-sized embed quota (§12, Batch C3)', () => {
  it('derives the per-run budget from the corpus size — a ratio, never a fixed ceiling', () => {
    expect(EMBED_COVERAGE_RATIO).toBe(1); // one run may cover the whole corpus
    expect(coverageQuota(87)).toBe(87);
    expect(coverageQuota(600)).toBe(600);
    expect(coverageQuota(1500)).toBe(1500);
  });

  it('floors a tiny corpus so the quota stays a real budget', () => {
    expect(coverageQuota(2)).toBe(EMBED_QUOTA_FLOOR);
    expect(coverageQuota(0)).toBe(EMBED_QUOTA_FLOOR);
    expect(EMBED_QUOTA_FLOOR).toBeGreaterThan(0);
  });

  it('the semantic channel primes the WHOLE corpus by default, past any old fixed ceiling', async () => {
    const many = corpusOf(600); // > the legacy 500 ceiling
    const index = buildSemanticIndex(many, semDeps({ embed: axes(allVectors(many)) }));
    await index.prime();
    expect(index.vectored()).toBe(600);
  });
});

// ── The passage keyspace logs its coverage (noun=passage) ─────────────────

describe('the semantic channel logs its coverage (noun=passage)', () => {
  it('a cold run names covered, fresh and the gap', async () => {
    const corpus = corpusOf(87);
    const { log, lines } = collector();
    const index = buildSemanticIndex(corpus, semDeps({ embed: axes(allVectors(corpus)), log }));
    await index.prime();

    const line = lines.find((l) => l.kind === 'embedding-coverage');
    expect(line).toBeDefined();
    expect(line!.detail).toBe('noun=passage covered=87 total=87 fresh=87 unembedded=0');
    // And it reads as a sentence on the activity log — never a silence.
    expect(formatEvent({ at: '', actor: 'clerk', kind: 'embedding-coverage', detail: line!.detail }))
      .toBe('embedded 87 of 87 passages — 0 unembedded');
  });

  it('a budget-stopped run names the gap, so starvation is a sentence', async () => {
    const corpus = corpusOf(40);
    const { log, lines } = collector();
    let t = 0;
    const index = buildSemanticIndex(
      corpus,
      semDeps({ embed: axes(allVectors(corpus)), log, primeBudgetMs: 100, now: () => (t += 60) }),
    );
    await index.prime();

    expect(index.vectored()).toBe(16); // one batch, then the budget stops it
    const line = lines.find((l) => l.kind === 'embedding-coverage');
    expect(line!.detail).toBe('noun=passage covered=16 total=40 fresh=16 unembedded=24');
    expect(formatEvent({ at: '', actor: 'clerk', kind: 'embedding-coverage', detail: line!.detail }))
      .toBe('embedded 16 of 40 passages — 24 unembedded');
  });

  it('a warm run reports fresh=0 and a zero gap', async () => {
    const corpus = corpusOf(12);
    const store = memoryStore();
    const { log, lines } = collector();
    const first = buildSemanticIndex(corpus, semDeps({ embed: axes(allVectors(corpus)), store, log }));
    await first.prime();
    const second = buildSemanticIndex(corpus, semDeps({ embed: axes(allVectors(corpus)), store, log }));
    await second.prime();

    const coverage = lines.filter((l) => l.kind === 'embedding-coverage');
    expect(coverage).toHaveLength(2);
    expect(coverage[1]!.detail).toBe('noun=passage covered=12 total=12 fresh=0 unembedded=0');
  });
});

// ── The claim keyspace logs its coverage (noun=claim) ─────────────────────

describe('the claim channel logs its coverage (noun=claim)', () => {
  it('the recency window gap is a sentence, never a silence', async () => {
    const { log, details } = claimRecorder();
    const claims = Array.from({ length: 10 }, (_, i) =>
      claim(`c-${String(i).padStart(3, '0')}`, `body ${i}`, {
        updated: `2026-0${1 + (i % 8)}-01T00:00:00.000Z`,
      }),
    );
    const vecs: Record<string, number[]> = {};
    for (const c of claims) vecs[c.body] = [1, 0];
    const ch = embeddingChannel({
      embed: axes(vecs),
      model: 'fake-embed',
      store: memoryStore(),
      log,
      window: 4,
    });

    await ch.prime(graph(claims));

    const line = details('embedding-coverage');
    expect(line).toHaveLength(1);
    expect(line[0]).toBe('noun=claim covered=4 total=10 fresh=4 unembedded=6');
  });

  it('a fully covered claim corpus reads as a sentence too', async () => {
    const { log, details } = claimRecorder();
    const claims = [claim('c-a', 'one'), claim('c-b', 'two'), claim('c-c', 'three')];
    const vecs: Record<string, number[]> = {};
    for (const c of claims) vecs[c.body] = [1, 0];
    const ch = embeddingChannel({
      embed: axes(vecs),
      model: 'fake-embed',
      store: memoryStore(),
      log,
    });

    await ch.prime(graph(claims));

    const line = details('embedding-coverage');
    expect(line[0]).toBe('noun=claim covered=3 total=3 fresh=3 unembedded=0');
    expect(formatEvent({ at: '', actor: 'clerk', kind: 'embedding-coverage', detail: line[0]! }))
      .toBe('embedded 3 of 3 claims — 0 unembedded');
  });
});

// ── The full-corpus coverage docket job (§12) ─────────────────────────────

describe('runCoverageEmbedding — the full-corpus docket job', () => {
  it('embeds every missing passage and reports the counts', async () => {
    const corpus = corpusOf(12);
    const store = memoryStore();
    const report = await runCoverageEmbedding({
      corpus,
      embed: axes(allVectors(corpus)),
      model: 'test-model',
      store,
      log: () => {},
    });

    expect(report).toEqual({ covered: 12, total: 12, fresh: 12 });
    expect(store.rows).toHaveLength(12);
  });

  it('is resumable: the next run embeds nothing new', async () => {
    const corpus = corpusOf(12);
    const store = memoryStore();
    await runCoverageEmbedding({ corpus, embed: axes(allVectors(corpus)), model: 'test-model', store, log: () => {} });
    const second = await runCoverageEmbedding({
      corpus,
      embed: axes(allVectors(corpus)),
      model: 'test-model',
      store,
      log: () => {},
    });

    expect(second).toEqual({ covered: 12, total: 12, fresh: 0 });
  });

  it('is derived and rebuildable (Q-3): a wiped store costs one pass, never a failure', async () => {
    const corpus = corpusOf(12);
    const store = memoryStore();
    await runCoverageEmbedding({ corpus, embed: axes(allVectors(corpus)), model: 'test-model', store, log: () => {} });
    store.save([]); // the index is derived; deleting it must cost one re-embed

    const rebuilt = await runCoverageEmbedding({
      corpus,
      embed: axes(allVectors(corpus)),
      model: 'test-model',
      store,
      log: () => {},
    });
    expect(rebuilt).toEqual({ covered: 12, total: 12, fresh: 12 });
  });

  it('a budget-stopped run reports the gap, and the sentence names it', async () => {
    const corpus = corpusOf(40);
    const { log, lines } = collector();
    let t = 0;
    const report = await runCoverageEmbedding({
      corpus,
      embed: axes(allVectors(corpus)),
      model: 'test-model',
      store: memoryStore(),
      log,
      budgetMs: 100,
      now: () => (t += 60),
    });

    expect(report).toEqual({ covered: 16, total: 40, fresh: 16 });
    const line = lines.find((l) => l.kind === 'embedding-coverage');
    expect(line!.detail).toContain('unembedded=24');
  });
});

// ── The docket wires the coverage pass ────────────────────────────────────

describe('the docket runs the coverage pass', () => {
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

  function fakeQueue(): QueueStore {
    const entries: QueueEntry[] = [];
    return {
      add(e: QueueDraft): QueueEntry {
        const entry = { ...e, id: `q-${entries.length}`, status: 'pending', created: new Date().toISOString() } as QueueEntry;
        entries.push(entry);
        return entry;
      },
      list: () => [...entries],
      get: (id: string) => entries.find((e) => e.id === id),
      draw: () => null,
      markAsked: () => {},
      markAnswered: () => {},
      markPending: () => {},
      defer: () => {},
      park: () => {},
      unpark: () => {},
      expire: () => 0,
      expireTailBeyond: () => 0,
      markExpired: () => {},
      recordReplyDisengagement: () => false,
      noteSittingStarted: () => {},
    };
  }

  it('runs the pass, logs the coverage sentence and carries the counts in the report', async () => {
    const corpus = corpusOf(12);
    const events: { kind: string; detail: string }[] = [];
    const store = memoryStore();

    const report = await runDocket({
      vault: fakeVault(corpus),
      queue: fakeQueue(),
      complete: (async () => '') as Complete,
      buildIndex: (snippets: Snippet[]): LexicalIndex => buildIndex(snippets),
      composeOpener: async (): Promise<QueueDraft | null> => null,
      log: (e) => void events.push({ kind: e.kind, detail: e.detail }),
      vaultRoot: '/tmp/elicit-coverage-docket',
      coverageEmbedding: () =>
        runCoverageEmbedding({
          corpus,
          embed: axes(allVectors(corpus)),
          model: 'test-model',
          store,
          log: (e) => void events.push({ kind: e.kind, detail: e.detail }),
        }),
    });

    expect(report.coverageEmbedding).toEqual({ covered: 12, total: 12, fresh: 12 });
    expect(events.some((e) => e.kind === 'embedding-coverage')).toBe(true);
    const line = events.find((e) => e.kind === 'embedding-coverage')!;
    expect(line.detail).toBe('noun=passage covered=12 total=12 fresh=12 unembedded=0');
  });
});

// ── The resonance staging verdict, with its evidence (§12, Q-17) ──────────

describe('the resonance staging verdict is logged with its evidence', () => {
  it('the activity line names which channel found the echoes', () => {
    // The ORDER is pinned in tests/semantic-resonance.test.ts (lexical first,
    // semantic fills to k, no network call when lexical filled k). This pins
    // the evidence half: when the semantic channel served, the line says so.
    const sentence = formatEvent({
      at: '',
      actor: 'elicitor',
      kind: 'resonance-checked',
      detail: 'session=ABC hits=3 lexical=1 semantic=2',
    });
    expect(sentence).toBe('looked for echoes of what was just said and found 3, 2 by meaning');
  });

  it('a lexical-only turn reads plainly, without the meaning clause', () => {
    const sentence = formatEvent({
      at: '',
      actor: 'elicitor',
      kind: 'resonance-checked',
      detail: 'session=ABC hits=2 lexical=2 semantic=0',
    });
    expect(sentence).toBe('looked for echoes of what was just said and found 2');
  });
});
