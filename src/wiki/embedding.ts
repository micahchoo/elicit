/**
 * The embedding clash channel — Q-30 stage 1's third channel, Q-17's staged
 * hybrid arriving.
 *
 * **What it retrieves is ABOUTNESS (Q-52), and cosine could not do otherwise.**
 * Ticket 007's eval (`docs/eval-2026-08-02-embedding-channel.md`) settled this
 * on real data rather than on argument: rephrased oppositions score 0.429–0.729
 * and genuine paraphrases score 0.507–0.761 — one population, not two. One
 * fixture belief's nearest neighbour is the sentence asserting its OPPOSITE,
 * ahead of its own paraphrase. That is the mechanism, not the bug. Polarity is
 * judged one layer down by `judgeOpposition`, whose poles must be exact
 * substrings of the cited quotes; a channel that could see negation would
 * separate the two poles of a contradiction and never pool them. Nothing here
 * tries to make cosine polarity-aware, and nothing here should.
 *
 * ── Why `prime` exists ──
 *
 * `ClashChannel.candidates` is SYNCHRONOUS — T11 shipped it that way, and
 * `poolCandidates` depends on it being pure and clock-free. Embedding is a
 * network call. So the channel is split in two: `prime(graph)` is the async
 * half that fills the vector cache, and `candidates(graph)` is the sync half
 * that reads only what the cache already holds. A caller awaits `prime` before
 * pooling; a caller that forgets still gets a correct, quieter answer from
 * whatever vectors are on disk. That is the plan's `embeddingChannel(deps)`
 * contract with the one adjustment the tree forced — the plan's `Embed` is
 * async and the interface it must satisfy is not.
 *
 * ── The cache is derived, never truth (Q-3) ──
 *
 * Vectors live in `vault/wiki/embeddings.jsonl`, keyed by claim id plus a hash
 * of the claim body plus the embedding model's name. Deleting the file costs
 * one re-embed pass and no data; a torn line costs one vector. The model is in
 * the key because Q-17 names two candidate models at 4096 and 768 dimensions,
 * and a cosine computed across two vector spaces is a number with no meaning.
 * Q-61 already gitignores the file inside the vault.
 *
 * ── Zero chat-model calls ──
 *
 * `Embed` is injected, so every test runs on a scripted fake. The one path that
 * touches the network is `localEmbedder`, at the bottom, pointing at the local
 * Ollama endpoint and nowhere else (Q-2/ADR-0001).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ClashChannel } from './clash.js';
import type { Claim, ClaimGraph, LogFn } from './contract.js';
import { THRESHOLDS, shadowDecision, type Threshold } from './thresholds.js';

// ── The injected halves ──

/**
 * Texts in, one vector per text out, in the same order.
 *
 * The order guarantee is the whole contract. A shorter list zipped back onto
 * the inputs files one claim's vector under another claim's id, and nothing
 * downstream can tell that it is wrong — so `prime` refuses a length mismatch
 * outright rather than trusting it.
 */
export type Embed = (texts: string[]) => Promise<number[][]>;

/** One cached vector, and everything needed to know whether it is still valid. */
export type EmbeddingRecord = {
  claimId: string;
  /** Of the claim body. A rewritten body invalidates its own vector. */
  hash: string;
  /** Which embedder produced it. A different model is a different space. */
  model: string;
  vector: number[];
};

/**
 * Where the vectors sit between runs. An interface rather than a path, because
 * every test in `tests/wiki-embedding.test.ts` runs on an in-memory one and
 * `fileEmbeddingStore` is the only implementation that touches disk.
 *
 * `load` NEVER throws. A missing file, a truncated line, a line of the wrong
 * shape — each is a rebuild, and a rebuild is one embed pass. An index that can
 * crash the Clerk is an index pretending to be truth.
 */
export interface EmbeddingIndexStore {
  load(): EmbeddingRecord[];
  save(records: EmbeddingRecord[]): void;
}

/** A `ClashChannel` with the async half the interface cannot express. */
export interface EmbeddingChannel extends ClashChannel {
  prime(graph: ClaimGraph): Promise<void>;
}

