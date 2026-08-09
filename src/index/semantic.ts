/**
 * The semantic resonance channel — Q-17's staged hybrid arriving on the surface
 * the person actually meets.
 *
 * `resonate()` in `./lexical.ts` is a 3-consecutive-word exact-match index. Its
 * measured paraphrase recall is **0/8** (`tests/resonance-paraphrase.test.ts`),
 * and it feeds resonance, juxtaposition and every composed opener in a sitting.
 * People re-say themselves; they do not quote themselves. This module is the
 * second channel Q-17 stages in beside it.
 *
 * ── It RANKS. It does not threshold. ──
 *
 * Ticket 007's eval measured both instruments on the same fixture and the same
 * corpus (`docs/eval-2026-08-02-embedding-channel.md`):
 *
 * | instrument | recall |
 * |---|---|
 * | best precision-preserving absolute cut (0.70) | 3/8 |
 * | nearest neighbour | **7/8** |
 *
 * Four reasons the rank is the right instrument HERE, and the fourth is the one
 * that makes it structural rather than merely better:
 *
 * 1. **It recovers more than twice the recall** on the only measurement anyone
 *    has (AUC 0.952 — the ordering is good even where the cut is not).
 * 2. **An absolute cosine does not travel.** The eval measured two backgrounds
 *    at two different heights — mean 0.454 on the fixture, 0.353 on the corpus —
 *    from a genre difference, not a length artefact (cosine↔length correlates
 *    at 0.032). 0.70 is the 100th percentile of one and the 99.94th of the
 *    other. A rank is corpus-relative by construction.
 * 3. **The cut is not stable to the third decimal.** The eval's addendum: one
 *    text scored 0.7606 in a batch of 8 and 0.7631 in a batch of 16. A pair
 *    within ~0.003 of a cut flips between runs on batch composition alone. A
 *    rank is invariant to that wobble.
 * 4. **Every caller of `resonate()` already wants the best few, not everything
 *    above a line.** `src/server.ts` takes `hits[0]`. `src/elicitor/elicitor.ts`
 *    walks the list in order and stops at the first that composes.
 *    `src/clerk/wiki-jobs.ts` takes the first three. Not one of them consumes
 *    "everything admitted". A resonance channel is exactly the place where
 *    top-N-by-rank is the natural shape, because the caller's own `k` IS the
 *    bound — which is why this channel needs no register entry to act, and the
 *    claim-level channel (ticket 064) does.
 *
 * What ticket 064 inherits: at the claim level the pool is not "the best few
 * for one query" but "every pair worth judging", and a quota bounds it (Q-56).
 * Top-N-by-rank there means **top-N pairs by cosine, quota-bounded**, replacing
 * `clash.embeddingCosine` as the selection instrument rather than re-tuning it.
 * The eval already sized it: at 0.60 the pool is 47 pairs over 54 snippets with
 * no god-node, which a top-N of ~10 would trim to the ten most similar without
 * caring what the background height of that corpus happens to be.
 *
 * ── A floor still exists, and it is SHADOW (Q-35) ──
 *
 * Ranking alone always returns something, including for an utterance with no
 * relative in the vault. So there is a floor — but a floor under a ranker has a
 * different job from a cut: it drops obvious noise, it does not select. Its
 * value is 0.50, measured rather than guessed: it sits below every true pair the
 * eval found (`posMin` 0.507) and above the bottom of the non-pair distribution
 * (0.330, mean 0.454), so on the measured fixture it costs ZERO recall and
 * still removes a tail. Q-35 keeps it in shadow: it logs the hits it would have
 * dropped and drops nothing, and the record is what graduates it.
 *
 * ── The opposite pole is a FEATURE here, and the channel could not suppress it
 * even if it were not ──
 *
 * The eval settled that cosine cannot tell "the same belief restated" from "the
 * opposite belief restated" — rephrased oppositions score 0.429–0.729, genuine
 * paraphrases 0.507–0.761, one population. On the shared fixture the
 * social-hedging belief's nearest neighbour is not its own paraphrase (0.507)
 * but the distractor asserting its OPPOSITE (0.697).
 *
 * **This channel surfaces that, deliberately.** Three reasons:
 *
 * 1. A channel that avoided opposites would need an organ it does not have.
 *    Any filter here would be a guess wearing the clothes of a policy. Q-52
 *    already rules that aboutness retrieval is the mechanism and polarity is
 *    judged one layer down.
 * 2. Surfacing the pole a person is now contradicting is the most interesting
 *    juxtaposition the system can offer — Q-15's "met as material, never
 *    accusation". Suppressing it would mean the system found the most
 *    informative thing in the vault and threw it away.
 * 3. The hazard the other way — the system appearing to AGREE with something it
 *    has misread — is a framing failure, and framing does not live here. What
 *    retrieval owes is to make the agreement claim unavailable, and this module
 *    does that structurally: see `SemanticHit`.
 *
 * ── `SemanticHit` has no `sharedPhrase`, and that absence is the guarantee ──
 *
 * `ResonanceHit.sharedPhrase` is an exact substring of BOTH the turn and the
 * snippet, and `src/clerk/composed.ts` requires the composed question to
 * contain it verbatim — that is Q-12 enforced by code. A semantic hit has no
 * such substring; there is no verbatim run of three words in common, which is
 * the whole definition of the fixture. So this type omits the field rather than
 * filling it with the snippet's own words, which would let a composer write
 * `"you said <phrase> before"` about words the person did not just say.
 *
 * The omission is load-bearing at the type level: `composeJuxtaposition(text,
 * hit, complete)` does not accept a `SemanticHit`, and cannot be made to
 * without someone deciding, in the open, what it may quote.
 * `tests/semantic-resonance.test.ts` holds that with a `@ts-expect-error`.
 *
 * ── The cross-sitting ceiling does not bite this consumer ──
 *
 * The eval's sharpest finding about the clash channel — every corpus pair above
 * 0.640 is two sentences of ONE essay, so at a precision-preserving threshold
 * that channel measures how tightly an essay stays on topic — is a property of
 * pairing two STORED snippets. Here one side of every pair is the utterance the
 * person just made, in today's sitting. Every hit is cross-sitting by
 * construction. There is nothing for `excludeSameSitting` to do.
 *
 * ── What is reused from T18, and the one thing that could not be ──
 *
 * `Embed`, `EmbeddingRecord`, `EmbeddingIndexStore`, `cosine`, `asRecord`,
 * `cachedVector` and `embedBatches` are imported from `src/wiki/embedding.ts`
 * unchanged. One seam, one cache format, one endpoint, one model, one hash — so
 * a text embedded by either channel hashes and scores identically.
 *
 * What could not be shared is the FILE. T18's `persist` prunes every record
 * whose id is not a live CLAIM; pointing this channel at
 * `vault/wiki/embeddings.jsonl` would make the first Clerk docket run delete
 * every snippet vector, and the first `prime` here delete every claim vector.
 * Two keyspaces cannot share one pruned file. So the records are the same
 * shape, in `vault/index/snippet-embeddings.jsonl`, where `claimId` holds the
 * id of the thing embedded — a claim there, a snippet here. Derived and
 * rebuildable (Q-3), and `vault/.gitignore` already ignores `/index/`.
 *
 * ── Zero chat-model calls, one network path ──
 *
 * `Embed` is injected, so every test runs on a scripted fake. The only path
 * that touches the network is T18's `localEmbedder`, pointing at the local
 * Ollama endpoint and nowhere else (Q-2 / ADR-0001).
 */

