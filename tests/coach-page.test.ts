/**
 * The coach page and waiting lines (090 T8) — server-composed prose,
 * testable without a DOM. One page per coached Direction (Q-76): a
 * chronological log half and the one-note advice margin; one quiet waiting
 * line only where something new waits.
 */

import { describe, it, expect } from 'vitest';
import { buildCoachPage, waitingLines, coachOfferSentence } from '../src/coach/page.js';
import { somethingNew, type CoachFacts } from '../src/coach/license.js';
import type { AdviceNote, DirectionRecord, Quest } from '../src/coach/contract.js';
import type { SittingTag } from '../src/coach/store.js';
import type { Snippet } from '../src/types.js';

const ULID = '01KZ0DJAKS53EHA0KJZTGZJHY5';

function direction(overrides?: Partial<DirectionRecord>): DirectionRecord {
 return {
  slug: 'cooking',
  name: 'Cooking',
  coached: true,
  coachedAt: '2026-08-03T07:00:00.000Z',
  declinedOptions: [],
  ...overrides,
 };
}

function quest(id: string, overrides?: Partial<Quest>): Quest {
 return { id, direction: 'cooking', act: 'Cook one meal from scratch', cites: ['c1'], adoptedAt: '2026-08-03T10:00:00.000Z', ...overrides };
}

function tag(session: string, started: string, overrides?: Partial<SittingTag>): SittingTag {
 return { session, started, ...overrides };
}

function snippet(id: string, session: string, prose: string): Snippet {
 return { id, version: 1, captured: '2026-08-03T09:00:00.000Z', provenance: { kind: 'unprompted', session, question: '', questionForm: 'theoretical' }, prose };
}

function note(overrides?: Partial<AdviceNote>): AdviceNote {
 return {
  direction: 'cooking',
  mintedAt: '2026-08-03T08:00:00.000Z',
  license: 'page-opened',
  options: [
   { id: 'opt-1', text: 'Cook one new recipe', cites: ['c1'] },
   { id: 'opt-2', text: 'Write down your knife setup', cites: ['c2'] },
  ],
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
  snippets: [],
  ...overrides,
 };
}

/** A direction whose log has every kind, in a deliberately shuffled order. */
function fullFacts(): CoachFacts {
 return facts({
  directions: [direction()],
  quests: [
   quest('q2', { adoptedAt: '2026-08-03T09:00:00.000Z' }),
   quest('q1', { adoptedAt: '2026-08-03T10:00:00.000Z', retiredAt: '2026-08-03T12:00:00.000Z' }),
  ],
  artifacts: [
   { id: 'a1', direction: 'cooking', pointer: '/home/me/notes/secret.pdf', name: 'the kitchen log', sentenceSession: 's1', declaredAt: '2026-08-03T11:00:00.000Z' },
  ],
  sittingTags: [tag('sess-r', '2026-08-03T10:30:00.000Z', { quest: 'q1', direction: 'cooking' })],
  advice: note(),
 });
}

