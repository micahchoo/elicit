import { describe, it, expect } from 'vitest';
import { protocolOptionRows } from '../web/protocol-options.js';

/**
 * The mode picker's quiet radio rows (ticket 157), tested at the pure seam:
 * the title is the option label, the blurb dims under it, the registry name
 * is the fallback for a title-less def, and rotation:false instruments are
 * marked explicit-only.
 */
describe('protocolOptionRows (ticket 157)', () => {
 it('labels rows with the title and carries the blurb under it', () => {
  const rows = protocolOptionRows([
   { id: 'drm', name: 'drm', title: 'walk back through yesterday', blurb: 'recover yesterday hour by hour, block by block', rotation: false },
  ]);
  expect(rows).toEqual([
   { id: 'drm', label: 'walk back through yesterday', blurb: 'recover yesterday hour by hour, block by block', explicitOnly: true },
  ]);
 });

 it('falls back to the registry name when the title is missing', () => {
  const rows = protocolOptionRows([
   { id: 'cdm', name: 'cdm', title: '', rotation: true },
  ]);
  expect(rows[0]).toEqual({ id: 'cdm', label: 'cdm', explicitOnly: false });
 });

 it('drops a blank blurb so the dimmed line never renders empty', () => {
  const rows = protocolOptionRows([
   { id: 'reflective', name: 'reflective', title: 'follow the thread', blurb: '   ', rotation: true },
  ]);
  expect(rows[0]).toEqual({ id: 'reflective', label: 'follow the thread', explicitOnly: false });
 });

 it('marks rotation:false instruments explicit-only (Q-85)', () => {
  const rows = protocolOptionRows([
   { id: 'people-grid', name: 'people-grid', title: 'which two are alike', rotation: false },
  ]);
  expect(rows[0]!.explicitOnly).toBe(true);
 });
});