import { join } from 'node:path';

import {
 asRecord,
 cachedVector,
 cosine,
 coverageQuota,
 embedBatches,
 pruneCache,
 vectorStoreFile,
 type Embed,
 type EmbeddingIndexStore,
 type EmbeddingRecord,
} from '../wiki/embedding.js';
import { THRESHOLDS, readNumber, shadowDecision } from '../wiki/thresholds.js'
import type { Threshold, ThresholdLogFn } from '../domain/thresholds.js';
import type { LexicalIndex, ResonanceHit, Snippet } from '../types.js';
import { resonate } from './lexical.js';

// ── What a semantic hit is, and what it deliberately is not ──

/**
 * One ranked neighbour of the query text.
 *
 * `rank` is 1-based and is the field a caller should reason about; `score` is
 * the raw cosine, carried for the record and for the shadow floor, and is NOT
 * comparable across corpora (see the module note). There is no `sharedPhrase`,
 * on purpose — nothing verbatim is shared, and a field claiming otherwise is
 * how a composer ends up quoting the person's past words back as if they had
 * just said them.
 */
export type SemanticHit = {
 snippetId: string;
 version: number;
 /** Raw cosine. Ordering is the signal; the absolute value is not portable. */
 score: number;
 /** 1-based position in this query's returned list. */
 rank: number;
 snippetText: string;
};

