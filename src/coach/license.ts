/**
 * The coach licence — ticket 090 T5. Three questions the routes ask are
 * answered here, purely, from injected disk facts: may we offer coaching on
 * a Direction (Q-73)? what event, if any, licenses a fresh advice note
 * (Q-77)? does anything new wait since the last visit (Q-76)?
 *
 * Zero LLM. No predicate anywhere reads elapsed time (Q-77): every
 * comparison is between recorded event times. A restart changes no answer,
 * and a test needs no server.
 */

import {
 directionSlugFor,
 type AdviceNote,
 type ArtifactRecord,
 type CoachLicenseEvent,
 type DirectionRecord,
 type Quest,
} from './contract.js';
import type { SittingTag } from './store.js';
 import type { QueueEntry, Snippet } from '../types.js';
 import { contentWordsOf } from '../index/lexical.js';
 import { THRESHOLDS, shadowDecision } from '../wiki/thresholds.js'
import type { ThresholdLogFn } from '../domain/thresholds.js';

/**
 * The disk facts every licence decision is recomputed from (Q-3). `advice`
 * holds each Direction's one note, keyed by slug — waitingLines evaluates
 * several Directions at once, and the unread-note predicate (Q-76) needs
 * every note in one snapshot. One file per Direction is a store invariant.
 * `snippets` carries the return prose the advice prompt quotes (Q-75) —
 * the person's words, never an artifact pointer (Q-78).
 */
export type CoachFacts = {
 directions: DirectionRecord[];
 quests: Quest[];
 artifacts: ArtifactRecord[];
 sittingTags: SittingTag[];
 queueEntries: QueueEntry[];
 claims: { id: string; body: string; range: string; cites: string[]; archived?: boolean }[];
 /** "snippetId@version"-id part → provenance.session — resolves a cite to its sitting. */
 snippetSessions: Map<string, string>;
 /** slug → the Direction's current advice note; absent slug means never minted. */
 advice: Map<string, AdviceNote>;
 /** The corpus the coach may quote — return prose only (Q-78: names, never pointers). */
 snippets: Snippet[];
};

/**
 * Name-term overlap ∪ evidence link — Finding 3's bootstrap rule. Mechanical,
 * no model. Term normalization: lowercase, strip non-alphanumerics, and the
 * floor keeps terms of length ≥ 4 (Exploratory OQ, T5) — a direction named
 * "go" under-matches, which is the safe direction. Evidence-relevant: any
 * cite whose snippet's session is a sitting tagged to this Direction.
 */
