/**
 * The Coach surface helpers (090 T11) — the pure text assembly exported
 * from web/coach.ts. Paint stays by-use; the rows the page paints are
 * tested here: sentences with the person's quotes, options with the wire
 * ids the three margin words post to, and the identifier-free sentences.
 */

import { describe, it, expect } from 'vitest';
import { coachLogRows, coachOptionRows, type CoachPageData } from '../web/coach.js';

function page(overrides?: Partial<CoachPageData>): CoachPageData {
 return {
  slug: 'cooking',
  name: 'Cooking',
  log: [
   {
    at: '2026-08-03T09:00:00.000Z',
    kind: 'quest-adopted',
    sentence: 'you took up a quest — Cook one meal from scratch',
    questId: '01KZ0DJAKS53EHA0KJZTGZJHY5',
   },
   {
    at: '2026-08-03T10:00:00.000Z',
    kind: 'quest-return',
    sentence: 'you came back with something for a quest',
    quote: 'the rice burned because I rushed',
    questId: '01KZ0DJAKS53EHA0KJZTGZJHY5',
   },
  ],
  advice: {
   mintedAt: '2026-08-03T08:00:00.000Z',
   unread: true,
   options: [
    { id: 'opt-1', text: 'Cook one new recipe' },
    { id: 'opt-2', text: 'Write down your knife setup' },
   ],
  },
  opening: 'nothing here yet — this page fills as you act',
  ...overrides,
 };
}

describe('coachLogRows (090 T11)', () => {
 it('carries sentence, quote and the quest id for the affordances, in server order', () => {
  const rows = coachLogRows(page());
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual({
   at: '2026-08-03T09:00:00.000Z',
   sentence: 'you took up a quest — Cook one meal from scratch',
   kind: 'quest-adopted',
   questId: '01KZ0DJAKS53EHA0KJZTGZJHY5',
  });
  expect(rows[1]).toEqual({
   at: '2026-08-03T10:00:00.000Z',
   sentence: 'you came back with something for a quest',
   kind: 'quest-return',
   quote: 'the rice burned because I rushed',
   questId: '01KZ0DJAKS53EHA0KJZTGZJHY5',
  });
 });

 it('an absent quote stays absent — a return whose review has not landed renders without one', () => {
  const p = page({
   log: [
    {
     at: '2026-08-03T10:00:00.000Z',
     kind: 'quest-return',
     sentence: 'you came back with something for a quest',
     questId: '01KZ0DJAKS53EHA0KJZTGZJHY5',
    },
   ],
  });
  const rows = coachLogRows(p);
  expect(rows[0]!.quote).toBeUndefined();
  expect(rows[0]!.sentence).not.toContain('01KZ0DJAKS53EHA0KJZTGZJHY5');
 });

 it('the quest id never appears in a sentence — identifiers stay off the surface (Q-15)', () => {
  for (const row of coachLogRows(page())) {
   expect(row.sentence).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);
  }
 });

 it('an empty log yields no rows — the page shows only the quiet opening', () => {
  expect(coachLogRows(page({ log: [] }))).toEqual([]);
 });
});

describe('coachOptionRows (090 T11)', () => {
 it('mirrors the note\'s options with their wire ids', () => {
  expect(coachOptionRows(page().advice)).toEqual([
   { id: 'opt-1', text: 'Cook one new recipe' },
   { id: 'opt-2', text: 'Write down your knife setup' },
  ]);
 });

 it('an absent note renders no margin at all', () => {
  expect(coachOptionRows(null)).toEqual([]);
  expect(coachOptionRows(page({ advice: null }).advice)).toEqual([]);
 });
});
