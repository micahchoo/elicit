// Mechanical claim status, and coreness computed on demand.
//
// This is Q-29's sharpest edge, and the reason the module is a pure function
// from the graph to a status: "who set this claim to evidenced?" has exactly
// one answer — arithmetic did. Nothing here reads model output, and nothing
// here can be reached by a model, because the op vocabulary has no word for
// `status` at all. A future author who wants to make a status depend on a
// model's judgment has to add an import to this file, which is a thing a
// reviewer can see.
//
// ── Two translations made once, on purpose ──
//
// 1. CONTEXT says a Contradiction between A and B "invalidates only claims
//    citing both". Claims cite snippet VERSIONS, never other claims, so the
//    only executable reading is: a third claim is contested when it cites at
//    least one snippet version that A cites AND at least one that B cites.
//    That is a translation, recorded here so a later reader does not mistake
//    it for drift (plan note N4). It compares cite strings exactly — `s1@1`
//    does not match `s1@2` — which is the NARROW reading. Contesting a claim
//    is a demotion, and the narrow rule errs toward leaving a claim live.
//
// 2. Q-50 says independent cites means distinct SITTINGS, and a sitting is
//    `Snippet.provenance.session`. Two versions of one snippet were already
//    one piece of evidence (Q-5); two distinct snippets from one sitting are
//    also one piece of evidence — one thought said twice. The consequence is
//    known and accepted: a corpus that is mostly one long sitting produces
//    almost no `evidenced` claims. That is the vocabulary working, and it must
//    not be "fixed" by loosening the rule.
//
// The evidence arithmetic resolves each cite THROUGH the graph, because a
// sitting is a fact about the snippet and not about the cite string. The
// contest check does not resolve anything: it is a set intersection between
// two claims' cite lists, and needs no snippet to exist to be answerable.

import {
  THRESHOLDS,
  shadowDecision,
  type ThresholdLogFn,
} from './thresholds.js';
import type { Claim, ClaimGraph, ClaimStatus, LogFn } from './contract.js';
import type { Facet } from '../types.js';

/**
 * What `computeStatus` returns.
 *
 * `live` is the status to write. `shadow` is what the status would be if
 * `status.readLogDiscount` were live (Q-35). They differ only while that
 * threshold is shadowed AND at least one cite arrived after the user read the
 * claim; the difference is the evidence that would graduate it.
 */
export type StatusResult = { live: ClaimStatus; shadow: ClaimStatus; why: string };

/** ≥2 independent cites make a claim `evidenced` (Q-21, Q-50). */
const SITTINGS_FOR_EVIDENCED = 2;

/** The snippet id half of a `snippetId@version` cite. */
function citeSnippetId(cite: string): string {
  const at = cite.lastIndexOf('@');
  return at === -1 ? cite : cite.slice(0, at);
}

/** The version half, or NaN when the cite is malformed — which never resolves. */
function citeVersion(cite: string): number {
  const at = cite.lastIndexOf('@');
  return at === -1 ? Number.NaN : Number(cite.slice(at + 1));
}

/** `2 sittings` / `1 sitting`. Kept in one place so every `why` reads alike. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** One resolved cite, and everything the arithmetic needs from it. */
type Evidence = {
  cite: string;
  snippetId: string;
  /**
   * The sitting key. A snippet whose `provenance.session` is empty or absent
   * gets a key of its OWN, keyed on the snippet id: absent is not equal, so
   * two sessionless snippets are two sittings and never one. Keying on the
   * snippet id (not the cite) keeps Q-5 true — two versions of one sessionless
   * snippet still collapse to one sitting.
   */
  sitting: string;
  /** Q-21's looping effect: this snippet arrived after the user read the claim. */
  discounted: boolean;
};

type Tally = {
  sittings: Set<string>;
  snippetIds: Set<string>;
  cites: number;
};

function tally(evidence: Evidence[]): Tally {
  return {
    sittings: new Set(evidence.map((e) => e.sitting)),
    snippetIds: new Set(evidence.map((e) => e.snippetId)),
    cites: evidence.length,
  };
}

/**
 * When the user FIRST read this claim, or undefined if they never did.
 *
 * The earliest read is the cut, not the latest: once the claim has been seen,
 * every later answer is potentially shaped by having seen it, and a second
 * reading cannot un-shape the answers that came between. Q-21's looping effect
 * is about exposure, and exposure is not undone.
 */
function firstReadAt(claim: Claim): number | undefined {
  let earliest: number | undefined;
  for (const entry of claim.readLog) {
    const t = Date.parse(entry.at);
    if (Number.isNaN(t)) continue; // an unparseable stamp discounts nothing
    if (earliest === undefined || t < earliest) earliest = t;
  }
  return earliest;
}

/**
 * Resolve every cite against the graph.
 *
 * `ClaimGraph.snippets` holds only the LATEST version of each snippet, so
 * resolution is a `version <= latest` comparison and not a key lookup: `@1`
 * when the latest is `@2` is a STALE citation (T8's lint finding) and still
 * real evidence, while `@3` against a latest of `@2` names a version that has
 * never existed and is evidence of nothing.
 */
