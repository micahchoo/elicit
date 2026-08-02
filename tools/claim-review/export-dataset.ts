// Export the claim graph as one composite record per claim, ordered for a
// diverse-first review pass (ticket 085, error-discovery method).
//
// A "composite record" is the smallest unit a human can judge a claim from:
// the Clerk's sentence, its Range, and the FULL verbatim text of every snippet
// it cites — plus what the person was asked, if anything. A reviewer who sees
// only the sentence can tell you it reads oddly; a reviewer who sees the
// sentence beside the words it came from can tell you it is wrong.
//
// This script READS the vault and never writes to it. `vault/` is its own git
// repo and the corpus is the ground truth under test.
//
// Run: npx tsx tools/claim-review/export-dataset.ts

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const REPO = join(import.meta.dirname, '..', '..');
const VAULT = join(REPO, 'vault');
const OUT = join(import.meta.dirname, 'dataset.json');

const SAMPLE_SIZE = 40;
const CLUSTERS = 10;

// ── the vault, read ──

interface Provenance {
  kind?: string;
  session?: string;
  question?: string;
  questionForm?: string;
  channel?: string;
  context?: string;
}

interface SnippetVersion {
  id: string;
  version: number;
  captured?: string;
  provenance: Provenance;
  prose: string;
}

interface ClaimRecord {
  id: string;
  claim: string;
  range: string;
  facet: string;
  status: string;
  referents: string[];
  attested: boolean;
  model?: string;
  created?: string;
  cites: string[];
  snippets: SnippetVersion[];
  unresolved: string[];
}

/** Every version file of every snippet, keyed `<id>@<v>` — the same directory
 *  walk as `vault.rebuildIndex()` and `scripts/backfill-context.ts`. */
function readSnippets(): Map<string, SnippetVersion> {
  const out = new Map<string, SnippetVersion>();
  const dir = join(VAULT, 'snippets');
  if (!existsSync(dir)) return out;
  for (const dirName of readdirSync(dir)) {
    let files: string[];
    try {
      files = readdirSync(join(dir, dirName)).filter((f) => /^v\d+\.md$/.test(f));
    } catch {
      continue; // stray file, not a snippet directory
    }
    for (const file of files) {
      const parsed = matter.read(join(dir, dirName, file));
      const data = parsed.data as { id?: string; version?: number; captured?: string; provenance?: Provenance };
      const id = data.id ?? dirName;
      const version = data.version ?? Number(file.match(/^v(\d+)\.md$/)![1]);
      out.set(`${id}@${version}`, {
        id,
        version,
        ...(data.captured !== undefined ? { captured: data.captured } : {}),
        provenance: data.provenance ?? {},
        prose: parsed.content.trim(),
      });
    }
  }
  return out;
}

function readClaims(snippets: Map<string, SnippetVersion>): ClaimRecord[] {
  const dir = join(VAULT, 'wiki', 'claims');
  const out: ClaimRecord[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const parsed = matter(readFileSync(join(dir, file), 'utf8'));
    const d = parsed.data as Record<string, unknown>;
    const cites = Array.isArray(d.cites) ? (d.cites as string[]) : [];
    const resolved: SnippetVersion[] = [];
    const unresolved: string[] = [];
    for (const ref of cites) {
      const hit = snippets.get(ref);
      if (hit) resolved.push(hit);
      else unresolved.push(ref);
    }
    out.push({
      id: String(d.id ?? file.replace(/\.md$/, '')),
      claim: parsed.content.trim(),
      range: String(d.range ?? ''),
      facet: String(d.facet ?? 'unknown'),
      status: String(d.status ?? 'unknown'),
      referents: Array.isArray(d.referents) ? (d.referents as string[]) : [],
      attested: d.attested === true,
      ...(typeof d.model === 'string' ? { model: d.model } : {}),
      ...(typeof d.created === 'string' ? { created: d.created } : {}),
      cites,
      snippets: resolved,
      unresolved,
    });
  }
  return out;
}

// ── clustering: facet, plus what the Range says ──
//
// No model calls. A Range is a short adverbial phrase ("in their academic
// research", "when exploring the platform"), so shared content words are a
// serviceable proxy for "these two claims are scoped alike". Facet carries
// half the distance because a `fact` and an `intention` over the same words
// are different kinds of claim and should not land in one cluster.

