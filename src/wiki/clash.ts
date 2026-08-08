/**
 * The clash channels — Q-30 stage 1, the pool of pairs worth a judgment.
 *
 * **What a channel retrieves is ABOUTNESS, not polarity (Q-52).** Lexical
 * (shared phrase), referent (shared registry entity) and the semantic channel
 * that joins them later all answer one question: are these two claims about the
 * same thing. None of them can see negation, and none of them is asked to.
 * Polarity is judged exactly one layer down, by `judgeOpposition` in
 * `src/clerk/contradiction.ts`, whose poles must be exact substrings of the
 * cited quotes or the candidate drops.
 *
 * That is a design, not a gap. "Estimates are for coordination" and "estimates
 * are NOT for coordination" are near-neighbours under every retrieval here, and
 * a channel that COULD see the negation would separate the two poles of a
 * contradiction and never pool them. Negation-blindness is the mechanism.
 *
 * What the pool owes in exchange is a record of itself. An aboutness-only pool
 * spends a bounded judgment quota on pairs that mostly agree, and eval finding
 * #8's lesson (ticket 036) is that "the pool was empty", "the pool was full of
 * agreement" and "no contradictions exist" must never render alike. So
 * `poolCandidates` returns its size, its per-channel contribution, what the
 * anti-repetition filter refused and what it re-proposed, and it emits
 * `clash-checked` on EVERY run including the zero one.
 *
 * **Zero model calls, and nothing here can make one.** No function in this file
 * takes a model handle — there is no such parameter in any signature below —
 * this module imports nothing from `src/llm.ts`, and `tests/wiki-clash.test.ts`
 * reads the source and holds both shut, including the name of the handle type.
 * A channel that wanted a model would not be a channel; it would be the
 * judgment.
 *
 * ── Extension point ──
 *
 * A new channel is one more `ClashChannel` in the array the caller passes to
 * `poolCandidates`. It needs a name from `ClashChannelName` (closed on purpose:
 * `WikiReport.candidates` is keyed by it and a channel nobody enumerated is a
 * count nobody can read) and a `candidates(graph)` that returns pairs. This file
 * imports nothing from any channel it does not own and takes no parameter for
 * one — a stub is worse than an absence.
 *
 * ── One number this file deliberately does not restate ──
 *
 * `THRESHOLDS['clash.lexicalMinPhrase']` is 3, and `src/index/lexical.ts`
 * separately hardcodes 3 in five places: `buildIndex`'s trigram stride
 * (`toks.length - 3`), `resonate`'s two query guards (`queryTokens.length < 3`,
 * `queryTokens.length - 3`), `resonate`'s shared-phrase floor
 * (`phraseTokens.length < 3`) and `extractSharedPhrase`'s trim bound
 * (`right - left >= 3`). Unifying them means editing that file, which this slice
 * declares read-only for every task. So this module adds NO sixth copy: it calls
 * `resonate` and inherits the shipped floor rather than re-deriving it. The
 * register entry is pinned to the shipped behaviour by a test in
 * `tests/wiki-clash.test.ts` instead — a two-word shared phrase pools nothing, a
 * three-word one pools a pair — so a drift between the number and the index
 * fails a test rather than passing silently.
 */

import { buildIndex, resonate } from '../index/lexical.js';
import type { Provenance, Snippet } from '../types.js';
import type {
 Claim,
 ClaimGraph,
 ClaimStore,
 ClashCandidate,
 ClashChannelName,
 LogFn,
 Registry,
} from './contract.js';
import { shadowDecision } from './thresholds.js'
import { sittingsOfCites } from './status.js';
import type { Threshold } from '../domain/thresholds.js';

// ── The interface every channel implements ──

/**
 * One way of proposing that two claims are about the same thing.
 *
 * `name` is the closed `ClashChannelName` rather than a bare string, because
 * the name is carried onto the `ClashCandidate` record as its provenance. A
 * string here would mean a cast there, and a cast on a provenance field is how
 * a fabricated provenance gets written.
 *
 * `candidates` returns its pairs in the channel's own RANK order, best first
 * (Q-65, ticket 083). The pool preserves that order across the union, and the
 * judgment quota cuts the ordered result to its top-N. A channel must
 * therefore be deterministic — the same graph yields the same order — and
 * TOTAL: no pair may be left to iteration order, or a quota boundary would
 * decide what gets judged by accident.
 */
export interface ClashChannel {
 readonly name: ClashChannelName;
 candidates(graph: ClaimGraph): [Claim, Claim][];
}