export function relevantClaims(
 facts: CoachFacts,
 direction: { slug: string; name: string },
): CoachFacts['claims'] {
 // Lowercase word terms of length ≥ 4 — the normalization floor (OQ T5).
 const nameTerms = new Set(
  direction.name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4),
 );
 const taggedSessions = new Set(
  facts.sittingTags.filter((t) => t.direction === direction.slug).map((t) => t.session),
 );
 return facts.claims.filter((c) => {
  if (c.archived) return false;
  const citesTaggedSitting = c.cites.some((cite) => {
   const snippetId = cite.split('@')[0] ?? '';
   const session = facts.snippetSessions.get(snippetId);
   return session !== undefined && taggedSessions.has(session);
  });
  if (citesTaggedSitting) return true;
  return c.body.toLowerCase().split(/[^a-z0-9]+/).some((t) => t.length >= 4 && nameTerms.has(t));
 });
}
 
 /**
  * Q-110 door 1: cluster claims by content-word overlap. Two claims share a
  * theme when they share >= 2 content words (len >= 4, claim-frame words
  * excluded). Union-find merges connected components; each cluster of >= 2
  * claims is a theme, named by its most common content word (title-cased).
  * The clustering mechanism is simple by design — every evaluation logs the
  * cluster sizes it saw (Q-111), so the threshold can be tuned from real
  * data. Tuned 2026-08-06 against the 117-claim Tomas vault: at >= 1 shared
  * word single-link chaining collapses a one-person corpus into one blob
  * (104-claim "User"; frame-filtered it just renames to "Bakery"); at >= 2
  * the same corpus yields 14 themes whose top clusters are real (former
  * academia: 16, flour: 5, storefront: 4).
  */
 /**
  * Closed-class words excluded from NAMING only (never from clustering):
  * modifiers, numbers, auxiliaries and generic nouns. A cluster's most
  * distinctive frequent word is often one of these — the ex-professor
  * cluster was named "Former", the three-employees cluster "Three" — and a
  * modifier is never the topic. Skipping them falls through to the topical
  * word (measured on the same corpus: "Students", "Luisa", "Fabricated").
  * A miss here costs only name quality, so a small closed list is enough.
  */
 const GENERIC_NAME_WORDS = new Set([
  'former', 'three', 'four', 'five', 'years', 'strong', 'certain', 'entire',
  'most', 'more', 'less', 'will', 'ever', 'cannot', 'would', 'could',
  'should', 'must', 'might', 'about', 'because', 'without', 'being',
  'having', 'sense', 'thing', 'things', 'part', 'time', 'way', 'life',
  'feeling', 'something', 'someone', 'still', 'even', 'also', 'only',
  'both', 'while', 'when', 'where', 'which', 'what', 'there', 'these',
  'those', 'than', 'then', 'into', 'over', 'under', 'after', 'before',
  'during', 'made', 'make', 'makes', 'keep', 'keeps', 'kept', 'know',
  'knows', 'knew', 'longer', 'rather', 'despite', 'though', 'through',
 ]);

 /**
  * Claim-frame vocabulary, excluded from theme keys. Every claim body is
  * phrased as a report — "The user states that…" — so the subject word and
  * the reporting verbs appear in nearly every claim. Left in, they union
  * everything into one mega-cluster (measured: 104 of 106 claims in a
  * single "User" theme that had absorbed every real theme beside it).
  * These words are the FRAME of a claim, never its topic.
  */
 const CLAIM_FRAME_WORDS = new Set([
  'user', 'person', 'they', 'their', 'them',
  'states', 'stated', 'describes', 'described', 'explains', 'explained',
  'expresses', 'expressed', 'mentions', 'mentioned', 'indicates', 'indicated',
  'suggests', 'suggested', 'believes', 'believed', 'asserts', 'asserted',
  'notes', 'noted', 'reports', 'reported', 'acknowledges', 'acknowledged',
  'feels', 'felt', 'thinks', 'thought', 'says', 'said', 'tells', 'told',
  'claims', 'claimed', 'recognizes', 'recognized', 'realizes', 'realized',
  'considers', 'considered', 'identifies', 'identified', 'posits',
  'currently', 'previously', 'specific', 'specifically',
 ]);

 export function clusterClaimsByTheme(
   claims: { id: string; body: string }[],
   /**
    * Additional frame words for this vault — the profile's name and pronoun
    * tokens. With claims phrased "Ada keeps…", the name is the word every
    * claim shares: exactly the "user" mega-cluster failure, wearing the
    * person's own name.
    */
   extraFrameWords: Iterable<string> = [],
 ): Map<string, { claims: number; name: string }> {
   const frame = new Set(CLAIM_FRAME_WORDS);
   for (const w of extraFrameWords) frame.add(w.toLowerCase());
   // Extract content words (len >= 4) per claim; the claim frame is not content.
   const cws = claims.map(c => ({
     id: c.id,
     words: [...contentWordsOf(c.body)].filter(w => w.length >= 4 && !frame.has(w)),
   }));
 
   // Union-find over claims that share >= 2 content words. One shared word
   // is coincidence in a corpus where every claim is about one life; two is
   // a topic.
   const parent = new Map<string, string>();
   const find = (x: string): string => {
     const p = parent.get(x);
     if (!p || p === x) return x;
     const r = find(p);
     parent.set(x, r);
     return r;
   };
   for (const c of cws) parent.set(c.id, c.id);
   for (let i = 0; i < cws.length; i++) {
     for (let j = i + 1; j < cws.length; j++) {
       const wj = new Set(cws[j]!.words);
       const shared = new Set(cws[i]!.words.filter(w => wj.has(w)));
       if (shared.size >= 2) {
         parent.set(find(cws[i]!.id), find(cws[j]!.id));
       }
     }
   }
 
   // Collect clusters
   const clusters = new Map<string, { ids: string[]; allWords: string[] }>();
   for (const c of cws) {
     const root = find(c.id);
     let cl = clusters.get(root);
     if (!cl) { cl = { ids: [], allWords: [] }; clusters.set(root, cl); }
     cl.ids.push(c.id);
     cl.allWords.push(...c.words);
   }
 
   // Name each cluster by its most DISTINCTIVE frequent word: in-cluster
   // count weighted by rarity across the whole claim set (tf-idf shape).
   // Raw frequency named the ex-professor cluster "Former" and the
   // three-employees cluster "Three" — the most common word in a cluster is
   // often corpus-wide filler, and filler carries no theme. Rarity weighting
   // makes the name the word this cluster uses that the rest do not.
   const df = new Map<string, number>();
   for (const c of cws) {
     for (const w of new Set(c.words)) df.set(w, (df.get(w) ?? 0) + 1);
   }
   const total = Math.max(1, cws.length);
   const result = new Map<string, { claims: number; name: string }>();
   for (const [root, cl] of clusters) {
     if (cl.ids.length < 2) continue; // singleton — not a theme
     const freq = new Map<string, number>();
     for (const w of cl.allWords) freq.set(w, (freq.get(w) ?? 0) + 1);
     // Three passes, each weaker than the last: distinctive topical word
     // with >= 2 uses; then any word with >= 2 uses; then anything at all.
     const pick = (skipGeneric: boolean, minUses: number): string => {
       let best = '';
       let bestScore = -1;
       for (const [w, n] of freq) {
         if (skipGeneric && GENERIC_NAME_WORDS.has(w)) continue;
         if (n < minUses) continue;
         const score = n * Math.log(1 + total / (df.get(w) ?? 1));
         if (score > bestScore || (score === bestScore && w.length > best.length)) {
           best = w; bestScore = score;
         }
       }
       return best;
     };
     const best = pick(true, 2) || pick(false, 2) || pick(false, 1);
     const name = best.charAt(0).toUpperCase() + best.slice(1);
     result.set(root, { claims: cl.ids.length, name });
   }
   return result;
 }
 
 export type OfferEvaluation = {
   evaluated: { direction: string; claims: number }[];
   qualified: string[];
   /** At most one — top by claim count, ties by name. Null when none qualifies or all are declined/coached. */
   offered: { slug: string; name: string } | null;
 };
 
 /**
  * Reads THRESHOLDS['coach.offerMinClaims'] through shadowDecision (log
  * injected by the route). Candidates are un-coached DirectionRecords only —
  * the queue arm was dead (its own docstring: only reflection entries write
  * QueueEntry.direction, and those fire only for already-coached Directions,
  * which are excluded here). Q-110 door 1 seeds un-coached records through
  * the docket; door 2 seeds them through the wiki verb.
  *
  * Q-112: a parked seeded Direction may re-offer when its relevant-claim
  * count has grown by 3+ since it was parked. The re-offer is logged.
  *
  * Measured 2026-08-05 across six archive vaults (gate-repair): the gate
  * FIRES once claims exist. 1003 `coach-offer` evaluations; every early one
  * read `directions=0 qualified=0 offered=none` because no DirectionRecord
  * existed, and the same vault that seeded 13 directions qualified 12 and
  * offered. `offerMinClaims=3` sits below the real per-theme claim counts
  * (Tomas vault: clusterSizes=[15,5,5,4,2,2,2,3,2,4,2,2,4] — 7 of 13 themes
  * clear the bar). The binding constraint is NOT coach math: it is sweep
  * throughput (`mint.callsPerRun=12`), which starved three of five eval
  * personas to zero claims. A door that opens onto a starved room is still
  * closed.
  *
  * Empty corpus: `{ evaluated: [], qualified: [], offered: null }`,
  * never a throw (090's data note).
  */
 export function evaluateOffer(facts: CoachFacts, log: ThresholdLogFn): OfferEvaluation {
   const candidates = new Map<string, { slug: string; name: string }>();
   for (const d of facts.directions) {
     if (!d.coached) candidates.set(d.slug, { slug: d.slug, name: d.name });
   }
   const excluded = new Set(
     facts.directions.filter((d) => d.coached || d.offerDeclinedAt !== undefined).map((d) => d.slug),
   );
 
   // Q-112: re-evaluate parked seeded directions
   for (const d of facts.directions) {
     if (d.seededOfferParkedAt === undefined) continue;
     if (excluded.has(d.slug)) continue;
     const claims = relevantClaims(facts, { slug: d.slug, name: d.name }).length;
     const bar = (d.seededOfferParkedClaimCount ?? 0) + 3;
     if (claims < bar) {
       excluded.add(d.slug); // still parked — not enough new claims
     } else {
       // Re-offer! Unpark by clearing park fields (write happens in the route).
       const parkedCount = d.seededOfferParkedClaimCount ?? 0;
       delete d.seededOfferParkedAt;
       delete d.seededOfferParkedClaimCount;
       log({
         at: new Date().toISOString(), actor: 'clerk', kind: 'coach-seeded-reoffer',
         detail: `slug=${d.slug} parkedClaims=${parkedCount} currentClaims=${claims}`,
       });
     }
   }
 
   const minClaims = THRESHOLDS['coach.offerMinClaims']!;
   const gate = shadowDecision(minClaims, 'offer coaching where enough has gathered', log);
   const evaluated: { direction: string; claims: number }[] = [];
   const qualified: string[] = [];
   for (const cand of candidates.values()) {
     if (excluded.has(cand.slug)) continue;
     const claims = relevantClaims(facts, cand).length;
     evaluated.push({ direction: cand.slug, claims });
     if (gate && claims >= (minClaims.value as number)) qualified.push(cand.slug);
   }
   if (qualified.length === 0) return { evaluated, qualified, offered: null };
   const best = evaluated
     .filter((e) => qualified.includes(e.direction))
     .sort((a, b) => b.claims - a.claims || a.direction.localeCompare(b.direction))[0]!;
   const cand = candidates.get(best.direction)!;
   return { evaluated, qualified, offered: { slug: cand.slug, name: cand.name } };
}

