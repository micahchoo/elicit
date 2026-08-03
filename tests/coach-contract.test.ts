/**
 * The coach contract — ticket 090 T2. Slug stability and route safety,
 * the option-set gate's named refusals, and the Q-24 absence assertion:
 * no record shape can carry a rate, a deadline, or a failure state.
 */

import { describe, it, expect } from 'vitest';
import { directionSlugFor, normalizeOption, adviceGuard } from '../src/coach/contract.js';
import type { DirectionRecord, Quest, ArtifactRecord } from '../src/coach/contract.js';

describe('directionSlugFor — the stable, route-safe Direction key', () => {
 it('is stable and readable', () => {
  expect(directionSlugFor('Wood Working!')).toBe('wood-working');
  expect(directionSlugFor('Wood Working!')).toBe(directionSlugFor('WOOD  working!'));
 });

 it('never yields a coach route word', () => {
  expect(directionSlugFor('Waiting')).toBe('d-waiting');
  expect(directionSlugFor('quest')).toBe('d-quest');
  expect(directionSlugFor('direction')).toBe('d-direction');
 });

 it('never yields an empty page path', () => {
  expect(directionSlugFor('!!!')).toBe('unnamed');
  expect(directionSlugFor('')).toBe('unnamed');
 });
});

describe('normalizeOption — the declined-dedupe form', () => {
 it('trims, lowercases and collapses internal whitespace', () => {
  expect(normalizeOption('  Try  X\nagain  ')).toBe('try x again');
  expect(normalizeOption('Try X')).toBe(normalizeOption('  TRY   x '));
 });
});

describe('adviceGuard — the option-set gate', () => {
 const exists = (id: string): boolean => id === 'c1' || id === 'c2' || id === 'c3';

 it('refuses a single option (a prescription, Q-74)', () => {
  const r = adviceGuard({ options: [{ text: 'Do the thing', cites: ['c1'] }] }, { declined: [], claimExists: exists });
  expect(r).toEqual({ ok: false, reason: 'fewer-than-2-options' });
 });

 it('refuses four options (choice-expansion is structural, Q-24)', () => {
  const r = adviceGuard(
   {
    options: [
     { text: 'a', cites: ['c1'] },
     { text: 'b', cites: ['c2'] },
     { text: 'c', cites: ['c3'] },
     { text: 'd', cites: ['c1'] },
    ],
   },
   { declined: [], claimExists: exists },
  );
  expect(r).toEqual({ ok: false, reason: 'more-than-3-options' });
 });

 it('refuses an option whose text is empty', () => {
  const r = adviceGuard(
   { options: [{ text: '   ', cites: ['c1'] }, { text: 'b', cites: ['c2'] }] },
   { declined: [], claimExists: exists },
  );
  expect(r).toEqual({ ok: false, reason: 'option-without-text' });
 });

 it('refuses an option citing nothing', () => {
  const r = adviceGuard(
   { options: [{ text: 'a', cites: [] }, { text: 'b', cites: ['c2'] }] },
   { declined: [], claimExists: exists },
  );
  expect(r).toEqual({ ok: false, reason: 'option-citing-nothing' });
 });

 it('refuses an option citing a claim that does not resolve', () => {
  const r = adviceGuard(
   { options: [{ text: 'a', cites: ['c1'] }, { text: 'b', cites: ['nope'] }] },
   { declined: [], claimExists: exists },
  );
  expect(r).toEqual({ ok: false, reason: 'unresolvable-cite' });
 });

 it('drops a declined text and refuses when fewer than two survive', () => {
  const r = adviceGuard(
   { options: [{ text: 'Try X', cites: ['c1'] }, { text: 'try x', cites: ['c2'] }] },
   { declined: ['Try X'], claimExists: exists },
  );
  expect(r).toEqual({ ok: false, reason: 'declined-option' });
 });

 it('passes a clean pair, id-ing every option uniquely', () => {
  const r = adviceGuard(
   { options: [{ text: 'Try X', cites: ['c1'] }, { text: 'Try Y', cites: ['c2'] }] },
   { declined: [], claimExists: exists },
  );
  expect(r.ok).toBe(true);
  if (r.ok) {
   expect(r.options.map((o) => o.id)).toEqual(['opt-1', 'opt-2']);
   expect(r.options.map((o) => o.text)).toEqual(['Try X', 'Try Y']);
   expect(r.options.map((o) => o.cites)).toEqual([['c1'], ['c2']]);
  }
 });

 it('accepts a bare array (tolerant posture)', () => {
  const r = adviceGuard([{ text: 'a', cites: ['c1'] }, { text: 'b', cites: ['c2'] }], { declined: [], claimExists: exists });
  expect(r.ok).toBe(true);
 });

 it('drops a declined text when two still survive', () => {
  const r = adviceGuard(
   { options: [{ text: 'OLD', cites: ['c1'] }, { text: 'a', cites: ['c2'] }, { text: 'b', cites: ['c3'] }] },
   { declined: ['old'], claimExists: exists },
  );
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.options.map((o) => o.text)).toEqual(['a', 'b']);
 });
});

describe('the record shapes carry no rate, deadline or failure key (Q-24)', () => {
 it('rejects a rate, a deadline and a failure state at the type level', () => {
  // @ts-expect-error — a Direction carries no rate (Q-24)
  const _noRate: DirectionRecord = { slug: 'x', name: 'x', coached: true, declinedOptions: [], completionRate: 1 };
  // @ts-expect-error — a Quest carries no deadline (Q-24)
  const _noDeadline: Quest = { id: 'q', direction: 'x', act: 'x', cites: [], adoptedAt: '2026-08-03', deadline: '2026-09-01' };
  // @ts-expect-error — an Artifact carries no failure state (Q-24)
  const _noFailure: ArtifactRecord = { id: 'a', direction: 'x', pointer: 'p', name: 'n', sentenceSession: 's', declaredAt: '2026-08-03', failed: true };
 });
});