export type EmbeddingDeps = {
  embed: Embed;
  /** The embedder's name, written into every record it produces. */
  model: string;
  store: EmbeddingIndexStore;
  log: LogFn;
  /** Overrides `EMBEDDING_WINDOW`. */
  window?: number;
  /** Overrides `EMBED_BUDGET_MS`. */
  budgetMs?: number;
  /**
   * Drop pairs whose two claims draw on one and the same sitting. OFF by
   * default — see `sameSitting` for what turning it on would mean.
   */
  excludeSameSitting?: boolean;
  /**
   * The gate. Defaults to the shipped register entry, and exists so a test can
   * exercise the live branch without editing `thresholds.ts`. Either way the
   * decision goes through `shadowDecision`, which is T5's invariant: no
   * threshold is read outside that module.
   */
  threshold?: Threshold;
  /** Injectable clock, for the budget only. Never used to order anything. */
  now?: () => number;
};

// ── The bounds (Q-56: a bound ships live and owes a record) ──

/**
 * How many live claims one run may embed and pair.
 *
 * This channel is quadratic and the quadratic is over 4096-dimensional
 * vectors: n claims cost n(n−1)/2 cosines of 4096 multiply-adds each. **At 400
 * that is 79,800 pairs and roughly 327 million multiply-adds per run** — under
 * two seconds — and 400 vectors is about 21 MB resident at qwen3's measured
 * 51 KB per vector. At 2,000 claims the same arithmetic is 8.2 billion
 * multiply-adds and 100 MB, which is a docket run nobody would wait for. The
 * bound is what keeps the growth from arriving silently.
 *
 * **Why a recency window rather than a refusal**, and why it also bounds the
 * embedding pass: the window is the `cap` most recently updated live claims, so
 * a claim the wiki just touched is always inside it and new material is never
 * starved. The cost is real and stated plainly — a cold claim in a wiki with
 * more than `cap` fresher ones stops being embedded and stops being paired BY
 * THIS CHANNEL. It stays reachable through the lexical channel and through the
 * referent channel, neither of which has this window, so the loss is recall on
 * one channel and not on the pool. This is the same shape T11 gave
 * `REFERENT_FANOUT_CAP`, for the same reason.
 *
 * **Why the number is here and not in `THRESHOLDS`.** It is a bound, and Q-56
 * says bounds ship LIVE from day one — a bound in shadow is not a bound. What
 * it owes instead is the record: every clip emits `clash-embedding-clipped`
 * saying how many claims fell outside. 400 is a ceiling chosen to be visible
 * when it bites on a corpus of a few hundred claims, not a measurement; the
 * clip record is what will set the real one. Moving it into the register is a
 * one-line change in a file this task does not own.
 */
export const EMBEDDING_WINDOW = 400;

/**
 * How long one `prime` may spend embedding before it gives up for this run.
 *
 * Ticket 007 measured the trap this exists for: the FIRST request against an
 * unloaded `qwen3-embedding` took **370 seconds and then returned HTTP 500**,
 * while warm it answers in 100–120 ms. Without a budget, one cold box turns a
 * background docket run into a six-minute hang per batch.
 *
 * The budget is safe to be strict about because **`prime` is resumable**: every
 * completed batch is persisted before the next one starts, so a run that stops
 * at the budget loses no work and the next run continues from the cache. And
 * the timed-out request still loads the model into VRAM, so the run after a
 * cold start is the warm one.
 */
export const EMBED_BUDGET_MS = 300_000;

/**
 * Texts per request. Small enough that a failure costs little and the budget
 * is checked often; large enough that 400 claims is 25 round trips rather than
 * 400.
 */
const EMBED_BATCH = 16;

// ── Shared helpers ──

/**
 * A claim the graph still asserts. Archived and superseded claims stay on disk
 * as evidence of a past self and are never pooled — the same rule
 * `src/wiki/clash.ts` applies, restated because its copy is module-private.
 */
function isLive(c: Claim): boolean {
  return c.archived !== true && c.supersededBy === undefined;
}

function byId(a: Claim, b: Claim): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The claim body's fingerprint. Truncated: this detects edits, not forgery. */
export function bodyHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

/**
 * Cosine similarity, or 0 when it has no meaning.
 *
 * A zero vector and a length mismatch both return 0 rather than `NaN` or a
 * partial sum. The length case is the second guard on Q-17's two models: a
 * 768-dim vector left over from `nomic-embed-text` must never score against a
 * 4096-dim one. The `model` field on each record is the first guard.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * The `cap` most recently updated live claims, returned in id order.
 *
 * Two sorts, both load-bearing: recency picks WHICH claims are in the window,
 * and id order fixes the pair sequence afterwards, so the same graph always
 * produces the same list in the same order.
 */
