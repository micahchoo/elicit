import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
 clusterPassages,
 neighborhoodSource,
 readNeighborhoods,
 runNeighborhoodsJob,
 writeNeighborhoods,
 type NeighborhoodPassage,
 type NeighborhoodStore,
} from '../src/wiki/neighborhoods.js';
import { bodyHash } from '../src/wiki/embedding.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { LogFn } from '../src/wiki/contract.js';

/**
 * Neighborhoods — §12.3, Batch C1. The tests pin the five acceptance
 * contracts: determinism (same corpus → same groups and names in the same
 * order, whatever the input order), the lexical fallback with no embedding
 * channel, embedding grouping when vectors cover the corpus, names drawn
 * from the passages' own terms, and the store round-trip. The job tests pin
 * the coverage sentence: clustered/skipped counts ride in the activity-log
 * detail, and a clipped or starved pass is never silent.
 */

const ROOTS: string[] = [];

function tempRoot(): string {
 const root = mkdtempSync(join(tmpdir(), 'elicit-neighborhoods-'));
 ROOTS.push(root);
 return root;
}

afterEach(() => {
 while (ROOTS.length > 0) rmSync(ROOTS.pop()!, { recursive: true, force: true });
});

function passage(id: string, prose: string, captured = '2026-08-09T10:00:00.000Z'): NeighborhoodPassage {
 return { id, prose, captured };
}

function recorder(): { events: { kind: string; detail: string }[]; log: LogFn } {
 const events: { kind: string; detail: string }[] = [];
 return {
  events,
  log: (e) => {
   events.push({ kind: e.kind, detail: e.detail });
  },
 };
}

/** The lexical corpus: two themes whose vocabularies do not overlap. */
const LEXICAL = [
 passage('a', 'sourdough baking is my favorite weekend hobby'),
 passage('b', 'sourdough baking fills my kitchen with smell'),
 passage('c', 'red truck engine needs new tires'),
 passage('d', 'red truck tires wear out fast'),
];

/** The same corpus with vectors: two orthogonal themes, full coverage. */
const EMBEDDING = [
 passage('a', 'sourdough starter smells like a bakery'),
 passage('b', 'my sourdough starter rose overnight'),
 passage('c', 'mother gardens roses every morning'),
 passage('d', 'mother gardens tomatoes too'),
];

const EMBEDDING_VECTORS = new Map<string, number[]>([
 ['a', [1, 0, 0]],
 ['b', [0.95, 0.312, 0]],
 ['c', [0, 1, 0]],
 ['d', [0, 0.95, 0.312]],
]);

// ── clusterPassages ──

describe('clusterPassages — determinism', () => {
 it('groups the same corpus identically whatever order it arrives in', () => {
  const forward = clusterPassages(LEXICAL);
  const backward = clusterPassages([...LEXICAL].reverse());
  const shuffled = clusterPassages([LEXICAL[2]!, LEXICAL[0]!, LEXICAL[3]!, LEXICAL[1]!]);
  expect(backward).toEqual(forward);
  expect(shuffled).toEqual(forward);
 });

 it('keeps cluster order stable: first member id order, groups in creation order', () => {
  const clusters = clusterPassages(LEXICAL);
  expect(clusters.map((c) => c.passageIds)).toEqual([['a', 'b'], ['c', 'd']]);
 });

 it('every passage lands in exactly one neighborhood — singletons included', () => {
  const clusters = clusterPassages([
   passage('x', 'sourdough baking every weekend'),
   passage('y', 'the red truck needs tires'),
  ]);
  const ids = clusters.flatMap((c) => c.passageIds);
  expect(ids.sort()).toEqual(['x', 'y']);
 });
});

describe('clusterPassages — the lexical fallback', () => {
 it('groups passages by content-word overlap when no embedding channel exists', () => {
  const clusters = clusterPassages(LEXICAL);
  expect(clusters.map((c) => c.passageIds)).toEqual([['a', 'b'], ['c', 'd']]);
 });

 it('falls back to lexical when vectors exist but coverage is below the floor', () => {
  const sparse = new Map<string, number[]>([['a', [1, 0, 0]]]); // 1 of 4
  expect(neighborhoodSource(LEXICAL, sparse)).toBe('lexical');
  // Grouping is the lexical one, not the embedding one: b stays with a
  // (word overlap) even though its vector is absent.
  const clusters = clusterPassages(LEXICAL, { vectors: sparse });
  expect(clusters.map((c) => c.passageIds)).toEqual([['a', 'b'], ['c', 'd']]);
 });

 it('a passage that fits no theme starts one of its own (no argmax)', () => {
  const clusters = clusterPassages([
   passage('a', 'sourdough baking every weekend'),
   passage('b', 'the red truck needs new tires'),
  ]);
  expect(clusters).toHaveLength(2);
 });

 it('handles a passage with no content words: it never joins, it stands alone', () => {
  const clusters = clusterPassages([
   passage('a', 'sourdough baking every weekend'),
   passage('b', 'things in the way of things'),
  ]);
  expect(clusters.map((c) => c.passageIds)).toEqual([['a'], ['b']]);
 });
});

