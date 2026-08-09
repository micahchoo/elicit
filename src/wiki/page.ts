/**
 * The contextualizer wiki page render (Batch B, §11): the pure shaping
 * behind GET /api/wiki, moved out of src/server.ts. Nothing here reads
 * disk or writes a log — the route gathers the passages, the neighborhoods,
 * the context lines and the Clerk's last lint findings, calls this once,
 * then stamps `surfaced` over the rendered passages.
 *
 * The page is YOUR WORDS, grouped into themes — no claim apparatus. The
 * claim vault is not deleted (the trial may return it); it simply stops
 * rendering. Passages arrive grouped into neighborhoods, each with a
 * context line in agent ink (when it was said, what question drew it, what
 * stood before it, what it echoes) — the claim status/range/verb machinery
 * has no seat on this surface (ruling 5, 2026-08-08).
 *
 * The shaping happens HERE, not in the client. Two tickets stand behind
 * that rule: 038 closed because the activity stream leaked identifiers
 * onto a surface a person reads, and 063 found 26 event kinds arriving
 * as two context-free words. A route that hands over raw enums and
 * trusts the renderer is the same mistake with a network hop in the
 * middle. So neighborhoods arrive as headings, context lines arrive as
 * agent prose, and the passages arrive in the order they are meant to be
 * read.
 */
import { clusterPassages, type Neighborhood } from './neighborhoods.js';
import type { ContextLineRecord } from './store.js';
import type { Contradiction } from './contract.js';
import type { Snippet } from '../types.js';

/** The since-last-read lens's read-through facts (wave 5). The route computes
 * them — the sitting census reads disk — and this function shapes them on. */
export type Freshness = {
 /** The latest read across every claim's readLog; null when nothing was ever read. */
 readThrough: string | null;
 /** Non-import sittings started after read-through; 0 when there is no read-through. */
 sittingsBehind: number;
 /** The latest non-import sitting start; null when there has never been one. */
 lastSittingAt: string | null;
};

/**
 * One passage on the contextualizer page — a snippet in the person's ink,
 * with the mechanical facts the lens and the fallback context line need.
 * `context` is the agent's composed line (B2's job); absent until that job
 * runs, in which case the client renders the mechanical facts as a fallback
 * line. The claim apparatus (status, range, cites) has no seat here.
 */
export type WikiPassage = {
 /** The snippet id — never printed, the read-log's key. */
 id: string;
 /** The person's own words, verbatim. */
 prose: string;
 /** When it was said (ISO). */
 captured: string;
 /** The question that drew it; '' when nothing asked for these words. */
 question: string;
 /** Where it stood in the conversation — the transcript turn index, when the snippet has one. */
 position: number | null;
 /** The agent's context line — agent ink, marginalia-class, never quotable. */
 context?: { text: string; echoes: string[]; at: string };
};

/** The GET /api/wiki payload: your passages grouped into neighborhoods. */
export type WikiPage = {
 /** Neighborhoods in the clustering's own order; every passage is in exactly one. */
 neighborhoods: { name: string; passages: WikiPassage[] }[];
 /** Every contradiction, dissolved included — the lens decides visibility (wave 5). */
 contradictions: Contradiction[];
 /** The lens's read-through + sitting census (wave 5). */
 freshness: Freshness;
 /** Null means the Clerk has not read the wiki yet in this process. */
 lintedAt: string | null;
 all: boolean;
};

/**
 * Group passages into neighborhoods.
 *
 * The route hands over the clustering STORE when C1's docket job has run
 * (or null when the store is missing or malformed). A null store is the
 * fallback case: clusterPassages itself computes a deterministic lexical
 * grouping (by provenance session) when no embedding vectors are supplied —
 * one exported function owns both paths, so the fallback is never a second,
 * drifting copy of the grouping logic.
 *
 * Two guarantees hold no matter which path ran:
 *
 *  - EVERY passage renders. A passage harvested after the last clustering
 *    job is in no cluster; it is grouped through the same lexical fallback
 *    and appended, so the page is always the whole corpus. A passage in a
 *    cluster whose id no longer resolves (edited/deleted snippet) is
 *    dropped from that cluster and re-grouped the same way.
 *  - A present store with zero clusters is a FACT, not a gap (C1's
 *    contract): the clustering job ran and found no themes. The page
 *    renders that honestly — one neighborhood named "no themes yet" —
 *    rather than silently re-grouping lexically as if the job had not run.
 *  - Ordering is deterministic: clusters keep the store's order, passages
 *    within a cluster keep the cluster's passageIds order, and the
 *    fallback groups sort by id (clusterPassages' own determinism).
 */
