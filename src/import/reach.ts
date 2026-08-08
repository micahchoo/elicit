/**
 * Reach — the licence that offers ONE unharvested region, computed from
 * names the person chose and the words of the questions actually waiting
 * (Q-62, seeding Task 11).
 *
 * The licence is names-only. A region node's terms come from its path
 * segments — the person's own organisation (Q-68) — and Reach never opens a
 * note: the survey's counts and the node's own path are all it may consult.
 * No frontmatter parser, no scanner import; the decline ledger is the only
 * disk it writes.
 *
 * The mechanism only OFFERS. Nothing happens on silence, and every
 * evaluation is logged, so Q-62's licence to ship live IS the record: a
 * reader can tell "nothing reached" from "the mechanism is broken".
 */

import { join } from 'node:path';

import { appendEvent } from '../log/activity.js';
import { appendLine, readLines } from '../jsonl.js';
import type { Survey } from './survey.js';
import type { LogFn } from '../wiki/contract.js';
import { THRESHOLDS } from '../wiki/thresholds.js';

export type ReachOffer = { path: string; unread: number; terms: string[] };

/** Terms under this length are noise, not names: 'run' cannot name a region. */
const MIN_TERM = 4;

/**
 * A small CLOSED stopword list: function words and question scaffolding
 * that would make every region look like every other. Closed means it is a
 * fixed table, not a lemma list that grows by observation — the same list
 * normalises both sides of every comparison, which is all it has to do.
 */
const STOPWORDS: Record<string, true> = {
 about: true, after: true, again: true, also: true, been: true, being: true,
 did: true, does: true, from: true, have: true, into: true, more: true,
 only: true, over: true, some: true, than: true, that: true, their: true,
 there: true, these: true, they: true, this: true, those: true, under: true,
 very: true, were: true, what: true, when: true, where: true, which: true,
 while: true, who: true, with: true, would: true, your: true,
};

/**
 * The one normaliser, for BOTH sides: a question and a folder name must
 * fall apart into the same words. Lowercased, split on anything that is
 * not a letter, camelCase boundaries split BEFORE lowercasing so
 * 'therapySessions' and 'therapy sessions' are the same two terms, terms
 * under 4 characters dropped, stopwords dropped, deduped by the Set.
 */
export function termsOf(text: string): Set<string> {
 const terms = new Set<string>();
 const spaced = text.replace(/([a-z])([A-Z])/g, '$1 $2');
 for (const word of spaced.toLowerCase().split(/[^a-z]+/)) {
  if (word.length < MIN_TERM || STOPWORDS[word] === true) continue;
  terms.add(word);
 }
 return terms;
}

/** A node's terms: the union of its path segments' terms, each segment
 * normalised by the same termsOf that normalises the questions. */
function nodeTerms(path: string): Set<string> {
 const terms = new Set<string>();
 for (const segment of path.split('/')) {
  if (segment === '') continue;
  for (const t of termsOf(segment)) terms.add(t);
 }
 return terms;
}

/**
 * Evaluate the licence: exactly one offer, or null. Every run emits one
 * `reach-evaluated` record — even when there is no survey, no live terms
 * and no candidate — and an offered run emits `reach-offered` as well.
 */
export function reachOffer(deps: {
 survey: Survey | null;
 liveTerms: () => Set<string>;
 declined: (path: string) => string | null; // ISO of the last decline, or null
 log: LogFn;
 minOverlap?: number; // default: THRESHOLDS['reach.nameOverlapMinTerms']
}): ReachOffer | null {
 const { survey, liveTerms, declined, log } = deps;
 const entry = THRESHOLDS['reach.nameOverlapMinTerms'];
 const minOverlap = deps.minOverlap ?? (typeof entry.value === 'number' ? entry.value : 2);

 const live = liveTerms();
 const nodes = survey?.nodes ?? [];

 type Candidate = { path: string; unread: number; terms: string[]; overlap: number };
 const candidates: Candidate[] = [];
 for (const node of nodes) {
  if (node.unread <= 0) continue;
  const matched = [...nodeTerms(node.path)].filter((t) => live.has(t));
  if (matched.length < minOverlap) continue;
  candidates.push({ path: node.path, unread: node.unread, terms: matched, overlap: matched.length });
 }

 // Rank: overlap desc, then least-recently-declined asc (never-declined
 // first — a decline REORDERS, it never suppresses, Q-22), then unread desc.
 candidates.sort((a, b) => {
  if (a.overlap !== b.overlap) return b.overlap - a.overlap;
  const da = declined(a.path);
  const db = declined(b.path);
  if (da === null && db !== null) return -1;
  if (db === null && da !== null) return 1;
  if (da !== null && db !== null && da !== db) return da < db ? -1 : 1;
  if (a.unread !== b.unread) return b.unread - a.unread;
  return 0;
 });

 const winner = candidates[0] ?? null;
 const at = new Date().toISOString();
 log({
  at,
  actor: 'clerk',
  kind: 'reach-evaluated',
  detail:
   `nodes=${nodes.length} candidates=${candidates.length} ` +
   `best=${winner?.path ?? 'none'} offered=${winner !== null} overlap=${winner?.overlap ?? 0}`,
 });
 if (winner) {
  log({
   at,
   actor: 'clerk',
   kind: 'reach-offered',
   detail: `path=${winner.path} unread=${winner.unread} terms=${winner.terms.join(',')}`,
  });
  return { path: winner.path, unread: winner.unread, terms: winner.terms };
 }
 return null;
}

const DECLINE_LEDGER = join('imports', 'reach-declines.jsonl');

/** Record one decline: one JSON line in the ledger, and one activity event. */
export function appendReachDecline(vaultRoot: string, path: string): void {
 const at = new Date().toISOString();
 appendLine(vaultRoot, DECLINE_LEDGER, JSON.stringify({ at, path }));
 appendEvent(vaultRoot, {
  at,
  actor: 'elicitor',
  kind: 'reach-declined',
  detail: `path=${path}`,
 });
}

/** The decline ledger: Map<path, lastDeclineISO>. Latest line wins; the
 * ledger is re-read on every call — a decline is a fact, not a cache. */
export function reachDeclines(vaultRoot: string): Map<string, string> {
 const declines = new Map<string, string>();
 for (const raw of readLines(vaultRoot, DECLINE_LEDGER)) {
  if (raw.trim() === '') continue;
  try {
   const line = JSON.parse(raw) as { at?: unknown; path?: unknown };
   if (typeof line?.at === 'string' && typeof line?.path === 'string') {
    // Latest line wins; re-read every call, no cache.
    declines.set(line.path, line.at);
   }
  } catch {
   // A half-written final line must not hide the declines above it.
  }
 }
 return declines;
}
