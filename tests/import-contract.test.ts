import { describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import type { ImportDecision, ImportRecord } from '../src/import/contract.js';
import type { Provenance } from '../src/types.js';

describe('the import record contract', () => {
 it('has no restate verb — Q-58 drops it by construction', () => {
  expectTypeOf<ImportDecision['action']>().toEqualTypeOf<'approve' | 'trim' | 'discard'>();
 });

 it('carries no Target — Q-60', () => {
  expectTypeOf<ImportRecord>().not.toHaveProperty('target');
 });

 it('absent authorship is absent, not authored', () => {
  const p: Provenance = { kind: 'unprompted', session: 's', question: '', questionForm: 'deliberative' };
  expect('authorship' in p).toBe(false);
 });

 it('a region filter cannot match a record with no region', () => {
  const r: ImportRecord = { hash: 'h', sourcePath: 'p', date: '2018-01-01', status: 'pending', attempts: 0 };
  expect(r.region === 'journals').toBe(false);
  expect(r.region).toBeUndefined();
 });
});
