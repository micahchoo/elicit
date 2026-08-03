import { describe, it, expect } from 'vitest';
import { sourceLabel, facetHeading, lintNote } from '../src/queue/source-label.js';
import { FACETS } from '../src/queue/facet-balance.js';
import type { QueueEntry } from '../src/types.js';
import type { LintFinding } from '../src/wiki/contract.js';

/**
 * Every member of each union, written out.
 *
 * A runtime list cannot be derived from a type, so this list is what a new
 * union member must be added to — and the `@ts-expect-error` blocks below are
 * what fail when someone forgets, because a `Record` keyed by the union
 * rejects a missing key at compile time.
 */
const SOURCES: QueueEntry['source'][] = [
 'composed',
 'still-true',
 'user-declared',
 'gap-declared',
 'gap-fill',
 'contradiction-remeasure',
'lint-still-true',
'lint-undiscriminated-range',
'import-repair',
'quest-reflection',
];

const LINT_KINDS: LintFinding['kind'][] = [
 'stale-citation',
 'orphan-claim',
 'god-node-referent',
 'merge-candidate',
 'undiscriminated-range',
];

/** A hyphenated machine literal — the shape ticket 063 found 26 of on a read surface. */
const SLUG = /[a-z]+-[a-z]/;

describe('sourceLabel', () => {
 it('gives every queue source a non-empty label', () => {
  for (const s of SOURCES) {
   expect(sourceLabel(s), `no label for ${s}`).toMatch(/\S/);
  }
 });

 /**
  * The actual requirement (S3, Q-15). `web/main.ts` renders the source onto
  * the waiting surface, so `contradiction-remeasure` in front of the person
  * the re-measure is trying not to interrogate undoes Q-15 with a debug
  * string. The grep T19 runs passes for a map that exists and is mis-keyed;
  * only this catches that.
  */
 it('lets no queue source literal reach the label', () => {
  const labels = SOURCES.map(sourceLabel).join(' | ');
  for (const s of SOURCES) {
   expect(labels, `the literal ${s} reached a label`).not.toContain(s);
  }
  expect(labels).not.toContain('contradiction-remeasure');
  expect(labels).not.toContain('lint-still-true');
 });

 /** Q-15 + the gap link: neither gap source may announce itself as a gap. */
 it('lets no label announce a gap (Q-15)', () => {
  for (const s of SOURCES) {
   expect(sourceLabel(s), `label for ${s} contains 'gap'`).not.toMatch(/gap/i);
  }
 });

 /** Q-15: the Clerk sources read as the ordinary question `composed` is. */
 it('reads the Clerk sources as the words composed gets', () => {
  expect(sourceLabel('contradiction-remeasure')).toBe(sourceLabel('composed'));
  expect(sourceLabel('lint-still-true')).toBe(sourceLabel('composed'));
  expect(sourceLabel('lint-undiscriminated-range')).toBe(sourceLabel('composed'));
 });

 /** Q-15: a repair question reads as the ordinary question `composed` is. */
 it('reads a repair question as the words composed gets — Q-15', () => {
  expect(sourceLabel('import-repair')).toBe(sourceLabel('composed'));
 });

 /** Q-75: a quest-tagged question reads as the ordinary question `composed` is. */
 it('reads a quest-reflection question as the words composed gets — Q-75', () => {
  expect(sourceLabel('quest-reflection')).toBe(sourceLabel('composed'));
 });

 it('is exhaustive by type — a missing member does not compile', () => {
  // @ts-expect-error — `lint-still-true` is absent, and the Record rejects it.
  const missing: Record<QueueEntry['source'], string> = {
   composed: 'a',
   'still-true': 'b',
   'user-declared': 'c',
   'contradiction-remeasure': 'd',
  };
  expect(Object.keys(missing)).toHaveLength(4);
 });
});

describe('facetHeading', () => {
 /**
  * `fact`, `value` and `episode` are ordinary English, so a heading is allowed
  * to contain one — "Steady facts" leaks nothing. What must never reach the
  * reader is the LITERAL, whole, and the hyphenated slug in any form.
  */
 it('gives every facet a heading that is not the literal', () => {
  for (const f of FACETS) {
   const heading = facetHeading(f);
   expect(heading, `no heading for ${f}`).toMatch(/\S/);
   expect(heading.toLowerCase(), `the heading for ${f} IS the literal`).not.toBe(f);
  }
 });

 it('lets no hyphenated literal reach a heading', () => {
  for (const f of FACETS) {
   expect(facetHeading(f), `heading for ${f} reads as a slug`).not.toMatch(SLUG);
   if (f.includes('-')) {
    expect(facetHeading(f), `the literal ${f} reached the heading`).not.toContain(f);
   }
  }
 });

 /** A mis-keyed map is the failure a grep cannot see: two facets, one heading. */
 it('gives each facet its own heading', () => {
  const headings = FACETS.map(facetHeading);
  expect(new Set(headings).size).toBe(FACETS.length);
 });

 it('is exhaustive by type — a missing facet does not compile', () => {
  // @ts-expect-error — `causal-theory` is absent, and the Record rejects it.
  const missing: Record<(typeof FACETS)[number], string> = {
   episode: 'a',
   'general-event': 'b',
   'lifetime-period': 'c',
   fact: 'd',
   construct: 'e',
   intention: 'f',
   value: 'g',
  };
  expect(Object.keys(missing)).toHaveLength(7);
 });
});

describe('lintNote', () => {
 it('gives every lint kind a note that is not the kind', () => {
  for (const k of LINT_KINDS) {
   const note = lintNote(k);
   expect(note, `no note for ${k}`).toMatch(/\S/);
   expect(note, `the literal ${k} reached the note`).not.toContain(k);
   expect(note, `note for ${k} reads as a slug`).not.toMatch(SLUG);
  }
 });

 /**
  * Q-15: nothing on the wiki accuses. A lint note is a remark about evidence,
  * so it may not carry a word that reads as a verdict on the person.
  */
 it('accuses nobody', () => {
  const accusing = ['wrong', 'false', 'invalid', 'error', 'failed', 'bad', 'inconsistent'];
  for (const k of LINT_KINDS) {
   for (const word of accusing) {
    expect(lintNote(k).toLowerCase(), `note for ${k} accuses`).not.toContain(word);
   }
  }
 });

 /** A mis-keyed map is the failure a grep cannot see: two kinds, one note. */
 it('gives each lint kind its own note', () => {
  const notes = LINT_KINDS.map(lintNote);
  expect(new Set(notes).size).toBe(LINT_KINDS.length);
 });

 it('is exhaustive by type — a missing kind does not compile', () => {
  // @ts-expect-error — `merge-candidate` is absent, and the Record rejects it.
  const missing: Record<LintFinding['kind'], string> = {
   'stale-citation': 'a',
   'orphan-claim': 'b',
   'god-node-referent': 'c',
  };
  expect(Object.keys(missing)).toHaveLength(3);
 });
});
