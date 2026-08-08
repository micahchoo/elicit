import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createImportStore } from '../src/import/store.js';
import type { ScannedItem } from '../src/import/contract.js';
import type { ImportCut, ImportRecord } from '../src/import/contract.js';

// A tmp vault root per test. The store is filesystem-only by construction:
// nothing here touches the real vault, and no test starts a server.
let root: string;
let store: ReturnType<typeof createImportStore>;
let P: string;
let item: ScannedItem;
let items: ScannedItem[];
let record: ImportRecord;
let changed: ScannedItem;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'import-store-'));
  store = createImportStore(root);
  P = join(root, 'posts', 'first.md');
  item = {
    hash: 'aaaaaaaaaaaa',
    sourcePath: P,
    date: '2024-01-01',
    title: 'First post',
    body: 'Body one.',
  };
  items = [
    item,
    { hash: 'bbbbbbbbbbbb', sourcePath: join(root, 'posts', 'second.md'), date: '2022-06-15', body: 'Body two.' },
    { hash: 'cccccccccccc', sourcePath: join(root, 'posts', 'third.md'), date: '2026-03-02', title: 'Third post', body: 'Body three.' },
  ];
  record = {
    hash: 'aaaaaaaaaaaa',
    sourcePath: P,
    date: '2024-01-01',
    status: 'pending',
    attempts: 0,
  };
  // A second sitting on P (Q-59): same source path, NEW body, so a new hash.
  // `lastmod` is carried by the changed file when the author edited it.
  changed = {
    hash: 'dddddddddddd',
    sourcePath: P,
    date: '2024-01-01',
    body: 'The changed body.',
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('import store (staging)', () => {
  it('admits an unknown hash and skips a known one', () => {
    expect(store.admit(items).added).toHaveLength(3);
    // toMatchObject, not toEqual: `admit` also returns `refused`, and an exact
    // match here would red out on a signature change rather than a behaviour one.
    expect(store.admit(items)).toMatchObject({
      added: [],
      skipped: expect.arrayContaining([items[0]!.hash]),
    });
  });

  it('dates a repeat source path to lastmod — Q-59 second sitting', () => {
    store.put({ ...record, sourcePath: P, status: 'accepted', date: '2024-01-01' });
    store.admit([{ ...changed, sourcePath: P, date: '2024-01-01', lastmod: '2026-05-17' }]);
    expect(store.get(changed.hash)!.date).toBe('2026-05-17');
  });

  it('refuses a repeat source path with no lastmod rather than reusing the first date', () => {
    store.put({ ...record, sourcePath: P, status: 'accepted' });
    // The changed file carries no `lastmod` — the key is absent, not present
    // and undefined (exactOptionalPropertyTypes rejects the latter form).
    const r = store.admit([{ ...changed, sourcePath: P }]);
    expect(r.added).toEqual([]);
    // 'no-lastmod', not 'no-date' — the file has a date; what is missing is the
    // one field that can date a SECOND sitting without collapsing it onto the first.
    expect(r.refused).toContainEqual({ sourcePath: P, reason: 'no-lastmod' });
  });

  it('skips a hash the reader excluded — a refusal is remembered', () => {
    store.put({ ...record, status: 'excluded', excludeReason: 'co-authored with Paul' });
    expect(store.admit([item]).added).toEqual([]);
  });

  it('writes no snippet, transcript or reading', () => {
    store.admit(items);
    for (const d of ['snippets', 'transcripts', 'wiki']) {
      expect(existsSync(join(root, d))).toBe(false);
    }
  });

  it('round-trips a record and its prepared prose through disk', () => {
    const prepared = '## Prepared prose\n\nWhat the harvester will read.';
    const cuts: ImportCut[] = [
      { text: 'A kept sentence.', at: 0, facet: 'value', stance: 'own', reading: 'the author values x' },
    ];
    store.put({ ...record, status: 'extracted', cuts }, prepared);
    expect(existsSync(join(root, 'imports', `${record.hash}.md`))).toBe(true);
    expect(store.get(record.hash)).toMatchObject({
      hash: record.hash,
      sourcePath: P,
      date: record.date,
      status: 'extracted',
      attempts: 0,
    });
    expect(store.get(record.hash)!.cuts).toEqual(cuts);
    expect(store.prepared(record.hash)).toBe(prepared);
  });

  it('returns items oldest-first, so a corpus imports in written order', () => {
    store.put({ ...record, hash: 'aaaaaaaaaaaa', sourcePath: join(root, 'posts', 'a.md'), date: '2024-01-01', status: 'extracted' });
    store.put({ ...record, hash: 'bbbbbbbbbbbb', sourcePath: join(root, 'posts', 'b.md'), date: '2022-06-15', status: 'pending' });
    store.put({ ...record, hash: 'cccccccccccc', sourcePath: join(root, 'posts', 'c.md'), date: '2026-03-02', status: 'extracted' });
    store.put({ ...record, hash: 'eeeeeeeeeeee', sourcePath: join(root, 'posts', 'e.md'), date: '2025-05-05', status: 'pending' });
    expect(store.nextExtracted()!.hash).toBe('aaaaaaaaaaaa');
    expect(store.nextPending()!.hash).toBe('bbbbbbbbbbbb');
  });

  it('stamps the region on every admitted record', () => {
    store.admit([items[0]!], 'journals-ab12cd');
    expect(store.get(items[0]!.hash)!.region).toBe('journals-ab12cd');
  });

  it('hands the review only items from the chosen region', () => {
    store.admit([items[0]!], 'journals-ab12cd');
    store.admit([items[1]!], 'talks-99ffee');
    store.put({ ...store.get(items[0]!.hash)!, status: 'extracted' });
    store.put({ ...store.get(items[1]!.hash)!, status: 'extracted' });
    expect(store.nextExtracted('journals-ab12cd')!.hash).toBe(items[0]!.hash);
    expect(store.nextExtracted('talks-99ffee')!.hash).toBe(items[1]!.hash);
  });

  it('never hands a region filter an item that has no region', () => {
    store.admit([items[2]!]); // the adopted-posts shape: no region at all
    store.put({ ...store.get(items[2]!.hash)!, status: 'extracted' });
    expect(store.nextExtracted('journals-ab12cd')).toBeNull();
    expect(store.nextExtracted()!.hash).toBe(items[2]!.hash); // unfiltered still sees it
  });

  it('keeps oldest-first inside a region', () => {
    store.admit([items[0]!], 'journals-ab12cd');
    store.admit([items[1]!], 'journals-ab12cd');
    store.put({ ...store.get(items[0]!.hash)!, status: 'extracted' });
    store.put({ ...store.get(items[1]!.hash)!, status: 'extracted' });
    expect(store.nextExtracted('journals-ab12cd')!.hash).toBe(items[1]!.hash);
  });

  it('round-trips region through a fresh store', () => {
    store.admit([items[0]!], 'journals-ab12cd');
    expect(createImportStore(root).get(items[0]!.hash)!.region).toBe('journals-ab12cd');
  });
});
