/**
 * The wiki page render (Wave D1 extraction): the pure shaping behind
 * GET /api/wiki, moved out of src/server.ts. Nothing here reads disk or
 * writes a log — the route gathers the graph, the repair set and the
 * Clerk's last lint findings, calls this once, then stamps `surfaced`
 * over the rendered facets and answers. Wire shape is byte-identical to
 * the pre-extraction route.
 *
 * The shaping happens HERE, not in the client. Two tickets stand behind
 * that rule: 038 closed because the activity stream leaked identifiers
 * onto a surface a person reads, and 063 found 26 event kinds arriving
 * as two context-free words. A route that hands over raw enums and
 * trusts the renderer is the same mistake with a network hop in the
 * middle. So facets arrive as headings, lint findings arrive as notes,
 * and the claims arrive in the order they are meant to be read.
 */
import { FACETS } from '../queue/facet-balance.js';
import { facetHeading, lintNote } from '../queue/source-label.js';
import { isLive } from './clash.js';
import { coreness } from './status.js';
import type { Facet } from '../types.js';
import type { Claim, ClaimGraph, Contradiction, LintFinding } from './contract.js';

/** The GET /api/wiki payload: facets in `FACETS` order, open contradictions, lint notes. */
export type WikiPage = {
 /** `FACETS` order, so two readings of one vault are the same page; an empty facet is omitted. */
 facets: { facet: Facet; heading: string; claims: Claim[] }[];
 /** Open contradictions only unless `all` (a dissolved one is not material any more). */
 contradictions: Contradiction[];
 /** Lint as notes — `kind` slug + `subject` id, never `detail` (tickets 038, 063). */
 lint: { kind: LintFinding['kind']; subject: string; note: string }[];
 /** Claim ids whose cites include a repaired snippet; omitted when empty, never null. */
 repairClaimIds?: string[];
 /** Null means the Clerk has not read the wiki yet in this process. */
 lintedAt: string | null;
 all: boolean;
};

/**
 * Render the wiki page the way the route always did. The graph, repair
 * set and lint findings are gathered by the caller; this function only
 * groups, scores and orders. The response object is what the route
 * `c.json`s — the caller stamps `surfaced` over `facets` first when the
 * read is not pure (129).
 */
export function renderWikiPage(inputs: {
 all: boolean;
 graph: ClaimGraph;
 /** The snippet ids under repair (ticket 137) — computed over the WHOLE graph by the caller. */
 repairedIds: Set<string>;
 /** The Clerk's last lint findings (live read by the caller). */
 lastLintFindings: LintFinding[];
 /** The Clerk's last lint timestamp (live read by the caller). */
 lintedAt: string | null;
}): WikiPage {
 const { all, graph, repairedIds, lastLintFindings, lintedAt } = inputs;

 // Repair consultation (ticket 137): the claim ids whose cites include a
 // repaired snippet, so the wiki surface can mark them. Computed over the
 // WHOLE graph — a repaired cite taints the claim whether or not the page
 // shows it. The empty set is omitted from the response, never null.
 const repairClaimIds = new Set<string>();
 if (repairedIds.size > 0) {
  for (const claim of graph.claims) {
   for (const cite of claim.cites) {
    if (repairedIds.has(cite.split('@')[0]!)) {
     repairClaimIds.add(claim.id);
     break;
    }
   }
  }
 }

 // Coreness over the WHOLE graph, archived claims included, and computed
 // once per claim rather than once per comparison. Scoring the whole graph
 // is also what keeps the order a reader sees from moving when `?all=1`
 // widens the page: a claim's neighbourhood does not shrink because the page
 // stopped showing part of it. The number is computed on demand and stored
 // nowhere (Q-21) — this route is its one caller.
 const score = new Map(graph.claims.map((cl) => [cl.id, coreness(cl.id, graph)]));

 const byFacet = new Map<Facet, Claim[]>();
 for (const cl of graph.claims) {
  if (!all && !isLive(cl)) continue;
  const group = byFacet.get(cl.facet);
  if (group) group.push(cl);
  else byFacet.set(cl.facet, [cl]);
 }

 // `FACETS` order, so two readings of one vault are the same page. An empty
 // facet is omitted: a heading over nothing is chrome, and the document rule
 // has no room for it. Ties break on id, because `coreness` is a
 // neighbourhood measure and a whole component scores alike.
 const facets = FACETS.filter((f) => byFacet.has(f)).map((f) => ({
  facet: f,
  heading: facetHeading(f),
  claims: (byFacet.get(f) ?? []).sort(
   (a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1),
  ),
 }));

 // A dissolved Contradiction is not material any more, so it is not part of
 // the default reading either. It is still on disk, and `?all=1` shows it.
 const contradictions = graph.contradictions.filter((x) => all || x.status === 'open');

 // Lint arrives as a note and nothing else. `LintFinding.detail` names claim
 // ids and `snippetId@version` cites, and `kind` is a slug — the route drops
 // both rather than trusting a renderer not to print them (tickets 038, 063).
 const hidden = new Set(graph.claims.filter((cl) => !isLive(cl)).map((cl) => cl.id));
 const lintNotes = lastLintFindings
  .filter((f) => all || !hidden.has(f.subject))
  .map((f) => ({ kind: f.kind, subject: f.subject, note: lintNote(f.kind) }));

 return {
  facets,
  contradictions,
  lint: lintNotes,
  ...(repairClaimIds.size > 0 ? { repairClaimIds: [...repairClaimIds] } : {}),
  lintedAt,
  all,
 };
}
