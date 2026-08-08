/**
 * Ticket 053 — the semantic resonance channel, measured against the live
 * endpoint, on the standing paraphrase fixture.
 *
 * **This is the one path in the ticket that touches the network** (Q-2 /
 * ADR-0001: local Ollama, nothing leaves the LAN). Every test runs on a fake.
 *
 * It does two jobs and the second is why it writes a file:
 *
 * 1. **Measure.** Build `buildSemanticIndex` over exactly the corpus
 *    `tests/resonance-paraphrase.test.ts` builds — the 8 stored beliefs plus
 *    the 3 distractors — prime it against the live endpoint, and run the 8
 *    restatements through the SHIPPED code path. Reports recall@1 and recall@5
 *    beside the lexical incumbent's 0/8 and the eval's 3/8 at cosine 0.70.
 *
 * 2. **Record the geometry**, so the measurement can be replayed offline and
 *    deterministically in CI. It writes `tests/fixtures/semantic-vectors.ts`:
 *    the 19 fixture texts' pairwise cosine matrix, Cholesky-factored into 19
 *    nineteen-dimensional vectors whose cosines reproduce the measured ones to
 *    six decimals. A test embedding those rows measures the REAL model's
 *    recall, with no network and no 4096-dimensional fixture to commit.
 *
 *     Two honest limits on that recording. The eval's addendum measured the
 *     endpoint as deterministic for a FIXED BATCH COMPOSITION only — a third-
 *     decimal wobble follows batch size — so this is one measurement, not the
 *     platonic one. And a rank is invariant to that wobble, which is the whole
 *     argument for ranking; the recorded recall is therefore stable in a way a
 *     recorded threshold verdict would not be.
 *
 * Vectors cache to `data/eval-053/cache-<model>.jsonl` in T18's line format,
 * keyed on the exact text. Derived and rebuildable (Q-3); deleting it costs one
 * embed pass and no data.
 *
 *   npx tsx scripts/eval-053-semantic-resonance.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildIndex, resonate } from '../src/index/lexical.js';
import { buildSemanticIndex } from '../src/index/semantic.js';
import { bodyHash, cosine, localEmbedder, type EmbeddingIndexStore, type EmbeddingRecord } from '../src/wiki/embedding.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { Snippet } from '../src/types.js';
import { PAIRS, DISTRACTORS } from '../tests/fixtures/paraphrase-pairs.js';

const OUT_DIR = join(import.meta.dirname, '..', 'data', 'eval-053');
const FIXTURE = join(import.meta.dirname, '..', 'tests', 'fixtures', 'semantic-vectors.ts');

const { embed: rawEmbed, model } = localEmbedder();

// ── A text-keyed cache, so a second run costs nothing ──

const CACHE = join(OUT_DIR, `cache-${model.replace(/[^a-z0-9]/gi, '-')}.jsonl`);
const cache = new Map<string, number[]>();
try {
  for (const line of readFileSync(CACHE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as { hash: string; vector: number[] };
    cache.set(r.hash, r.vector);
  }
} catch {
  // No cache is the ordinary cold state.
}

function flush(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const lines = [...cache].map(([hash, vector]) => JSON.stringify({ hash, model, vector }));
  writeFileSync(CACHE, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf-8');
}

/** Retries with backoff, for the cold start ticket 007 measured. Never fabricates. */
async function embed(texts: string[]): Promise<number[][]> {
  const need = texts.filter((t) => !cache.has(bodyHash(t)));
  if (need.length > 0) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const vectors = await rawEmbed(need);
        if (vectors.length !== need.length) throw new Error('length mismatch');
        need.forEach((t, i) => cache.set(bodyHash(t), vectors[i]!));
        flush();
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    if (lastErr) throw lastErr;
  }
  return texts.map((t) => cache.get(bodyHash(t))!);
}

// ── The corpus, identical to the standing test's VAULT ──

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

const VAULT: Snippet[] = [
  ...PAIRS.map((p, i) => snip(`pair-${i}`, p.stored)),
  ...DISTRACTORS.map((d, i) => snip(`distractor-${i}`, d)),
];

// ── An in-memory store: this script measures, it does not write to the vault ──

function memoryStore(): EmbeddingIndexStore {
  let rows: EmbeddingRecord[] = [];
  return { load: () => rows, save: (r) => { rows = r; } };
}

const quiet = () => {};

