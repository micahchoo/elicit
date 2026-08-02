import { describe, it, expect } from 'vitest';
import { buildIndex, resonate } from '../src/index/lexical.js';
import type { Snippet } from '../src/types.js';

function snip(id: string, version: number, prose: string): Snippet {
  return {
    id,
    version,
    captured: new Date().toISOString(),
    provenance: {
      kind: 'harvest' as const,
      session: 'test-session',
      question: 'test question',
      questionForm: 'deliberative' as const,
    },
    prose,
  };
}

describe('buildIndex', () => {
  it('builds deterministic index from same snippets', () => {
    const snippets = [
      snip('a', 1, 'the cat sat on the mat quietly'),
      snip('b', 1, 'i remember the day we first met'),
    ];
    const idx1 = buildIndex(snippets);
    const idx2 = buildIndex(snippets);
    const hits1 = resonate(idx1, 'the cat sat', 5);
    const hits2 = resonate(idx2, 'the cat sat', 5);
    expect(hits1).toEqual(hits2);
  });

  it('handles empty snippet array', () => {
    const idx = buildIndex([]);
    expect(idx).toBeDefined();
    expect(resonate(idx, 'anything', 5)).toEqual([]);
  });
});

describe('resonate', () => {
  it('finds shared 3+-word phrase across texts with different surroundings', () => {
    const snippets = [
      snip('a', 1, 'yesterday morning the cat sat on the mat while i read'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'i watched the cat sat on my favorite rug', 5);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const hit = hits[0]!;
    expect(hit.snippetText.includes(hit.sharedPhrase)).toBe(true);
    expect('i watched the cat sat on my favorite rug'.includes(hit.sharedPhrase)).toBe(true);
    expect(hit.snippetId).toBe('a');
    expect(hit.version).toBe(1);
    expect(hit.score).toBeGreaterThan(0);
  });

  it('rejects stopword-only overlap', () => {
    const snippets = [
      snip('a', 1, 'and then the rain started falling hard'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'i walked outside and then the sun came out', 5);
    expect(hits).toEqual([]);
  });

  it('ranks rarer phrase above common one', () => {
    const snippets = [
      snip('a', 1, 'the cat sat on the mat'),
      snip('b', 1, 'the cat sat near the door'),
      snip('c', 1, 'the cat sat under the table'),
      snip('rare', 1, 'phlogiston theory dominated alchemical discourse'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'the cat sat while phlogiston theory dominated debate', 5);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const rareIdx = hits.findIndex(h => h.snippetId === 'rare');
    const commonIdx = hits.findIndex(h => h.snippetId === 'a' || h.snippetId === 'b' || h.snippetId === 'c');
    expect(rareIdx).toBeLessThan(commonIdx);
  });

  it('sharedPhrase is verbatim substring of both query and snippet text', () => {
    const snippets = [
      snip('a', 1, 'the hermeneutic circle describes interpretive understanding'),
    ];
    const idx = buildIndex(snippets);
    const query = 'Gadamer wrote about the hermeneutic circle at length';
    const hits = resonate(idx, query, 5);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const hit = hits[0]!;
    expect(hit.snippetText.includes(hit.sharedPhrase)).toBe(true);
    expect(query.includes(hit.sharedPhrase)).toBe(true);
    expect(hit.sharedPhrase.toLowerCase()).toContain('hermeneutic circle');
  });

  it('empty vault returns empty results', () => {
    const idx = buildIndex([]);
    expect(resonate(idx, 'anything here at all', 5)).toEqual([]);
  });

  it('diversity rule: one hit per snippet id', () => {
    const snippets = [
      snip('a', 1, 'the common phrase here and common phrase there and common phrase everywhere'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'common phrase is everywhere in common phrase land', 5);
    const hitsForA = hits.filter(h => h.snippetId === 'a');
    expect(hitsForA.length).toBeLessThanOrEqual(1);
  });

  it('diversity rule: near-identical snippets yield at most one hit', () => {
    const a = snip('a', 1, 'the hermeneutic circle describes how interpretation proceeds from parts to whole and back again');
    const b = snip('b', 1, 'the hermeneutic circle describes how interpretation proceeds from parts to whole and back again always');
    const c = snip('c', 1, 'quantum entanglement challenges our classical notion of locality');
    const snippets = [a, b, c];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'hermeneutic circle describes interpretation and quantum entanglement challenges', 5);
    const hitIds = new Set(hits.map(h => h.snippetId));
    expect(hitIds.has('a') && hitIds.has('b')).toBe(false);
    expect(hitIds.has('c')).toBe(true);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('respects k parameter for result count', () => {
    const snippets = [
      snip('a', 1, 'first unique idea about philosophy'),
      snip('b', 1, 'second unique idea about science'),
      snip('c', 1, 'third unique idea about art'),
      snip('d', 1, 'fourth unique idea about music'),
      snip('e', 1, 'fifth unique idea about history'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'unique idea about', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when no phrase matches', () => {
    const snippets = [
      snip('a', 1, 'completely unrelated text here'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'nothing in common at all', 5);
    expect(hits).toEqual([]);
  });

  it('handles punctuation and casing in texts', () => {
    const snippets = [
      snip('a', 1, 'the Self, according to Jung, integrates the conscious and unconscious.'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'Jung said the self integrates conscious and unconscious aspects', 5);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const hit = hits[0]!;
    expect(hit.snippetText.includes(hit.sharedPhrase)).toBe(true);
    expect('Jung said the self integrates conscious and unconscious aspects'.includes(hit.sharedPhrase)).toBe(true);
  });

  it('scores long shared phrases higher than short ones (same rarity)', () => {
    const snippets = [
      snip('short', 1, 'the big dog barked'),
      snip('long', 1, 'the big dog barked loudly at dawn'),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'the big dog barked loudly at dawn today', 5);
    const longIdx = hits.findIndex(h => h.snippetId === 'long');
    const shortIdx = hits.findIndex(h => h.snippetId === 'short');
    expect(longIdx).toBeLessThan(shortIdx);
  });

  it('handles single-character and very short texts', () => {
    const snippets = [
      snip('a', 1, 'Hi'),
      snip('b', 1, ''),
    ];
    const idx = buildIndex(snippets);
    const hits = resonate(idx, 'Hi there', 5);
    expect(hits).toEqual([]);
  });
});
