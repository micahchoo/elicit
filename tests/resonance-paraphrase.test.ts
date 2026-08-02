import { describe, it, expect } from 'vitest';
import { buildIndex, resonate } from '../src/index/lexical.js';
import type { Snippet } from '../src/types.js';
import { PAIRS, DISTRACTORS } from './fixtures/paraphrase-pairs.js';

/**
 * Standing paraphrase fixture — eval metric 14, "semantic-resonance recall".
 *
 * The data lives in `tests/fixtures/paraphrase-pairs.ts`, because
 * `tests/wiki-clash.test.ts` measures the same pairs through the clash channels
 * and two copies would drift apart. Every pair is a belief stated once in the
 * vault and restated later in fresh words, with NO verbatim run of three or
 * more words in common. That is how belief-drift actually shows up in speech:
 * people re-say themselves, they do not quote themselves. `resonate()` is a
 * trigram exact-match index, so it finds none of them. This file asserts that —
 * deliberately, as the honest baseline — and turns into the recall metric the
 * moment a semantic channel lands (Q-17: local embeddings, staged with the
 * Clerk slice).
 *
 * WHEN THE EMBEDDING CHANNEL SHIPS: flip SEMANTIC_CHANNEL_LIVE to true, set
 * RECALL_FLOOR to the recall the channel is expected to hold, and route the
 * retrieval below through the hybrid entry point. Nothing else here changes —
 * the pairs are the metric.
 *
 * The pairs are load-bearing. `no pair shares a trigram with any stored
 * snippet` guards them: if someone edits a pair into lexical overlap, recall
 * would climb without any semantic capability, and that test fails loudly
 * rather than letting a fake number stand.
 */

const SEMANTIC_CHANNEL_LIVE = false;

/** Recall the semantic channel must hold once it is live. Unused until then. */
const RECALL_FLOOR = 0.5;

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

  const results = PAIRS.map((pair, i) => ({
    pair,
    targetId: `pair-${i}`,
    hits: resonate(index, pair.restated, 5),
  }));

  const found = results.filter(r => r.hits.some(h => h.snippetId === r.targetId));
  const recall = found.length / PAIRS.length;

  it('reports recall', () => {
    const lines = results.map(
      r => `  ${r.hits.length > 0 ? 'HIT ' : 'miss'} ${r.pair.label}`,
    );
    console.log(
      `semantic-resonance recall: ${found.length}/${PAIRS.length} = ${recall.toFixed(2)}\n${lines.join('\n')}`,
    );
    expect(recall).toBeGreaterThanOrEqual(0);
  });

  if (SEMANTIC_CHANNEL_LIVE) {
    it('meets the recall floor', () => {
      expect(recall).toBeGreaterThanOrEqual(RECALL_FLOOR);
    });
  } else {
    it('finds none of them — trigram index, no semantic channel (Q-17)', () => {
      // This is the honest baseline, not an aspiration. When it fails because
      // recall went UP, that is the embedding channel landing: flip
      // SEMANTIC_CHANNEL_LIVE and record the new number instead of deleting
      // this test.
      expect(recall).toBe(0);
    });

    it('returns no hit at all for a restated belief', () => {
      for (const r of results) {
        expect(r.hits, `unexpected hit for ${r.pair.label}`).toEqual([]);
      }
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
