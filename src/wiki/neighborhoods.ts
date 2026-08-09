/**
 * Neighborhoods — §12.3: your passages, grouped into themes.
 *
 * The contextualizer wiki (§11) is your passages in your ink, grouped so the
 * page reads as themes rather than as one undifferentiated stream. That
 * grouping is C1's job: clustering by embedding similarity when the vectors
 * exist, with a deterministic lexical fallback when the embedding channel is
 * off. Both channels run the same single-pass greedy join:
 *
 *   - Passages are sorted by id first, so the same corpus always produces the
 *     same groups whatever order the vault was read in (determinism).
 *   - Each passage joins the FIRST theme whose similarity to the theme's
 *     representative meets the join floor; a passage that qualifies for
 *     nothing starts a theme of its own. There is no argmax (§12.3 forbids
 *     it): a passage is never forced into the closest theme when it fits
 *     none. The grouping is a reading aid, not an assertion.
 *   - Embedding mode compares a passage's vector to the theme's centroid (an
 *     unnormalised sum — cosine is scale-invariant, so the sum ranks exactly
 *     like the mean) by cosine; a pair where either side has no vector falls
 *     back to content-word Jaccard against the theme's vocabulary, exactly
 *     as `resonateHybrid` stages lexical behind semantic elsewhere.
 *   - Lexical mode compares every pair by content-word Jaccard.
 *   - The mode is chosen by vector COVERAGE, not by availability: with fewer
 *     than `neighborhoods.minVectorCoverage` of the passages vectored, the
 *     channel is starved and the fallback runs — and the fallback IS the
 *     sentence on the activity log (§12: starvation must never be a silence).
 *
 * Names are a term-frequency label, never a model sentence: the theme's most
 * frequent content word, generic name words excluded, ties broken by length
 * then alphabet. A theme whose passages yield no topical word is named by the
 * date its earliest passage was said — a fact, not a judgment.
 *
 * The store is `vault/wiki/neighborhoods.json`, rebuilt by the docket job
 * every run and read by the page. It is derived data (Q-3): a missing or
 * malformed file costs a rebuild, never a passage, and `readNeighborhoods`
 * never throws. The job never embeds — it reads the snippet-vector store
 * (`vault/index/snippet-embeddings.jsonl`) that the semantic channel primes
 * and the full-corpus coverage job (C3) grows, and logs what it clustered
 * and what it skipped as the coverage sentence.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GENERIC_NAME_WORDS } from '../coach/license.js';
import { contentWordsOf, jaccard } from '../index/lexical.js';
import { fileSnippetVectorStore } from '../index/semantic.js';
import { cachedVector, cosine, type EmbeddingRecord } from './embedding.js';
import type { LogFn } from './contract.js';
import { THRESHOLDS, readNumber, shadowDecision, type ThresholdRegister } from './thresholds.js';

// ── The shapes ──

/** One passage on the page — a snippet, in your ink. */
export type NeighborhoodPassage = { id: string; prose: string; captured: string };

/** One theme: a name and the passages that compose it. */
export type Neighborhood = { name: string; passageIds: string[] };

/** Which channel produced the grouping. */
export type NeighborhoodSource = 'embedding' | 'lexical';

/** The derived store the page reads (Q-3: rebuilt by the job, never source). */
export type NeighborhoodStore = {
 rebuiltAt: string;
 source: NeighborhoodSource;
 /** Coverage — the numbers the activity-log sentence is built from. Written by the job; absent on stores that predate it. */
 coverage?: { total: number; clustered: number; skipped: number };
 clusters: Neighborhood[];
};

/** What one job run did, for the DocketReport. */
export type NeighborhoodsReport = {
 source: NeighborhoodSource;
 clustered: number;
 skipped: number;
 neighborhoods: number;
};

/** The one file the store lives in, under the vault's wiki directory. */
const NEIGHBORHOODS_FILE = 'neighborhoods.json';

// ── Shared helpers ──

