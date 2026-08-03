import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createRegionStore, slugFor } from '../src/import/region.js';
import type { DatingRule } from '../src/import/contract.js';

// A tmp vault root per test. The region store is filesystem-only by
// construction: nothing here touches the real vault.
let root: string;

const D: DatingRule = { kind: 'filename', pattern: 'YYYY-MM-DD' };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'import-region-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the region store — a folder subtree, declared on disk', () => {
  it('a declaration survives a new store over the same vault', () => {
    createRegionStore(root).declare({ root: '/c/journals', dating: D, authorship: 'authored' });
    const fresh = createRegionStore(root); // simulates a restart
    expect(fresh.list()).toHaveLength(1);
    expect(fresh.list()[0]!.dating).toEqual(D);
    expect(fresh.list()[0]!.root).toBe('/c/journals');
  });

  it('re-declaring a root keeps the slug and replaces the declaration', () => {
    const s = createRegionStore(root);
    const a = s.declare({ root: '/c/notes', dating: D, authorship: 'authored' });
    const b = s.declare({ root: '/c/notes', dating: D, authorship: 'machine-assisted' });
    expect(b.slug).toBe(a.slug);
    expect(s.list()).toHaveLength(1);
    expect(s.get(a.slug)!.authorship).toBe('machine-assisted');
  });

  it('regionFor returns the deepest declared region', () => {
    const s = createRegionStore(root);
    s.declare({ root: '/c/journals', dating: D, authorship: 'authored' });
    const inner = s.declare({ root: '/c/journals/2019', dating: D, authorship: 'other' });
    expect(s.regionFor('/c/journals/2019/a.md')!.slug).toBe(inner.slug);
    expect(s.regionFor('/c/journals/2018/a.md')!.authorship).toBe('authored');
  });

  it('does not match a sibling whose name shares a prefix', () => {
    const s = createRegionStore(root);
    s.declare({ root: '/c/journals', dating: D, authorship: 'authored' });
    expect(s.regionFor('/c/journals-old/a.md')).toBeNull();
  });

  it('two same-named subtrees under different parents get different slugs', () => {
    expect(slugFor('/c/work/2019')).not.toBe(slugFor('/c/personal/2019'));
  });
});