/**
 * A hit from either channel, tagged with which one found it.
 *
 * The tag is not decoration. Only the lexical arm carries `sharedPhrase`, so a
 * consumer that needs a verbatim quote (Q-12) must narrow to `'lexical'` and
 * the compiler will not let it forget.
 */
export type HybridHit =
 | ({ channel: 'lexical' } & ResonanceHit)
 | ({ channel: 'semantic' } & SemanticHit);

/** Words of a snippet a semantic juxtaposition may quote — see `quotablePhrase`. */
const QUOTE_WORDS = 4;

/**
 * The verbatim run of a snippet's own words that a semantic juxtaposition may
 * quote (ticket 068's ruling).
 *
 * `SemanticHit` deliberately carries no `sharedPhrase`: nothing verbatim is
 * shared with the turn, and a field claiming otherwise is how a composer ends
 * up quoting the person's past words back as if they had just said them. But
 * the composed question still has to quote SOMETHING verbatim — Q-12 is
 * enforced in code. This is the answer the ruling chose: the snippet's own
 * prose, framed then-versus-now. Every quoted word is the person's; the
 * framing, not an echo, is what justifies the connection.
 *
 * The first `QUOTE_WORDS` whitespace-separated tokens, edge punctuation
 * trimmed — the same shape the lexical channel treats as quotable, which
 * requires a phrase of at least three words. The return is always an exact
 * substring of `snippetText`: never an invented phrase.
 */
export function quotablePhrase(snippetText: string): string {
 const words = snippetText.split(/\s+/).filter((w) => w.length > 0);
 let phrase = words.slice(0, QUOTE_WORDS).join(' ');
 phrase = phrase.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
 return phrase.length > 0 ? phrase : snippetText.trim();
}

// ── The bounds (Q-56: a bound ships LIVE and owes a clip record) ──

/**
 * Three of the bounds this channel acts under — `resonance.semanticFloor`,
 * `resonance.primeBudgetMs`, `resonance.queryBudgetMs` — are declared in
 * `src/wiki/thresholds.ts` (Q-35/Q-56: one declaration site, no threshold
 * value read except through `THRESHOLDS`). The prime CAP's default has been
 * corpus-sized since Batch C3 (§12's debt: quotas sized to the real corpus):
 * `coverageQuota(corpus.length)` from `src/wiki/embedding.ts` — a ratio over
 * the corpus, never a fixed ceiling that starves a growing vault.
 * `resonance.primeCap` remains the explicit-override seam
 * (`SemanticDeps.primeCap`) and the record of the bound's liveness; a
 * clipped explicit cap still emits threshold-clipped through
 * `shadowDecision`, exactly like every other bound in this module.
 *
 * The prime cap is per-RUN, never a recency window: a window would make the
 * channel structurally unable to surface the 2017-2026 material Q-18
 * stratifies by age, and `prime` is resumable — every completed batch
 * persists before the next starts, so a clipped run loses no work.
 */

/** Default `k`, matching `resonate()`'s so the two channels agree by default. */
export const TOP_N = 5;

// ── The cache file ──

/**
 * `vault/index/snippet-embeddings.jsonl` — T18's record shape, T18's line
 * format, a second file for a second keyspace. See the module note for why one
 * file is impossible.
 *
 * The file mechanics — one record per line, final newline, `load` NEVER
 * throwing, a torn line costing one vector — are `vectorStoreFile` in
 * `src/wiki/embedding.ts`, shared with the wiki channel. Q-3: the index is
 * derived, so its absence costs one embed pass and nothing else, and it can
 * never be the reason a sitting fails.
 */
export function fileSnippetVectorStore(vaultRoot: string): EmbeddingIndexStore {
 return vectorStoreFile(join(vaultRoot, 'index', 'snippet-embeddings.jsonl'), asRecord);
}

// ── The channel ──