/**
 * One pooled pair, tagged with the channel that found it.
 *
 * `attempts` is the value the `ClashCandidate` record must be born with, and it
 * is here rather than defaulted downstream because Q-53's cap is only real if
 * the second attempt is *known to be* a second attempt. A caller that wrote
 * `attempts: 1` on every record would re-propose an expired pair forever. The
 * type is `1 | 2` and not `number` for the same reason: there is no third
 * attempt to write.
 */
export type PooledPair = {
 pair: [Claim, Claim];
 channel: ClashChannelName;
 attempts: 1 | 2;
 /**
  * Whether the pair joins two sittings — Q-65's ordering key and the per-pair
  * shadow field ticket 007's watch-item asks for. Computed by the pool from
  * the graph via `!sameSitting(a, b, graph)`, never by the channel: a
  * cross-sitting pair ranks above a same-sitting one, and the record must
  * say which it was.
  */
 joinsTwoSittings: boolean;
};

/**
 * The pool, with its own measurements attached (Q-52, ticket 059).
 *
 * `perChannel` counts what each channel produced BEFORE the union, and holds a
 * key for every channel passed in, including the ones that produced nothing. It
 * rides into `WikiReport.candidates` unchanged.
 *
 * `suppressed` is every distinct pair the anti-repetition filter refused, and
 * `reproposed` is how many of `pairs` are Q-53 second attempts. Together with
 * `pairs.length` they are what tells a reader whether a quiet run was a quiet
 * corpus or a pool that never filled.
 */
export type ClashPool = {
 pairs: PooledPair[];
 perChannel: Record<string, number>;
 suppressed: number;
 reproposed: number;
};

// ── Shared helpers ──

/**
 * A claim the graph still asserts. Archived and superseded claims stay on disk
 * as evidence of a past self and are never pooled: a contradiction between a
 * claim and one the wiki has already retired is not a tension, it is history.
 *
 * The ONE definition of "live claim" in the wiki slice: lint and the
 * vector channel import this copy instead of restating it, so a rule change
 * (Q-5) lands in one place. Skipping is not removing — nothing here changes
 * what is on disk.
 */
export function isLive(c: Claim): boolean {
 return c.archived !== true && c.supersededBy === undefined;
}