describe('clusterPassages — the embedding channel', () => {
 it('groups by cosine similarity when vector coverage clears the floor', () => {
  expect(neighborhoodSource(EMBEDDING, EMBEDDING_VECTORS)).toBe('embedding');
  const clusters = clusterPassages(EMBEDDING, { vectors: EMBEDDING_VECTORS });
  expect(clusters.map((c) => c.passageIds)).toEqual([['a', 'b'], ['c', 'd']]);
 });

 it('is deterministic under the embedding channel too', () => {
  const forward = clusterPassages(EMBEDDING, { vectors: EMBEDDING_VECTORS });
  const backward = clusterPassages([...EMBEDDING].reverse(), { vectors: EMBEDDING_VECTORS });
  expect(backward).toEqual(forward);
 });
});

describe('clusterPassages — names come from the passages own terms', () => {
 it('names a theme by its most frequent content word, capitalized', () => {
  const clusters = clusterPassages(LEXICAL);
  const names = clusters.map((c) => c.name);
  // 'sourdough' (×2) beats 'baking' (×2) on length; 'tires' and 'truck'
  // both appear 2× and tie on length, so the alphabetical tie-break decides.
  expect(names).toEqual(['Sourdough', 'Tires']);
 });

 it('excludes generic name words — a modifier is never the topic', () => {
  const clusters = clusterPassages([
   passage('a', 'things about things', '2026-08-09T10:00:00.000Z'),
   passage('b', 'things about things', '2026-08-10T10:00:00.000Z'),
  ]);
  // 'things' is a generic name word; the theme still clusters (the passages
  // share it), but the name falls back to a fact about the passage — the
  // date its earliest passage was said — rather than a filler word.
  expect(clusters).toHaveLength(1);
  expect(clusters[0]!.name).toBe('2026-08-09');
 });

 it('never fabricates a word the passages did not say', () => {
  const clusters = clusterPassages([
   passage('a', 'sourdough baking every weekend'),
   passage('b', 'sourdough baking on sundays'),
  ]);
  const spoken = new Set('a sourdough baking every weekend b sourdough baking on sundays'.split(' '));
  for (const c of clusters) {
   expect(spoken.has(c.name.toLowerCase())).toBe(true);
  }
 });
});

// ── The store ──

describe('the neighborhoods store round-trips', () => {
 it('write → read returns the same store', () => {
  const root = tempRoot();
  const store: NeighborhoodStore = {
   rebuiltAt: '2026-08-09T10:00:00.000Z',
   source: 'embedding',
   coverage: { total: 4, clustered: 4, skipped: 0 },
   clusters: [{ name: 'Sourdough', passageIds: ['a', 'b'] }],
  };
  writeNeighborhoods(root, store);
  expect(readNeighborhoods(root)).toEqual(store);
 });

 it('missing file reads as null, never throws', () => {
  const root = tempRoot();
  expect(readNeighborhoods(root)).toBeNull();
 });

 it('malformed JSON reads as null, never throws', () => {
  const root = tempRoot();
  writeNeighborhoods(root, {
   rebuiltAt: '2026-08-09T10:00:00.000Z',
   source: 'lexical',
   coverage: { total: 0, clustered: 0, skipped: 0 },
   clusters: [],
  });
  const path = join(root, 'wiki', 'neighborhoods.json');
  // Clobber with garbage — a half-written file.
  writeFileSync(path, '{ not json', 'utf8');
  expect(readNeighborhoods(root)).toBeNull();
 });

 it('a store without the coverage field still reads — the agreed shape is {rebuiltAt, source, clusters}', () => {
  const root = tempRoot();
  const store = {
   rebuiltAt: '2026-01-03T00:00:00.000Z',
   source: 'lexical' as const,
   clusters: [{ name: 'the kitchen window', passageIds: ['a', 'b'] }],
  };
  mkdirSync(join(root, 'wiki'), { recursive: true });
  writeFileSync(join(root, 'wiki', 'neighborhoods.json'), JSON.stringify(store), 'utf8');
  expect(readNeighborhoods(root)).toEqual(store);
 });

 it('wrong shape reads as null — a well-formed JSON object of the wrong kind', () => {
  const root = tempRoot();
  writeNeighborhoods(root, {
   rebuiltAt: '2026-08-09T10:00:00.000Z',
   source: 'lexical',
   coverage: { total: 0, clustered: 0, skipped: 0 },
   clusters: [],
  });
  // Replace with a well-formed JSON object of the wrong shape.
  writeFileSync(join(root, 'wiki', 'neighborhoods.json'), JSON.stringify({ clusters: 'nope' }), 'utf8');
  expect(readNeighborhoods(root)).toBeNull();
 });
});

// ── The docket job ──

