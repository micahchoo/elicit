import { describe, it, expect, vi } from 'vitest';

// The loader fallback (ticket 157): a def without a title renders under its
// registry key, so a title-less def never degrades the surfaces. The real
// defs all carry titles, so this file serves one title-less def through a
// mocked node:fs — the only way to exercise the fallback path. The test
// self-verifies the mock: if the interception were inert, 'notitle' would
// not be in the loaded set and `def` below would be undefined.
vi.mock('node:fs', async (importOriginal) => {
 const actual = await importOriginal<typeof import('node:fs')>();
 const notitle = [
  '---',
  'name: notitle',
  'targets:',
  '  - self',
  'prerequisites: []',
  'questionForm: theoretical',
  'floorProbe: "What would it cost you to be wrong about that?"',
  '---',
  'A title-less def body.',
 ].join('\n');
 return {
  ...actual,
  readdirSync: ((dir: unknown) => {
   if (typeof dir === 'string' && dir.includes('defs')) return ['notitle.md'];
   return (actual.readdirSync as (d: unknown) => unknown)(dir);
  }) as typeof actual.readdirSync,
  readFileSync: ((path: unknown, ...rest: unknown[]) => {
   if (typeof path === 'string' && path.includes('defs')) return notitle;
   return (actual.readFileSync as (p: unknown, ...r: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync,
 };
});

import { loadProtocolDefinitions } from '../src/protocols/registry.js';

describe('protocol def title fallback (ticket 157)', () => {
 it('a def without a title renders under its registry name', () => {
  const defs = loadProtocolDefinitions();
  const def = defs.get('notitle');
  expect(def).toBeDefined();
  expect(def!.name).toBe('notitle');
  expect(def!.title).toBe('notitle');
  expect(def!.blurb).toBeUndefined();
  expect(def!.prompt.length).toBeGreaterThan(0);
 });
});