export type SemanticDeps = {
 embed: Embed;
 /** The embedder's name, written into every record it produces. */
 model: string;
 store: EmbeddingIndexStore;
 log: ThresholdLogFn;
 /** Overrides `THRESHOLDS['resonance.primeCap']`. */
 primeCap?: number;
 /** Overrides `THRESHOLDS['resonance.primeBudgetMs']`. */
 primeBudgetMs?: number;
 /** Overrides `THRESHOLDS['resonance.queryBudgetMs']`. */
 queryBudgetMs?: number;
 /** Overrides `THRESHOLDS['resonance.semanticFloor']`, so a test can exercise the live branch. */
 floor?: Threshold;
 /** Injectable clock, for the prime budget only. Never used to order anything. */
 now?: () => number;
};

export interface SemanticIndex {
 /**
  * Fill the vector cache. Async, batched, budgeted, resumable, and it NEVER
  * throws or rejects — an unreachable endpoint logs once and returns.
  */
 prime(): Promise<void>;
 /**
  * The top `k` snippets by cosine to `text`, ranked. Async because the query
  * itself must be embedded, and that is a network call. Returns `[]` rather
  * than throwing when the endpoint is unreachable, slow, or the cache is cold.
  */
 resonate(text: string, k?: number): Promise<SemanticHit[]>;
 /** How many snippets currently hold a usable vector. Observability, not state. */
 vectored(): number;
}

/**
 * Build the channel over a corpus.
 *
 * **Build it from the WHOLE corpus.** `prime` prunes the cache to the ids it
 * was given, exactly as T18's does, so an index built from a subset would
 * delete every other snippet's vector on its first pass. That is the same
 * contract T18 has and it is stated here because the mistake is cheap to make.
 */