function windowOf(graph: ClaimGraph, cap: number): { window: Claim[]; total: number } {
  const live = graph.claims.filter(isLive);
  if (live.length <= cap) return { window: [...live].sort(byId), total: live.length };
  const kept = [...live]
    .sort((a, b) => (a.updated === b.updated ? byId(a, b) : a.updated < b.updated ? 1 : -1))
    .slice(0, cap)
    .sort(byId);
  return { window: kept, total: live.length };
}

/**
 * The sittings a claim draws on, read through its cites.
 *
 * A cite is `snippetId@version`; the snippet's `provenance.session` is the
 * sitting. A cite the graph cannot resolve contributes nothing — the set comes
 * back smaller, never wrong.
 */
function sessionsOf(claim: Claim, graph: ClaimGraph): Set<string> {
  const out = new Set<string>();
  for (const cite of claim.cites) {
    const id = cite.split('@')[0];
    if (!id) continue;
    const session = graph.snippets[id]?.provenance.session;
    if (session) out.add(session);
  }
  return out;
}

/**
 * Whether two claims are two sentences of one sitting.
 *
 * Ticket 007's finding, and the reason this predicate exists at all: on the
 * 139-snippet import the highest cosine between two snippets of the SAME
 * sitting is 0.808, and between two DIFFERENT sittings it is 0.640. Every pair
 * above 0.65 is two sentences of one essay. So at a precision-preserving
 * threshold this channel currently measures how tightly an essay stays on
 * topic, not how a belief moved across nine years — and under Q-50 two cites
 * from one sitting are one thought said twice.
 *
 * It is OFF by default, deliberately. Turning it on changes what the pool
 * MEANS, and that is a decision for the register with a shadow record behind
 * it, not a default chosen inside the channel that would implement it. Built
 * now because building it now costs little and retrofitting it costs more.
 *
 * The predicate is strict on purpose: a pair is excluded only when both claims
 * draw on exactly ONE session and it is the same one. A claim spanning two
 * sittings, or one whose cites the graph cannot resolve, is never excluded —
 * ignorance is not evidence of sameness.
 */
function sameSitting(a: Claim, b: Claim, graph: ClaimGraph): boolean {
  const sa = sessionsOf(a, graph);
  const sb = sessionsOf(b, graph);
  if (sa.size !== 1 || sb.size !== 1) return false;
  const [only] = sa;
  return only !== undefined && sb.has(only);
}

// ── The cache file ──

/** `vault/wiki/embeddings.jsonl` — one record per line, final newline. */
export function fileEmbeddingStore(vaultRoot: string): EmbeddingIndexStore {
  const path = join(vaultRoot, 'wiki', 'embeddings.jsonl');
  return {
    load(): EmbeddingRecord[] {
      let text: string;
      try {
        text = readFileSync(path, 'utf-8');
      } catch {
        // No file is the ordinary cold state, not an error: Q-3 says the index
        // is derived, so its absence costs one embed pass and nothing else.
        return [];
      }
      const out: EmbeddingRecord[] = [];
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // A torn line costs one vector, never the run.
        }
        const record = asRecord(parsed);
        if (record) out.push(record);
      }
      return out;
    },
    save(records: EmbeddingRecord[]): void {
      mkdirSync(dirname(path), { recursive: true });
      const body = records.map((r) => JSON.stringify(r)).join('\n');
      writeFileSync(path, records.length > 0 ? `${body}\n` : '', 'utf-8');
    },
  };
}

/**
 * A parsed line, or null. Every field is checked, because a well-formed JSON
 * object of the wrong shape is exactly what a half-finished format migration
 * leaves behind, and a `vector` of strings would silently make every cosine 0.
 */
function asRecord(value: unknown): EmbeddingRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.claimId !== 'string' || v.claimId === '') return null;
  if (typeof v.hash !== 'string' || typeof v.model !== 'string') return null;
  if (!Array.isArray(v.vector) || v.vector.length === 0) return null;
  if (!v.vector.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { claimId: v.claimId, hash: v.hash, model: v.model, vector: v.vector as number[] };
}

// ── The channel ──