async function main(): Promise<void> {
  const index = buildSemanticIndex(VAULT, {
    embed,
    model,
    store: memoryStore(),
    log: quiet,
  });

  const t0 = Date.now();
  await index.prime();
  console.log(`primed ${index.vectored()}/${VAULT.length} snippets in ${Date.now() - t0}ms (model=${model})\n`);

  const lexical = buildIndex(VAULT);

  let atOne = 0;
  let atFive = 0;
  let atSeventy = 0;
  let lexicalHits = 0;

  console.log('restatement → what the channel ranks first');
  console.log('─'.repeat(78));

  for (const [i, pair] of PAIRS.entries()) {
    const target = `pair-${i}`;
    const hits = await index.resonate(pair.restated, 5);
    const top = hits[0];
    const rank = hits.findIndex((h) => h.snippetId === target) + 1;
    if (rank === 1) atOne++;
    if (rank > 0) atFive++;
    // The instrument ticket 007 recommended against, for comparison only.
    if (hits.some((h) => h.snippetId === target && h.score >= 0.7)) atSeventy++;
    if (resonate(lexical, pair.restated, 5).some((h) => h.snippetId === target)) lexicalHits++;

    const verdict = rank === 1 ? 'RANK 1' : rank > 0 ? `rank ${rank}` : 'MISS  ';
    console.log(
      `${verdict}  ${pair.label}\n` +
        `        top=${top?.snippetId ?? '—'} cos=${top?.score.toFixed(4) ?? '—'}` +
        `  target=${target} cos=${hits.find((h) => h.snippetId === target)?.score.toFixed(4) ?? '<not in top 5>'}`,
    );
  }

  console.log('─'.repeat(78));
  console.log(`semantic recall@1  : ${atOne}/${PAIRS.length}`);
  console.log(`semantic recall@5  : ${atFive}/${PAIRS.length}`);
  console.log(`semantic @cos>=0.70: ${atSeventy}/${PAIRS.length}   (the instrument 007 recommended against)`);
  console.log(`lexical  recall@5  : ${lexicalHits}/${PAIRS.length}   (the incumbent)`);
  console.log(`shadow floor       : ${THRESHOLDS['resonance.semanticFloor'].name}=${String(THRESHOLDS['resonance.semanticFloor'].value)} live=${THRESHOLDS['resonance.semanticFloor'].live}`);

  // ── The opposite pole: the eval's single most interesting data point ──
  const opposed = await index.resonate(PAIRS[0]!.restated, 11);
  const d0 = opposed.find((h) => h.snippetId === 'distractor-0');
  const p0 = opposed.find((h) => h.snippetId === 'pair-0');
  console.log(
    `\nopposite pole  : distractor-0 (states the opposite) rank=${d0?.rank ?? '—'} cos=${d0?.score.toFixed(4) ?? '—'}` +
      `  vs pair-0 (the paraphrase) rank=${p0?.rank ?? '—'} cos=${p0?.score.toFixed(4) ?? '—'}`,
  );

  await writeFixture();
}

// ── The recorded geometry ──

/**
 * Cholesky: L L^T = G. Rows of L are vectors whose pairwise cosines are exactly
 * G, because every row's norm is sqrt(G[i][i]) = 1 for a cosine matrix. The
 * clamp on the diagonal absorbs the rounding that makes a measured Gram matrix
 * miss positive-definiteness by ~1e-9.
 */
function cholesky(g: number[][]): number[][] {
  const n = g.length;
  const l: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = g[i]![j]!;
      for (let k = 0; k < j; k++) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) l[i]![j] = Math.sqrt(Math.max(sum, 1e-12));
      else l[i]![j] = sum / l[j]![j]!;
    }
  }
  return l;
}

async function writeFixture(): Promise<void> {
  const texts = [...PAIRS.map((p) => p.stored), ...PAIRS.map((p) => p.restated), ...DISTRACTORS];
  const vectors = await embed(texts);
  const n = texts.length;

  const gram: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => cosine(vectors[i]!, vectors[j]!)),
  );
  const low = cholesky(gram).map((row) => row.map((x) => Number(x.toFixed(6))));

  let worst = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      worst = Math.max(worst, Math.abs(cosine(low[i]!, low[j]!) - gram[i]![j]!));
    }
  }
  console.log(`\nrecorded geometry: ${n} texts, ${n}-dim rows, worst cosine error ${worst.toExponential(2)}`);
  if (worst > 1e-5) throw new Error(`reconstruction error ${worst} is too large to record`);

  const rows = texts.map((t, i) => `  ${JSON.stringify(t)}:\n    [${low[i]!.join(', ')}],`).join('\n');

  writeFileSync(
    FIXTURE,
    `/**
 * The measured geometry of the paraphrase fixture, recorded so the recall
 * number can be replayed offline. **Generated — do not hand-edit.**
 *
 *   npx tsx scripts/eval-053-semantic-resonance.ts
 *
 * Each row is a 19-dimensional vector whose pairwise cosines reproduce what
 * \`${model}\` actually returned for these 19 texts on the local endpoint,
 * to within ${worst.toExponential(1)}. It is a Cholesky factor of the measured
 * cosine matrix, not a projection: the geometry is exact, only the ambient
 * dimension is smaller. A test that embeds these rows measures the REAL model's
 * ranking without a network call and without committing 19 x 4096 floats.
 *
 * Two limits, both from ticket 007's eval. The endpoint is deterministic for a
 * FIXED BATCH COMPOSITION and wobbles in the third decimal with batch size, so
 * this is one measurement rather than the platonic one — which is exactly why
 * the channel ranks instead of cutting, since a rank survives that wobble and
 * an absolute cut does not. And these are short first-person belief statements
 * (82 chars mean); an essay sentence sits in a lower background.
 *
 * Recorded ${new Date().toISOString().slice(0, 10)} against ${model}.
 */

export const MODEL = ${JSON.stringify(model)};

/** Text → its recorded vector. Keys are verbatim from \`paraphrase-pairs.ts\`. */
export const RECORDED_VECTORS: Record<string, number[]> = {
${rows}
};
`,
    'utf-8',
  );
  console.log(`wrote ${FIXTURE}`);
}

await main();