/** Live claims in id order — the one traversal order every channel uses. */
function liveClaims(graph: ClaimGraph): Claim[] {
 return graph.claims.filter(isLive).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The identity of a pair: its two claim ids, sorted. Never the record's id.
 *
 * Q-30 stage 4's anti-repetition is about the PAIR — the same two claims must
 * not collect a fresh record and a fresh question on every docket run — so the
 * key is derived from the claims and nothing else. Sorted, so that a stored
 * record written as `[b, a]` still blocks the pair a channel proposes as
 * `[a, b]`; every side of the filter builds its key through this one function
 * for exactly that reason. A claim id is a ULID, which cannot contain `|`.
 */
function idKey(a: string, b: string): string {
 return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pairKey(a: Claim, b: Claim): string {
 return idKey(a.id, b.id);
}

/** The same two claims, in the same order the key puts them. */
function orderPair(a: Claim, b: Claim): [Claim, Claim] {
 return a.id < b.id ? [a, b] : [b, a];
}

/**
 * Whether two claims are two sentences of one sitting.
 *
 * Q-65's ORDERING key (ticket 083), not an exclusion predicate: a pair that
 * joins two sittings ranks strictly above a same-sitting pair whatever their
 * cosines, and a same-sitting pair is still pooled — just ranked below.
 * Ticket 007 measured why the distinction matters: on the 139-snippet import
 * the highest cosine between two snippets of the SAME sitting is 0.808, and
 * between two DIFFERENT sittings it is 0.640 — every pair above 0.65 is two
 * sentences of one essay, and under Q-50 two cites from one sitting are one
 * thought said twice.
 *
 * The predicate is strict on purpose: a pair counts as same-sitting only when
 * both claims draw on exactly ONE session and it is the same one. A claim
 * spanning two sittings, or one whose cites the graph cannot resolve, is never
 * same-sitting — ignorance is not evidence of sameness.
 */
export function sameSitting(a: Claim, b: Claim, graph: ClaimGraph): boolean {
 // The `'drop'` policy: a sessionless snippet contributes no sitting, because
 // ignorance is not evidence of sameness (status' evidence arithmetic, by
 // contrast, keys a sessionless snippet on its id — absent is never equal).
 const sa = sittingsOfCites(a.cites, graph.snippets, 'drop');
 const sb = sittingsOfCites(b.cites, graph.snippets, 'drop');
 if (sa.size !== 1 || sb.size !== 1) return false;
 const [only] = sa;
 return only !== undefined && sb.has(only);
}

// ── The lexical channel ──

/**
 * The provenance the claim-body index carries.
 *
 * `buildIndex` takes `Snippet[]`, and the only fields it reads are `id`,
 * `version` and `prose`. The rest of the shape has to be filled to satisfy the
 * type, so it is filled ONCE, here, with empty question fields — nothing asked
 * for a claim body; the agent wrote it.
 *
 * **No synthetic Snippet is ever written to disk and nothing outside
 * `lexicalPairs` sees one.** This is a shape cast for an index, not a Snippet:
 * Sole Authorship (Q-1) governs what a Snippet is, and a claim body is agent
 * prose. If this value ever escapes this module, that is the bug.
 */
const CLAIM_PROVENANCE: Provenance = {
 kind: 'harvest',
 session: '',
 question: '',
 questionForm: 'deliberative',
};

function asIndexEntry(c: Claim): Snippet {
 return {
  id: c.id,
  version: 1,
  captured: c.created,
  provenance: CLAIM_PROVENANCE,
  prose: c.body,
 };
}

/**
 * Pairs of live claims that share a verbatim phrase.
 *
 * The existing snippet index cannot do this — it is keyed by snippet id and
 * returns snippet hits, and there is no claim-body index anywhere else — so
 * this builds a SECOND `LexicalIndex` over claim bodies through the adapter
 * above, then resonates each claim body against it and pairs the claim with
 * every hit that is not itself.
 *
 * `resonate`'s own `k` is left at its shipped default rather than restated
 * here: the neighbour count is a property of the retrieval, it already has a
 * decided value, and a second copy of it in this file would be a number nobody
 * decided twice. The diversity rule and the rare-phrase scoring come along for
 * free, which is the reason for reusing `resonate` instead of writing a fourth
 * trigram matcher.
 */
function lexicalPairs(graph: ClaimGraph): [Claim, Claim][] {
 const live = liveClaims(graph);
 if (live.length < 2) return [];

 const index = buildIndex(live.map(asIndexEntry));
 const byId = new Map(live.map((c) => [c.id, c]));

 const seen = new Set<string>();
 const out: [Claim, Claim][] = [];
 for (const claim of live) {
  for (const hit of resonate(index, claim.body)) {
   if (hit.snippetId === claim.id) continue;
   const other = byId.get(hit.snippetId);
   if (!other) continue;
   const key = pairKey(claim, other);
   if (seen.has(key)) continue;
   seen.add(key);
   out.push(orderPair(claim, other));
  }
 }
 return out;
}

/** The lexical channel. Stateless, so it is a value rather than a factory. */
export const lexicalChannel: ClashChannel = {
 name: 'lexical',
 candidates: lexicalPairs,
};

// ── The referent channel ──

/**
 * How many live claims one referent contributes to the pool on one run.
 *
 * The bound exists because this channel is quadratic on a god-node: a referent
 * named by n claims yields n(n-1)/2 pairs, and "my work" will be named by every
 * claim in the wiki within a year. At 12 the ceiling is 66 pairs per referent,
 * which is the same order as the judgment quota downstream can ever spend.
 *
 * **Why a window rather than a hard refusal, and why recency orders it.** The
 * window is the `cap` most recently updated claims for the referent, so a claim
 * the wiki just touched is always inside it and new material is never starved.
 * The cost is real and worth stating: a cold claim on a god-node referent stops
 * being pooled BY THIS CHANNEL once the referent has more than `cap` fresher
 * ones. It is still reachable through the lexical channel and through the
 * semantic one, neither of which has a per-referent window, so the loss is
 * recall on one channel and not on the pool.
 *
 * **Why the number is here and not in `THRESHOLDS`.** It is a bound, and Q-56
 * says bounds ship live from day one — there is no shadow mode for it to earn
 * its way out of, because a bound in shadow is not a bound. What it owes
 * instead is the record: every clip emits `clash-referent-clipped` naming the
 * referent and how many claims fell outside, which is the evidence that sets
 * the real number once there is a corpus. The plan records the number as
 * unknown until then, and it still is; 12 is a ceiling chosen to be visible
 * when it bites, not a measurement. Moving it into the register is a one-line
 * change in a file this task does not own.
 */
export const REFERENT_FANOUT_CAP = 12;

/**
 * Pairs of live claims that name the same canonical referent.
 *
 * **This is the only non-semantic channel that can fire on disjoint
 * vocabulary**, and that is the whole reason it exists beside the lexical one:
 * two claims about "my manager" collide because they point at the same registry
 * entity, however differently they are worded. It is why the Q-32 registry is
 * on the critical path rather than a nicety.
 *
 * It reads the registry through `Registry.claimsFor` rather than reading
 * `Claim.referents` itself, because which claims belong to a slug — including
 * everything reached through an alias — is the registry's question to answer.
 */
export function referentChannel(
 registry: Registry,
 opts: { fanoutCap?: number; log?: LogFn } = {},
): ClashChannel {
 const cap = opts.fanoutCap ?? REFERENT_FANOUT_CAP;
 const log = opts.log;

 return {
  name: 'referent',
  candidates(graph: ClaimGraph): [Claim, Claim][] {
   const slugs = graph.referents
    .map((r) => r.slug)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

   const seen = new Set<string>();
   const out: [Claim, Claim][] = [];

   for (const slug of slugs) {
    const claims = registry.claimsFor(slug, graph).filter(isLive);
    const window = fanoutWindow(claims, cap);

    if (window.length < claims.length && log) {
     log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'clash-referent-clipped',
      detail:
       `referent=${slug} cap=${cap} claims=${claims.length} ` +
       `clipped=${claims.length - window.length}`,
     });
    }

    for (let i = 0; i < window.length; i++) {
     for (let j = i + 1; j < window.length; j++) {
      const a = window[i];
      const b = window[j];
      if (!a || !b) continue;
      const key = pairKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(orderPair(a, b));
     }
    }
   }
   return out;
  },
 };
}

