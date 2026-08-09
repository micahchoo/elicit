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

 it('names unprompted writing freely', () => {
  expect(originWord('unprompted')).toBe('free writing');
 });
});

describe('descentCloseWord — how a descent ended on its own (012 T9)', () => {
 it('says the step limit ended it', () => {
  expect(descentCloseWord('cap')).toBe('going deeper ended \u2014 it reached its limit');
 });

 it('says the thread coming together ended it', () => {
  expect(descentCloseWord('convergence')).toBe('going deeper ended \u2014 the thread came together');
 });

 it('says a question that could not be written ended it', () => {
  expect(descentCloseWord('composition-failed')).toBe('going deeper ended \u2014 the next question could not be written');
 });

 it('covers the gate words the person may press too', () => {
  expect(descentCloseWord('park')).toBe('going deeper ended \u2014 your place is held');
  expect(descentCloseWord('another-day')).toBe('going deeper ended \u2014 the rest waits for another day');
 });
});