function resolve(
  claim: Claim,
  graph: ClaimGraph,
): { evidence: Evidence[]; unresolved: number } {
  const cut = firstReadAt(claim);
  const evidence: Evidence[] = [];
  let unresolved = 0;

  for (const cite of claim.cites) {
    const id = citeSnippetId(cite);
    const version = citeVersion(cite);
    const snippet = graph.snippets[id];
    if (!snippet || Number.isNaN(version) || version > snippet.version) {
      unresolved++;
      continue;
    }
    const session = snippet.provenance.session;
    const captured = Date.parse(snippet.captured);
    evidence.push({
      cite,
      snippetId: id,
      sitting: session ? `session:${session}` : `no-session:${id}`,
      discounted: cut !== undefined && !Number.isNaN(captured) && captured > cut,
    });
  }

  return { evidence, unresolved };
}

/**
 * The Facets under which the cited snippets were read.
 *
 * A Snippet carries no Facet — Q-4 puts Facet in the agent's Reading, citing
 * `snippet@version`, and never inside the Snippet file. So the only executable
 * reading of "separated by Facet" is a join through the readings that cite
 * those snippets. Matched on snippet id rather than version, because a
 * re-versioned snippet is the same material read under the same Facet.
 */
function facetsOf(snippetIds: Set<string>, graph: ClaimGraph): Set<Facet> {
  const facets = new Set<Facet>();
  for (const reading of Object.values(graph.readings)) {
    for (const cite of reading.cites) {
      if (snippetIds.has(citeSnippetId(cite))) {
        facets.add(reading.facet);
        break;
      }
    }
  }
  return facets;
}

/**
 * The distinct question sources behind the cited snippets.
 *
 * Only sources that are PRESENT are counted, which is deliberately unlike the
 * sitting rule above. A sitting decides a status, and Q-50 ruled that an
 * absent session is its own sitting. This tier decides nothing — it only
 * records a distinction for a later decision to use — and calling two unknowns
 * "separated" would manufacture a fact about the evidence.
 */
function questionSourcesOf(evidence: Evidence[], graph: ClaimGraph): Set<string> {
  const sources = new Set<string>();
  for (const e of evidence) {
    const source = graph.snippets[e.snippetId]?.provenance.questionSource;
    if (source) sources.add(`${source.channel}#${source.blockId}`);
  }
  return sources;
}

/**
 * The status the cite arithmetic alone would give.
 *
 * Contested and user-attested are decided before this is ever called, so this
 * function knows about exactly one rule and cannot be confused by the others.
 */
function statusFromEvidence(t: Tally): ClaimStatus {
  return t.sittings.size >= SITTINGS_FOR_EVIDENCED ? 'evidenced' : 'unconfirmed';
}

function whyFromEvidence(
  status: ClaimStatus,
  t: Tally,
  evidence: Evidence[],
  unresolved: number,
  graph: ClaimGraph,
): string {
  const tail = unresolved > 0 ? ` (${count(unresolved, 'unresolved')})` : '';

  if (status === 'evidenced') {
    const parts = [count(t.sittings.size, 'sitting')];
    // The stronger tier (Q-50): recorded so a later decision can read it
    // without re-deriving it. Nothing in this slice acts on it.
    const facets = facetsOf(t.snippetIds, graph);
    if (facets.size > 1) parts.push(count(facets.size, 'facet'));
    const sources = questionSourcesOf(evidence, graph);
    if (sources.size > 1) parts.push(count(sources.size, 'question source'));
    return `evidenced: ${parts.join(', ')}${tail}`;
  }

  if (t.cites === 0) {
    return unresolved === 0 ? 'unconfirmed: no cites' : `unconfirmed: no resolvable cites${tail}`;
  }
  return `unconfirmed: ${count(t.sittings.size, 'sitting')} across ${count(t.cites, 'cite')}${tail}`;
}

/**
 * The status a claim has, given the graph. Total, pure, and never derived from
 * any model output.
 *
 * Precedence, evaluated in order:
 *   1. `contested` — a member of an open Contradiction, or a claim citing
 *      snippet versions from both of its sides.
 *   2. `user-attested` — `attested: true`, which only a user verb sets.
 *   3. `evidenced` — ≥2 cites from distinct sittings (Q-50).
 *   4. `unconfirmed` — otherwise.
 *
 * `log` is optional and is used for one thing: recording what the shadowed
 * read-log discount would have done (Q-35). It is optional because the
 * function's value does not depend on it — a caller with no Activity Log still
 * gets the same three fields — and every call written against the plan's
 * two-argument signature stays correct.
 */
