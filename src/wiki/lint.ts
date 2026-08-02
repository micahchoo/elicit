/**
 * The graph lint — five findings, no model, no writes (Q-31).
 *
 * **This module takes no model handle. There is no such parameter anywhere in
 * its signature, and that absence IS the contract.** A reader who wants to know
 * whether an opinion can enter here does not have to trace a call graph: the
 * three arguments are a graph snapshot, the threshold register and a log sink,
 * and none of them can reach an LLM. `tests/wiki-lint.test.ts` holds that shut
 * with a `@ts-expect-error` on a fourth argument, and Task 8's verification step
 * greps this file for the word.
 *
 * The second half of Q-31 is the same shape: the lint ADDS and ANNOTATES; it
 * never removes or restructures a claim. Every finding here is a note — a
 * string naming a subject — and the mechanical consequence of each one is
 * performed a layer up, by the wiki jobs that own the queue and the report. So
 * this module can run on every docket pass forever and be incapable of damage.
 * If a future finding wants to archive something, it is not a lint finding.
 *
 * Two consequences of having no state, both deliberate:
 *
 *   - It has no memory and no queue, so it repeats a finding on every run. The
 *     caller decides what to do about that; "one still-true question per
 *     flagged claim" (Q-31) is enforced where the claim id and the queue are
 *     both in scope, and nowhere else.
 *   - It has no clock. Given the same graph it returns the same findings in the
 *     same order, which is what makes the repetition above safe to rely on.
 *     `shadowDecision` stamps its own log lines, and those are the only times
 *     read anywhere in this file's call tree.
 *
 * Every number it acts on comes from the register in `thresholds.ts`, passed in
 * rather than imported, so a test graduates a mechanism by flipping one boolean
 * and the module cannot tell the difference (Q-35).
 */

import type { Facet } from '../types.js';
import type { Claim, ClaimGraph, LintFinding, LogFn } from './contract.js';
import { shadowDecision } from './thresholds.js';
import type { Threshold, THRESHOLDS } from './thresholds.js';

/**
 * The register, by its KEYS rather than by its shipped values.
 *
 * `typeof THRESHOLDS` would be the obvious annotation and it is the wrong one:
 * `satisfies Record<string, Threshold>` preserves the boolean literals, so
 * `THRESHOLDS['lint.godNodeFanout'].live` has the type `false`, not `boolean`.
 * Under that annotation no caller can pass a register with the entry flipped
 * live — including the test that proves the shadow is what withholds the
 * finding, rather than a bug. Mapping the keys to the declared `Threshold`
 * keeps every key literal (so no lookup here is `| undefined` under
 * `noUncheckedIndexedAccess`), keeps a new register entry appearing here for
 * free, and depends on the one thing this module actually needs: that these
 * names exist and carry a value and a liveness.
 */
export type ThresholdRegister = { [K in keyof typeof THRESHOLDS]: Threshold };

export function lint(
  graph: ClaimGraph,
  thresholds: ThresholdRegister,
  log: LogFn,
): LintFinding[] {
  return [
    ...citationFindings(graph, thresholds, log),
    ...godNodeFindings(graph, thresholds, log),
    ...mergeCandidateFindings(graph, thresholds, log),
    ...undiscriminatedRangeFindings(graph, thresholds, log),
  ];
}

/**
 * A claim the graph still asserts. Archived and superseded claims stay on disk
 * as evidence of a past self (Q-5, Q-29) and are deliberately NOT linted: a
 * still-true question about a sentence the wiki has already replaced asks the
 * user about something nobody holds, and a fanout count that includes the
 * retired claims measures the wiki's history rather than its shape.
 *
 * Skipping is not removing. Nothing here changes what is on disk.
 */
function isLive(c: Claim): boolean {
  return c.archived !== true && c.supersededBy === undefined;
}

/**
 * What became of one `snippetId@version` cite.
 *
 * `graph.snippets` is keyed by snippet ID and holds only the LATEST version of
 * each — it is `vault.rebuildIndex()`'s shape, joined. So the question "does
 * this cite still resolve?" is a VERSION COMPARISON and never a key lookup for
 * `id@version`. Getting that backwards flags every claim in the vault, since no
 * versioned key is ever present.
 *
 *   - `current` — the cite names the latest version.
 *   - `stale`   — an older version, and the file still exists on disk. Q-5:
 *                 versions are immutable, so this is normal and orphans
 *                 nothing; it is a question to ask, not a defect.
 *   - `dead`    — the whole snippet id is gone from the vault, or the cite is
 *                 malformed, or it names a version that does not exist. A cite
 *                 nothing can resolve is what makes a claim an orphan.
 */
type CiteFate = 'current' | 'stale' | 'dead';

function fateOf(cite: string, snippets: ClaimGraph['snippets']): CiteFate {
  const at = cite.lastIndexOf('@');
  if (at <= 0) return 'dead';

  const latest = snippets[cite.slice(0, at)];
  if (!latest) return 'dead';

  const version = Number(cite.slice(at + 1));
  // A cite ahead of the latest version resolves to nothing on disk. It is the
  // fabrication case the write boundary rejects, so it should be unreachable;
  // read as dead rather than stale, because "ask the user if it is still true"
  // is the wrong question about evidence that never existed.
  if (!Number.isInteger(version) || version < 1 || version > latest.version) return 'dead';

  return version < latest.version ? 'stale' : 'current';
}

