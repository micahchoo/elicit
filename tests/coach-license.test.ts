/**
 * The coach licence module (090 T5) — offers, licensing events and
 * "something new", all computed from injected disk facts. Pure: no store,
 * no server. The empty-corpus case (090's data note) is asserted by name:
 * nothing qualified, nothing offered, nothing thrown.
 */

import { describe, it, expect } from 'vitest';
import { evaluateOffer, relevantClaims, licenseState, somethingNew, type CoachFacts } from '../src/coach/license.js';
import type { AdviceNote, ArtifactRecord, DirectionRecord, Quest } from '../src/coach/contract.js';
import type { SittingTag } from '../src/coach/store.js';
import type { QueueEntry } from '../src/types.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';

type Claim = { id: string; body: string; range: string; cites: string[]; archived?: boolean };

function claim(id: string, body: string, cites: string[] = []): Claim {
 return { id, body, range: 'the shop', cites };
}

function direction(overrides?: Partial<DirectionRecord>): DirectionRecord {
 return {
  slug: 'carpentry',
  name: 'Carpentry',
  coached: false,
  declinedOptions: [],
  ...overrides,
 };
}

function quest(id: string, overrides?: Partial<Quest>): Quest {
 return { id, direction: 'carpentry', act: 'Do the thing', cites: ['c1'], adoptedAt: '2026-08-03T00:00:00.000Z', ...overrides };
}

function tag(session: string, started: string, overrides?: Partial<SittingTag>): SittingTag {
 return { session, started, ...overrides };
}

function queueEntry(overrides?: Partial<QueueEntry>): QueueEntry {
 return {
  id: '01KZ0DJAKS53EHA0KJZTGZJHY5',
  status: 'pending',
  source: 'composed',
  license: 'CC0',
  question: 'What changed?',
  questionForm: 'theoretical',
  sharpness: 'sharp',
  horizon: 'session',
  created: '2026-08-03T00:00:00.000Z',
  ...overrides,
 };
}

function note(overrides?: Partial<AdviceNote>): AdviceNote {
 return {
  direction: 'carpentry',
  mintedAt: '2026-08-03T08:00:00.000Z',
  license: 'page-opened',
  options: [{ id: 'opt-1', text: 'Do A', cites: ['c1'] }],
  ...overrides,
 };
}

function facts(overrides?: Partial<CoachFacts>): CoachFacts {
 return {
  directions: [],
  quests: [],
  artifacts: [],
  sittingTags: [],
  queueEntries: [],
  claims: [],
  snippetSessions: new Map(),
  advice: null,
  ...overrides,
 };
}

function noopLog(): void {}

