/**
 * The queue's serialization truth (Wave A1): OPTIONAL_ENTRY_FIELDS is the
 * single list that drives both #write (entry → frontmatter) and #parseEntry
 * (frontmatter → entry), so a field the type declares but the list omits
 * silently dies on disk — it is written, read back as absent, and any
 * dedupe that keys on it (the Q-83 lineage mirror: one question per claim,
 * ever) re-fires on every restart.
 *
 * The compile-time `satisfies readonly OptionalEntryKey[]` on the list
 * guarantees it contains no NON-optional key; it cannot guarantee it
 * contains every optional one. This file supplies the missing direction:
 * derive the optional-key set from the QueueEntry type the same way
 * queue.ts does, and diff it against the list.
 */

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';

import { createQueueStore, OPTIONAL_ENTRY_FIELDS } from '../src/queue/queue.js';
import type { QueueDraft, QueueEntry } from '../src/types.js';

/**
 * The optional-key set, derived from the QueueEntry type the same way
 * queue.ts derives OptionalEntryKey. A new optional field in types.ts must
 * grow THIS list and OPTIONAL_ENTRY_FIELDS together — the diff below fails
 * on whichever side is behind.
 */
type OptionalEntryKey = {
  [K in keyof QueueEntry]-?: undefined extends QueueEntry[K] ? K : never;
}[keyof QueueEntry];

const EXPECTED_OPTIONAL_KEYS = [
  'answeredAt',
  'claim',
  'quest',
  'gap',
  // The composition gap sweep (redesign-2026-08-09 §7, §10): the
  // (composition, gap) dedupe pair and the sitting stamp of the faster
  // expiry.
  'composition',
  'createdSitting',
  'bud',
  'failure',
  'snippet',
  'claims',
  'cites',
  'quotedFragment',
  'target',
  'topic',
  'targetFacet',
  'direction',
  'errandKind',
  'errandPerson',
  'patternId',
  'derivedFrom',
  'operatorsUsed',
  'lineageMirror',
  'soundingId',
  'machineId',
  'machineProtocol',
  'drmId',
  'territoryNode',
  'atlasRegion',
  'subjects',
] as const satisfies readonly OptionalEntryKey[];

describe('OPTIONAL_ENTRY_FIELDS serialization truth', () => {
  test('covers every optional QueueEntry key', () => {
    const actual = new Set<string>(OPTIONAL_ENTRY_FIELDS);
    const expected = new Set<string>(EXPECTED_OPTIONAL_KEYS);
    expect([...expected].filter((k) => !actual.has(k))).toEqual([]);
    expect([...actual].filter((k) => !expected.has(k))).toEqual([]);
  });

  test('the six draft-provenance fields survive a fresh-store read-back', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-qserial-'));
    const draft: QueueDraft = {
      source: 'composed',
      license: 'user',
      question: 'What has changed for you?',
      questionForm: 'deliberative',
      horizon: 'session',
      errandKind: 'other-minds',
      errandPerson: 'Ada',
      patternId: 'reversal',
      derivedFrom: ['s1@1', 's2@2'],
      operatorsUsed: ['reversal'],
    };
    const entry = createQueueStore(root).add(draft);
    // A FRESH store over the same root is what a restart reads.
    const readBack = createQueueStore(root).list().find((e) => e.id === entry.id);
    expect(readBack).toBeDefined();
    expect(readBack!.errandKind).toBe('other-minds');
    expect(readBack!.errandPerson).toBe('Ada');
    expect(readBack!.patternId).toBe('reversal');
    expect(readBack!.derivedFrom).toEqual(['s1@1', 's2@2']);
    expect(readBack!.operatorsUsed).toEqual(['reversal']);
  });
});
