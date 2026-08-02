/**
 * Ticket 007 — embedding channel eval on the real corpus.
 *
 * Measures qwen3-embedding (4096d) and nomic-embed-text (768d) against:
 *   1. the standing paraphrase fixture (tests/fixtures/paraphrase-pairs.ts)
 *   2. all pairs over the 139 imported vault snippets
 *   3. constructed negation pairs (Q-52's mechanism claim)
 *
 * Local endpoint only — ADR-0001 / Q-2. No hosted API, including for eval.
 * Vectors cache to data/eval-007/cache-<model>.jsonl so re-runs cost nothing.
 *
 * Run: npx tsx scripts/eval-007-embeddings.ts
 * Writes: data/eval-007/results.json  (read by the findings doc)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PAIRS, DISTRACTORS } from '../tests/fixtures/paraphrase-pairs.js';

const BASE = process.env.ELICIT_EMBED_URL ?? 'http://192.168.0.229:11434/v1/embeddings';
const MODELS = ['qwen3-embedding', 'nomic-embed-text'] as const;
const CACHE_DIR = join(process.cwd(), 'data', 'eval-007');
const VAULT_SNIPPETS = join(process.cwd(), 'vault', 'snippets');

// ---------------------------------------------------------------- corpus load

interface Snip { id: string; session: string; prose: string }

function loadCorpus(): Snip[] {
  const out: Snip[] = [];
  for (const dir of readdirSync(VAULT_SNIPPETS).sort()) {
    const file = join(VAULT_SNIPPETS, dir, 'v1.md');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
    if (!m) continue;
    const session = /session:\s*(.+)/.exec(m[1]!)?.[1]?.trim() ?? '';
    const prose = m[2]!.trim();
    if (prose) out.push({ id: dir, session, prose });
  }
  return out;
}

// ------------------------------------------------------- negation constructs
// Q-52 rules that negation-blindness is the MECHANISM: an opposed pair must be
// a near neighbour or the pipeline never pools it. Two families, deliberately:
//
//  (a) minimal — the real corpus sentence with the polarity flipped in place.
//      Near-total lexical overlap, so a HIGH score here is weak evidence.
//  (b) rephrased — the opposed pole restated in fresh words, the way belief
//      drift actually appears. This is the case the channel must actually
//      handle, and the one worth believing.
//
// Every `a` below is a VERBATIM sentence from vault/snippets.

interface NegPair { label: string; kind: 'minimal' | 'rephrased'; a: string; b: string }

const NEGATIONS: NegPair[] = [
  {
    label: 'technology-as-saviour',
    kind: 'minimal',
    a: 'The saviour idea of technology is looked at quite humbly and seen as a tool that needs to be situated.',
    b: 'The saviour idea of technology is not looked at humbly and is not seen as a tool that needs to be situated.',
  },
  {
    label: 'technology-as-saviour',
    kind: 'rephrased',
    a: 'The saviour idea of technology is looked at quite humbly and seen as a tool that needs to be situated.',
    b: 'Software arrives as the answer on its own terms; where it lands changes nothing about what it can do.',
  },
  {
    label: 'care-is-political',
    kind: 'minimal',
    a: 'Care is a very political act in the sense of what it questions and that has reflected in these collectives.',
    b: 'Care is not a political act in the sense of what it questions and that has not reflected in these collectives.',
  },
  {
    label: 'care-is-political',
    kind: 'rephrased',
    a: 'Care is a very political act in the sense of what it questions and that has reflected in these collectives.',
    b: 'Looking after each other is simply a private kindness between individuals, with no bearing on power or on what a group contests.',
  },
  {
    label: 'listen-versus-speak-for',
    kind: 'minimal',
    a: 'The point was to listen to what people there already wanted, not to speak for them.',
    b: 'The point was not to listen to what people there already wanted, but to speak for them.',
  },
  {
    label: 'listen-versus-speak-for',
    kind: 'rephrased',
    a: 'The point was to listen to what people there already wanted, not to speak for them.',
    b: 'A trained practitioner should set the agenda for a community, because the residents cannot articulate what they need.',
  },
  {
    label: 'design-hero-worship',
    kind: 'minimal',
    a: 'I understand now that the trap lies in the hero-worship that design engages.',
    b: 'I understand now that there is no trap in the hero-worship that design engages.',
  },
  {
    label: 'design-hero-worship',
    kind: 'rephrased',
    a: 'I understand now that the trap lies in the hero-worship that design engages.',
    b: 'Celebrating the individual designer as a visionary is healthy for the field and I see nothing wrong in it.',
  },
  {
    label: 'wikipedia-gaps',
    kind: 'minimal',
    a: "Wikipedia's knowledge gaps are not accidental- they reflect whose histories are considered encyclopaedic.",
    b: "Wikipedia's knowledge gaps are accidental- they do not reflect whose histories are considered encyclopaedic.",
  },
  {
    label: 'wikipedia-gaps',
    kind: 'rephrased',
    a: "Wikipedia's knowledge gaps are not accidental- they reflect whose histories are considered encyclopaedic.",
    b: 'What is missing from the open encyclopaedia is just an artefact of who happened to show up to write, and carries no judgement about whose past counts.',
  },
  {
    label: 'audio-natural-for-community',
    kind: 'minimal',
    a: 'Audio was a much more natural way for many in the community to record knowledge and daily practices',
    b: 'Audio was not a natural way for many in the community to record knowledge and daily practices',
  },
  {
    label: 'audio-natural-for-community',
    kind: 'rephrased',
    a: 'Audio was a much more natural way for many in the community to record knowledge and daily practices',
    b: 'Typed text remained the format people reached for first when they wanted to keep what they knew; speaking it aloud never felt like recording.',
  },
  {
    label: 'participant-authored-stories',
    kind: 'minimal',
    a: 'It was about creating space for the participants to tell their own stories using tools they could take apart, understand, and reshape.',
    b: 'It was not about creating space for the participants to tell their own stories, and the tools were not ones they could take apart, understand, or reshape.',
  },
  {
    label: 'participant-authored-stories',
    kind: 'rephrased',
    a: 'It was about creating space for the participants to tell their own stories using tools they could take apart, understand, and reshape.',
    b: 'We produced the narrative on their behalf with equipment that stayed sealed, because opening it up would only have slowed the programme down.',
  },
  {
    label: 'fragility-is-honest',
    kind: 'minimal',
    a: 'Fragility is an honest and important understanding in this sense because it changes the way we look at incentives and penalisations as a motivation.',
    b: 'Fragility is not an honest or important understanding in this sense because it does not change the way we look at incentives and penalisations as a motivation.',
  },
  {
    label: 'fragility-is-honest',
    kind: 'rephrased',
    a: 'Fragility is an honest and important understanding in this sense because it changes the way we look at incentives and penalisations as a motivation.',
    b: 'Treating a group as breakable is a sentimental distraction; rewards and punishments drive behaviour exactly as they always have.',
  },
];

// ------------------------------------------------------------------- embedder

/**
 * Cache line: `{text, vector}`, keyed on the exact text. The text is stored
 * rather than only its digest so a second pass over the cache (analyze) keys on
 * the same thing the first pass wrote, with no shared hashing convention to get
 * out of step.
 */
