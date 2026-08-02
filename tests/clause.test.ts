import { describe, it, expect } from 'vitest';
import { isCompleteClause, widenToClause } from '../src/clerk/clause.js';

/**
 * Ticket 088: the quoted pole must be a complete clause, decided
 * mechanically. `isCompleteClause` is the fragment-only arm (a finite verb
 * with a reachable subject); `widenToClause` adds the segmenter's boundary
 * arm and widens a non-clause fragment to the smallest enclosing clause
 * inside the person's prose.
 */

// ── isCompleteClause: the fragment-only arm ─────────────────────────────────

describe('isCompleteClause', () => {
 it('accepts a subject + finite verb, however short', () => {
  for (const clause of [
   'I worked on making',
   'I keep my weekends completely free of work',
   'I worked through both days last weekend',
   'the mechanism worked',
   'the archival object looked',
   'there was a problem',
   "I'm working on it",
   'she kept the archive organised',
   'the workshop facilitation helped',
  ]) {
   expect(isCompleteClause(clause), clause).toBe(true);
  }
 });

 it('rejects a verb phrase with no reachable subject', () => {
  // The T16 shape: `worked on making` has a finite verb and nothing before
  // it. `keep my weekends completely free of work` starts on a base verb.
  for (const fragment of [
   'worked on making',
   'keep my weekends completely free of work',
   'worked through both days last weekend',
   'annotating an archival object',
   'making a mechanism',
   'completely free of work',
  ]) {
   expect(isCompleteClause(fragment), fragment).toBe(false);
  }
 });

 it('rejects a noun phrase, even one that ends on a base-verb stem', () => {
  // `report` and `work` are base verbs; a noun before a WEAK form is not
  // trusted as a subject — this is the class that would otherwise pass
  // `the final report` and `the weekend work` as clauses.
  for (const np of ['the final report', 'the weekend work', 'a good start']) {
   expect(isCompleteClause(np), np).toBe(false);
  }
 });

 it('rejects words that only look like past participles', () => {
  for (const fragment of ['the tired and ragged', 'a crowded room']) {
   expect(isCompleteClause(fragment), fragment).toBe(false);
  }
 });

 it('treats an adverb before the verb as no subject at all', () => {
  // `quickly ran home` is a verb phrase, not a clause.
  expect(isCompleteClause('quickly ran home')).toBe(false);
 });
});

// ── widenToClause: the widening, verbatim rule intact ───────────────────────

// The RESULTS §16.5 fixture, verbatim from the T16 run.
const T16_PROSE =
 'I worked on making a mechanism for annotating an archival object as well as how the archival object looked.';

describe('widenToClause', () => {
 it('widens the T16 fragment to its full clause inside the real sentence', () => {
  expect(widenToClause('worked on making', T16_PROSE)).toBe(T16_PROSE);
 });

 it('keeps a fragment that is already a clause exactly as it is', () => {
  expect(widenToClause('I worked on making', T16_PROSE)).toBe('I worked on making');
 });

 it('always returns an exact substring of the prose (verbatim rule intact)', () => {
  for (const fragment of ['worked on making', 'making a mechanism', 'the archival object']) {
   const widened = widenToClause(fragment, T16_PROSE);
   expect(T16_PROSE.includes(widened), `'${widened}' must be verbatim in the prose`).toBe(true);
  }
 });

 it('widen to the SMALLEST enclosing clause, not the whole sentence', () => {
  const prose = 'I was tired, so I went home.';
  expect(widenToClause('went home', prose)).toBe('I went home.');
  expect(widenToClause('was tired', prose)).toBe('I was tired');
 });

 it('returns a sentence-aligned fragment unchanged (the boundary test)', () => {
  // `No exceptions.` is a complete sentence with no finite verb; the
  // segmenter's boundary test treats it as a clause.
  expect(widenToClause('No exceptions.', 'No exceptions. I keep my weekends free.')).toBe(
   'No exceptions.'
  );
 });

 it('leaves a fragment untouched when it is not verbatim in the prose', () => {
  expect(widenToClause('worked on making', 'I worked on something else entirely.')).toBe(
   'worked on making'
  );
 });

 it('leaves an empty fragment untouched', () => {
  expect(widenToClause('', T16_PROSE)).toBe('');
 });

 it('widens across a multi-sentence run when the fragment spans one', () => {
  const prose = 'I worked on making things. Then I stopped.';
  expect(widenToClause('things. Then', prose)).toBe(prose);
 });
});
