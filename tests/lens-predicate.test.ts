import { describe, it, expect } from 'vitest';
import { sinceChanged, exhibitSinceChanged, lastReadOf, freshnessSentence } from '../web/lens.js';
import { readableDate } from '../web/dates.js';

/**
 * The since-you-last-read lens (wave 5, canon §5.5): the pure predicates
 * behind the wiki's default reading, unit-tested at the seam (web/lens.ts).
 * ISO stamps compare lexicographically, so `> lastRead` IS time order; the
 * boundary (equal to lastRead) is not a change.
 */

describe('sinceChanged', () => {
 it('marks a claim created after the last read as changed', () => {
  expect(sinceChanged(
   { created: '2026-08-02T00:00:00.000Z', updated: '2026-08-02T00:00:00.000Z', readLog: [{ at: '2026-08-01T00:00:00.000Z' }] },
   undefined,
   '2026-08-01T00:00:00.000Z',
  )).toBe(true);
 });

 it('marks a claim edited after the last read as changed, even when it was created before', () => {
  expect(sinceChanged(
   { created: '2026-07-01T00:00:00.000Z', updated: '2026-08-02T00:00:00.000Z', readLog: [{ at: '2026-08-01T00:00:00.000Z' }] },
   undefined,
   '2026-08-01T00:00:00.000Z',
  )).toBe(true);
 });

 it('marks a claim repair-touched after the last read as changed', () => {
  expect(sinceChanged(
   { created: '2026-07-01T00:00:00.000Z', updated: '2026-07-01T00:00:00.000Z', readLog: [{ at: '2026-08-01T00:00:00.000Z' }] },
   '2026-08-02T00:00:00.000Z',
   '2026-08-01T00:00:00.000Z',
  )).toBe(true);
 });

 it('recedes a claim unchanged since the last read', () => {
  expect(sinceChanged(
   { created: '2026-07-01T00:00:00.000Z', updated: '2026-07-01T00:00:00.000Z', readLog: [{ at: '2026-08-01T00:00:00.000Z' }] },
   undefined,
   '2026-08-01T00:00:00.000Z',
  )).toBe(false);
 });

 it('recedes a claim whose repair predates the last read', () => {
  expect(sinceChanged(
   { created: '2026-07-01T00:00:00.000Z', updated: '2026-07-01T00:00:00.000Z', readLog: [{ at: '2026-08-01T00:00:00.000Z' }] },
   '2026-07-30T00:00:00.000Z',
   '2026-08-01T00:00:00.000Z',
  )).toBe(false);
 });

 it('treats the last-read moment itself as read, not as a change', () => {
  expect(sinceChanged(
   { created: '2026-08-01T00:00:00.000Z', updated: '2026-08-01T00:00:00.000Z', readLog: [{ at: '2026-08-01T00:00:00.000Z' }] },
   '2026-08-01T00:00:00.000Z',
   '2026-08-01T00:00:00.000Z',
  )).toBe(false);
 });
});

describe('exhibitSinceChanged', () => {
 it('marks an exhibit opened after the last read as changed', () => {
  expect(exhibitSinceChanged(
   { opened: '2026-08-02T00:00:00.000Z', updated: '2026-08-02T00:00:00.000Z', status: 'open' },
   '2026-08-01T00:00:00.000Z',
  )).toBe(true);
 });

 it('marks a dissolved exhibit resolved after the last read as changed', () => {
  expect(exhibitSinceChanged(
   { opened: '2026-07-01T00:00:00.000Z', updated: '2026-08-02T00:00:00.000Z', status: 'dissolved' },
   '2026-08-01T00:00:00.000Z',
  )).toBe(true);
 });

 it('recedes a dissolved exhibit resolved before the last read', () => {
  expect(exhibitSinceChanged(
   { opened: '2026-07-01T00:00:00.000Z', updated: '2026-07-30T00:00:00.000Z', status: 'dissolved' },
   '2026-08-01T00:00:00.000Z',
  )).toBe(false);
 });

 it('does not mark an open exhibit changed by an update alone', () => {
  expect(exhibitSinceChanged(
   { opened: '2026-07-01T00:00:00.000Z', updated: '2026-08-02T00:00:00.000Z', status: 'open' },
   '2026-08-01T00:00:00.000Z',
  )).toBe(false);
 });
});

describe('lastReadOf', () => {
 it('is the newest read across every claim and every log entry', () => {
  expect(lastReadOf([
   { created: 'a', updated: 'a', readLog: [{ at: '2026-08-01T00:00:00.000Z' }, { at: '2026-07-20T00:00:00.000Z' }] },
   { created: 'b', updated: 'b', readLog: [{ at: '2026-08-02T00:00:00.000Z' }] },
   { created: 'c', updated: 'c', readLog: [] },
  ])).toBe('2026-08-02T00:00:00.000Z');
 });

 it('is null when no claim was ever read', () => {
  expect(lastReadOf([{ created: 'a', updated: 'a', readLog: [] }])).toBe(null);
 });

 it('is null for an empty page', () => {
  expect(lastReadOf([])).toBe(null);
 });
});

describe('freshnessSentence', () => {
 it('renders nothing when the page was never read', () => {
  expect(freshnessSentence({ readThrough: null, sittingsBehind: 0, lastSittingAt: null })).toBe(null);
 });

 it('names the read-through date when caught up, via the shared date helper', () => {
  const iso = '2026-07-14T09:00:00.000Z';
  expect(freshnessSentence({ readThrough: iso, sittingsBehind: 0, lastSittingAt: iso }))
   .toBe(`Read through ${readableDate(iso)}.`);
 });

 it('counts one sitting behind in the singular', () => {
  expect(freshnessSentence({ readThrough: '2026-08-01T00:00:00.000Z', sittingsBehind: 1, lastSittingAt: '2026-08-03T00:00:00.000Z' }))
   .toBe('1 sitting behind \u00b7 let it catch up');
 });

 it('counts sittings behind in the plural', () => {
  expect(freshnessSentence({ readThrough: '2026-08-01T00:00:00.000Z', sittingsBehind: 2, lastSittingAt: '2026-08-03T00:00:00.000Z' }))
   .toBe('2 sittings behind \u00b7 let it catch up');
 });

 it('renders nothing when the read-through date does not parse', () => {
  expect(freshnessSentence({ readThrough: 'not-a-date', sittingsBehind: 0, lastSittingAt: null })).toBe(null);
 });
});
