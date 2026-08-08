import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildIndex, resonate } from '../src/index/lexical.js';
import {
  buildSemanticIndex,
  fileSnippetVectorStore,
  resonateHybrid,
  type SemanticHit,
  type SemanticDeps,
} from '../src/index/semantic.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import { bodyHash, type Embed, type EmbeddingIndexStore, type EmbeddingRecord } from '../src/wiki/embedding.js';
import type { ThresholdLogFn } from '../src/domain/thresholds.js';
import type { Snippet } from '../src/types.js';
import { PAIRS, DISTRACTORS } from './fixtures/paraphrase-pairs.js';
import { MODEL, RECORDED_VECTORS } from './fixtures/semantic-vectors.js';

/**
 * The semantic resonance channel (ticket 053).
 *
 * The headline number is measured, not asserted into existence: the fake
 * embedder in `recorded()` returns vectors whose pairwise cosines ARE what
 * `qwen3-embedding` returned for these nineteen texts on the local endpoint
 * (`scripts/eval-053-semantic-resonance.ts` recorded them; see
 * `tests/fixtures/semantic-vectors.ts` for how the geometry survives the
 * dimension reduction exactly). So the recall block below re-runs the real
 * measurement offline and deterministically, against the shipped code path.
 *
 * Everything else runs on hand-built vectors, because mechanism and measurement
 * should not be able to break each other.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────

function snip(id: string, prose: string): Snippet {
  return {
    id,
    version: 1,
    captured: '2026-03-14T09:00:00.000Z',
    provenance: {
      kind: 'harvest',
      session: 'paraphrase-fixture',
      question: 'what did you notice about yourself this week?',
      questionForm: 'deliberative',
    },
    prose,
  };
}

/** Exactly the corpus `tests/resonance-paraphrase.test.ts` builds, rebuilt here
 *  rather than imported, because that file is the standing baseline and is not
 *  this ticket's to edit. */
const VAULT: Snippet[] = [
  ...PAIRS.map((p, i) => snip(`pair-${i}`, p.stored)),
  ...DISTRACTORS.map((d, i) => snip(`distractor-${i}`, d)),
];

function memoryStore(seed: EmbeddingRecord[] = []): EmbeddingIndexStore & { saves: number } {
  let rows = seed;
  return {
    saves: 0,
    load: () => rows,
    save(r: EmbeddingRecord[]) {
      rows = r;
      this.saves++;
    },
  };
}

function collector(): { log: ThresholdLogFn; lines: { kind: string; detail: string }[] } {
  const lines: { kind: string; detail: string }[] = [];
  return { log: (e) => lines.push({ kind: e.kind, detail: e.detail }), lines };
}

/** The recorded geometry. Refuses an unknown text rather than inventing one. */
function recorded(): Embed & { calls: number } {
  const embed = async (texts: string[]) =>
    texts.map((t) => {
      const v = RECORDED_VECTORS[t];
      if (!v) throw new Error(`no recorded vector for ${JSON.stringify(t)}`);
      embed.calls++;
      return v;
    });
  embed.calls = 0;
  return embed;
}

/** Hand-built one-hot-ish vectors, for the mechanism tests. */
function axes(map: Record<string, number[]>): Embed & { calls: number; batches: number[] } {
  const embed = async (texts: string[]) => {
    embed.calls += texts.length;
    embed.batches.push(texts.length);
    return texts.map((t) => {
      const v = map[t];
      if (!v) throw new Error(`no vector for ${JSON.stringify(t)}`);
      return v;
    });
  };
  embed.calls = 0;
  embed.batches = [] as number[];
  return embed;
}

function deps(over: Partial<SemanticDeps> & Pick<SemanticDeps, 'embed'>): SemanticDeps {
  return {
    model: 'test-model',
    store: memoryStore(),
    log: () => {},
    ...over,
  };
}

// ── The measurement (the reason this ticket exists) ───────────────────────