/**
 * `stale-citation` and `orphan-claim` — one pass over each live claim's cites,
 * because both findings are readings of the same resolution.
 *
 * They are mutually exclusive by construction: a stale cite is one that
 * resolved, so a claim with any stale cite has a cite that resolved, and is not
 * an orphan. That is Q-5 spelled as code — **re-versioning orphans nothing.**
 * Reading "all cites superseded" as orphaning would make every long-lived claim
 * an orphan, which is the opposite of what the finding is for.
 */
function citationFindings(
  graph: ClaimGraph,
  thresholds: ThresholdRegister,
  log: LogFn,
): LintFinding[] {
  const stale = thresholds['lint.staleCitationAgeDays'];

  // The register says 0 days of grace: a newer version exists, so the citation
  // is stale now. A positive grace would need to compare the newer version's
  // capture time against the present, and this function has no clock by design
  // — the caller would have to pass one, which is a signature change and a
  // decision, not something to infer. Until it is made, a non-zero value goes
  // on the record instead of being silently rounded to zero.
  if (stale.value !== 0) {
    log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'lint-threshold-unhonored',
      detail:
        `threshold=lint.staleCitationAgeDays value=${String(stale.value)} ` +
        'needs a clock; lint is pure and applied a 0-day grace',
    });
  }

  const findings: LintFinding[] = [];

  for (const c of graph.claims) {
    if (!isLive(c)) continue;

    const staleCites: string[] = [];
    const deadCites: string[] = [];
    for (const cite of c.cites) {
      const fate = fateOf(cite, graph.snippets);
      if (fate === 'stale') staleCites.push(cite);
      else if (fate === 'dead') deadCites.push(cite);
    }

    // Orphan: EVERY cite failed to resolve. The empty-cites case lands here
    // too, and belongs here — `Claim.cites` is required and non-empty, so a
    // claim with none is a file that got past the write boundary somehow, and
    // a note is exactly the right amount of alarm.
    if (deadCites.length === c.cites.length) {
      findings.push({
        kind: 'orphan-claim',
        subject: c.id,
        detail:
          c.cites.length === 0
            ? 'no cites at all: nothing in the vault stands behind this claim'
            : `every cite is unresolvable: ${deadCites.join(', ')}`,
        refs: [c.id, ...deadCites],
      });
      continue;
    }

    if (staleCites.length === 0) continue;

    // One finding per CLAIM, not per cite: `subject` is what T12 attributes
    // the still-true question to, and two findings naming one claim would be
    // two questions about it unless the caller deduped — which is a rule the
    // shape can keep instead of a rule the caller has to remember (B8).
    const would = `flag stale-citation on claim=${c.id} cites=${staleCites.join(',')}`;
    if (!shadowDecision(stale, would, log)) continue;

    findings.push({
      kind: 'stale-citation',
      subject: c.id,
      detail: `${staleCites.length === 1 ? 'a cite' : `${staleCites.length} cites`} name` +
        `${staleCites.length === 1 ? 's' : ''} a superseded snippet version: ${staleCites.join(', ')}`,
      refs: [c.id, ...staleCites],
    });
  }

  return findings;
}

/**
 * `god-node-facet` — a facet carrying more claims than the fanout.
 *
 * Shadowed (Q-35): a fanout note that fires because the wiki is young says
 * nothing about the wiki, so the shadow record has to show it firing on a real
 * corpus before it is allowed to appear.
 *
 * The consequence, when it graduates, is a note. **There is no split op** —
 * there is no vocabulary for one, on purpose (Q-31).
 */
function godNodeFindings(
  graph: ClaimGraph,
  thresholds: ThresholdRegister,
  log: LogFn,
): LintFinding[] {
  const t = thresholds['lint.godNodeFanout'];
  // The register admits booleans, because two of its entries are switches. This
  // one is a count; anything else is not a fanout and is not acted on.
  if (typeof t.value !== 'number') return [];

  const byFacet = new Map<Facet, string[]>();
  for (const c of graph.claims) {
    if (!isLive(c)) continue;
    const ids = byFacet.get(c.facet);
    if (ids) ids.push(c.id);
    else byFacet.set(c.facet, [c.id]);
  }

  const findings: LintFinding[] = [];
  // Sorted, so the finding order does not depend on which claim happened to be
  // written first — the determinism invariant is about the whole return value.
  for (const facet of [...byFacet.keys()].sort()) {
    const ids = byFacet.get(facet) ?? [];
    if (ids.length <= t.value) continue;

    const would = `note god-node on facet=${facet} claims=${ids.length} over fanout=${t.value}`;
    if (!shadowDecision(t, would, log)) continue;

    findings.push({
      kind: 'god-node-facet',
      subject: facet,
      detail: `${ids.length} live claims carry the ${facet} facet, over a fanout of ${t.value}`,
      refs: ids,
    });
  }

  return findings;
}