/**
 * Every Q-77 event for one direction strictly after `baseline`, newest
 * first. The ONE walk of the four collections (sitting tags, artifacts,
 * queue entries, last visit) — licenseState and somethingNew read this
 * instead of each re-walking them with a different baseline, so "what
 * happened since" has one implementation.
 */
type DirectionEvent = { event: CoachLicenseEvent; at: string };

function directionEventsSince(facts: CoachFacts, slug: string, baseline: string): DirectionEvent[] {
 const events: DirectionEvent[] = [];
 const questIds = new Set(facts.quests.filter((q) => q.direction === slug).map((q) => q.id));
 for (const t of facts.sittingTags) {
  if (t.quest !== undefined && questIds.has(t.quest) && t.started > baseline) {
   events.push({ event: 'quest-return', at: t.started });
  }
  if (t.direction === slug && t.started > baseline) {
   events.push({ event: 'sitting-touched', at: t.started });
  }
 }
 for (const a of facts.artifacts) {
  if (a.direction === slug && a.declaredAt > baseline) {
   events.push({ event: 'artifact-declared', at: a.declaredAt });
  }
 }
 for (const e of facts.queueEntries) {
  if (e.direction === slug && e.answeredAt !== undefined && e.answeredAt > baseline) {
   events.push({ event: 'sitting-touched', at: e.answeredAt });
  }
 }
 const dir = facts.directions.find((d) => d.slug === slug);
 if (dir !== undefined && dir.lastVisit !== undefined && dir.lastVisit > baseline) {
  events.push({ event: 'page-opened', at: dir.lastVisit });
 }
 events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
 return events;
}