describe('semantic-resonance recall, replayed from the live measurement', () => {
  it('the recorded geometry is the model that Q-17 chose', () => {
    expect(MODEL).toBe('qwen3-embedding');
    expect(Object.keys(RECORDED_VECTORS)).toHaveLength(PAIRS.length * 2 + DISTRACTORS.length);
  });

  /**
   * 7/8 by rank against the incumbent's 0/8, on the same corpus and the same
   * eight beliefs. Ticket 007 predicted exactly this gap: AUC 0.952, and the
   * true partner is the nearest neighbour for seven of eight pairs.
   */
  it('finds 7 of 8 restated beliefs — the trigram index finds 0', async () => {
    const embed = recorded();
    const index = buildSemanticIndex(VAULT, deps({ embed, model: MODEL }));
    await index.prime();
    expect(index.vectored()).toBe(VAULT.length);

    const lexical = buildIndex(VAULT);
    const semanticHits: string[] = [];
    let semanticFound = 0;
    let lexicalFound = 0;

    for (const [i, pair] of PAIRS.entries()) {
      const target = `pair-${i}`;
      const hits = await index.resonate(pair.restated, 5);
      if (hits.some((h) => h.snippetId === target)) semanticFound++;
      if (resonate(lexical, pair.restated, 5).some((h) => h.snippetId === target)) lexicalFound++;
      semanticHits.push(`${hits[0]?.snippetId ?? '—'} ${pair.label}`);
    }

    console.log(`semantic recall: ${semanticFound}/${PAIRS.length}\n  ${semanticHits.join('\n  ')}`);
    expect(lexicalFound).toBe(0);
    expect(semanticFound).toBe(7);
  });

  /**
   * The design decision, executable. Ranking recovers 7/8; the absolute cut
   * ticket 007 measured recovers 3/8 from the SAME vectors. If someone ever
   * swaps the instrument back, this is what goes red.
   */
  it('ranking beats the 0.70 cut on the same vectors, 7 against 3', async () => {
    const index = buildSemanticIndex(VAULT, deps({ embed: recorded(), model: MODEL }));
    await index.prime();

    let byRank = 0;
    let byCut = 0;
    for (const [i, pair] of PAIRS.entries()) {
      const target = `pair-${i}`;
      const hits = await index.resonate(pair.restated, VAULT.length);
      const hit = hits.find((h) => h.snippetId === target);
      if (hits.slice(0, 5).some((h) => h.snippetId === target)) byRank++;
      if (hit && hit.score >= 0.7) byCut++;
    }
    expect(byRank).toBe(7);
    expect(byCut).toBe(3);
  });

  /**
   * The one pair rank misses, and why it is the most interesting result in the
   * eval rather than a defect: the nearest neighbour of "I hedge toward what is
   * popular" is the sentence asserting the OPPOSITE, ahead of its own
   * paraphrase. Cosine retrieves aboutness (Q-52); polarity is invisible to it.
   *
   * This channel surfaces that on purpose. A juxtaposition against the pole a
   * person is now contradicting is the most informative question the system can
   * ask; suppressing it would mean throwing away the best thing in the vault on
   * the strength of a distinction cosine cannot make. What the channel must
   * never do is CLAIM agreement — see the next test.
   */
  it('surfaces the opposite pole ahead of the paraphrase, deliberately', async () => {
    const index = buildSemanticIndex(VAULT, deps({ embed: recorded(), model: MODEL }));
    await index.prime();

    const hits = await index.resonate(PAIRS[0]!.restated, VAULT.length);
    const opposite = hits.find((h) => h.snippetId === 'distractor-0');
    const paraphrase = hits.find((h) => h.snippetId === 'pair-0');

    expect(opposite?.rank).toBe(1);
    expect(paraphrase).toBeDefined();
    expect(opposite!.score).toBeGreaterThan(paraphrase!.score);
    // The opposed distractor IS the snippet whose belief the restatement
    // contradicts, quoted from the fixture so a reader can check it.
    expect(opposite!.snippetText).toContain('my hedges track my actual confidence');
  });
});

