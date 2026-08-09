/**
 * Gazetteer frontier sweep tests — ticket 100.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGazetteerStore } from '../src/clerk/gazetteer-store.js';
import type { GazetteerStore } from '../src/clerk/gazetteer-store.js';
import { runGazetteerFrontier } from '../src/clerk/gazetteer-frontier.js';
import { createQueueStore } from '../src/queue/queue.js';
import type { QueueStore } from '../src/types.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'elicit-gazetteer-frontier-'));
}

function setupVault(root: string) {
  mkdirSync(join(root, 'vault', 'queue'), { recursive: true });
  mkdirSync(join(root, 'entities'), { recursive: true });
}

describe('gazetteer frontier sweep', () => {
  let root: string;
  let store: GazetteerStore;
  let queue: QueueStore;

  beforeEach(() => {
    root = tempDir();
    setupVault(root);
    store = createGazetteerStore(root);
    queue = createQueueStore(join(root, 'vault'));
  });

  const now = '2026-08-03T00:00:00Z';

  function doSweep(shadowMode = false) {
    return runGazetteerFrontier({
      store,
      queue,
      log: () => {},
      now,
      mentionThreshold: 2,
      mintCap: 5,
      shadowMode,
    });
  }

  it('mints nothing when no entities exist', () => {
    const result = doSweep(true);
    expect(result.minted).toBe(0);
    expect(result.frontierEntities).toBe(0);
  });

  it('mints nothing when all entities are below threshold', () => {
    store.put({
      id: 'person-alice',
      name: 'Alice',
      kind: 'person',
      aliases: [],
      mentions: ['a@1'], // only 1 mention, below threshold of 2
      updatedAt: now,
    });
    const result = doSweep(true);
    expect(result.frontierEntities).toBe(0);
  });

  it('finds frontier entities (mentioned enough, never asked about)', () => {
    store.put({
      id: 'person-alice',
      name: 'Alice',
      kind: 'person',
      aliases: [],
      mentions: ['a@1', 'a@2', 'a@3'],
      updatedAt: now,
    });
    store.put({
      id: 'place-home',
      name: 'Home',
      kind: 'place',
      aliases: [],
      mentions: ['b@1', 'b@2'],
      updatedAt: now,
    });
    const result = doSweep(true); // shadow mode
    expect(result.frontierEntities).toBe(2);
    expect(result.minted).toBe(0); // shadow: nothing minted
  });

  it('excludes entities already asked about via queue subjects', () => {
    store.put({
      id: 'person-alice',
      name: 'Alice',
      kind: 'person',
      aliases: [],
      mentions: ['a@1', 'a@2', 'a@3'],
      updatedAt: now,
    });
    // Add a queue entry that targets Alice
    queue.add({
      source: 'composed',
      license: 'test',
      question: 'Tell me about Alice',
      questionForm: 'deliberative',
      horizon: 'session',
      subjects: ['person-alice'],
    });
    const result = doSweep(true);
    expect(result.frontierEntities).toBe(0); // Alice is already asked about
  });

  it('mints questions in live mode', () => {
    store.put({
      id: 'person-alice',
      name: 'Alice',
      kind: 'person',
      aliases: [],
      mentions: ['a@1', 'a@2', 'a@3'],
      updatedAt: now,
    });
    const result = doSweep(false); // live mode
    expect(result.frontierEntities).toBe(1);
    expect(result.minted).toBe(1);
    const entries = queue.list();
    const frontier = entries.filter((e) => e.source === 'gazetteer-frontier');
    expect(frontier).toHaveLength(1);
    expect(frontier[0]!.subjects).toContain('person-alice');
    expect(frontier[0]!.question).toMatch(/Alice/); // names the entity
  });

  it('caps mints at mintCap in live mode', () => {
    store.put({
      id: 'person-alice',
      name: 'Alice',
      kind: 'person',
      aliases: [],
      mentions: ['a@1', 'a@2'],
      updatedAt: now,
    });
    store.put({
      id: 'place-home',
      name: 'Home',
      kind: 'place',
      aliases: [],
      mentions: ['b@1', 'b@2'],
      updatedAt: now,
    });
    store.put({
      id: 'institution-acme',
      name: 'Acme Corp',
      kind: 'institution',
      aliases: [],
      mentions: ['c@1', 'c@2'],
      updatedAt: now,
    });
    const result = runGazetteerFrontier({
      store,
      queue,
      log: () => {},
      now,
      mentionThreshold: 2,
      mintCap: 2, // cap at 2
      shadowMode: false,
    });
    expect(result.frontierEntities).toBe(3);
    expect(result.minted).toBe(2); // capped
  });

  it('question text names the entity, never the gap', () => {
    store.put({
      id: 'person-alice',
      name: 'Alice',
      kind: 'person',
      aliases: [],
      mentions: ['a@1', 'a@2'],
      updatedAt: now,
    });
    doSweep(false);
    const frontier = queue
      .list()
      .filter((e) => e.source === 'gazetteer-frontier');
    expect(frontier).toHaveLength(1);
    const q = frontier[0]!.question;
    expect(q).toMatch(/Alice/);
    // Q-79: questions name the topic, never the gap
    expect(q).not.toMatch(/never|gap|missing|haven't|absent/i);
  });
});