/**
 * The newest Q-77 event after the current note's mintedAt (or after
 * coachedAt when no note). Null = nothing licenses. Elapsed time appears in
 * no predicate: comparisons are between recorded event times only.
 * Ties sort by the event's insertion order below (quest-return first) —
 * two events sharing one timestamp are both true, and either answers the
 * route's question.
 */
export function licenseState(
 facts: CoachFacts,
 slug: string,
): { event: CoachLicenseEvent; at: string } | null {
 const direction = facts.directions.find((d) => d.slug === slug);
 if (!direction) return null;
 const baseline = facts.advice.get(slug)?.mintedAt ?? direction.coachedAt;
 if (baseline === undefined) return null;

 const events = directionEventsSince(facts, slug, baseline);
 if (events.length === 0) return null;
 return events[0]!;
}

/**
 * Q-76's quiet line predicate: unread advice, or a quest/return/artifact
 * fact newer than lastVisit. Never visited and nothing unread → nothing
 * has happened since the person last looked, so the quiet line stays dark.
 */
export function somethingNew(facts: CoachFacts, slug: string): boolean {
 const direction = facts.directions.find((d) => d.slug === slug);
 if (!direction) return false;
 const note = facts.advice.get(slug);
 if (note && note.readAt === undefined) return true;
 const since = direction.lastVisit;
 if (since === undefined) return false;

 // The shared events view walks the four collections; the unread note is
 // the one extra source (a newer note without a visit is still new).
 if (directionEventsSince(facts, slug, since).length > 0) return true;
 if (note && note.mintedAt > since) return true;
 return false;
}
