import { describe, it, expect } from 'vitest';
import { descentCloseWord, originWord, sourceWord } from '../web/provenance.js';

/**
 * The provenance words the screen shows (ticket 155), tested at the pure
 * seam — the same convention as waiting-surface.test.ts: main.ts renders
 * only what these mappers return, so the wire value and the displayed word
 * cannot drift apart.
 */
describe('sourceWord — the opener dealt by the Randomizer (Q-18)', () => {
 it('names the resurfaced past for a resurfacing draw', () => {
  expect(sourceWord('resurfacing')).toBe('dealt \u2014 from your older self');
 });

 it('names the deck for a deck draw', () => {
  expect(sourceWord('deck')).toBe('dealt \u2014 from a deck');
 });
});

describe('originWord — where a harvest came from', () => {
 it('calls a harvest of a sitting what it is', () => {
  expect(originWord('harvest')).toBe('sitting');
 });

 it('keeps unprompted writing unprompted', () => {
  expect(originWord('unprompted')).toBe('unprompted');
 });
});

describe('descentCloseWord — how a descent ended on its own (012 T9)', () => {
 it('says the cap closed it', () => {
  expect(descentCloseWord('cap')).toBe('the descent closed \u2014 the cap');
 });

 it('says convergence closed it', () => {
  expect(descentCloseWord('convergence')).toBe('the descent closed \u2014 convergence');
 });

 it('says composition failed closed it', () => {
  expect(descentCloseWord('composition-failed')).toBe('the descent closed \u2014 composition failed');
 });

 it('covers the gate words the person may press too', () => {
  expect(descentCloseWord('park')).toBe('the descent closed \u2014 parked');
  expect(descentCloseWord('another-day')).toBe('the descent closed \u2014 another day');
 });
});
