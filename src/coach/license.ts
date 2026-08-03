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
import type { QueueEntry } from '../types.js';
import { THRESHOLDS, shadowDecision, type ThresholdLogFn } from '../wiki/thresholds.js';

/**
 * The disk facts every licence decision is recomputed from (Q-3). `advice`
 * is the Direction's one note — the unread-note predicate (Q-76) cannot be
 * answered without it, and one file per Direction is a store invariant, so
 * the type carries it like every other record.
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
 /** The Direction's current advice note, or null when none has ever been minted. */
 advice: AdviceNote | null;
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

export type OfferEvaluation = {
 evaluated: { direction: string; claims: number }[];
 qualified: string[];
 /** At most one — top by claim count, ties by name. Null when none qualifies or all are declined/coached. */
 offered: { slug: string; name: string } | null;
};

/**
 * Reads THRESHOLDS['coach.offerMinClaims'] through shadowDecision (log
 * injected by the route). Candidates are the distinct non-empty
 * `QueueEntry.direction` values (slugged) plus un-coached DirectionRecords;
 * coached and offer-declined Directions are excluded BEFORE evaluation, and
 * the exclusion is visible in `evaluated` (an excluded Direction never
 * appears). Empty corpus: `{ evaluated: [], qualified: [], offered: null }`,
 * never a throw (090's data note).
 *
 * Within this slice the queue arm of the candidate pool is dead: the only
 * writer of `QueueEntry.direction` this plan adds is T6's reflection
 * entries, which fire only for already-coached Directions — and coached
 * Directions are excluded here. Until another slice mints direction-tagged
 * entries, candidates come from direction records alone (stubs left by
 * declines and un-coachings). Expected per 090's data note, not a defect.
 */
export function evaluateOffer(facts: CoachFacts, log: ThresholdLogFn): OfferEvaluation {
 const candidates = new Map<string, { slug: string; name: string }>();
 for (const e of facts.queueEntries) {
  if (e.direction !== undefined && e.direction.trim() !== '') {
   const slug = directionSlugFor(e.direction);
   if (!candidates.has(slug)) candidates.set(slug, { slug, name: e.direction });
  }
 }
 for (const d of facts.directions) {
  if (!d.coached) candidates.set(d.slug, { slug: d.slug, name: d.name });
 }
 const excluded = new Set(
  facts.directions.filter((d) => d.coached || d.offerDeclinedAt !== undefined).map((d) => d.slug),
 );

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
 const baseline = facts.advice ? facts.advice.mintedAt : direction.coachedAt;
 if (baseline === undefined) return null;

 const events: { event: CoachLicenseEvent; at: string }[] = [];
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
 if (direction.lastVisit !== undefined && direction.lastVisit > baseline) {
  events.push({ event: 'page-opened', at: direction.lastVisit });
 }
 if (events.length === 0) return null;
 events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
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
 const note = facts.advice;
 if (note && note.readAt === undefined) return true;
 const since = direction.lastVisit;
 if (since === undefined) return false;

 const questIds = new Set(facts.quests.filter((q) => q.direction === slug).map((q) => q.id));
 for (const t of facts.sittingTags) {
  if ((t.quest !== undefined && questIds.has(t.quest)) || t.direction === slug) {
   if (t.started > since) return true;
  }
 }
 for (const a of facts.artifacts) {
  if (a.direction === slug && a.declaredAt > since) return true;
 }
 for (const e of facts.queueEntries) {
  if (e.direction === slug && e.answeredAt !== undefined && e.answeredAt > since) return true;
 }
 if (note && note.mintedAt > since) return true;
 return false;
}