export function embeddingChannel(deps: EmbeddingDeps): EmbeddingChannel {
  const { embed, model, store, log } = deps;
  const cap = deps.window ?? EMBEDDING_WINDOW;
  const budgetMs = deps.budgetMs ?? EMBED_BUDGET_MS;
  const threshold = deps.threshold ?? THRESHOLDS['clash.embeddingCosine'];
  const clock = deps.now ?? (() => Date.now());

  // The register's entry is a number; a boolean one would be a misconfiguration
  // and must pool NOTHING rather than everything.
  const cut = typeof threshold.value === 'number' ? threshold.value : Number.POSITIVE_INFINITY;

  /** Loaded once per instance, then kept in step with what `prime` writes. */
  let cache: Map<string, EmbeddingRecord> | undefined;
  function loaded(): Map<string, EmbeddingRecord> {
    if (!cache) {
      cache = new Map();
      for (const record of store.load()) cache.set(record.claimId, record);
    }
    return cache;
  }

  function clip(reason: string, detail: string): void {
    log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'clash-embedding-clipped',
      detail: `reason=${reason} ${detail}`,
    });
  }

  function unavailable(detail: string): void {
    log({ at: new Date().toISOString(), actor: 'clerk', kind: 'embedding-unavailable', detail });
  }

  /** A vector that is still valid for this claim under this model. */
  function vectorFor(claim: Claim): number[] | undefined {
    const record = loaded().get(claim.id);
    if (!record) return undefined;
    if (record.model !== model) return undefined;
    if (record.hash !== bodyHash(claim.body)) return undefined;
    return record.vector;
  }

  return {
    name: 'embedding',

    /**
     * Fill the cache for everything in the window that lacks a valid vector.
     *
     * **It never throws and never rejects.** An unreachable endpoint — a
     * refused connection, a timeout, a slow HTTP 500 on a cold model — logs
     * `embedding-unavailable` once and returns, keeping every batch that
     * already succeeded. The Clerk works with the embedding server switched
     * off, because it works with it switched off today.
     */
    async prime(graph: ClaimGraph): Promise<void> {
      const { window } = windowOf(graph, cap);
      const cached = loaded();
      const missing = window.filter((c) => vectorFor(c) === undefined);

      const deadline = clock() + budgetMs;
      let embedded = 0;
      let stopped: string | undefined;

      for (let i = 0; i < missing.length; i += EMBED_BATCH) {
        if (clock() >= deadline) {
          clip('budget', `budgetMs=${budgetMs} embedded=${embedded} pending=${missing.length - embedded}`);
          break;
        }
        const batch = missing.slice(i, i + EMBED_BATCH);
        let vectors: number[][];
        try {
          vectors = await embed(batch.map((c) => c.body));
        } catch (err) {
          stopped = err instanceof Error ? err.message : String(err);
          break;
        }
        if (vectors.length !== batch.length) {
          // Zipping a short list back onto the inputs would file one claim's
          // vector under another claim's id, and nothing downstream could tell.
          stopped = `expected ${batch.length} vectors, received ${vectors.length}`;
          break;
        }
        const fresh: EmbeddingRecord[] = [];
        for (const [j, claim] of batch.entries()) {
          const vector = vectors[j];
          if (!vector || vector.length === 0 || !vector.every((n) => Number.isFinite(n))) {
            stopped = `claim ${claim.id} came back without a usable vector`;
            break;
          }
          fresh.push({ claimId: claim.id, hash: bodyHash(claim.body), model, vector });
        }
        if (stopped) break;
        for (const record of fresh) cached.set(record.claimId, record);
        embedded += fresh.length;
        // Persist per batch: this is what makes prime resumable, so the budget
        // above and the cold-start failure below both cost time and never work.
        persist(graph, cached, store);
      }

      if (stopped !== undefined) {
        unavailable(`model=${model} embedded=${embedded} pending=${missing.length - embedded} error=${stopped}`);
      }
    },

    /**
     * Pairs of live claims whose bodies sit close in the vector space.
     *
     * Synchronous and cache-only, so it satisfies `ClashChannel` and stays
     * deterministic: the same graph yields the same pairs in the same order,
     * whatever order the claims arrive in. A claim with no valid vector is
     * simply absent — it is never an error and never a fabricated pair.
     *
     * Every pair that clears the cosine goes through `shadowDecision`, so while
     * Q-35 keeps the threshold in shadow this returns nothing and writes what
     * it WOULD have pooled. That record is what graduates the number.
     */
    candidates(graph: ClaimGraph): [Claim, Claim][] {
      const { window, total } = windowOf(graph, cap);
      if (window.length < total) {
        clip('window', `claims=${total} window=${cap} clipped=${total - window.length}`);
      }

      const scored: { claim: Claim; vector: number[] }[] = [];
      for (const claim of window) {
        const vector = vectorFor(claim);
        if (vector) scored.push({ claim, vector });
      }

      const out: [Claim, Claim][] = [];
      for (let i = 0; i < scored.length; i++) {
        const a = scored[i];
        if (!a) continue;
        for (let j = i + 1; j < scored.length; j++) {
          const b = scored[j];
          if (!b) continue;
          const score = cosine(a.vector, b.vector);
          if (score < cut) continue;
          if (deps.excludeSameSitting === true && sameSitting(a.claim, b.claim, graph)) continue;
          const would = `pool ${a.claim.id}+${b.claim.id} cosine=${score.toFixed(4)}`;
          if (!shadowDecision(threshold, would, log)) continue;
          out.push([a.claim, b.claim]);
        }
      }
      return out;
    },
  };
}

