import { describe, expect, it } from 'vitest';
import { expectTypeOf } from 'vitest';
import type { ImportDecision, ImportRecord } from '../src/import/contract.js';

describe('the import record contract', () => {
  it('has no restate verb — Q-58 drops it by construction', () => {
    expectTypeOf<ImportDecision['action']>().toEqualTypeOf<'approve' | 'trim' | 'discard'>();
  });

  it('carries no Target — Q-60', () => {
    expectTypeOf<ImportRecord>().not.toHaveProperty('target');
  });
});