/**
 * `merge-candidate` — two registry referents whose canonical names are close
 * enough to be worth a human's glance. A dimmed note on BOTH entries, and
 * nothing else: **only user attestation ever executes a merge** (Q-32). There
 * is no merge in this module, none in the `Registry` interface, and the model
 * has no word for one.
 *
 * Shadowed (Q-35), and the shadow record is the point: nobody knows yet whether
 * 0.85 over token overlap surfaces pairs a human would agree about.
 *
 * `Registry.mergeCandidates` (T10) computes the same relation over the same
 * data. The duplication is the price of `lint`'s signature, which takes a graph
 * and not a registry — deliberately, since a registry is a thing that can
 * write. If the two ever disagree, THIS one is the note the user sees.
 */
function mergeCandidateFindings(
  graph: ClaimGraph,
  thresholds: ThresholdRegister,
  log: LogFn,
): LintFinding[] {
  const t = thresholds['registry.mergeCandidateSimilarity'];
  if (typeof t.value !== 'number') return [];

  const referents = [...graph.referents].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const findings: LintFinding[] = [];

  for (let i = 0; i < referents.length; i++) {
    const a = referents[i];
    if (!a) continue;
    for (let j = i + 1; j < referents.length; j++) {
      const b = referents[j];
      if (!b) continue;

      const score = nameSimilarity(a.canonical, b.canonical);
      if (score <= t.value) continue;

      const would = `note merge-candidate on ${a.slug} and ${b.slug} similarity=${score.toFixed(2)}`;
      if (!shadowDecision(t, would, log)) continue;

      // Both entries, because a note on one of them is a note the user reading
      // the other never sees, and either is as likely to be the page they open.
      const detail = `"${a.canonical}" and "${b.canonical}" may name one referent (similarity ${score.toFixed(2)})`;
      findings.push({ kind: 'merge-candidate', subject: a.slug, detail, refs: [a.slug, b.slug] });
      findings.push({ kind: 'merge-candidate', subject: b.slug, detail, refs: [b.slug, a.slug] });
    }
  }

  return findings;
}

/**
 * `undiscriminated-range` — two live claims describing the same situation
 * under the same stated conditions, found by comparing their RANGE strings
 * and nothing else. The signal is sameness, and sameness is a string
 * function: no opposition judgment and no candidate pool in the path, so
 * the finding sees the corpus as it is today (ticket 060).
 *
 * The subject is the referent slug — the thing both claims are about — and
 * the refs are the two claim ids in sorted order. The sorted pair is the
 * caller's dedupe key (exactly how T11 dedupes candidate pairs): ONE minted
 * question per pair (Q-31), carrying both ids so the answer can route back
 * to one SUPERSEDE per claim.
 *
 * Shadowed (Q-35) like its siblings: computed and logged, returned only
 * when the register flips. It graduates when the shadow record shows pairs
 * a human agrees are two descriptions of one situation.
 */
function undiscriminatedRangeFindings(
  graph: ClaimGraph,
  thresholds: ThresholdRegister,
  log: LogFn,
): LintFinding[] {
  const t = thresholds['lint.undiscriminatedRangeSimilarity'];
  if (typeof t.value !== 'number') return [];

  // Live claims only, sorted by id so every pair is visited once in i<j
  // order and the refs come out in the caller's dedupe key order.
  const live = graph.claims.filter(isLive).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const findings: LintFinding[] = [];

  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    if (!a) continue;
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      if (!b) continue;

      // The referent both claims are about — the lexicographically first of
      // the slugs they share. No shared referent, no finding.
      const [subject] = a.referents.filter((r) => b.referents.includes(r)).sort();
      if (subject === undefined) continue;

      const score = nameSimilarity(a.range, b.range);
      if (score <= t.value) continue;

      const would = `note undiscriminated-range on ${a.id} and ${b.id} referent=${subject} similarity=${score.toFixed(2)}`;
      if (!shadowDecision(t, would, log)) continue;

      findings.push({
        kind: 'undiscriminated-range',
        subject,
        detail: `${a.id} and ${b.id} describe the same situation under the same stated conditions (similarity ${score.toFixed(2)})`,
        refs: [a.id, b.id],
      });
    }
  }

  return findings;
}

/**
 * Normalized token overlap between two canonical names — Jaccard over the
 * words, case and punctuation and word order discarded.
 *
 * What it catches at 0.85: "Sarah Kim" against "kim, SARAH", "The Bakery"
 * against "the bakery ". What it does NOT catch: "Sarah" against "Sara", or
 * "Mum" against "Mother" — one shared token out of two scores 0.5, far under
 * the bar. That is the intended reach. Deciding that two differently spelled
 * names are one person is inference about identity, and Q-32 keeps inference
 * out of identity: the model may add structure and link reversibly, never
 * collapse. The shadow record is what will say whether this reach is enough.
 *
 * A pure string function, and the only similarity measure in this file.
 */
function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Unicode-aware, so a name with an accent in it is one token and not three. */
function nameTokens(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0));
}