export function computeStatus(claim: Claim, graph: ClaimGraph, log?: LogFn): StatusResult {
  // 1. Contested. Membership first, in a pass of its own: a claim that is a
  //    member of one Contradiction and a both-sides citer of another should
  //    report the fact about itself, not the fact about its neighbours.
  for (const k of graph.contradictions) {
    if (k.status !== 'open') continue;
    if (k.claims[0] === claim.id || k.claims[1] === claim.id) {
      const why = `contested: member of open Contradiction ${k.id}`;
      return { live: 'contested', shadow: 'contested', why };
    }
  }

  const cited = new Set(claim.cites);
  for (const k of graph.contradictions) {
    if (k.status !== 'open') continue;
    const a = graph.claims.find((c) => c.id === k.claims[0]);
    const b = graph.claims.find((c) => c.id === k.claims[1]);
    if (!a || !b) continue; // a side that is not in the snapshot invalidates nothing
    if (a.cites.some((c) => cited.has(c)) && b.cites.some((c) => cited.has(c))) {
      const why = `contested: cites snippet versions from both sides of open Contradiction ${k.id}`;
      return { live: 'contested', shadow: 'contested', why };
    }
  }

  // 2. User attestation. Set by a user verb only (Q-33); no op type reaches it.
  if (claim.attested) {
    return {
      live: 'user-attested',
      shadow: 'user-attested',
      why: 'user-attested: set by a user verb',
    };
  }

  // 3 & 4. The cite arithmetic, computed twice: once over every resolving cite
  //        and once with the read-log discount applied.
  const { evidence, unresolved } = resolve(claim, graph);
  const kept = evidence.filter((e) => !e.discounted);
  const discountedCount = evidence.length - kept.length;

  const allTally = tally(evidence);
  const keptTally = tally(kept);
  const undiscounted = statusFromEvidence(allTally);
  const discounted = statusFromEvidence(keptTally);

  // The threshold is read only through `shadowDecision`, so graduating the
  // discount is one boolean in thresholds.ts and no change here. The sink is
  // silenced when nothing would be discounted: that is not a decision, and one
  // line per claim per run would bury the records graduation depends on.
  const sink: ThresholdLogFn =
    discountedCount > 0 && log
      ? (e) => log({ ...e, refs: [claim.id] })
      : () => {};
  const discountIsLive = shadowDecision(
    THRESHOLDS['status.readLogDiscount'],
    `discount ${count(discountedCount, 'cite')} answered after the read on ${claim.id}: ` +
      `${undiscounted} would become ${discounted}`,
    sink,
  );

  const live = discountIsLive ? discounted : undiscounted;
  const shadow = discounted;
  const liveTally = discountIsLive ? keptTally : allTally;
  const liveEvidence = discountIsLive ? kept : evidence;

  let why = whyFromEvidence(live, liveTally, liveEvidence, unresolved, graph);
  if (shadow !== live) {
    why += ` (shadow: ${shadow}, ${count(discountedCount, 'cite')} discounted by read-log)`;
  }

  return { live, shadow, why };
}

/**
 * How central a claim is in the citation web, in [0, 1].
 *
 * Definition: the number of distinct snippets reachable from the claim through
 * shared-citation edges within two hops, normalized by the graph's maximum.
 *
 * **Computed, never stored, never written to a file, never sent to a model.**
 * CONTEXT.md is explicit that this number must not become a confidence score,
 * so it exists only as a function call: there is no field to persist it in,
 * and `computeStatus` does not return it. Its one caller in this slice orders
 * claims within a Facet for the read surface, and orders nothing else.
 *
 * The edges are the citation graph as given. Two claims are adjacent when they
 * cite the same snippet ID — version-insensitive, because two versions of one
 * snippet are the same material (Q-5) and a re-version must not silently cut
 * an edge.
 */
export function coreness(claimId: string, graph: ClaimGraph): number {
  const snippetsOf = new Map<string, Set<string>>();
  const claimsBySnippet = new Map<string, string[]>();
  for (const c of graph.claims) {
    const ids = new Set(c.cites.map(citeSnippetId));
    snippetsOf.set(c.id, ids);
    for (const s of ids) {
      const holders = claimsBySnippet.get(s);
      if (holders) holders.push(c.id);
      else claimsBySnippet.set(s, [c.id]);
    }
  }

  const reach = (id: string): number => {
    if (!snippetsOf.has(id)) return 0;
    const seen = new Set([id]);
    let frontier = [id];
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const cid of frontier) {
        for (const s of snippetsOf.get(cid) ?? []) {
          for (const other of claimsBySnippet.get(s) ?? []) {
            if (seen.has(other)) continue;
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    const snippets = new Set<string>();
    for (const cid of seen) for (const s of snippetsOf.get(cid) ?? []) snippets.add(s);
    return snippets.size;
  };

  const raw = reach(claimId);
  if (raw === 0) return 0;

  // Normalizing against the graph max makes the number comparable within one
  // rendering and meaningless across two — which is the point. A coreness that
  // survived a graph change would start to look like a measurement of the
  // claim rather than of its neighbourhood.
  let max = 0;
  for (const c of graph.claims) max = Math.max(max, reach(c.id));
  return max === 0 ? 0 : raw / max;
}