export function buildSemanticIndex(snippets: Snippet[], deps: SemanticDeps): SemanticIndex {
 const { embed, model, store, log } = deps;
 const primeBudgetMs = deps.primeBudgetMs ?? readNumber(THRESHOLDS['resonance.primeBudgetMs'], 0);
 const queryBudgetMs = deps.queryBudgetMs ?? readNumber(THRESHOLDS['resonance.queryBudgetMs'], 0);
 const floor = deps.floor ?? THRESHOLDS['resonance.semanticFloor'];
 const clock = deps.now ?? (() => Date.now());

 // A boolean floor would be a misconfiguration. It must drop NOTHING rather
 // than everything: this channel's job is recall, and a silent total blackout
 // is the failure mode ticket 053 exists to end.
 const floorValue = readNumber(floor, Number.NEGATIVE_INFINITY);

 /**
  * The corpus as given, first occurrence of an id wins. Deliberately NOT
  * sorted here: ordering the corpus by id would make `resonate`'s tie-break
  * unobservable, and an invariant that no test can see is an invariant that
  * quietly stops holding. `prime` sorts its own copy, where the order decides
  * which snippets a clipped run embeds first and therefore has to be fixed.
  */
 const corpus: Snippet[] = [];
 const seen = new Set<string>();
 for (const s of snippets) {
  if (seen.has(s.id)) continue;
  seen.add(s.id);
  corpus.push(s);
 }
 const byId = (a: Snippet, b: Snippet): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

 // The per-run prime quota, sized to the real corpus (§12, Batch C3): the
 // whole corpus by default (EMBED_COVERAGE_RATIO), or an explicit
 // `primeCap` override. Placed after the corpus loop because the default is
 // a function of the corpus.
 const cap = deps.primeCap ?? coverageQuota(corpus.length);

 let cache: Map<string, EmbeddingRecord> | undefined;
 function loaded(): Map<string, EmbeddingRecord> {
  if (!cache) {
   cache = new Map();
   for (const record of store.load()) cache.set(record.claimId, record);
  }
  return cache;
 }

 /** How many corpus snippets currently hold a usable vector (observability). */
 function countVectored(): number {
  let n = 0;
  for (const snippet of corpus) if (cachedVector(loaded(), model, snippet.id, snippet.prose) !== undefined) n++;
  return n;
 }

 function unavailable(detail: string): void {
  log({ at: new Date().toISOString(), actor: 'clerk', kind: 'embedding-unavailable', detail });
 }


 /**
  * The query's vector, or undefined — never a throw, never a fabrication.
  *
  * The budget is a race rather than an abort because `Embed` is an injected
  * function with no cancellation in its contract. The losing request keeps
  * running and, on a cold model, finishes the job of loading the weights; its
  * rejection is caught here so it cannot surface as an unhandled rejection.
  */
 async function embedQuery(text: string): Promise<number[] | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'expired'>((resolve) => {
   timer = setTimeout(() => resolve('expired'), queryBudgetMs);
  });
  const call = embed([text]).then(
   (vectors) => ({ vectors }),
   (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
  );

  const outcome = await Promise.race([call, expired]);
  if (timer !== undefined) clearTimeout(timer);

  if (outcome === 'expired') {
   shadowDecision(
    THRESHOLDS['resonance.queryBudgetMs'],
    `stop waiting for the query vector after ${queryBudgetMs}ms and return no semantic hits`,
    log,
    true,
   );
   return undefined;
  }
  if ('error' in outcome) {
   unavailable(`model=${model} subject=query embedded=0 pending=1 error=${outcome.error}`);
   return undefined;
  }
  const vector = outcome.vectors[0];
  if (
   outcome.vectors.length !== 1 ||
   !vector ||
   vector.length === 0 ||
   !vector.every((n) => Number.isFinite(n))
  ) {
   unavailable(
    `model=${model} subject=query embedded=0 pending=1 error=the query came back without a usable vector`,
   );
   return undefined;
  }
  return vector;
 }

 return {
  async prime(): Promise<void> {
   const cached = loaded();
   const missing = [...corpus].sort(byId).filter((s) => cachedVector(loaded(), model, s.id, s.prose) === undefined);

   let todo = missing;
   if (todo.length > cap) {
    shadowDecision(
     THRESHOLDS['resonance.primeCap'],
     `embed ${missing.length} snippets in one run; ${missing.length - cap} wait for the next`,
     log,
     true,
    );
    todo = todo.slice(0, cap);
   }

   // The §12 coverage sentence (Batch C3): standing vector coverage of the
   // passage keyspace after this prime, with the gap named — a starved run
   // is a sentence on the activity log, never a silence.
   const total = corpus.length;
   const coveredBefore = countVectored();

   await embedBatches({
    items: todo.map((s) => ({ id: s.id, body: s.prose })),
    embed,
    model,
    budgetMs: primeBudgetMs,
    clock,
    log,
    cached,
    subject: 'snippet',
    noun: 'snippet',
    onBudgetExceeded: (embedded, pending) =>
     shadowDecision(
      THRESHOLDS['resonance.primeBudgetMs'],
      `stop embedding: ${embedded} done, ${pending} still waiting`,
      log,
      true,
     ),
    persistBatch: () => persist(seen, cached, store),
   });

   const covered = countVectored();
   log({
    at: new Date().toISOString(),
    actor: 'clerk',
    kind: 'embedding-coverage',
    detail: `noun=passage covered=${covered} total=${total} fresh=${covered - coveredBefore} unembedded=${total - covered}`,
   });
  },

  async resonate(text: string, k: number = TOP_N): Promise<SemanticHit[]> {
   if (k <= 0) return [];
   if (text.trim() === '') return [];

   const scorable: { snippet: Snippet; vector: number[] }[] = [];
   for (const snippet of corpus) {
    const vector = cachedVector(loaded(), model, snippet.id, snippet.prose);
    if (vector) scorable.push({ snippet, vector });
   }
   if (scorable.length === 0) return [];

   const query = await embedQuery(text);
   if (!query) return [];

   const scored = scorable
    .map(({ snippet, vector }) => ({ snippet, score: cosine(query, vector) }))
    // Rank descending, then by id — so a tie is broken by something stable
    // rather than by whatever order the corpus happened to be read in.
    .sort((a, b) =>
     b.score !== a.score
      ? b.score - a.score
      : a.snippet.id < b.snippet.id
       ? -1
       : a.snippet.id > b.snippet.id
        ? 1
        : 0,
    )
    .slice(0, k);

   // The floor, in shadow (Q-35). One line per query, and only when it would
   // have changed something — an every-turn record would drown the feed the
   // shadow evidence has to be read from.
   const below = scored.filter((s) => s.score < floorValue);
   let kept = scored;
   if (below.length > 0) {
    const worst = below.map((s) => `${s.snippet.id}@${s.score.toFixed(4)}`).join(',');
    if (
     shadowDecision(
      floor,
      `drop ${below.length} of ${scored.length} ranked hits below ${floorValue}: ${worst}`,
      log,
     )
    ) {
     kept = scored.filter((s) => s.score >= floorValue);
    }
   }

   return kept.map(({ snippet, score }, i) => ({
    snippetId: snippet.id,
    version: snippet.version,
    score,
    rank: i + 1,
    snippetText: snippet.prose,
   }));
  },

  vectored(): number {
   return countVectored();
  },
 };
}