/**
 * The `cap` most recently updated claims, returned in id order.
 *
 * Two sorts, both load-bearing: recency picks WHICH claims are in the window,
 * and id order fixes what the pair sequence looks like afterwards, so the same
 * graph always produces the same list.
 */
function fanoutWindow(claims: Claim[], cap: number): Claim[] {
 if (claims.length <= cap) {
  return [...claims].sort(byId);
 }
 return mostRecentlyUpdated(claims, cap);
}

/** Id order — the one traversal order every channel uses. */
function byId(a: Claim, b: Claim): number {
 return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The `cap` most recently updated claims, returned in id order — the ONE
 * recency rule in the wiki slice. The vector channel's windowOf calls this
 * instead of restating the sort, so a recency change lands in one place.
 *
 * Two sorts, both load-bearing: recency picks WHICH claims are in the window,
 * and id order fixes the sequence afterwards, so the same graph always
 * produces the same list.
 */
export function mostRecentlyUpdated(claims: Claim[], cap: number): Claim[] {
 return [...claims]
  .sort((a, b) => (a.updated === b.updated ? byId(a, b) : a.updated < b.updated ? 1 : -1))
  .slice(0, cap)
  .sort(byId);
}

// ── The pool ──

/**
 * What the existing record for a pair permits.
 *
 * `blocked` is the rule (Q-30 stage 4, B9): a pair that already has a
 * `ClashCandidate` at ANY status is never re-proposed. The middle status is the
 * one that matters — a candidate spends nearly its whole life in
 * `pending-remeasure`, waiting days for a person to answer, and a filter that
 * only caught the terminal statuses would re-propose that pair on every docket
 * run, spend an opposition judgment on it, and write a SECOND record with no
 * queue entry that the next job reads as needing a fresh question.
 *
 * `reproposable` is the ONE exception (Q-53). A pair dissolved as
 * `remeasure-expired` on its first attempt earns exactly one more: expiry is a
 * question that fell off the queue, not an answer, and retiring a pair on
 * silence makes a real contradiction permanently invisible because the person
 * was busy that week. Silence never stands in for a verdict — and it never
 * stands in twice, which is what the cap at two attempts says.
 *
 * Every other outcome retires the pair at once, whatever its `attempts` reads:
 * `not-opposed` is an answer, and an answered question is not re-asked.
 *
 * A `dissolved` record with NO outcome falls through to `blocked`. An
 * unrecorded reason is not the exception; it is a record nobody can read.
 */
function verdict(records: ClashCandidate[]): 'fresh' | 'blocked' | 'reproposable' {
 if (records.length === 0) return 'fresh';
 let attempts = 0;
 for (const r of records) {
  if (r.status !== 'dissolved') return 'blocked';
  if (r.outcome !== 'remeasure-expired') return 'blocked';
  attempts = Math.max(attempts, r.attempts);
 }
 return attempts >= 2 ? 'blocked' : 'reproposable';
}

/**
 * Every channel's pairs, unioned, filtered, and measured.
 *
 * The order of operations is the contract:
 *
 *   1. Each channel produces pairs, and `perChannel` records what it produced —
 *      before the union, including zero.
 *   2. The union dedupes by the sorted claim-id pair and **keeps the FIRST
 *      channel in `channels` array order**. That tag is the record's
 *      provenance: without it the layer that persists the candidate would have
 *      to invent how the pair was found.
 *   3. The anti-repetition filter refuses any pair that already has a record
 *      (except Q-53's one re-proposal), any pair that is the two members of an
 *      open Contradiction, and any pair whose claims are not both live.
 *   4. The judgment quota cuts the ordered, filtered union to its top-N. A
 *      bound ships live (Q-56): the cut is unconditional, and every clip is
 *      recorded through shadowDecision.
 *   5. `clash-checked` is emitted on EVERY run, zero included — with `pool=`
 *      naming the pool after the cut, the number the caller receives. A run
 *      that looked and found nothing must not read like a run that never
 *      looked.
 *
 * Pure apart from the log sink and the clock inside it: same graph, same store
 * contents, same result, in the same order.
 */
export function poolCandidates(
 graph: ClaimGraph,
 channels: ClashChannel[],
 store: ClaimStore,
 log: LogFn,
 quota: Threshold,
): ClashPool {
 const live = new Map(graph.claims.filter(isLive).map((c) => [c.id, c]));

 const recordsByPair = new Map<string, ClashCandidate[]>();
 for (const record of store.listCandidates()) {
  const [a, b] = record.pair;
  const key = idKey(a, b);
  const existing = recordsByPair.get(key);
  if (existing) existing.push(record);
  else recordsByPair.set(key, [record]);
 }

 const openContradictions = new Set<string>();
 for (const c of graph.contradictions) {
  if (c.status !== 'open') continue;
  const [a, b] = c.claims;
  openContradictions.add(idKey(a, b));
 }

 // Union first, filter second: the dedupe decides WHICH channel gets credit
 // for a pair, and the filter must not change that answer.
 const perChannel: Record<string, number> = {};
 const union = new Map<string, { pair: [Claim, Claim]; channel: ClashChannelName }>();
 for (const channel of channels) {
  const produced = channel.candidates(graph);
  perChannel[channel.name] = produced.length;
  for (const [a, b] of produced) {
   const key = pairKey(a, b);
   if (union.has(key)) continue;
   union.set(key, { pair: orderPair(a, b), channel: channel.name });
  }
 }

 const pairs: PooledPair[] = [];
 let suppressed = 0;
 let reproposed = 0;
 for (const [key, found] of union) {
  const [a, b] = found.pair;
  if (a.id === b.id || !live.has(a.id) || !live.has(b.id)) {
   suppressed++;
   continue;
  }
  if (openContradictions.has(key)) {
   suppressed++;
   continue;
  }
  const state = verdict(recordsByPair.get(key) ?? []);
  if (state === 'blocked') {
   suppressed++;
   continue;
  }
  if (state === 'reproposable') reproposed++;
  pairs.push({
   pair: found.pair,
   channel: found.channel,
   attempts: state === 'fresh' ? 1 : 2,
   joinsTwoSittings: !sameSitting(a, b, graph),
  });
 }

 // Q-65 (ticket 083): the judgment quota bounds the ordered, filtered union
 // BEFORE the record is written, so `clash-checked`'s `pool=` is the pool the
 // caller actually receives (the number `WikiReport.pool.size` reports) and
 // the clip below is the only place the cut is visible. 0 is the safe
 // direction for a cap, mirroring `bound()` in wiki-jobs.
 const n = typeof quota.value === 'number' ? quota.value : 0;
 if (pairs.length > n) {
  shadowDecision(
   quota,
   `${pairs.length - n} pooled pairs left without a judgment this run`,
   log,
   true,
  );
  pairs.length = n;
 }

 const counts = channels.map((c) => `${c.name}:${perChannel[c.name] ?? 0}`).join(',');
 log({
  at: new Date().toISOString(),
  actor: 'clerk',
  kind: 'clash-checked',
  detail:
   `pool=${pairs.length} suppressed=${suppressed} reproposed=${reproposed} ` +
   `channels=${counts || '(none)'}`,
 });

 return { pairs, perChannel, suppressed, reproposed };
}