describe('runNeighborhoodsJob', () => {
 it('writes the store and logs the coverage sentence — lexical when no model', async () => {
  const root = tempRoot();
  const { events, log } = recorder();
  const report = await runNeighborhoodsJob({
   vaultRoot: root,
   log,
   snippets: LEXICAL,
  });
  expect(report).toEqual({ source: 'lexical', clustered: 4, skipped: 0, neighborhoods: 2 });
  const store = readNeighborhoods(root);
  expect(store?.source).toBe('lexical');
  expect(store?.coverage).toEqual({ total: 4, clustered: 4, skipped: 0 });
  expect(store?.clusters.map((c) => c.passageIds)).toEqual([['a', 'b'], ['c', 'd']]);
  expect(events).toContainEqual({
   kind: 'neighborhoods-built',
   detail: 'source=lexical clustered=4 skipped=0 neighborhoods=2',
  });
 });

 it('clusters by embedding when the model is present and the store covers the corpus', async () => {
  const root = tempRoot();
  const { log } = recorder();
  const records = EMBEDDING.map((p) => ({
   claimId: p.id,
   hash: bodyHash(p.prose),
   model: 'test-model',
   vector: EMBEDDING_VECTORS.get(p.id)!,
  }));
  const report = await runNeighborhoodsJob({
   vaultRoot: root,
   log,
   snippets: EMBEDDING,
   model: 'test-model',
   loadVectors: () => records,
   now: () => '2026-08-09T10:00:00.000Z',
  });
  expect(report).toEqual({ source: 'embedding', clustered: 4, skipped: 0, neighborhoods: 2 });
  const store = readNeighborhoods(root);
  expect(store?.source).toBe('embedding');
  expect(store?.rebuiltAt).toBe('2026-08-09T10:00:00.000Z');
  expect(store?.clusters.map((c) => c.passageIds)).toEqual([['a', 'b'], ['c', 'd']]);
 });

 it('a starved store falls back to lexical and the coverage is in the sentence', async () => {
  const root = tempRoot();
  const { events, log } = recorder();
  const records = [{ claimId: 'a', hash: bodyHash(LEXICAL[0]!.prose), model: 'test-model', vector: [1, 0, 0] }];
  await runNeighborhoodsJob({
   vaultRoot: root,
   log,
   snippets: LEXICAL,
   model: 'test-model',
   loadVectors: () => records,
  });
  expect(readNeighborhoods(root)?.source).toBe('lexical');
  expect(events).toContainEqual({
   kind: 'neighborhoods-built',
   detail: 'source=lexical coverage=1/4 clustered=4 skipped=0 neighborhoods=2',
  });
 });

 it('a stale vector (body changed) is not used — hash guard holds', async () => {
  const root = tempRoot();
  const { log } = recorder();
  const stale = [{ claimId: 'a', hash: bodyHash('something else entirely'), model: 'test-model', vector: [1, 0, 0] }];
  const report = await runNeighborhoodsJob({
   vaultRoot: root,
   log,
   snippets: LEXICAL,
   model: 'test-model',
   loadVectors: () => stale,
  });
  expect(report.source).toBe('lexical');
 });

 it('the cap clips the corpus and the clip is a sentence, never a silence', async () => {
  const root = tempRoot();
  const { events, log } = recorder();
  const report = await runNeighborhoodsJob({
   vaultRoot: root,
   log,
   snippets: LEXICAL,
   thresholds: {
    ...THRESHOLDS,
    'neighborhoods.passageCap': { name: 'neighborhoods.passageCap', value: 2, live: true, graduatesWhen: 'test' },
   },
  });
  expect(report).toEqual({ source: 'lexical', clustered: 2, skipped: 2, neighborhoods: 1 });
  expect(readNeighborhoods(root)?.coverage).toEqual({ total: 2, clustered: 2, skipped: 2 });
  expect(events).toContainEqual({
   kind: 'neighborhoods-built',
   detail: 'source=lexical clustered=2 skipped=2 neighborhoods=1',
  });
  // The bound's own clip record: Q-56 says a clip emits, and it did.
  expect(events.map((e) => e.kind)).toContain('threshold-clipped');
 });

 it('an empty corpus writes an honest empty store — found nothing, not never looked', async () => {
  const root = tempRoot();
  const { events, log } = recorder();
  const report = await runNeighborhoodsJob({ vaultRoot: root, log, snippets: [] });
  expect(report).toEqual({ source: 'lexical', clustered: 0, skipped: 0, neighborhoods: 0 });
  expect(readNeighborhoods(root)).toEqual({
   rebuiltAt: expect.any(String),
   source: 'lexical',
   coverage: { total: 0, clustered: 0, skipped: 0 },
   clusters: [],
  });
  expect(events).toContainEqual({
   kind: 'neighborhoods-built',
   detail: 'source=lexical clustered=0 skipped=0 neighborhoods=0',
  });
 });

 it('reads the store file the job wrote, from disk', async () => {
  const root = tempRoot();
  const { log } = recorder();
  await runNeighborhoodsJob({ vaultRoot: root, log, snippets: LEXICAL });
  const raw = JSON.parse(readFileSync(join(root, 'wiki', 'neighborhoods.json'), 'utf8'));
  expect(raw.source).toBe('lexical');
  expect(raw.clusters).toHaveLength(2);
 });
});
