import { describe, it, expect } from 'vitest';
import { reviewCountSentence } from '../web/deps.js';

/**
 * The close's count sentence (wave 2): "Kept N passages for your review,
 * M fragments couldn't stand alone — read them now?" — the ONE copy both
 * the review row and Today's silent close render. Tested at the pure seam:
 * the em-dash and the pluralization are the contract; the zero case is
 * every-zero-is-a-sentence (copy rule 5).
 */
describe('reviewCountSentence', () => {
 it('keeps the canon example (4 passages, 2 fragments)', () => {
  expect(reviewCountSentence(4, 2)).toBe(
   'Kept 4 passages for your review, 2 fragments couldn\'t stand alone \u2014 read them now?',
  );
 });

 it('drops the fragment clause when none could not stand alone', () => {
  expect(reviewCountSentence(4, 0)).toBe(
   'Kept 4 passages for your review \u2014 read them now?',
  );
 });

 it('pluralizes to passage and fragment at one', () => {
  expect(reviewCountSentence(1, 1)).toBe(
   'Kept 1 passage for your review, 1 fragment couldn\'t stand alone \u2014 read them now?',
  );
 });

 it('renders the zero sentence when nothing was kept', () => {
  expect(reviewCountSentence(0, 0)).toBe('Nothing waits for your review.');
  expect(reviewCountSentence(0, 3)).toBe('Nothing waits for your review.');
 });
});