describe('a semantic hit cannot claim the person just said something', () => {
  /**
   * `ResonanceHit.sharedPhrase` is an exact substring of BOTH texts, and
   * `composeJuxtaposition` requires the composed question to contain it
   * verbatim — Q-12 enforced by code. A semantic hit shares no such substring,
   * so the field is absent rather than filled with the snippet's own words.
   * The absence is what stops a composer writing "you said <phrase> before"
   * about words the person did not say.
   */
  it('has no sharedPhrase field', async () => {
    const index = buildSemanticIndex(VAULT, deps({ embed: recorded(), model: MODEL }));
    await index.prime();
    const hit = (await index.resonate(PAIRS[1]!.restated, 1))[0]!;
    expect(hit).not.toHaveProperty('sharedPhrase');
    expect(Object.keys(hit).sort()).toEqual(['rank', 'score', 'snippetId', 'snippetText', 'version']);
  });

  it('is not accepted where a verbatim quote is required — at compile time', async () => {
    // Never executed. `tsc --noEmit` is the assertion: if `SemanticHit` ever
    // grows a `sharedPhrase`, this @ts-expect-error becomes unused and the
    // build fails, which is the point.
    async function wouldNotCompile(hit: SemanticHit): Promise<void> {
      const { composeJuxtaposition } = await import('../src/clerk/composed.js');
      // @ts-expect-error a SemanticHit has no sharedPhrase and never will
      await composeJuxtaposition('what they just said', hit, async () => '');
    }
    expect(typeof wouldNotCompile).toBe('function');
  });
});

// ── Ranking mechanics ─────────────────────────────────────────────────────