describe('relevantClaims (T5)', () => {
 it('a claim sharing a normalized name-term with the Direction is relevant', () => {
  const f = facts({
   claims: [claim('c1', 'carpentry changed how I build'), claim('c2', 'the workbench holds nothing')],
  });
  const got = relevantClaims(f, { slug: 'carpentry', name: 'Carpentry' });
  expect(got.map((c) => c.id)).toEqual(['c1']);
 });

 it('normalizes case and punctuation; terms under 4 characters are dropped', () => {
  const f = facts({
   claims: [claim('c1', 'CARPENTRY!'), claim('c2', 'carpentry'), claim('c3', 'go')],
  });
  // 'go' is under the floor and 'CARPENTRY!' normalizes to the same term.
  const got = relevantClaims(f, { slug: 'go', name: 'go' });
  expect(got.map((c) => c.id)).toEqual([]);
  const got2 = relevantClaims(f, { slug: 'carpentry', name: 'Carpentry' });
  expect(got2.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
 });

 it('a claim citing a snippet from a direction-tagged sitting is relevant by evidence, with no term overlap', () => {
  const f = facts({
   claims: [claim('c1', 'something entirely unrelated', ['snip1@1'])],
   snippetSessions: new Map([['snip1', 'sess-9']]),
   sittingTags: [tag('sess-9', '2026-08-03T07:00:00.000Z', { direction: 'carpentry' })],
  });
  const got = relevantClaims(f, { slug: 'carpentry', name: 'Carpentry' });
  expect(got.map((c) => c.id)).toEqual(['c1']);
 });

 it('a cite from a sitting tagged to ANOTHER direction is not evidence for this one', () => {
  const f = facts({
   claims: [claim('c1', 'something entirely unrelated', ['snip1@1'])],
   snippetSessions: new Map([['snip1', 'sess-9']]),
   sittingTags: [tag('sess-9', '2026-08-03T07:00:00.000Z', { direction: 'gardening' })],
  });
  const got = relevantClaims(f, { slug: 'carpentry', name: 'Carpentry' });
  expect(got).toEqual([]);
 });

 it('an archived claim is not relevant evidence', () => {
  const f = facts({
   claims: [claim('c1', 'carpentry changed how I build', []), { ...claim('c2', 'carpentry again'), archived: true }],
  });
  const got = relevantClaims(f, { slug: 'carpentry', name: 'Carpentry' });
  expect(got.map((c) => c.id)).toEqual(['c1']);
 });
});

describe('evaluateOffer (T5)', () => {
 it('a Direction whose name-terms match 3 claim bodies qualifies and is offered', () => {
  const f = facts({
   directions: [direction()],
   claims: [
    claim('c1', 'carpentry changed how I build'),
    claim('c2', 'carpentry is the craft I chose'),
    claim('c3', 'carpentry pays the rent'),
   ],
  });
  const ev = evaluateOffer(f, noopLog);
  expect(ev.evaluated).toEqual([{ direction: 'carpentry', claims: 3 }]);
  expect(ev.qualified).toEqual(['carpentry']);
  expect(ev.offered).toEqual({ slug: 'carpentry', name: 'Carpentry' });
 });

 it('below the offerMinClaims floor nothing qualifies but the evaluation is logged-visible', () => {
  const f = facts({
   directions: [direction()],
   claims: [claim('c1', 'carpentry changed how I build')],
  });
  const ev = evaluateOffer(f, noopLog);
  expect(ev.evaluated).toEqual([{ direction: 'carpentry', claims: 1 }]);
  expect(ev.qualified).toEqual([]);
  expect(ev.offered).toBeNull();
 });

 it('a coached Direction is excluded before evaluation — its absence is the visible exclusion', () => {
  const f = facts({
   directions: [direction({ coached: true })],
   claims: [claim('c1', 'carpentry changed how I build')],
  });
  const ev = evaluateOffer(f, noopLog);
  expect(ev.evaluated).toEqual([]);
  expect(ev.qualified).toEqual([]);
  expect(ev.offered).toBeNull();
 });

 it('a declined Direction is excluded forever', () => {
  const f = facts({
   directions: [direction({ offerDeclinedAt: '2026-08-03T06:00:00.000Z' })],
   claims: [claim('c1', 'carpentry changed how I build')],
  });
  const ev = evaluateOffer(f, noopLog);
  expect(ev.evaluated).toEqual([]);
  expect(ev.offered).toBeNull();
 });

 it('empty facts evaluate to an empty offer and never throw (090 data note)', () => {
  const ev = evaluateOffer(facts(), noopLog);
  expect(ev).toEqual({ evaluated: [], qualified: [], offered: null });
 });

 it('ties break by name, alphabetically', () => {
  const f = facts({
   directions: [direction({ slug: 'b', name: 'Banjo' }), direction({ slug: 'a', name: 'Archery' })],
   claims: [
    claim('c1', 'archery changed how I aim'),
    claim('c2', 'archery is a quiet craft'),
    claim('c3', 'archery takes patience'),
    claim('c4', 'banjo changed how I hear'),
    claim('c5', 'banjo is a loud craft'),
    claim('c6', 'banjo takes practice'),
   ],
  });
  const ev = evaluateOffer(f, noopLog);
  expect(ev.qualified.sort()).toEqual(['a', 'b']);
  expect(ev.offered).toEqual({ slug: 'a', name: 'Archery' });
 });

 it('the queue arm contributes distinct slugged directions', () => {
  const f = facts({
   queueEntries: [queueEntry({ direction: 'Gardening' }), queueEntry({ direction: 'Waiting' })],
  });
  const ev = evaluateOffer(f, noopLog);
  const slugs = ev.evaluated.map((e) => e.direction).sort();
  expect(slugs).toEqual(['d-waiting', 'gardening']);
 });

 it('reads the offerMinClaims floor through the register, and the floor is live under Q-62', () => {
  const t = THRESHOLDS['coach.offerMinClaims'];
  expect(t.live).toBe(true);
  expect(t.value).toBe(3);
  expect(t.graduatesWhen.length).toBeGreaterThan(20);
 });
});

describe('licenseState (T5)', () => {
 it('picks the newest of the four event kinds after the note mintedAt', () => {
  const f = facts({
   directions: [direction({ lastVisit: '2026-08-03T12:00:00.000Z' })],
   quests: [quest('q1')],
   artifacts: [
    { id: 'a1', direction: 'carpentry', pointer: '/x', name: 'the plan', sentenceSession: 's1', declaredAt: '2026-08-03T10:00:00.000Z' },
   ],
   sittingTags: [
    tag('sess-r', '2026-08-03T09:00:00.000Z', { quest: 'q1', direction: 'carpentry' }),
    tag('sess-s', '2026-08-03T11:00:00.000Z', { direction: 'carpentry' }),
   ],
   advice: note({ mintedAt: '2026-08-03T08:00:00.000Z' }),
  });
  const got = licenseState(f, 'carpentry');
  expect(got).toEqual({ event: 'page-opened', at: '2026-08-03T12:00:00.000Z' });
 });

 it('a direction-tagged queue entry answered after the note licenses sitting-touched', () => {
  const f = facts({
   directions: [direction()],
   queueEntries: [queueEntry({ direction: 'carpentry', status: 'answered', answeredAt: '2026-08-03T09:30:00.000Z' })],
   advice: note({ mintedAt: '2026-08-03T08:00:00.000Z' }),
  });
  const got = licenseState(f, 'carpentry');
  expect(got).toEqual({ event: 'sitting-touched', at: '2026-08-03T09:30:00.000Z' });
 });

 it('returns null when the note is newer than everything', () => {
  const f = facts({
   directions: [direction({ lastVisit: '2026-08-03T06:00:00.000Z' })],
   artifacts: [
    { id: 'a1', direction: 'carpentry', pointer: '/x', name: 'the plan', sentenceSession: 's1', declaredAt: '2026-08-03T09:00:00.000Z' },
   ],
   advice: note({ mintedAt: '2026-08-03T10:00:00.000Z' }),
  });
  expect(licenseState(f, 'carpentry')).toBeNull();
 });

 it('uses coachedAt as the baseline when no note exists', () => {
  const f = facts({
   directions: [direction({ coachedAt: '2026-08-03T07:00:00.000Z' })],
   artifacts: [
    { id: 'a1', direction: 'carpentry', pointer: '/x', name: 'the plan', sentenceSession: 's1', declaredAt: '2026-08-03T08:00:00.000Z' },
   ],
  });
  const got = licenseState(f, 'carpentry');
  expect(got).toEqual({ event: 'artifact-declared', at: '2026-08-03T08:00:00.000Z' });
 });

 it('returns null for an unknown direction', () => {
  expect(licenseState(facts(), 'nope')).toBeNull();
 });
});

describe('somethingNew (T5)', () => {
 it('true on unread advice', () => {
  const f = facts({
   directions: [direction({ coached: true, lastVisit: '2026-08-03T12:00:00.000Z' })],
   advice: note({ mintedAt: '2026-08-03T08:00:00.000Z' }),
  });
  expect(somethingNew(f, 'carpentry')).toBe(true);
 });

 it('false right after a visit stamp newer than every fact', () => {
  const f = facts({
   directions: [direction({ coached: true, lastVisit: '2026-08-03T12:00:00.000Z' })],
   artifacts: [
    { id: 'a1', direction: 'carpentry', pointer: '/x', name: 'the plan', sentenceSession: 's1', declaredAt: '2026-08-03T10:00:00.000Z' },
   ],
   advice: note({ mintedAt: '2026-08-03T09:00:00.000Z', readAt: '2026-08-03T11:00:00.000Z' }),
  });
  expect(somethingNew(f, 'carpentry')).toBe(false);
 });

 it('true on a return newer than the visit stamp', () => {
  const f = facts({
   directions: [direction({ coached: true, lastVisit: '2026-08-03T10:00:00.000Z' })],
   quests: [quest('q1')],
   sittingTags: [tag('sess-r', '2026-08-03T11:00:00.000Z', { quest: 'q1', direction: 'carpentry' })],
   advice: note({ mintedAt: '2026-08-03T09:00:00.000Z', readAt: '2026-08-03T09:30:00.000Z' }),
  });
  expect(somethingNew(f, 'carpentry')).toBe(true);
 });

 it('false for an unknown slug', () => {
  expect(somethingNew(facts(), 'nope')).toBe(false);
 });
});