/**
 * Write the cache back, minus any claim the graph no longer asserts.
 *
 * Pruning is what keeps a file of 51 KB vectors from growing without end. It
 * prunes to LIVE claims: an archived claim is never paired, so its vector buys
 * nothing, and un-archiving costs one re-embed.
 */
function persist(
  graph: ClaimGraph,
  cached: Map<string, EmbeddingRecord>,
  store: EmbeddingIndexStore,
): void {
  const live = new Set(graph.claims.filter(isLive).map((c) => c.id));
  for (const id of [...cached.keys()]) if (!live.has(id)) cached.delete(id);
  store.save([...cached.values()].sort((a, b) => (a.claimId < b.claimId ? -1 : 1)));
}

// ── The one path that touches the network (Q-2 / ADR-0001) ──

/**
 * Where the embedder points, read from the environment on every call, exactly
 * as `src/llm.ts` reads its endpoint. `qwen3-embedding` is Q-17's provisional
 * default and ticket 007's eval confirmed it against `nomic-embed-text`
 * (768-dim, five times faster and five times smaller, and it never reaches a
 * cut with both non-zero recall and zero false positives). Choosing the lighter
 * model is an env var, not a code change.
 *
 * Local only. There is no hosted branch and there is no code path to add one.
 */
export function embedderConfig(): { url: string; model: string } {
  return {
    url: process.env.ELICIT_EMBED_URL ?? 'http://192.168.0.229:11434/v1/embeddings',
    model: process.env.ELICIT_EMBED_MODEL ?? 'qwen3-embedding',
  };
}

/** Per-request ceiling. See `EMBED_BUDGET_MS` for the cold-start measurement. */
export const EMBED_REQUEST_TIMEOUT_MS = 120_000;

/**
 * The real embedder. Every failure — a refused connection, a non-2xx status, a
 * body that is not what the API promises, a request that outlives its timeout —
 * throws, because `prime` reads any throw as "the server is not there" and
 * skips the channel. **Nothing here ever fabricates a vector**; a made-up
 * vector would be cached, and a cached lie is permanent.
 */
export function localEmbedder(cfg = embedderConfig()): { embed: Embed; model: string } {
  return {
    model: cfg.model,
    async embed(texts: string[]): Promise<number[][]> {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, input: texts }),
        signal: AbortSignal.timeout(EMBED_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`embeddings ${res.status} from ${cfg.model} at ${cfg.url}`);
      }
      const body: unknown = await res.json();
      const data = (body as { data?: unknown }).data;
      if (!Array.isArray(data)) throw new Error(`embeddings returned no data array`);
      // The API indexes its own results; sorting by that index rather than
      // trusting arrival order is what makes `Embed`'s order contract true.
      const rows = [...(data as { index?: number; embedding?: unknown }[])].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      );
      return rows.map((row, i) => {
        const vector = row.embedding;
        if (!Array.isArray(vector) || vector.length === 0) {
          throw new Error(`embeddings returned no vector at index ${i}`);
        }
        return vector as number[];
      });
    },
  };
}