const STOPWORDS = new Set(
  ('a an the of in on at to for with by from about as is are was were be been being ' +
    'and or but if then than that this these those it its their his her they he she ' +
    'when while during over under after before since until through into out up down ' +
    'i you we my your our not no do does did have has had can could will would').split(' ')
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function distance(a: ClaimRecord, b: ClaimRecord, tok: Map<string, Set<string>>): number {
  const facetPart = a.facet === b.facet ? 0 : 1;
  const rangePart = 1 - jaccard(tok.get(a.id)!, tok.get(b.id)!);
  return 0.5 * facetPart + 0.5 * rangePart;
}

/** Farthest-first traversal: deterministic k-centers. Seed 0 is the
 *  lexicographically first id, so two runs over the same vault agree. */
function cluster(records: ClaimRecord[], k: number) {
  const tok = new Map(records.map((r) => [r.id, tokens(`${r.range} ${r.claim}`)]));
  if (records.length === 0) {
    return { seeds: [] as number[], assignment: [] as { cluster: number; toSeed: number }[] };
  }
  const seeds: number[] = [0];
  const minDist = records.map((r) => distance(r, records[0]!, tok));
  while (seeds.length < Math.min(k, records.length)) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < records.length; i++) {
      if (seeds.includes(i)) continue;
      if (minDist[i]! > bestD) {
        bestD = minDist[i]!;
        best = i;
      }
    }
    if (best < 0) break;
    seeds.push(best);
    for (let i = 0; i < records.length; i++) {
      minDist[i] = Math.min(minDist[i]!, distance(records[i]!, records[best]!, tok));
    }
  }

  const assignment = records.map((r) => {
    let best = 0;
    let bestD = Infinity;
    seeds.forEach((s, ci) => {
      const d = distance(r, records[s]!, tok);
      if (d < bestD) {
        bestD = d;
        best = ci;
      }
    });
    return { cluster: best, toSeed: bestD };
  });
  return { seeds, assignment };
}

/** Deterministic PRNG so the "random" third of the sample is reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Order the whole corpus so the first `SAMPLE_SIZE` are maximally unalike.
 *
 * Two thirds are cluster representatives taken round-robin — one from each
 * cluster before a second from any — so the reviewer crosses every region of
 * the corpus inside the first ten records. One third is drawn at random,
 * because the clustering only knows about facet and Range wording and the
 * failure we are hunting may not vary along either. The remainder follows in
 * representative order; nothing is dropped.
 */
function order(records: ClaimRecord[], assignment: { cluster: number; toSeed: number }[]) {
  const byCluster = new Map<number, number[]>();
  assignment.forEach((a, i) => {
    if (!byCluster.has(a.cluster)) byCluster.set(a.cluster, []);
    byCluster.get(a.cluster)!.push(i);
  });
  for (const members of byCluster.values()) {
    members.sort((x, y) => assignment[x]!.toSeed - assignment[y]!.toSeed);
  }

  const queues = [...byCluster.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([, members]) => members.slice());
  const reps: number[] = [];
  while (reps.length < records.length) {
    let moved = false;
    for (const q of queues) {
      const next = q.shift();
      if (next !== undefined) {
        reps.push(next);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const rand = mulberry32(0x085);
  const shuffled = records.map((_, i) => i);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  const used = new Set<number>();
  const sequence: number[] = [];
  const take = (pool: number[]) => {
    while (pool.length) {
      const next = pool.shift()!;
      if (!used.has(next)) {
        used.add(next);
        sequence.push(next);
        return;
      }
    }
  };
  const repPool = reps.slice();
  const randPool = shuffled.slice();
  while (sequence.length < Math.min(SAMPLE_SIZE, records.length)) {
    take(repPool);
    if (sequence.length >= SAMPLE_SIZE) break;
    take(repPool);
    if (sequence.length >= SAMPLE_SIZE) break;
    take(randPool);
  }
  while (repPool.length) take(repPool);
  return sequence;
}

// ── run ──

const snippets = readSnippets();
const claims = readClaims(snippets);
const { seeds, assignment } = cluster(claims, CLUSTERS);
const sequence = order(claims, assignment);

const records = sequence.map((idx, position) => ({
  ...claims[idx]!,
  cluster: assignment[idx]!.cluster,
  isSeed: seeds.includes(idx),
  position,
  inSample: position < SAMPLE_SIZE,
}));

const dataset = {
  generated: new Date().toISOString(),
  claimCount: claims.length,
  snippetVersionCount: snippets.size,
  sampleSize: Math.min(SAMPLE_SIZE, claims.length),
  clusterCount: seeds.length,
  unresolvedCites: claims.flatMap((c) => c.unresolved.map((u) => ({ claim: c.id, cite: u }))),
  records,
};

writeFileSync(OUT, `${JSON.stringify(dataset, null, 2)}\n`);

const facets = new Map<string, number>();
for (const r of records) facets.set(r.facet, (facets.get(r.facet) ?? 0) + 1);
const clusterSizes = new Map<number, number>();
for (const r of records) clusterSizes.set(r.cluster, (clusterSizes.get(r.cluster) ?? 0) + 1);

console.log(`claims            ${dataset.claimCount}`);
console.log(`snippet versions  ${dataset.snippetVersionCount}`);
console.log(`clusters          ${dataset.clusterCount} (sizes ${[...clusterSizes.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n).join(' ')})`);
console.log(`facets            ${[...facets].map(([f, n]) => `${f}:${n}`).join(' ')}`);
console.log(`sample            first ${dataset.sampleSize} of ${dataset.claimCount}`);
console.log(`unresolved cites  ${dataset.unresolvedCites.length}`);
for (const u of dataset.unresolvedCites) console.log(`  ${u.claim} -> ${u.cite}`);
const noSnippet = records.filter((r) => r.snippets.length === 0);
console.log(`claims with no resolved snippet  ${noSnippet.length}`);
for (const r of noSnippet) console.log(`  ${r.id}`);
console.log(`wrote ${OUT}`);