describe('ranking', () => {
  const CORPUS = [snip('a', 'alpha'), snip('b', 'beta'), snip('c', 'gamma')];
  // Every vector sits above the (now live) noise floor: ranking mechanics
  // are this block's subject, the floor has its own describe below.
  const VECTORS = {
    alpha: [1, 0],
    beta: [0.8, 0.6],
    gamma: [0.6, 0.8],
    query: [1, 0],
  };

  async function primed(over: Partial<SemanticDeps> = {}) {
    const index = buildSemanticIndex(CORPUS, deps({ embed: axes(VECTORS), ...over }));
    await index.prime();
    return index;
  }

  it('orders by cosine, highest first, with a contiguous 1-based rank', async () => {
    const hits = await (await primed()).resonate('query', 3);
    expect(hits.map((h) => h.snippetId)).toEqual(['a', 'b', 'c']);
    expect(hits.map((h) => h.rank)).toEqual([1, 2, 3]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('returns at most k', async () => {
    expect(await (await primed()).resonate('query', 2)).toHaveLength(2);
    expect(await (await primed()).resonate('query', 1)).toHaveLength(1);
  });

  it('returns nothing for a k of zero or less', async () => {
    expect(await (await primed()).resonate('query', 0)).toEqual([]);
    expect(await (await primed()).resonate('query', -1)).toEqual([]);
  });

  it('breaks a tie by snippet id, not by corpus order', async () => {
    const tied = [snip('z', 'same'), snip('a', 'same'), snip('m', 'same')];
    const index = buildSemanticIndex(
      tied,
      deps({ embed: axes({ same: [1, 0], query: [1, 0] }) }),
    );
    await index.prime();
    expect((await index.resonate('query', 3)).map((h) => h.snippetId)).toEqual(['a', 'm', 'z']);
  });

  /** A snippet id appearing twice must not be embedded twice or ranked twice. */
  it('holds one entry per snippet id, first occurrence wins', async () => {
    const embed = axes({ ...VECTORS, duplicate: [1, 0] });
    const index = buildSemanticIndex(
      [snip('a', 'alpha'), snip('a', 'duplicate'), snip('c', 'gamma')],
      deps({ embed }),
    );
    await index.prime();
    expect(embed.calls).toBe(2);
    expect(index.vectored()).toBe(2);
    const hits = await index.resonate('query', 5);
    expect(hits.map((h) => h.snippetId)).toEqual(['a', 'c']);
    expect(hits[0]!.snippetText).toBe('alpha');
  });

  it('carries the snippet version and prose the caller needs', async () => {
    const hit = (await (await primed()).resonate('query', 1))[0]!;
    expect(hit.version).toBe(1);
    expect(hit.snippetText).toBe('alpha');
  });

  it('is silent on an empty query, and does not spend a call finding that out', async () => {
    const embed = axes(VECTORS);
    const index = buildSemanticIndex(CORPUS, deps({ embed }));
    await index.prime();
    const after = embed.calls;
    expect(await index.resonate('', 5)).toEqual([]);
    expect(await index.resonate('   \n ', 5)).toEqual([]);
    expect(embed.calls).toBe(after);
  });

  it('is silent, and spends no network call, when nothing has a vector', async () => {
    const embed = axes(VECTORS);
    const index = buildSemanticIndex(CORPUS, deps({ embed }));
    expect(await index.resonate('query', 5)).toEqual([]);
    expect(embed.calls).toBe(0);
  });
});

// ── The cache: derived, rebuildable, never the source of truth (Q-3) ──────

describe('the vector cache is derived and rebuildable', () => {
  const CORPUS = [snip('a', 'alpha'), snip('b', 'beta')];
  const VECTORS = { alpha: [1, 0], beta: [0, 1], query: [1, 0], changed: [0.5, 0.5] };

  function tmp(): string {
    return mkdtempSync(join(tmpdir(), 'elicit-053-'));
  }

  it('round-trips through vault/index/snippet-embeddings.jsonl', async () => {
    const root = tmp();
    try {
      const embed = axes(VECTORS);
      await buildSemanticIndex(CORPUS, deps({ embed, store: fileSnippetVectorStore(root) })).prime();
      expect(embed.calls).toBe(2);

      const path = join(root, 'index', 'snippet-embeddings.jsonl');
      const lines = readFileSync(path, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!)).toMatchObject({ claimId: 'a', model: 'test-model', vector: [1, 0] });

      // A second index over the same file spends nothing.
      const again = axes(VECTORS);
      const second = buildSemanticIndex(CORPUS, deps({ embed: again, store: fileSnippetVectorStore(root) }));
      await second.prime();
      expect(again.calls).toBe(0);
      expect(second.vectored()).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats a missing file as cold, not as an error', () => {
    const root = tmp();
    try {
      expect(fileSnippetVectorStore(root).load()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('survives a torn line, a wrong shape, and a vector of strings', () => {
    const root = tmp();
    try {
      mkdirSync(join(root, 'index'), { recursive: true });
      writeFileSync(
        join(root, 'index', 'snippet-embeddings.jsonl'),
        [
          '{"claimId":"good","hash":"h","model":"m","vector":[1,0]}',
          '{"claimId":"torn","hash":"h","model":"m","vec',
          '{"claimId":"","hash":"h","model":"m","vector":[1,0]}',
          '{"claimId":"strings","hash":"h","model":"m","vector":["1","0"]}',
          '{"claimId":"empty","hash":"h","model":"m","vector":[]}',
          '{"claimId":"nan","hash":"h","model":"m","vector":[1,null]}',
          'not json at all',
          '',
        ].join('\n'),
        'utf-8',
      );
      expect(fileSnippetVectorStore(root).load()).toEqual([
        { claimId: 'good', hash: 'h', model: 'm', vector: [1, 0] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a corrupt cache rebuilds rather than crashing a sitting', async () => {
    const root = tmp();
    try {
      mkdirSync(join(root, 'index'), { recursive: true });
      writeFileSync(join(root, 'index', 'snippet-embeddings.jsonl'), 'garbage\n{{{\n', 'utf-8');
      const embed = axes(VECTORS);
      const index = buildSemanticIndex(CORPUS, deps({ embed, store: fileSnippetVectorStore(root) }));
      await index.prime();
      expect(index.vectored()).toBe(2);
      expect((await index.resonate('query', 1))[0]!.snippetId).toBe('a');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('re-embeds a snippet whose prose changed', async () => {
    const store = memoryStore([
      { claimId: 'a', hash: bodyHash('something else'), model: 'test-model', vector: [1, 0] },
      { claimId: 'b', hash: bodyHash('beta'), model: 'test-model', vector: [0, 1] },
    ]);
    const embed = axes(VECTORS);
    await buildSemanticIndex(CORPUS, deps({ embed, store })).prime();
    expect(embed.calls).toBe(1);
    expect(embed.batches).toEqual([1]);
  });

  it('re-embeds a vector left behind by another model — two spaces never mix', async () => {
    const store = memoryStore([
      { claimId: 'a', hash: bodyHash('alpha'), model: 'nomic-embed-text', vector: [1, 0, 0] },
      { claimId: 'b', hash: bodyHash('beta'), model: 'test-model', vector: [0, 1] },
    ]);
    const embed = axes(VECTORS);
    await buildSemanticIndex(CORPUS, deps({ embed, store })).prime();
    expect(embed.calls).toBe(1);
  });

  it('prunes a snippet the corpus no longer holds', async () => {
    const store = memoryStore([
      { claimId: 'gone', hash: 'h', model: 'test-model', vector: [1, 0] },
      { claimId: 'a', hash: bodyHash('alpha'), model: 'test-model', vector: [1, 0] },
    ]);
    await buildSemanticIndex(CORPUS, deps({ embed: axes(VECTORS), store })).prime();
    expect(store.load().map((r) => r.claimId)).toEqual(['a', 'b']);
  });

  it('persists after every batch, so a stopped run keeps its work', async () => {
    const many = Array.from({ length: 40 }, (_, i) => snip(`s${String(i).padStart(2, '0')}`, `t${i}`));
    const map = Object.fromEntries(many.map((s, i) => [s.prose, [i, 1]]));
    const store = memoryStore();
    const embed = axes(map);
    await buildSemanticIndex(many, deps({ embed, store })).prime();
    expect(embed.batches).toEqual([16, 16, 8]);
    expect(store.saves).toBe(3);
  });
});

// ── The endpoint is not there (the cold-start trap ticket 007 measured) ───

describe('an unreachable endpoint is quiet, never fatal', () => {
  const CORPUS = [snip('a', 'alpha'), snip('b', 'beta')];

  it('prime resolves and logs rather than rejecting', async () => {
    const { log, lines } = collector();
    const index = buildSemanticIndex(
      CORPUS,
      deps({ embed: async () => { throw new Error('fetch failed'); }, log }),
    );
    await expect(index.prime()).resolves.toBeUndefined();
    expect(index.vectored()).toBe(0);
    const record = lines.find((l) => l.kind === 'embedding-unavailable');
    expect(record?.detail).toContain('error=fetch failed');
    expect(record?.detail).toContain('pending=2');
  });

  it('prime keeps the batches that already succeeded', async () => {
    const many = Array.from({ length: 20 }, (_, i) => snip(`s${String(i).padStart(2, '0')}`, `t${i}`));
    let batch = 0;
    const index = buildSemanticIndex(
      many,
      deps({
        embed: async (texts) => {
          if (batch++ > 0) throw new Error('embeddings 500 after 370s');
          return texts.map((_, i) => [i, 1]);
        },
      }),
    );
    await index.prime();
    expect(index.vectored()).toBe(16);
  });

  it('refuses a short list rather than filing one vector under another id', async () => {
    const { log, lines } = collector();
    const index = buildSemanticIndex(
      CORPUS,
      deps({ embed: async () => [[1, 0]], log }),
    );
    await index.prime();
    expect(index.vectored()).toBe(0);
    expect(lines.find((l) => l.kind === 'embedding-unavailable')?.detail).toContain(
      'expected 2 vectors, received 1',
    );
  });

  it('refuses a vector that is empty or not finite', async () => {
    for (const bad of [[[], [0, 1]], [[Number.NaN, 1], [0, 1]]] as number[][][]) {
      const { log, lines } = collector();
      const index = buildSemanticIndex(CORPUS, deps({ embed: async () => bad, log }));
      await index.prime();
      expect(index.vectored()).toBe(0);
      expect(lines.some((l) => l.kind === 'embedding-unavailable')).toBe(true);
    }
  });

  it('resonate returns nothing when the query cannot be embedded', async () => {
    const { log, lines } = collector();
    const store = memoryStore([
      { claimId: 'a', hash: bodyHash('alpha'), model: 'test-model', vector: [1, 0] },
    ]);
    // The cache already holds a vector for 'a', so the only call this makes is
    // the query's own — and it is the one that fails.
    const index = buildSemanticIndex(
      CORPUS,
      deps({
        embed: async () => {
          throw new Error('connection refused');
        },
        store,
        log,
      }),
    );
    expect(await index.resonate('query', 5)).toEqual([]);
    expect(lines.find((l) => l.kind === 'embedding-unavailable')?.detail).toContain(
      'connection refused',
    );
  });

  /**
   * The query path needs its OWN validity check, not prime's: a fabricated or
   * malformed query vector would rank the whole vault against noise and return
   * five confident, meaningless hits. Silence is the only honest answer.
   */
  it('refuses a query vector that is malformed, and ranks nothing on it', async () => {
    const store = () =>
      memoryStore([{ claimId: 'a', hash: bodyHash('alpha'), model: 'test-model', vector: [1, 0] }]);
    const malformed: [string, number[][]][] = [
      ['not finite', [[Number.NaN, 1]]],
      ['empty', [[]]],
      ['too many', [[1, 0], [0, 1]]],
      ['none at all', []],
    ];
    for (const [why, vectors] of malformed) {
      const { log, lines } = collector();
      const index = buildSemanticIndex(CORPUS, deps({ embed: async () => vectors, store: store(), log }));
      expect(await index.resonate('query', 5), why).toEqual([]);
      expect(lines.some((l) => l.kind === 'embedding-unavailable'), why).toBe(true);
    }
  });

  it('gives up on a hanging query inside the budget, and says so', async () => {
    const { log, lines } = collector();
    const store = memoryStore([
      { claimId: 'a', hash: bodyHash('alpha'), model: 'test-model', vector: [1, 0] },
    ]);
    const index = buildSemanticIndex(
      CORPUS,
      // A cold model: 370 seconds and then an HTTP 500. Nobody waits.
      deps({ embed: () => new Promise(() => {}), store, log, queryBudgetMs: 20 }),
    );
    const started = Date.now();
    expect(await index.resonate('query', 5)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1500);
    const clip = lines.find((l) => l.kind === 'threshold-clipped');
    expect(clip?.detail).toContain('threshold=resonance.queryBudgetMs');
    expect(clip?.detail).toContain('mode=live');
  });
});

// ── Bounds ship live and owe a record (Q-56) ─────────────────────────────

describe('the bounds act, and leave the record that would resize them', () => {
  const many = Array.from({ length: 40 }, (_, i) => snip(`s${String(i).padStart(2, '0')}`, `t${i}`));
  const map = Object.fromEntries(many.map((s, i) => [s.prose, [i, 1]]));

  it('all four bounds and the floor are declared live (floor graduated 2026-08-03)', () => {
    expect(THRESHOLDS['resonance.primeCap'].live).toBe(true);
    expect(THRESHOLDS['resonance.primeBudgetMs'].live).toBe(true);
    expect(THRESHOLDS['resonance.queryBudgetMs'].live).toBe(true);
    expect(THRESHOLDS['resonance.semanticFloor'].live).toBe(true);
    expect(THRESHOLDS['resonance.semanticFloor'].value).toBe(0.5);
  });

  it('clips the prime run at the cap and logs how many wait', async () => {
    const { log, lines } = collector();
    const index = buildSemanticIndex(many, deps({ embed: axes(map), log, primeCap: 20 }));
    await index.prime();
    expect(index.vectored()).toBe(20);
    const clip = lines.find((l) => l.kind === 'threshold-clipped');
    expect(clip?.detail).toContain('threshold=resonance.primeCap');
    expect(clip?.detail).toContain('20 wait for the next');
  });

  /**
   * WHICH twenty is as load-bearing as how many. A clipped run must take the
   * same prefix every time, or two runs interleave and the corpus is never
   * finished — the resumability the cap depends on rests on this order.
   */
  it('a clipped run always takes the same prefix, in id order', async () => {
    // Rotated, not reversed: a rotation is neither the id order nor its
    // mirror, so neither leaving the sort out nor flipping it can pass.
    const scrambled = [...many.slice(20), ...many.slice(0, 20)];
    const store = memoryStore();
    await buildSemanticIndex(scrambled, deps({ embed: axes(map), store, primeCap: 5 })).prime();
    expect(store.load().map((r) => r.claimId)).toEqual(['s00', 's01', 's02', 's03', 's04']);
  });

  /** The cap is per RUN, never a recency window: the corpus is 2017-2026 and a
   *  window would make old material structurally unreachable (Q-18). */
  it('resumes: the next run embeds what the last one left', async () => {
    const store = memoryStore();
    const first = buildSemanticIndex(many, deps({ embed: axes(map), store, primeCap: 20 }));
    await first.prime();
    const second = buildSemanticIndex(many, deps({ embed: axes(map), store, primeCap: 20 }));
    await second.prime();
    expect(second.vectored()).toBe(40);
  });

  it('stops at the time budget and says what is still waiting', async () => {
    const { log, lines } = collector();
    let t = 0;
    const index = buildSemanticIndex(
      many,
      deps({ embed: axes(map), log, primeBudgetMs: 100, now: () => (t += 60) }),
    );
    await index.prime();
    expect(index.vectored()).toBe(16);
    const clip = lines.find(
      (l) => l.kind === 'threshold-clipped' && l.detail.includes('resonance.primeBudgetMs'),
    );
    expect(clip?.detail).toContain('16 done, 24 still waiting');
  });
});

// ── The floor is shadow-first (Q-35) ─────────────────────────────────────

describe('the noise floor acts (graduated 2026-08-03), and demotes cleanly', () => {
  const CORPUS = [snip('near', 'near'), snip('far', 'far')];
  const VECTORS = { near: [1, 0], far: [0, 1], query: [0.99, 0.14] };

  async function primed(over: Partial<SemanticDeps> = {}) {
    const index = buildSemanticIndex(CORPUS, deps({ embed: axes(VECTORS), ...over }));
    await index.prime();
    return index;
  }

  it('keeps a below-floor hit when demoted to shadow, and writes what it would have dropped', async () => {
    const { log, lines } = collector();
    const index = await primed({ log, floor: { ...THRESHOLDS['resonance.semanticFloor'], live: false } });
    const hits = await index.resonate('query', 5);
    expect(hits.map((h) => h.snippetId)).toEqual(['near', 'far']);
    const shadow = lines.find((l) => l.kind === 'shadow-decision');
    expect(shadow?.detail).toContain('threshold=resonance.semanticFloor');
    expect(shadow?.detail).toContain('mode=shadow');
    expect(shadow?.detail).toContain('drop 1 of 2 ranked hits');
  });

  it('drops a below-floor hit by default, and re-ranks what is left', async () => {
    const { log, lines } = collector();
    const hits = await (await primed({ log })).resonate('query', 5);
    expect(hits.map((h) => h.snippetId)).toEqual(['near']);
    expect(hits[0]!.rank).toBe(1);
    expect(lines.some((l) => l.kind === 'shadow-decision')).toBe(false);
  });

  it('says nothing when every hit clears the floor', async () => {
    const { log, lines } = collector();
    const index = buildSemanticIndex(
      [snip('near', 'near')],
      deps({ embed: axes(VECTORS), log }),
    );
    await index.prime();
    expect(await index.resonate('query', 5)).toHaveLength(1);
    expect(lines.filter((l) => l.kind === 'shadow-decision')).toEqual([]);
  });

  it('a misconfigured boolean floor drops nothing rather than everything', async () => {
    const index = await primed({ floor: { ...THRESHOLDS['resonance.semanticFloor'], value: true, live: true } });
    expect(await index.resonate('query', 5)).toHaveLength(2);
  });
});

// ── The hybrid entry point (Q-17, both stages) ───────────────────────────

describe('resonateHybrid', () => {
  const ECHO = 'the cat sat on the mat and considered its options';
  const CORPUS = [snip('echo', ECHO), snip('other', 'gamma')];
  const VECTORS = { [ECHO]: [1, 0], gamma: [0.9, 0.44], [`${ECHO} yesterday`]: [1, 0] };

  async function semantic(log: ThresholdLogFn = () => {}) {
    const index = buildSemanticIndex(CORPUS, deps({ embed: axes(VECTORS), log }));
    await index.prime();
    return index;
  }

  it('degrades to the trigram index when there is no semantic channel', async () => {
    const lexical = buildIndex(CORPUS);
    const hybrid = await resonateHybrid(lexical, undefined, `${ECHO} yesterday`, 5);
    const plain = resonate(lexical, `${ECHO} yesterday`, 5);
    expect(hybrid.map((h) => h.snippetId)).toEqual(plain.map((h) => h.snippetId));
    expect(hybrid.every((h) => h.channel === 'lexical')).toBe(true);
  });

  it('puts the quotable channel first, then fills with the ranked one', async () => {
    const hits = await resonateHybrid(buildIndex(CORPUS), await semantic(), `${ECHO} yesterday`, 5);
    expect(hits[0]!.channel).toBe('lexical');
    expect(hits[0]!.snippetId).toBe('echo');
    expect(hits.map((h) => h.snippetId)).toContain('other');
    expect(hits.find((h) => h.snippetId === 'other')!.channel).toBe('semantic');
  });

  it('never returns one snippet twice, whichever channel found it', async () => {
    const hits = await resonateHybrid(buildIndex(CORPUS), await semantic(), `${ECHO} yesterday`, 5);
    expect(new Set(hits.map((h) => h.snippetId)).size).toBe(hits.length);
  });

  it('honours k across both channels', async () => {
    const hits = await resonateHybrid(buildIndex(CORPUS), await semantic(), `${ECHO} yesterday`, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.channel).toBe('lexical');
  });

  it('spends no network call when lexical already filled k', async () => {
    const embed = axes(VECTORS);
    const index = buildSemanticIndex(CORPUS, deps({ embed }));
    await index.prime();
    const before = embed.calls;
    await resonateHybrid(buildIndex(CORPUS), index, `${ECHO} yesterday`, 1);
    expect(embed.calls).toBe(before);
  });

  /** The tag is the seam: only the lexical arm carries a quotable phrase. */
  it('tags each hit with the channel that found it', async () => {
    const hits = await resonateHybrid(buildIndex(CORPUS), await semantic(), `${ECHO} yesterday`, 5);
    for (const hit of hits) {
      if (hit.channel === 'lexical') expect(typeof hit.sharedPhrase).toBe('string');
      else expect(hit.rank).toBeGreaterThan(0);
    }
  });
});