describe('buildCoachPage (090 T8)', () => {
 it('is chronological (oldest first) across every log kind', () => {
  const page = buildCoachPage(fullFacts(), [], 'cooking')!;
  expect(page.log.map((e) => e.kind)).toEqual([
   'quest-adopted',
   'quest-adopted',
   'quest-return',
   'artifact',
   'quest-retired',
  ]);
  expect(page.log.map((e) => e.at)).toEqual([
   '2026-08-03T09:00:00.000Z',
   '2026-08-03T10:00:00.000Z',
   '2026-08-03T10:30:00.000Z',
   '2026-08-03T11:00:00.000Z',
   '2026-08-03T12:00:00.000Z',
  ]);
 });

 it('quotes a return snippet — the person\'s words, in the quote slot', () => {
  const prose = 'the rice burned because I rushed';
  const page = buildCoachPage(fullFacts(), [snippet('snip-r', 'sess-r', prose)], 'cooking')!;
  const ret = page.log.find((e) => e.kind === 'quest-return')!;
  expect(ret.quote).toBe(prose);
  // The log sentence itself stays agent-plane; the quote carries the words.
  expect(ret.sentence).toBe('you came back with something for a quest');
 });

 it('a return sitting whose review has not landed logs without a quote', () => {
  const page = buildCoachPage(fullFacts(), [], 'cooking')!;
  const ret = page.log.find((e) => e.kind === 'quest-return')!;
  expect(ret.quote).toBeUndefined();
 });

 it('shows the artifact by NAME, and the pointer appears nowhere in the serialized page', () => {
  const page = buildCoachPage(fullFacts(), [], 'cooking')!;
  const art = page.log.find((e) => e.kind === 'artifact')!;
  expect(art.sentence).toContain('the kitchen log');
  expect(JSON.stringify(page)).not.toContain('secret.pdf');
  expect(JSON.stringify(page)).not.toContain('/home/me/notes');
 });

 it('no log entry carries a ULID or completion language', () => {
  const f = facts({
   directions: [direction()],
   quests: [quest('q1', { act: `go read ${ULID} and report back`, retiredAt: '2026-08-03T12:00:00.000Z' })],
  });
  const page = buildCoachPage(f, [], 'cooking')!;
  for (const e of page.log) {
   expect(e.sentence).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);
   expect(e.sentence.toLowerCase()).not.toMatch(/complete|fail|progress|streak/);
  }
 });

 it('the advice margin carries the one note, unread or read, with option ids', () => {
  const page = buildCoachPage(fullFacts(), [], 'cooking')!;
  expect(page.advice).toEqual({
   mintedAt: '2026-08-03T08:00:00.000Z',
   unread: true,
   options: [
    { id: 'opt-1', text: 'Cook one new recipe' },
    { id: 'opt-2', text: 'Write down your knife setup' },
   ],
  });
  const read = buildCoachPage(facts({ directions: [direction()], advice: note({ readAt: '2026-08-03T09:00:00.000Z' }) }), [], 'cooking')!;
  expect(read.advice!.unread).toBe(false);
  const none = buildCoachPage(facts({ directions: [direction()] }), [], 'cooking')!;
  expect(none.advice).toBeNull();
 });

 it('an empty log renders the quiet opening, never an exhortation', () => {
  const page = buildCoachPage(facts({ directions: [direction()] }), [], 'cooking')!;
  expect(page.log).toEqual([]);
  expect(page.opening).toBe('nothing here yet — this page fills as you act');
 });

 it('a non-empty log carries no opening sentence — silence, not commentary', () => {
  const page = buildCoachPage(fullFacts(), [], 'cooking')!;
  expect(page.opening).toBe('');
 });

 it('un-coached or unknown slugs return null (the lens is off — Q-73)', () => {
  expect(buildCoachPage(facts({ directions: [direction({ coached: false })] }), [], 'cooking')).toBeNull();
  expect(buildCoachPage(facts(), [], 'nope')).toBeNull();
 });

 it('a sitting-tagged transcript with no quest logs as a sitting entry', () => {
  const f = facts({
   directions: [direction()],
   sittingTags: [tag('sess-s', '2026-08-03T13:00:00.000Z', { direction: 'cooking' })],
  });
  const page = buildCoachPage(f, [], 'cooking')!;
  expect(page.log.map((e) => e.kind)).toEqual(['sitting']);
  expect(page.log[0]!.sentence).toBe('you sat with this direction');
 });
});

describe('waitingLines (090 T8)', () => {
 it('is empty when nothing is new', () => {
  const f = facts({
   directions: [direction({ lastVisit: '2026-08-03T12:00:00.000Z' })],
   advice: note({ mintedAt: '2026-08-03T08:00:00.000Z', readAt: '2026-08-03T09:00:00.000Z' }),
  });
  expect(waitingLines(f)).toEqual([]);
  expect(somethingNew(f, 'cooking')).toBe(false);
 });

 it('is empty right after a fresh visit stamp newer than every fact', () => {
  const f = facts({
   directions: [direction({ lastVisit: '2026-08-03T12:00:00.000Z' })],
   artifacts: [
    { id: 'a1', direction: 'cooking', pointer: '/x', name: 'the log', sentenceSession: 's1', declaredAt: '2026-08-03T10:00:00.000Z' },
   ],
  });
  expect(waitingLines(f)).toEqual([]);
 });

 it('shows one quiet line per coached Direction with something new, sorted by name', () => {
  const f = facts({
   directions: [
    direction({ slug: 'cooking', name: 'Cooking', lastVisit: '2026-08-03T06:00:00.000Z' }),
    direction({ slug: 'banjo', name: 'Banjo', lastVisit: '2026-08-03T12:00:00.000Z' }),
   ],
   advice: note({ mintedAt: '2026-08-03T08:00:00.000Z' }),
  });
  expect(waitingLines(f)).toEqual([
   { slug: 'banjo', sentence: 'something new waits where you are learning Banjo' },
   { slug: 'cooking', sentence: 'something new waits where you are learning Cooking' },
  ]);
 });

 it('never lines up an un-coached Direction', () => {
  const f = facts({
   directions: [direction({ coached: false, lastVisit: '2026-08-03T06:00:00.000Z' })],
   advice: note(),
  });
  expect(waitingLines(f)).toEqual([]);
 });
});

describe('coachOfferSentence (090 T8)', () => {
 it('composes the one dimmed line (Q-37)', () => {
  expect(coachOfferSentence({ name: 'Cooking' })).toBe('coaching is open for Cooking — a word declines');
 });
});