function neighborhoodsOf(passages: Snippet[], store: Neighborhood[] | null): { name: string; passages: WikiPassage[] }[] {
 const byId = new Map(passages.map((p) => [p.id, p]));
 const place = (p: Snippet): WikiPassage => ({
  id: p.id,
  prose: p.prose,
  captured: p.captured,
  question: p.provenance.question,
  position: p.provenance.span?.start ?? null,
 });
 // The store's presence — even with zero clusters — is meaningful (C1):
 // null means "the job has not run" (fall back), [] means "it ran and
 // found no themes" (say so). Both are derived stores, never source.
 if (store !== null && store.length === 0) {
  return [{ name: 'no themes yet', passages: passages.map(place) }];
 }
 const groups: { name: string; passageIds: string[] }[] = store ?? clusterPassages(
  passages.map((p) => ({ id: p.id, prose: p.prose, captured: p.captured })),
 );
 const placed = new Set<string>();
 const neighborhoods: { name: string; passages: WikiPassage[] }[] = [];
 for (const g of groups) {
  const members: WikiPassage[] = [];
  for (const pid of g.passageIds) {
   const p = byId.get(pid);
   if (!p || placed.has(pid)) continue;
   placed.add(pid);
   members.push(place(p));
  }
  if (members.length > 0) neighborhoods.push({ name: g.name, passages: members });
 }
 const leftovers = passages.filter((p) => !placed.has(p.id));
 if (leftovers.length > 0) {
  for (const g of clusterPassages(leftovers.map((p) => ({ id: p.id, prose: p.prose, captured: p.captured })))) {
   const members: WikiPassage[] = [];
   for (const pid of g.passageIds) {
    const p = byId.get(pid);
    if (!p) continue;
    placed.add(pid);
    members.push(place(p));
   }
   if (members.length > 0) neighborhoods.push({ name: g.name, passages: members });
  }
 }
 return neighborhoods;
}

/**
 * Render the wiki page. The passages, neighborhoods store, context lines,
 * contradictions, freshness and lint findings are gathered by the caller;
 * this function only groups, orders and attaches context. The response
 * object is what the route `c.json`s — the caller stamps `surfaced` over
 * the passages first when the read is not pure (129).
 */
export function renderWikiPage(inputs: {
 all: boolean;
 /** The whole snippet corpus — the page is your words, nothing is hidden. */
 passages: Snippet[];
 /** C1's clustering store, or null when it has not run (the lexical fallback then). */
 neighborhoods: Neighborhood[] | null;
 /** The context-line store, keyed by passage id — B2's job's output. */
 contextLines: Map<string, ContextLineRecord>;
 /** Every contradiction, dissolved included — the lens decides visibility. */
 contradictions: Contradiction[];
 /** The lens's read-through + sitting census — computed by the caller. */
 freshness: Freshness;
 /** The Clerk's last lint timestamp (live read by the caller). */
 lintedAt: string | null;
}): WikiPage {
 const { all, passages, neighborhoods, contextLines, contradictions, freshness, lintedAt } = inputs;

 const neighborhoodsOut = neighborhoodsOf(passages, neighborhoods);
 for (const n of neighborhoodsOut) {
  for (const p of n.passages) {
   const line = contextLines.get(p.id);
   if (line) {
    // The wire carries text + the echo citations + the stamp the lens keys
    // on. The model stamp stays in the store — no model name reaches a
    // reading surface (Q-34's stamp is store machinery, never chrome).
    p.context = { text: line.text, echoes: line.echoes, at: line.at };
   }
  }
 }

 return {
  neighborhoods: neighborhoodsOut,
  contradictions,
  freshness,
  lintedAt,
  all,
 };
}
