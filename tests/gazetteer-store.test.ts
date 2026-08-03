/**
 * Gazetteer store tests — ticket 100.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGazetteerStore } from '../src/clerk/gazetteer-store.js';
import type { GazetteerStore, GazetteerEntity, EntityKind } from '../src/clerk/gazetteer-store.js';

let root: string;
let store: GazetteerStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-gazetteer-store-'));
  store = createGazetteerStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeEntity(overrides?: Partial<GazetteerEntity>): GazetteerEntity {
  return {
    id: 'person-alice',
    name: 'Alice',
    kind: 'person',
    aliases: ['Al'],
    mentions: ['01J123@1'],
    updatedAt: '2026-08-03T10:00:00.000Z',
    ...overrides,
  };
}

describe('gazetteer store — put and get', () => {
  it('stores and retrieves an entity', () => {
    const entity = makeEntity();
    store.put(entity);
    const got = store.get('person-alice');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Alice');
    expect(got!.kind).toBe('person');
  });

  it('returns null for unknown entity', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  it('overwrites on repeated put', () => {
    store.put(makeEntity({ name: 'Alice' }));
    store.put(makeEntity({ name: 'Alice Updated' }));
    const got = store.get('person-alice');
    expect(got!.name).toBe('Alice Updated');
  });

  it('rejects invalid id in put', () => {
    expect(() => store.put(makeEntity({ id: 'BAD ID!' }))).toThrow();
  });

  it('rejects empty name in put', () => {
    expect(() => store.put(makeEntity({ name: '  ' }))).toThrow();
  });

  it('rejects invalid kind in put', () => {
    expect(() =>
      store.put(makeEntity({ kind: 'giraffe' as unknown as EntityKind })),
    ).toThrow();
  });
});

describe('gazetteer store — list', () => {
  it('returns empty list when no entities', () => {
    expect(store.list()).toEqual([]);
  });

  it('lists all entities, newest first', () => {
    store.put(
      makeEntity({ id: 'person-alice', updatedAt: '2026-08-01T00:00:00Z' }),
    );
    store.put(
      makeEntity({
        id: 'place-home',
        name: 'Home',
        kind: 'place',
        updatedAt: '2026-08-03T00:00:00Z',
      }),
    );
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe('place-home'); // newest first
  });

  it('skips malformed files', () => {
    const entitiesDir = join(root, 'entities');
    mkdirSync(entitiesDir, { recursive: true });
    writeFileSync(join(entitiesDir, 'bad.json'), 'not json');
    store.put(makeEntity({ id: 'person-alice' }));
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('person-alice');
  });
});

describe('gazetteer store — byMentionCount', () => {
  it('returns entities at or above threshold', () => {
    store.put(
      makeEntity({ id: 'person-alice', mentions: ['a@1', 'b@2', 'c@3'] }),
    );
    store.put(
      makeEntity({
        id: 'place-home',
        name: 'Home',
        kind: 'place',
        mentions: ['d@4'],
      }),
    );
    const result = store.byMentionCount(2);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('person-alice');
  });

  it('returns empty when no entity meets threshold', () => {
    store.put(makeEntity({ mentions: ['a@1'] }));
    expect(store.byMentionCount(5)).toEqual([]);
  });

  it('sorts by mention count descending', () => {
    store.put(
      makeEntity({ id: 'person-alice', mentions: ['a@1', 'b@2'] }),
    );
    store.put(
      makeEntity({
        id: 'place-home',
        name: 'Home',
        kind: 'place',
        mentions: ['c@3', 'd@4', 'e@5'],
      }),
    );
    const result = store.byMentionCount(1);
    expect(result[0]!.id).toBe('place-home'); // 3 > 2 mentions
  });
});
