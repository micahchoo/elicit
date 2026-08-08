/**
 * The graph lint — seven findings, no model, no writes (Q-31).
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Facet } from '../types.js';
import type { Claim, ClaimGraph, LintFinding, LogFn } from './contract.js';
import { shadowDecision } from './thresholds.js';
import { isLive } from './clash.js';
import { nameSimilarity } from './registry.js';
import type { THRESHOLDS } from './thresholds.js';
import type { Threshold } from '../domain/thresholds.js';

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
    ...occasionlessRangeFindings(graph, thresholds, log),
    ...weakEvidenceFindings(graph, thresholds, log),
  ];
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
 * `god-node-referent` — a registry referent named by more live claims than
 * the fanout.
 *
 * Scoped to referents (ticket 089): a god-node is one registry entity named
 * by many claims — the node-dominance hazard REFERENT_FANOUT_CAP bounds
 * quadratically in src/wiki/clash.ts. The facet reading was dropped because it
 * measured corpus size, not fan-out: facets are a closed vocabulary of eight,
 * so the count on facet=fact climbed 15→49 as the corpus grew. A category
 * with many members is not a god-node.
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

  const byReferent = new Map<string, string[]>();
  for (const c of graph.claims) {
    if (!isLive(c)) continue;
    // Dedupe within the claim: a claim naming two referents contributes to
    // both counts. A claim with no referents names no node and is no fan-out.
    for (const slug of new Set(c.referents)) {
      const ids = byReferent.get(slug);
      if (ids) ids.push(c.id);
      else byReferent.set(slug, [c.id]);
    }
  }

  const findings: LintFinding[] = [];
  // Sorted, so the finding order does not depend on which claim happened to be
  // written first — the determinism invariant is about the whole return value.
  for (const slug of [...byReferent.keys()].sort()) {
    const ids = byReferent.get(slug) ?? [];
    if (ids.length <= t.value) continue;

    const would = `note god-node on referent=${slug} claims=${ids.length} over fanout=${t.value}`;
    if (!shadowDecision(t, would, log)) continue;

    findings.push({
      kind: 'god-node-referent',
      subject: slug,
      detail: `${ids.length} live claims name the ${slug} referent, over a fanout of ${t.value}`,
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
 * `occasionless-range` — a live claim whose Range names no occasion.
 *
 * The measured classes (RESULTS 16.2, ticket 087): "generally" x7,
 * "in general", and the over-broad "throughout their life" the 085
 * review met in the wild. Q-21 makes Range mandatory so a claim cannot
 * float free of its occasion; this finding is the note that says one
 * does. Shadowed (Q-35) like its siblings: computed and logged, returned
 * only when the register flips.
 *
 * The subject is the claim id — the note renders beside the sentence.
 */
function occasionlessRangeFindings(
  graph: ClaimGraph,
  thresholds: ThresholdRegister,
  log: LogFn,
): LintFinding[] {
  const t = thresholds['lint.occasionlessRange'];
  // The register admits booleans, because two of its entries are switches.
  // This one is a switch; anything else is not a flag and is not acted on.
  if (typeof t.value !== 'boolean') return [];

  const findings: LintFinding[] = [];
  for (const c of graph.claims) {
    if (!isLive(c)) continue;
    if (namesOccasion(c.range)) continue;

    const would = `note occasionless-range on claim=${c.id} range="${c.range}"`;
    if (!shadowDecision(t, would, log)) continue;

    findings.push({
      kind: 'occasionless-range',
      subject: c.id,
      detail: `range "${c.range}" names no occasion`,
      refs: [c.id],
    });
  }
  return findings;
}

/**
 * `weak-evidence` — a live claim whose only cite is one of the labelled
 * danglers (074's measured set; the label record lives with the corpus,
 * outside the repo).
 *
 * The 085 review met the consequence: a snippet of the shape "This tool is
 * my attempt at those four parts in one window" — where "those four parts"
 * is a dangler — minted a claim that is opaque. The check is mechanical: the claim cites
 * exactly one snippet and that snippet id is in the labelled set. Nothing
 * else about the claim is judged — the note is about the evidence, never
 * the claim's content (Q-31, Q-15).
 *
 * Shadowed (Q-35) like its siblings.
 */
function weakEvidenceFindings(
  graph: ClaimGraph,
  thresholds: ThresholdRegister,
  log: LogFn,
): LintFinding[] {
  const t = thresholds['lint.weakEvidenceDangler'];
  if (typeof t.value !== 'boolean') return [];

  const findings: LintFinding[] = [];
  for (const c of graph.claims) {
    if (!isLive(c)) continue;
    if (c.cites.length !== 1) continue;

    const cite = c.cites[0];
    if (cite === undefined) continue;
    const at = cite.lastIndexOf('@');
    if (at <= 0) continue;
    if (!DANGLER_SNIPPET_IDS.has(cite.slice(0, at))) continue;

    const would = `note weak-evidence on claim=${c.id} cite=${cite}`;
    if (!shadowDecision(t, would, log)) continue;

    findings.push({
      kind: 'weak-evidence',
      subject: c.id,
      detail: `its only cite is a labelled dangler (074): ${cite}`,
      refs: [c.id, cite],
    });
  }
  return findings;
}

/** Unicode-aware, so a name with an accent in it is one token and not three. */
function nameTokens(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0));
}
/**
 * Closed-class words that never name an occasion: prepositions,
 * determiners, conjunctions, auxiliaries, pronouns, and the
 * subordinators that introduce one ("when", "while"). A range like
 * "when working with cheap devices" names its occasion through the
 * content words that survive this list; a range that survives with no
 * content word at all names nothing.
 */
