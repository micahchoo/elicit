/**
 * The Coach page and the waiting lines — ticket 090 T8. Server-composed
 * prose, testable without a DOM: one page per coached Direction (Q-76),
 * log half plus advice margin; at most one quiet waiting-surface line per
 * coached Direction where something new waits.
 *
 * The document rule governs every sentence: log entries carry no ULID and
 * no completion language — a dormant quest simply has no newer entries, so
 * dormancy renders as silence, never as a sentence (Q-24, Q-77). Artifacts
 * appear by NAME only; the pointer never enters a sentence (Q-78).
 */

import { somethingNew, type CoachFacts } from './license.js';
import type { Snippet } from '../types.js';

export type CoachLogEntry = {
 at: string;
 kind: 'quest-adopted' | 'quest-return' | 'quest-retired' | 'artifact' | 'sitting';
 /** One sentence, composed here. Identifier-free. */
 sentence: string;
 /** The person's own words, quoted (dark-serif ink on the page): the quest's return prose. */
 quote?: string;
};

export type CoachPage = {
 slug: string;
 name: string;
 /** Chronological, oldest first — a log reads down the page. */
 log: CoachLogEntry[];
 advice: { mintedAt: string; unread: boolean; options: { id: string; text: string }[] } | null;
 /** The empty-state sentence when the log is empty — quiet, never an exhortation. */
 opening: string;
};

/** Remove every identifier a composed sentence might carry (Q-15: nothing names). */
function scrub(text: string): string {
 return text
  .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '')
  .replace(/\s+/g, ' ')
  .trim();
}

export function buildCoachPage(facts: CoachFacts, snippets: Snippet[], slug: string): CoachPage | null {
 const direction = facts.directions.find((d) => d.slug === slug);
 if (!direction || !direction.coached) return null;

 const entries: CoachLogEntry[] = [];
 for (const q of facts.quests.filter((q) => q.direction === slug)) {
  entries.push({ at: q.adoptedAt, kind: 'quest-adopted', sentence: scrub(`you took up a quest — ${q.act}`) });
  if (q.retiredAt !== undefined) {
   entries.push({ at: q.retiredAt, kind: 'quest-retired', sentence: scrub(`you retired a quest — ${q.act}`) });
  }
 }
 for (const a of facts.artifacts.filter((a) => a.direction === slug)) {
  entries.push({ at: a.declaredAt, kind: 'artifact', sentence: scrub(`you declared ${a.name}`) });
 }

 const questIds = new Set(facts.quests.filter((q) => q.direction === slug).map((q) => q.id));
 for (const t of facts.sittingTags) {
  if (t.direction !== slug) continue;
  if (t.quest !== undefined && questIds.has(t.quest)) {
   // The return quote is the return-Snippets' prose; before review lands
   // them, the return still logs — as an entry without a quote.
   const prose = snippets.filter((s) => s.provenance.session === t.session).map((s) => s.prose);
   entries.push({
    at: t.started,
    kind: 'quest-return',
    sentence: 'you came back with something for a quest',
    ...(prose.length > 0 ? { quote: prose.join('\n\n') } : {}),
   });
  } else {
   entries.push({ at: t.started, kind: 'sitting', sentence: 'you sat with this direction' });
  }
 }
 entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

 return {
  slug,
  name: direction.name,
  log: entries,
  advice: facts.advice
   ? {
    mintedAt: facts.advice.mintedAt,
    unread: facts.advice.readAt === undefined,
    options: facts.advice.options.map((o) => ({ id: o.id, text: o.text })),
   }
   : null,
  opening: entries.length === 0 ? 'nothing here yet — this page fills as you act' : '',
 };
}

/** Q-76's quiet lines: one per coached Direction with something new, sorted for stable output. */
export function waitingLines(facts: CoachFacts): { slug: string; sentence: string }[] {
 return facts.directions
  .filter((d) => d.coached && somethingNew(facts, d.slug))
  .map((d) => ({ slug: d.slug, sentence: `something new waits where you are learning ${d.name}` }))
  .sort((a, b) => a.sentence.localeCompare(b.sentence));
}

/**
 * Q-37's dimmed-line wording for the coached offer. Named
 * `coachOfferSentence` because `offerSentence` is already exported by
 * web/reach-line.ts and the mechanism sweep matches callers by identifier
 * alone — the same collision that named `directionSlugFor` (090 T2).
 */
export function coachOfferSentence(offer: { name: string }): string {
 return `coaching is open for ${offer.name} — a word declines`;
}
