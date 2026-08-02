/**
 * Ticket 007, second pass — reads the cache written by eval-007-embeddings.ts
 * and answers the questions the first pass raised. No network calls.
 *
 *  A. Threshold PORTABILITY: does one absolute cosine mean the same thing on
 *     the fixture and on the real corpus? (It is the whole premise of a fixed
 *     `clash.embeddingCosine`.)
 *  B. Cross-sitting pairs only — 76 of 139 snippets come from one essay, so
 *     the raw pair count flatters the channel.
 *  C. What a candidate pool actually looks like at each threshold, against
 *     T12's per-run judgment quota of 3.
 *  D. Does text LENGTH drive cosine? A channel that mostly measures length is
 *     not measuring aboutness.
 *
 * Run: npx tsx scripts/eval-007-analyze.ts
 */
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAIRS, DISTRACTORS } from '../tests/fixtures/paraphrase-pairs.js';
import { EmbedCache } from './eval-007-embeddings.js';

const CACHE_DIR = join(process.cwd(), 'data', 'eval-007');
const VAULT_SNIPPETS = join(process.cwd(), 'vault', 'snippets');
const MODELS = ['qwen3-embedding', 'nomic-embed-text'] as const;

interface Snip { id: string; session: string; prose: string }

function loadCorpus(): Snip[] {
  const out: Snip[] = [];
  for (const dir of readdirSync(VAULT_SNIPPETS).sort()) {
    const file = join(VAULT_SNIPPETS, dir, 'v1.md');
    if (!existsSync(file)) continue;
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, 'utf8'));
    if (!m) continue;
    const session = /session:\s*(.+)/.exec(m[1]!)?.[1]?.trim() ?? '';
    const prose = m[2]!.trim();
    if (prose) out.push({ id: dir, session, prose });
  }
  return out;
}

function loadCache(model: string): (text: string) => number[] {
  const cache = new EmbedCache(join(CACHE_DIR, `cache-${model}.jsonl`));
  return (text: string) => {
    const v = cache.get(text);
    if (!v) throw new Error(`cache miss (run eval-007-embeddings.ts first): ${text.slice(0, 60)}`);
    return v;
  };
}

function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Fraction of `background` strictly below x, as a percentile. */
function pctileOf(background: number[], x: number): number {
  let below = 0;
  for (const b of background) if (b < x) below++;
  return (100 * below) / background.length;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}

