import { describe, it, expect } from 'vitest';
import { triadSurface, toggleTriad, type PhaseMetaLike } from '../web/triad-surface.js';

/**
 * The triad chip surface (ticket 159, slice 7), tested at the pure seam:
 * the surface decision (the prose fallback) and the tap logic. No DOM —
 * the exchange screen's renderer is a thin shell over these two.
 */

function meta(overrides?: Partial<PhaseMetaLike>): PhaseMetaLike {
 return {
  id: 'triads',
  label: 'which two are alike',
  step: 1,
  of: 2,
  renderer: 'triads',
  triad: { names: ['Ana', 'Bea', 'Cleo'] },
  ...overrides,
 };
}

describe('triadSurface (the prose fallback)', () => {
 it('renders the chip surface when the active phase declares the triads renderer and carries three names', () => {
  expect(triadSurface(meta())).toEqual({ names: ['Ana', 'Bea', 'Cleo'] });
 });

 it('falls back to the generic block with no phase meta at all', () => {
  expect(triadSurface(null)).toBeNull();
  expect(triadSurface(undefined)).toBeNull();
 });

 it('falls back when the phase declares no renderer', () => {
  const m: PhaseMetaLike = { id: 'triads', label: 'which two are alike', step: 1, of: 2 };
  expect(triadSurface(m)).toBeNull();
 });

 it('falls back on an unknown renderer — never a crash', () => {
  expect(triadSurface(meta({ renderer: 'drm-day-map' }))).toBeNull();
  expect(triadSurface(meta({ renderer: 'some-future-surface' }))).toBeNull();
 });

 it('falls back when the triads renderer rides no names', () => {
  const m: PhaseMetaLike = { id: 'triads', label: 'which two are alike', step: 1, of: 2, renderer: 'triads' };
  expect(triadSurface(m)).toBeNull();
 });

 it('falls back when fewer than three names ride the meta — the server-side degradation mirror', () => {
  expect(triadSurface(meta({ triad: { names: ['Ana', 'Bea'] } }))).toBeNull();
 });

 it('caps the surface at the first three names', () => {
  const m = meta({ triad: { names: ['Ana', 'Bea', 'Cleo', 'Dee'] } });
  expect(triadSurface(m)).toEqual({ names: ['Ana', 'Bea', 'Cleo'] });
 });
});

describe('toggleTriad (the tap logic)', () => {
 it('selects a first name', () => {
  expect(toggleTriad([], 'Ana')).toEqual(['Ana']);
 });

 it('selects a second name', () => {
  expect(toggleTriad(['Ana'], 'Bea')).toEqual(['Ana', 'Bea']);
 });

 it('ignores a third tap — selection is explicit two, never implicit replacement', () => {
  expect(toggleTriad(['Ana', 'Bea'], 'Cleo')).toEqual(['Ana', 'Bea']);
 });

 it('toggles a selected name off', () => {
  expect(toggleTriad(['Ana', 'Bea'], 'Ana')).toEqual(['Bea']);
 });

 it('frees the second slot after a toggle-off', () => {
  expect(toggleTriad(toggleTriad(['Ana', 'Bea'], 'Ana'), 'Cleo')).toEqual(['Bea', 'Cleo']);
 });
});