/**
 * Write the cache back, minus any id the corpus no longer holds.
 *
 * Pruning is what keeps a file of 51 KB vectors from growing without end: a
 * deleted snippet's vector buys nothing, and re-adding one costs one re-embed.
 * The delete-and-save is shared `pruneCache`; the only channel-specific part
 * is WHICH ids are kept.
 */
function persist(
 ids: Set<string>,
 cached: Map<string, EmbeddingRecord>,
 store: EmbeddingIndexStore,
): void {
 pruneCache(cached, ids, store);
}

// ── The §12 full-corpus coverage job (Batch C3) ──

/**
 * Embed every passage missing a vector, as a docket job — §12's debt that
 * full-corpus coverage is a scheduled thing, never the boot prime's
 * one-time courtesy.
 *
 * The boot-built channel captures its corpus at boot; this job rebuilds the
 * channel over the CURRENT corpus every run, so a snippet harvested since
 * boot joins the coverage pass. The vectors persist in the store across
 * runs (Q-3: derived and rebuildable — a deleted store costs one pass), and
 * the prime itself emits the coverage sentence (`embedding-coverage`,
 * noun=passage). The per-run quota is the corpus-sized default
 * (`coverageQuota`), so a starved run means the budget or the embedder
 * stopped it — and the sentence says how many passages are still
 * unembedded. Zero chat-model calls: the only network path is the injected
 * `embed`.
 */
export async function runCoverageEmbedding(deps: {
 /** The CURRENT corpus, one entry per passage. */
 corpus: Snippet[];
 embed: Embed;
 model: string;
 store: EmbeddingIndexStore;
 log: ThresholdLogFn;
 /** Overrides `THRESHOLDS['resonance.primeBudgetMs']` for tests. */
 budgetMs?: number;
 /** Injectable clock, for the prime budget only. */
 now?: () => number;
}): Promise<{ covered: number; total: number; fresh: number }> {
 const index = buildSemanticIndex(deps.corpus, {
  embed: deps.embed,
  model: deps.model,
  store: deps.store,
  log: deps.log,
  ...(deps.budgetMs !== undefined ? { primeBudgetMs: deps.budgetMs } : {}),
  ...(deps.now !== undefined ? { now: deps.now } : {}),
 });
 const before = index.vectored();
 await index.prime();
 const covered = index.vectored();
 return { covered, total: deps.corpus.length, fresh: covered - before };
}

// ── The hybrid entry point (Q-17's staged hybrid, both stages) ──

/**
 * Both channels, one list — the entry point `tests/resonance-paraphrase.test.ts`
 * names in its "when the embedding channel ships" note.
 *
 * **Lexical first, always, and then semantic fills to `k`.** Not because
 * lexical scores better — it scores 0/8 where this scores 7/8 by rank — but
 * because when it DOES fire it carries a verbatim shared phrase, and a
 * quotable hit is strictly more useful to every downstream composer than an
 * unquotable one (Q-17: "phrase-echo, explainable, quotable" ships first). The
 * lexical channel is silent on most turns; the semantic channel is what stands
 * in that silence.
 *
 * A snippet already returned by lexical is not returned again by semantic: the
 * quotable hit for a snippet dominates the unquotable one for the same snippet.
 *
 * `semantic` is optional and `undefined` is the ordinary cold state — no
 * endpoint, no cache, no channel — in which this degrades exactly to
 * `resonate()`. That is the same shape T18 gave the Clerk: the system works
 * with the embedding server switched off, because it works with it switched off
 * today.
 */
export async function resonateHybrid(
 lexical: LexicalIndex,
 semantic: SemanticIndex | undefined,
 text: string,
 k: number = TOP_N,
): Promise<HybridHit[]> {
 const out: HybridHit[] = [];
 const taken = new Set<string>();

 for (const hit of resonate(lexical, text, k)) {
  if (taken.has(hit.snippetId)) continue;
  taken.add(hit.snippetId);
  out.push({ channel: 'lexical', ...hit });
 }
 if (out.length >= k || !semantic) return out.slice(0, k);

 for (const hit of await semantic.resonate(text, k)) {
  if (taken.has(hit.snippetId)) continue;
  taken.add(hit.snippetId);
  out.push({ channel: 'semantic', ...hit });
  if (out.length >= k) break;
 }
 return out;
}