function main() {
  const corpus = loadCorpus();
  const report: Record<string, unknown> = { corpusSize: corpus.length };

  for (const model of MODELS) {
    const V = loadCache(model);
    console.log(`\n################ ${model}`);

    // ---- background distributions
    const corpusPairs: { i: number; j: number; c: number; cross: boolean }[] = [];
    for (let i = 0; i < corpus.length; i++) {
      for (let j = i + 1; j < corpus.length; j++) {
        corpusPairs.push({
          i, j,
          c: cosine(V(corpus[i]!.prose), V(corpus[j]!.prose)),
          cross: corpus[i]!.session !== corpus[j]!.session,
        });
      }
    }
    const corpusBg = corpusPairs.map(p => p.c);
    const crossPairs = corpusPairs.filter(p => p.cross);
    const crossBg = crossPairs.map(p => p.c);

    const fixtureCandidates = [...PAIRS.map(p => p.stored), ...DISTRACTORS];
    const fixtureBg: number[] = [];
    for (const [i, p] of PAIRS.entries()) {
      for (const c of fixtureCandidates) {
        if (c === PAIRS[i]!.stored) continue;
        fixtureBg.push(cosine(V(p.restated), V(c)));
      }
    }

    // ---- A. Portability: same cosine, two different meanings
    console.log('\nA. THRESHOLD PORTABILITY — where a raw cosine sits in each background');
    console.log('   cosine | %ile in fixture-negatives | %ile in corpus-pairs | %ile in cross-sitting');
    for (const t of [0.60, 0.65, 0.70, 0.73, 0.75, 0.78, 0.82]) {
      console.log(`   ${t.toFixed(2)}   |  ${pctileOf(fixtureBg, t).toFixed(2).padStart(6)}%  |  ${pctileOf(corpusBg, t).toFixed(3).padStart(7)}%  |  ${pctileOf(crossBg, t).toFixed(3).padStart(7)}%`);
    }
    const truePairCos = PAIRS.map(p => cosine(V(p.stored), V(p.restated)));
    console.log('   true paraphrase pairs, as a percentile of the CORPUS background:');
    for (const [i, c] of truePairCos.entries()) {
      console.log(`     ${c.toFixed(4)} → ${pctileOf(corpusBg, c).toFixed(2)}%  ${PAIRS[i]!.label}`);
    }

    // ---- B. Cross-sitting
    console.log('\nB. CROSS-SITTING ONLY');
    console.log(`   total pairs ${corpusPairs.length}, cross-sitting ${crossPairs.length} (${(100 * crossPairs.length / corpusPairs.length).toFixed(1)}%)`);
    const sameMax = Math.max(...corpusPairs.filter(p => !p.cross).map(p => p.c));
    console.log(`   max same-sitting cosine ${sameMax.toFixed(4)}, max cross-sitting ${Math.max(...crossBg).toFixed(4)}`);

    // ---- C. Pool size at each threshold, versus T12's quota of 3
    console.log('\nC. POOL SIZE vs T12 judgment quota (3 per run)');
    console.log('   thresh | all pairs | cross-sitting pairs');
    for (const t of [0.60, 0.65, 0.68, 0.70, 0.72, 0.73, 0.75, 0.78, 0.80, 0.82]) {
      const all = corpusBg.filter(c => c >= t).length;
      const cross = crossBg.filter(c => c >= t).length;
      console.log(`   ${t.toFixed(2)}   | ${String(all).padStart(9)} | ${String(cross).padStart(19)}`);
    }
    // The top cross-sitting pairs are what the channel would ACTUALLY surface,
    // since same-sitting pairs are two sentences of one essay.
    console.log('\n   TOP 10 CROSS-SITTING PAIRS (what the channel would surface first):');
    for (const p of [...crossPairs].sort((a, b) => b.c - a.c).slice(0, 10)) {
      console.log(`   ${p.c.toFixed(4)}  [${corpus[p.i]!.session.replace('post-', '')} | ${corpus[p.j]!.session.replace('post-', '')}]`);
      console.log(`      A: ${corpus[p.i]!.prose.slice(0, 110)}`);
      console.log(`      B: ${corpus[p.j]!.prose.slice(0, 110)}`);
    }

    // ---- D. Length confound
    console.log('\nD. LENGTH CONFOUND');
    const lens = corpusPairs.map(p => Math.min(corpus[p.i]!.prose.length, corpus[p.j]!.prose.length));
    const meanLens = corpusPairs.map(p => (corpus[p.i]!.prose.length + corpus[p.j]!.prose.length) / 2);
    console.log(`   corr(cosine, min length)  = ${pearson(corpusBg, lens).toFixed(3)}`);
    console.log(`   corr(cosine, mean length) = ${pearson(corpusBg, meanLens).toFixed(3)}`);
    const fixtureLen = [...PAIRS.map(p => p.stored), ...PAIRS.map(p => p.restated)].reduce((a, b) => a + b.length, 0) / (PAIRS.length * 2);
    const corpusLen = corpus.reduce((a, b) => a + b.prose.length, 0) / corpus.length;
    console.log(`   mean chars — fixture ${fixtureLen.toFixed(0)}, corpus ${corpusLen.toFixed(0)}`);

    // ---- E. Self-similarity floor: a model whose vectors are all alike
    const anisotropy = corpusBg.reduce((a, b) => a + b, 0) / corpusBg.length;
    console.log(`\nE. ANISOTROPY (mean cosine between unrelated snippets) = ${anisotropy.toFixed(4)}`);
    console.log(`   — the usable dynamic range above the floor is ${(Math.max(...corpusBg) - anisotropy).toFixed(4)}`);

    // ---- F. The one number T18 needs
    const sorted = [...crossBg].sort((a, b) => b - a);
    console.log('\nF. CROSS-SITTING threshold that yields exactly N pairs:');
    for (const n of [3, 5, 10, 20, 30]) console.log(`   N=${String(n).padStart(2)} → ${sorted[n - 1]!.toFixed(4)}`);

    // ---- G. Pool CONCENTRATION — the god-node question (plan L1032-1034).
    // A pool where one snippet is half the pairs burns the quota on one node.
    console.log('\nG. POOL CONCENTRATION at candidate thresholds');
    for (const t of [0.60, 0.65, 0.70]) {
      const pool = corpusPairs.filter(p => p.c >= t);
      if (!pool.length) { console.log(`   ${t.toFixed(2)}: empty pool`); continue; }
      const freq = new Map<number, number>();
      for (const p of pool) { freq.set(p.i, (freq.get(p.i) ?? 0) + 1); freq.set(p.j, (freq.get(p.j) ?? 0) + 1); }
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]!;
      console.log(`   ${t.toFixed(2)}: ${pool.length} pairs over ${freq.size} distinct snippets; busiest snippet is in ${top[1]} of them (${(100 * top[1] / pool.length).toFixed(0)}%)`);
      console.log(`         busiest: "${corpus[top[0]]!.prose.slice(0, 95)}"`);
    }

    report[model] = {
      anisotropy,
      corpusMax: Math.max(...corpusBg),
      crossSittingPairs: crossPairs.length,
      truePairCorpusPercentiles: truePairCos.map(c => Number(pctileOf(corpusBg, c).toFixed(2))),
      crossThresholdForN: Object.fromEntries([3, 5, 10, 20, 30].map(n => [n, Number(sorted[n - 1]!.toFixed(4))])),
      lengthCorrelation: Number(pearson(corpusBg, meanLens).toFixed(3)),
    };
  }

  writeFileSync(join(CACHE_DIR, 'analysis.json'), JSON.stringify(report, null, 2));
}

main();