export class EmbedCache {
  private mem = new Map<string, number[]>();
  constructor(private path: string) {
    if (existsSync(path)) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line) as { text: string; vector: number[] };
        this.mem.set(rec.text, rec.vector);
      }
    }
  }
  get(text: string): number[] | undefined { return this.mem.get(text); }
  put(text: string, vector: number[]): void {
    this.mem.set(text, vector);
    appendFileSync(this.path, `${JSON.stringify({ text, vector })}\n`);
  }
  get size(): number { return this.mem.size; }
}

async function embedOne(model: string, text: string, attempt = 1): Promise<number[]> {
  try {
    const r = await fetch(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(600000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { data?: { embedding: number[] }[] };
    const v = j.data?.[0]?.embedding;
    if (!v?.length) throw new Error('empty embedding');
    return v;
  } catch (e) {
    if (attempt >= 4) throw e;
    // Cold model load can 500 or stall; back off and retry rather than invent.
    await new Promise(res => setTimeout(res, 4000 * attempt));
    return embedOne(model, text, attempt + 1);
  }
}

async function embedAll(model: string, texts: string[]): Promise<Map<string, number[]>> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cache = new EmbedCache(join(CACHE_DIR, `cache-${model}.jsonl`));
  const out = new Map<string, number[]>();
  let fetched = 0;
  const t0 = Date.now();
  for (const [i, text] of texts.entries()) {
    let v = cache.get(text);
    if (!v) {
      v = await embedOne(model, text);
      cache.put(text, v);
      fetched++;
      if (fetched % 25 === 0) {
        process.stderr.write(`  ${model}: ${i + 1}/${texts.length} (${fetched} fetched, ${Math.round((Date.now() - t0) / 1000)}s)\n`);
      }
    }
    out.set(text, v);
  }
  process.stderr.write(`  ${model}: ${texts.length} vectors ready (${fetched} newly embedded, dim=${out.values().next().value?.length})\n`);
  return out;
}

// ------------------------------------------------------------------ statistics

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

function describe(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return {
    n: s.length, min: s[0]!, max: s[s.length - 1]!, mean,
    p1: pct(s, 1), p5: pct(s, 5), p25: pct(s, 25), p50: pct(s, 50),
    p75: pct(s, 75), p95: pct(s, 95), p99: pct(s, 99), p999: pct(s, 99.9),
  };
}

/** Best achievable separation between two labelled score sets. */
function separation(positives: number[], negatives: number[]) {
  const cuts = [...new Set([...positives, ...negatives])].sort((a, b) => a - b);
  let best = { threshold: NaN, tp: 0, fp: 0, fn: 0, f1: -1, precision: 0, recall: 0 };
  for (const t of cuts) {
    const tp = positives.filter(x => x >= t).length;
    const fp = negatives.filter(x => x >= t).length;
    const fn = positives.length - tp;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp / (positives.length || 1);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    if (f1 > best.f1) best = { threshold: t, tp, fp, fn, f1, precision, recall };
  }
  // AUC by rank (Mann-Whitney), the threshold-free separation measure.
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  const auc = wins / (positives.length * negatives.length || 1);
  const posMin = Math.min(...positives), negMax = Math.max(...negatives);
  return { ...best, auc, cleanlySeparable: posMin > negMax, posMin, negMax };
}

// ----------------------------------------------------------------------- main

async function main() {
  const corpus = loadCorpus();
  process.stderr.write(`corpus: ${corpus.length} snippets, ${new Set(corpus.map(c => c.session)).size} sittings\n`);

  const fixtureStored = PAIRS.map(p => p.stored);
  const fixtureRestated = PAIRS.map(p => p.restated);
  const texts = [
    ...fixtureStored, ...fixtureRestated, ...DISTRACTORS,
    ...corpus.map(c => c.prose),
    ...NEGATIONS.flatMap(n => [n.a, n.b]),
  ];
  const unique = [...new Set(texts)];
  process.stderr.write(`texts to embed: ${unique.length} unique of ${texts.length}\n`);

  const results: Record<string, unknown> = {
    generated: new Date().toISOString(),
    endpoint: BASE,
    corpusSize: corpus.length,
    sittings: new Set(corpus.map(c => c.session)).size,
    uniqueTexts: unique.length,
  };

  for (const model of MODELS) {
    process.stderr.write(`\n=== ${model} ===\n`);
    const vec = await embedAll(model, unique);
    const V = (t: string) => vec.get(t)!;
    const dim = V(unique[0]!).length;

    // 1. Fixture: true pairs versus everything else in the fixture vault.
    const truePairs = PAIRS.map((p, i) => ({
      label: p.label, index: i, cosine: cosine(V(p.stored), V(p.restated)),
    }));
    const candidates = [...fixtureStored, ...DISTRACTORS];
    const falsePairs: { restated: number; against: string; cosine: number }[] = [];
    for (const [i, r] of fixtureRestated.entries()) {
      for (const c of candidates) {
        if (c === fixtureStored[i]) continue;
        falsePairs.push({ restated: i, against: c, cosine: cosine(V(r), V(c)) });
      }
    }
    // Rank recall: is the true stored snippet the nearest neighbour?
    const rankRecall = PAIRS.map((p, i) => {
      const scored = candidates
        .map(c => ({ c, s: cosine(V(p.restated), V(c)) }))
        .sort((a, b) => b.s - a.s);
      const rank = scored.findIndex(x => x.c === p.stored) + 1;
      return { label: p.label, rank, top1: scored[0]!.c, top1Cosine: scored[0]!.s };
    });

    const fixtureSep = separation(truePairs.map(t => t.cosine), falsePairs.map(f => f.cosine));

    // 2. The real 139: every pair.
    const corpusPairs: { a: number; b: number; cosine: number }[] = [];
    for (let i = 0; i < corpus.length; i++) {
      for (let j = i + 1; j < corpus.length; j++) {
        corpusPairs.push({ a: i, b: j, cosine: cosine(V(corpus[i]!.prose), V(corpus[j]!.prose)) });
      }
    }
    const corpusScores = corpusPairs.map(p => p.cosine);
    const admits = (t: number) => corpusScores.filter(s => s >= t).length;
    const quotaThreshold = (n: number) => {
      const s = [...corpusScores].sort((a, b) => b - a);
      return s[Math.min(n, s.length) - 1]!;
    };
    const topCorpus = [...corpusPairs].sort((a, b) => b.cosine - a.cosine).slice(0, 15)
      .map(p => ({ cosine: p.cosine, a: corpus[p.a]!.prose.slice(0, 90), b: corpus[p.b]!.prose.slice(0, 90) }));

    // 3. Negation, with the corpus background as the yardstick.
    const negScores = NEGATIONS.map(n => ({
      label: n.label, kind: n.kind, cosine: cosine(V(n.a), V(n.b)),
    }));

    results[model] = {
      dim,
      fixture: {
        truePairs: truePairs.map(t => ({ label: t.label, cosine: round(t.cosine) })),
        trueStats: roundAll(describe(truePairs.map(t => t.cosine))),
        falseStats: roundAll(describe(falsePairs.map(f => f.cosine))),
        falseTop5: [...falsePairs].sort((a, b) => b.cosine - a.cosine).slice(0, 5)
          .map(f => ({ cosine: round(f.cosine), restated: PAIRS[f.restated]!.label, against: f.against })),
        separation: roundAll(fixtureSep),
        recallAt: {
          '0.90': truePairs.filter(t => t.cosine >= 0.9).length,
          '0.85': truePairs.filter(t => t.cosine >= 0.85).length,
          '0.82': truePairs.filter(t => t.cosine >= 0.82).length,
          '0.80': truePairs.filter(t => t.cosine >= 0.8).length,
          '0.75': truePairs.filter(t => t.cosine >= 0.75).length,
          '0.70': truePairs.filter(t => t.cosine >= 0.7).length,
          '0.60': truePairs.filter(t => t.cosine >= 0.6).length,
        },
        falseAdmittedAt: {
          '0.90': falsePairs.filter(f => f.cosine >= 0.9).length,
          '0.85': falsePairs.filter(f => f.cosine >= 0.85).length,
          '0.82': falsePairs.filter(f => f.cosine >= 0.82).length,
          '0.80': falsePairs.filter(f => f.cosine >= 0.8).length,
          '0.75': falsePairs.filter(f => f.cosine >= 0.75).length,
          '0.70': falsePairs.filter(f => f.cosine >= 0.7).length,
          '0.60': falsePairs.filter(f => f.cosine >= 0.6).length,
        },
        rankRecall: rankRecall.map(r => ({ label: r.label, rank: r.rank, top1Cosine: round(r.top1Cosine) })),
        top1Correct: rankRecall.filter(r => r.rank === 1).length,
      },
      corpus: {
        pairCount: corpusPairs.length,
        stats: roundAll(describe(corpusScores)),
        admittedAt: Object.fromEntries(
          [0.95, 0.9, 0.88, 0.85, 0.82, 0.8, 0.78, 0.75, 0.7, 0.6].map(t => [t.toFixed(2), admits(t)]),
        ),
        thresholdForTopN: Object.fromEntries(
          [3, 5, 10, 20, 50].map(n => [String(n), round(quotaThreshold(n))]),
        ),
        top15: topCorpus.map(t => ({ ...t, cosine: round(t.cosine) })),
      },
      negation: {
        scores: negScores.map(n => ({ ...n, cosine: round(n.cosine) })),
        minimalStats: roundAll(describe(negScores.filter(n => n.kind === 'minimal').map(n => n.cosine))),
        rephrasedStats: roundAll(describe(negScores.filter(n => n.kind === 'rephrased').map(n => n.cosine))),
        // The number that decides Q-52: where does an opposed pair sit against
        // the corpus background? A pair below the corpus p99 is never pooled.
        minimalPercentileInCorpus: negScores.filter(n => n.kind === 'minimal')
          .map(n => ({ label: n.label, pctile: round(percentileOf(corpusScores, n.cosine)) })),
        rephrasedPercentileInCorpus: negScores.filter(n => n.kind === 'rephrased')
          .map(n => ({ label: n.label, pctile: round(percentileOf(corpusScores, n.cosine)) })),
      },
    };
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

function percentileOf(sorted: number[], x: number): number {
  const below = sorted.filter(s => s < x).length;
  return (100 * below) / (sorted.length || 1);
}
function round(x: number): number { return Math.round(x * 10000) / 10000; }
function roundAll<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'number' ? round(v) : v;
  return out as T;
}

// Only run when invoked directly — eval-007-analyze.ts imports EmbedCache.
if (process.argv[1]?.includes('eval-007-embeddings')) {
  main().catch(e => { console.error(e); process.exit(1); });
}
