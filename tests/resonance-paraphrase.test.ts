import { describe, it, expect, beforeAll } from 'vitest';
import { buildIndex, resonate } from '../src/index/lexical.js';
import { buildSemanticIndex, resonateHybrid, type HybridHit } from '../src/index/semantic.js';
import type { Embed, EmbeddingIndexStore, EmbeddingRecord } from '../src/wiki/embedding.js';
import type { Snippet } from '../src/types.js';
import { PAIRS, DISTRACTORS, type ParaphrasePair } from './fixtures/paraphrase-pairs.js';
import { MODEL, RECORDED_VECTORS } from './fixtures/semantic-vectors.js';

/**
 * Standing paraphrase fixture — eval metric 14, "semantic-resonance recall".
 *
 * The data lives in `tests/fixtures/paraphrase-pairs.ts`, because
 * `tests/wiki-clash.test.ts` measures the same pairs through the clash channels
 * and two copies would drift apart. Every pair is a belief stated once in the
 * vault and restated later in fresh words, with NO verbatim run of three or
 * more words in common. That is how belief-drift actually shows up in speech:
 * `resonate()` is a
 * trigram exact-match index, so it finds none of them. The semantic channel
 * (053, wired by 068) ranks them — 7/8 by the recorded geometry — and the
 * hybrid entry point stands in the lexical silence, as Q-17 staged.
 *
 * The retrieval below runs through `resonateHybrid`, which is exactly the
 * entry point the live surfaces use. SEMANTIC_CHANNEL_LIVE records that the
 * channel is wired; RECALL_FLOOR is one pair below the measured 7/8, so a
 * real regression fails and third-decimal noise does not.
 *
 * The pairs are load-bearing. `no pair shares a trigram with any stored
 * snippet` guards them: if someone edits a pair into lexical overlap, recall
 * would climb without any semantic capability, and that test fails loudly
 * rather than letting a fake number stand.
 */

const SEMANTIC_CHANNEL_LIVE = true;

/** Recall the semantic channel must hold — one pair below the measured 7/8. */
const RECALL_FLOOR = 0.75;

function snip(id: string, prose: string): Snippet {
 return {
  id,
  version: 1,
  captured: '2026-03-14T09:00:00.000Z',
  provenance: {
   kind: 'harvest' as const,
   session: 'paraphrase-fixture',
   question: 'what did you notice about yourself this week?',
   questionForm: 'deliberative' as const,
  },
  prose,
 };
}

function words(text: string): string[] {
 return (text.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? []);
}

function trigrams(text: string): Set<string> {
 const w = words(text);
 const out = new Set<string>();
 for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
 return out;
}

function sharedTrigrams(a: string, b: string): string[] {
 const bs = trigrams(b);
 return [...trigrams(a)].filter(t => bs.has(t));
}

/** In-memory cache store — the file store is exercised through the app test. */
function memoryStore(seed: EmbeddingRecord[] = []): EmbeddingIndexStore {
 let rows = seed;
 return {
  load: () => rows,
  save(r: EmbeddingRecord[]) {
   rows = r;
  },
 };
}

/** The recorded geometry. Refuses an unknown text rather than inventing one. */
function recorded(): Embed {
 const embed = async (texts: string[]) =>
  texts.map((t) => {
   const v = RECORDED_VECTORS[t];
   if (!v) throw new Error(`no recorded vector for ${JSON.stringify(t)}`);
   return v;
  });
 return embed;
}

const VAULT: Snippet[] = [
 ...PAIRS.map((p, i) => snip(`pair-${i}`, p.stored)),
 ...DISTRACTORS.map((d, i) => snip(`distractor-${i}`, d)),
];

describe('paraphrase fixture integrity', () => {
 it('has at least six pairs', () => {
  expect(PAIRS.length).toBeGreaterThanOrEqual(6);
 });

 it('no restatement shares a trigram with any stored snippet', () => {
  const overlaps: string[] = [];
  for (const pair of PAIRS) {
   for (const stored of [...PAIRS.map(p => p.stored), ...DISTRACTORS]) {
    for (const t of sharedTrigrams(pair.restated, stored)) {
     overlaps.push(`${pair.label}: "${t}" also in "${stored}"`);
    }
   }
  }
  // A pair with lexical overlap would let the trigram index score a "hit"
  // that proves nothing about semantic recall. Keep this list empty.
  expect(overlaps).toEqual([]);
 });
});

describe('semantic-resonance recall (eval metric 14)', () => {
 const index = buildIndex(VAULT);
 let results: { pair: ParaphrasePair; targetId: string; hits: HybridHit[] }[] = [];

 // The channel, on the recorded geometry: 053 measured the real model on
 // exactly this corpus and committed the cosine matrix. Prime and query
 // embeds are scripted lookups, deterministic and offline, and the entry
 // point is the same `resonateHybrid` the live surfaces await.
 beforeAll(async () => {
  const semantic = buildSemanticIndex(VAULT, {
   embed: recorded(),
   model: MODEL,
   store: memoryStore(),
   log: () => { },
  });
  await semantic.prime();
  results = await Promise.all(
   PAIRS.map(async (pair, i) => ({
    pair,
    targetId: `pair-${i}`,
    hits: await resonateHybrid(index, semantic, pair.restated, 5),
   })),
  );
 });

 function measured(): { found: number; recall: number; lines: string } {
  const found = results.filter(r => r.hits.some(h => h.snippetId === r.targetId));
  const lines = results.map(
   r => `  ${r.hits.length > 0 ? 'HIT ' : 'miss'} ${r.pair.label}`,
  );
  return { found: found.length, recall: found.length / PAIRS.length, lines: lines.join('\n') };
 }

 it('reports recall', () => {
  const { found, recall, lines } = measured();
  console.log(
   `semantic-resonance recall: ${found}/${PAIRS.length} = ${recall.toFixed(2)}\n${lines}`,
  );
  expect(recall).toBeGreaterThanOrEqual(0);
 });

 if (SEMANTIC_CHANNEL_LIVE) {
  it('meets the recall floor', () => {
   expect(measured().recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
  });
 }
});

describe('control: the same index does find verbatim recurrence', () => {
 // Guards the negative results above from being vacuous. If this fails, the
 // fixture is finding nothing because the index is broken, not because the
 // restatements are lexically disjoint.
 it('hits when the belief is re-said in the original words', () => {
  const index = buildIndex(VAULT);
  const hits = resonate(
   index,
   'Honestly I still default to hedging in whichever direction is socially cheaper, even now',
   5,
  );
  expect(hits.length).toBeGreaterThanOrEqual(1);
  expect(hits[0]!.snippetId).toBe('pair-0');
  expect(hits[0]!.sharedPhrase.toLowerCase()).toContain('hedging');
 });
});