function byId(a: { id: string }, b: { id: string }): number {
 return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** First occurrence of an id wins — a duplicate id is a caller bug, not a second passage. */
function dedupeById(passages: NeighborhoodPassage[]): NeighborhoodPassage[] {
 const out: NeighborhoodPassage[] = [];
 const seen = new Set<string>();
 for (const p of passages) {
  if (seen.has(p.id)) continue;
  seen.add(p.id);
  out.push(p);
 }
 return out;
}

/** One theme mid-clustering. */
type Acc = {
 ids: string[];
 /** Unnormalised vector sum of the theme's vectored members; null when none. */
 centroid: number[] | null;
 /** Union of every member's content words — the theme's vocabulary. */
 words: Set<string>;
};

/** The similarity of one passage to one theme, by whichever channel the pair can use. */
function similarity(
 pWords: Set<string>,
 pVec: readonly number[] | undefined,
 c: Acc,
 source: NeighborhoodSource,
): number {
 if (source === 'embedding' && pVec && pVec.length > 0 && c.centroid) {
  return cosine([...pVec], c.centroid);
 }
 return jaccard(pWords, c.words);
}

/** The join floor for one pair: cosine in embedding mode, Jaccard otherwise. */
function joinFloor(source: NeighborhoodSource, hasVectorPair: boolean): number {
 return source === 'embedding' && hasVectorPair
  ? readNumber(THRESHOLDS['neighborhoods.embeddingJoin'], 0.55)
  : readNumber(THRESHOLDS['neighborhoods.lexicalJoin'], 0.25);
}

/** Fold one passage's vector into a theme's centroid. */
function addToCentroid(centroid: number[] | null, vec: readonly number[] | undefined): number[] | null {
 if (!vec || vec.length === 0) return centroid;
 if (!centroid) return [...vec];
 return centroid.map((v, i) => v + (vec[i] ?? 0));
}

// ── The mode decision ──

/**
 * Which channel clusters a corpus: `embedding` when enough passages hold a
 * usable vector, `lexical` otherwise. The floor is a coverage fraction, not
 * an availability check — one vector in forty does not license the channel.
 */
export function neighborhoodSource(
 passages: NeighborhoodPassage[],
 vectors?: ReadonlyMap<string, readonly number[]>,
): NeighborhoodSource {
 if (!vectors || passages.length === 0) return 'lexical';
 let vectored = 0;
 for (const p of passages) if (vectors.get(p.id)) vectored++;
 const floor = readNumber(THRESHOLDS['neighborhoods.minVectorCoverage'], 0.5);
 return vectored / passages.length >= floor ? 'embedding' : 'lexical';
}

// ── The clustering ──

export type ClusterOpts = {
 /**
  * Snippet vectors keyed by passage id, as `cachedVector` validated them.
  * Absent (or thinly covered) means the embedding channel is off and the
  * deterministic lexical fallback runs.
  */
 vectors?: ReadonlyMap<string, readonly number[]>;
};

/**
 * Group passages into themes. Deterministic: the same corpus yields the same
 * groups and the same names in the same order, whatever order it arrives in.
 * Every passage lands in exactly one theme — a passage that fits none starts
 * one of its own (curation, not assertion).
 */
export function clusterPassages(passages: NeighborhoodPassage[], opts: ClusterOpts = {}): Neighborhood[] {
 const ordered = dedupeById(passages).sort(byId);
 const source = neighborhoodSource(ordered, opts.vectors);
 const byIdMap = new Map(ordered.map((p) => [p.id, p]));
 const clusters: Acc[] = [];

 for (const p of ordered) {
  const words = contentWordsOf(p.prose);
  const vec = opts.vectors?.get(p.id);
  let best: Acc | null = null;
  let bestSim = -Infinity;
  for (const c of clusters) {
   const hasVectorPair = source === 'embedding' && !!vec && vec.length > 0 && !!c.centroid;
   const sim = similarity(words, vec, c, source);
   // Ties keep the earliest theme: the first in id order, and a theme that
   // fits equally well is a theme the passage may read either way.
   if (sim >= joinFloor(source, hasVectorPair) && sim > bestSim) {
    best = c;
    bestSim = sim;
   }
  }
  if (best) {
   best.ids.push(p.id);
   if (words.size > 0) {
    const out = new Set(best.words);
    for (const w of words) out.add(w);
    best.words = out;
   }
   best.centroid = addToCentroid(best.centroid, vec);
  } else {
   clusters.push({
    ids: [p.id],
    centroid: vec && vec.length > 0 ? [...vec] : null,
    words: new Set(words),
   });
  }
 }

 return clusters.map((c) => ({ name: nameFor(c, byIdMap), passageIds: c.ids }));
}

// ── Naming ──

/**
 * A term-frequency label: the theme's most frequent content word, generic
 * name words excluded (a modifier is never the topic — the same rule the
 * coach's theme names run under), ties broken by length then alphabet.
 * Never a model sentence and never a trait about the person — the name is a
 * reading aid. A theme with no topical word is named by the date its
 * earliest passage was said: a fact, not a judgment.
 */
function nameFor(c: Acc, byIdMap: Map<string, NeighborhoodPassage>): string {
 const freq = new Map<string, number>();
 for (const id of c.ids) {
  const prose = byIdMap.get(id)?.prose;
  if (!prose) continue;
  for (const w of contentWordsOf(prose)) {
   if (GENERIC_NAME_WORDS.has(w)) continue;
   freq.set(w, (freq.get(w) ?? 0) + 1);
  }
 }
 let best = '';
 let bestCount = 0;
 for (const [w, n] of freq) {
  if (
   n > bestCount ||
   (n === bestCount && (w.length > best.length || (w.length === best.length && w < best)))
  ) {
   best = w;
   bestCount = n;
  }
 }
 if (best) return best.charAt(0).toUpperCase() + best.slice(1);
 const dates = c.ids
  .map((id) => byIdMap.get(id)?.captured ?? '')
  .filter((d) => d.length >= 10)
  .sort();
 const date = dates[0]?.slice(0, 10);
 return date ?? 'a theme';
}

// ── The store ──

/**
 * Write the rebuilt neighborhoods. The directory is created because the very
 * first run may precede any other wiki write; the file is derived (Q-3) and
 * the next run replaces it wholesale.
 */
export function writeNeighborhoods(root: string, store: NeighborhoodStore): void {
 const dir = join(root, 'wiki');
 mkdirSync(dir, { recursive: true });
 writeFileSync(join(dir, NEIGHBORHOODS_FILE), JSON.stringify(store) + '\n', 'utf8');
}

/**
 * Read the store, or null when it is missing or malformed. Never throws: a
 * half-written file (a crash between `writeFileSync`'s open and close) is a
 * rebuild, exactly like the wiki store's malformed-in-skipped-out rule.
 */
export function readNeighborhoods(root: string): NeighborhoodStore | null {
 let raw: string;
 try {
  raw = readFileSync(join(root, 'wiki', NEIGHBORHOODS_FILE), 'utf8');
 } catch {
  return null;
 }
 let parsed: unknown;
 try {
  parsed = JSON.parse(raw);
 } catch {
  return null;
 }
 return storeOf(parsed);
}

/** A parsed store, or null — every field checked, because a well-formed JSON object of the wrong shape is exactly what a half-finished migration leaves behind. */
function storeOf(value: unknown): NeighborhoodStore | null {
 if (typeof value !== 'object' || value === null) return null;
 const d = value as Record<string, unknown>;
 if (typeof d.rebuiltAt !== 'string') return null;
 if (d.source !== 'embedding' && d.source !== 'lexical') return null;
 const cov = d.coverage;
 if (cov !== undefined) {
  if (typeof cov !== 'object' || cov === null) return null;
  const coverage = cov as Record<string, unknown>;
  const total = coverage.total;
  const clustered = coverage.clustered;
  const skipped = coverage.skipped;
  if (typeof total !== 'number' || typeof clustered !== 'number' || typeof skipped !== 'number') return null;
  if (total < 0 || clustered < 0 || skipped < 0) return null;
 }
 if (!Array.isArray(d.clusters)) return null;
 const clusters: Neighborhood[] = [];
 for (const c of d.clusters) {
  if (typeof c !== 'object' || c === null) return null;
  const cc = c as Record<string, unknown>;
  if (typeof cc.name !== 'string') return null;
  if (!Array.isArray(cc.passageIds) || !cc.passageIds.every((x) => typeof x === 'string')) return null;
  // Explicit casts: property narrowing on a Record value resets between
  // accesses, and any[] is not string[].
  const name: string = cc.name as string;
  const passageIds: string[] = cc.passageIds as string[];
  clusters.push({ name, passageIds });
 }
 const parsed: NeighborhoodStore = { rebuiltAt: d.rebuiltAt, source: d.source, clusters };
 if (cov !== undefined) {
  const coverage = cov as Record<string, unknown>;
  parsed.coverage = { total: coverage.total as number, clustered: coverage.clustered as number, skipped: coverage.skipped as number };
 }
 return parsed;
}

// ── The docket job ──

/**
 * Rebuild the neighborhoods store from the whole corpus, and log the
 * coverage. Runs after every docket run (a run follows any harvest or import,
 * so passages that changed are always caught up — the trigger is the run).
 *
 * The cost is bounded two ways, both logged:
 *   - The job NEVER embeds. It clusters with the vectors the semantic
 *     channel primed and the full-corpus coverage job (C3) grows; a starved
 *     store falls back to lexical grouping, and the fallback is the sentence.
 *   - `neighborhoods.passageCap` bounds how many passages one run clusters;
 *     a clip emits `threshold-clipped` and rides in the coverage counts, so
 *     a clipped corpus reads as a sentence, never a silence.
 */
export async function runNeighborhoodsJob(deps: {
 vaultRoot: string;
 log: LogFn;
 snippets: NeighborhoodPassage[];
 /** The embedder's model name; absent means the embedding channel is off and the run is lexical by construction. */
 model?: string;
 /** Vector source; defaults to `vault/index/snippet-embeddings.jsonl`. Tests inject. */
 loadVectors?: () => EmbeddingRecord[];
 now?: () => string;
 /** Register override, so a test can exercise the cap without a 1001-passage corpus. */
 thresholds?: ThresholdRegister;
}): Promise<NeighborhoodsReport> {
 const now = deps.now ?? (() => new Date().toISOString());
 const thresholds = deps.thresholds ?? THRESHOLDS;
 const passages = dedupeById(deps.snippets).sort(byId);

 // The per-run cap. 0 reads as "no cap" (a misconfigured zero starves the
 // job loudly rather than quietly unbounded).
 const cap = readNumber(thresholds['neighborhoods.passageCap'], 0);
 const slice = cap > 0 && passages.length > cap ? passages.slice(0, cap) : passages;
 const clipped = passages.length - slice.length;
 if (clipped > 0) {
  shadowDecision(
   thresholds['neighborhoods.passageCap'],
   `clip ${clipped} of ${passages.length} passages — the rest wait for the next run`,
   deps.log,
   true,
  );
 }

 // Vectors: read the snippet-vector store, keeping only records still valid
 // for this passage under this model (hash + model — `cachedVector`'s rule).
 let vectors: Map<string, number[]> | undefined;
 let vectored = 0;
 if (deps.model) {
  const records = (deps.loadVectors ?? (() => fileSnippetVectorStore(deps.vaultRoot).load()))();
  const cached = new Map(records.map((r) => [r.claimId, r]));
  vectors = new Map();
  for (const p of slice) {
   const v = cachedVector(cached, deps.model, p.id, p.prose);
   if (v) {
    vectors.set(p.id, v);
    vectored++;
   }
  }
 }

 const source = neighborhoodSource(slice, vectors);
 const clusters = clusterPassages(slice, vectors ? { vectors } : {});
 writeNeighborhoods(deps.vaultRoot, {
  rebuiltAt: now(),
  source,
  coverage: { total: slice.length, clustered: slice.length, skipped: clipped },
  clusters,
 });

 const coverage = deps.model ? ` coverage=${vectored}/${slice.length}` : '';
 deps.log({
  at: now(),
  actor: 'clerk',
  kind: 'neighborhoods-built',
  detail: `source=${source}${coverage} clustered=${slice.length} skipped=${clipped} neighborhoods=${clusters.length}`,
 });
 return { source, clustered: slice.length, skipped: clipped, neighborhoods: clusters.length };
}