const FUNCTION_WORDS: Record<string, true> = {
  'about': true,
  'above': true,
  'across': true,
  'after': true,
  'against': true,
  'along': true,
  'among': true,
  'around': true,
  'as': true,
  'at': true,
  'before': true,
  'behind': true,
  'below': true,
  'beneath': true,
  'beside': true,
  'between': true,
  'beyond': true,
  'by': true,
  'despite': true,
  'down': true,
  'during': true,
  'except': true,
  'for': true,
  'from': true,
  'in': true,
  'inside': true,
  'into': true,
  'near': true,
  'of': true,
  'off': true,
  'on': true,
  'onto': true,
  'out': true,
  'outside': true,
  'over': true,
  'past': true,
  'per': true,
  'since': true,
  'through': true,
  'throughout': true,
  'till': true,
  'to': true,
  'toward': true,
  'towards': true,
  'under': true,
  'underneath': true,
  'until': true,
  'unto': true,
  'up': true,
  'upon': true,
  'via': true,
  'with': true,
  'within': true,
  'without': true,
  'regarding': true,
  'concerning': true,
  'and': true,
  'or': true,
  'but': true,
  'nor': true,
  'so': true,
  'yet': true,
  'is': true,
  'are': true,
  'was': true,
  'were': true,
  'be': true,
  'been': true,
  'being': true,
  'am': true,
  'has': true,
  'have': true,
  'had': true,
  'do': true,
  'does': true,
  'did': true,
  'will': true,
  'would': true,
  'shall': true,
  'should': true,
  'can': true,
  'could': true,
  'may': true,
  'might': true,
  'must': true,
  'need': true,
  'ought': true,
  'used': true,
  'i': true,
  'me': true,
  'my': true,
  'mine': true,
  'we': true,
  'us': true,
  'our': true,
  'ours': true,
  'you': true,
  'your': true,
  'yours': true,
  'he': true,
  'him': true,
  'his': true,
  'she': true,
  'her': true,
  'hers': true,
  'it': true,
  'its': true,
  'they': true,
  'them': true,
  'their': true,
  'theirs': true,
  'who': true,
  'whom': true,
  'whose': true,
  'which': true,
  'what': true,
  'when': true,
  'where': true,
  'why': true,
  'how': true,
  'whether': true,
  'if': true,
  'that': true,
  'because': true,
  'though': true,
  'although': true,
  'unless': true,
  'whereas': true,
};

/**
 * Content words that still name no occasion: time adverbs without an
 * anchor ("generally", "currently"), and lifetime or deictic nouns
 * ("life", "point", "time"). These are the measured classes of ticket
 * 087 — RESULTS 16.2 counted `generally` x7 and `in general`; the 085
 * review met `throughout their life` in the wild.
 */
const OCCASIONLESS_WORDS: Record<string, true> = {
  'generally': true,
  'general': true,
  'currently': true,
  'current': true,
  'previously': true,
  'early': true,
  'late': true,
  'recently': true,
  'always': true,
  'usually': true,
  'often': true,
  'sometimes': true,
  'seldom': true,
  'rarely': true,
  'never': true,
  'eventually': true,
  'initially': true,
  'finally': true,
  'soon': true,
  'now': true,
  'then': true,
  'past': true,
  'present': true,
  'future': true,
  'life': true,
  'lifetime': true,
  'whole': true,
  'entire': true,
  'ever': true,
  'forever': true,
  'point': true,
  'time': true,
  'moment': true,
  'instance': true,
  'case': true,
  'period': true,
  'phase': true,
  'everyday': true,
  'ongoing': true,
  'overall': true,
  'broadly': true,
  'widely': true,
  'commonly': true,
  'typically': true,
  'occasionally': true,
  'regularly': true,
  'constantly': true,
  'continually': true,
  'continuously': true,
  'frequently': true,
  'mostly': true,
  'mainly': true,
  'primarily': true,
  'merely': true,
};

/**
 * Does this range name an occasion? A range is occasionless when every
 * content word in it is an OCCASIONLESS_WORDS member — the measured
 * classes — or when no content word survives at all.
 */
function namesOccasion(range: string): boolean {
  for (const token of nameTokens(range)) {
    if (!(token in FUNCTION_WORDS) && !(token in OCCASIONLESS_WORDS)) return true;
  }
  return false;
}

/**
 * The labelled dangler set, ticket 074 (label record kept with the corpus,
 * outside the repo): 96 of 139 measured snippets dangled, 2026-08-02. A snippet id here
 * carries a pronoun, demonstrative or definite description whose referent
 * is not identifiable from the snippet text alone — the 085 review met
 * the consequence when a claim minted from "those four parts" came out
 * opaque. The set is data, keyed by snippet id; the conformance test
 * keeps it equal to the doc's "yes" rows.
 */
/** The labelled dangler set, loaded once from data/dangler-snippet-ids.json. */
function loadDanglerIds(): ReadonlySet<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'data', 'dangler-snippet-ids.json'),
    join(process.cwd(), 'data', 'dangler-snippet-ids.json'),
  ];
  for (const p of candidates) {
    try {
      return new Set(JSON.parse(readFileSync(p, 'utf-8')) as string[]);
    } catch {
      // try the next candidate
    }
  }
  return new Set();
}
const DANGLER_SNIPPET_IDS: ReadonlySet<string> = loadDanglerIds();

