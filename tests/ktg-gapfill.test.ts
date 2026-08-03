/**
 * Territory gap-fill sweep tests — ticket 094 Phase 3.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadKtgSkeletonOrThrow } from '../src/ktg/loader.js';
import { createCoverageStore } from '../src/ktg/coverage.js';
import type { CoverageStore } from '../src/ktg/coverage.js';
import { runTerritoryGapFillSweep } from '../src/ktg/gap-fill.js';
import { createQueueStore } from '../src/queue/queue.js';
import type { QueueStore, QueueDraft } from '../src/types.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'elicit-ktg-gapfill-'));
}

function setupVault(root: string) {
  mkdirSync(join(root, 'vault', 'queue'), { recursive: true });
  mkdirSync(join(root, 'vault', 'ktg', 'coverage'), { recursive: true });
  mkdirSync(join(root, 'data', 'ktg'), { recursive: true });
}

describe('territory gap-fill sweep', () => {
  let root: string;
  let queue: QueueStore;
  let coverage: CoverageStore;

  const skeleton = loadKtgSkeletonOrThrow('fake-craft');

  beforeEach(() => {
    root = tempDir();
    setupVault(root);
    queue = createQueueStore(join(root, 'vault'));
    coverage = createCoverageStore(join(root, 'vault'));
  });

  function doSweep() {
    return runTerritoryGapFillSweep({
      skeleton,
      coverage,
      queue,
      log: () => {},
      now: '2026-08-03T00:00:00Z',
    });
  }

  it('mints nothing when no nodes are evidenced', () => {
    const result = doSweep();
    expect(result.minted).toBe(0);
  });

  it('mints frontier question for unprobed hard prereq of evidenced node', () => {
    coverage.writeReading({
      nodeId: 'fake-craft.technique.core',
      cites: ['snippet-1'],
      status: 'evidenced',
      model: 'test',
      at: '2026-08-03T00:00:00Z',
    });

    const result = doSweep();
    expect(result.frontierQuestions).toBe(2);
    expect(result.minted).toBe(2);

    const entries = queue.list();
    const nodeIds = entries
      .filter((e) => e.source === 'territory-gap-fill')
      .map((e) => e.territoryNode)
      .sort();
    expect(nodeIds).toEqual([
      'fake-craft.foundations.materials',
      'fake-craft.foundations.setup',
    ]);

    for (const e of entries) {
      if (e.source !== 'territory-gap-fill') continue;
      expect(e.question).not.toContain('Material Selection');
      expect(e.question).not.toContain('Workspace Setup');
      expect(e.question).toMatch(/what would it look like/i);
    }
  });

  it('mints frontier question for unprobed node with evidenced successor', () => {
    coverage.writeReading({
      nodeId: 'fake-craft.integration.capstone',
      cites: ['snippet-2'],
      status: 'evidenced',
      model: 'test',
      at: '2026-08-03T00:00:00Z',
    });

    const result = doSweep();
    expect(result.frontierQuestions).toBe(1);

    const entries = queue.list();
    const nodeIds = entries
      .filter((e) => e.source === 'territory-gap-fill')
      .map((e) => e.territoryNode);
    expect(nodeIds).toContain('fake-craft.technique.core');
  });

  it('mints common-failure probe for evidenced node', () => {
    coverage.writeReading({
      nodeId: 'fake-craft.foundations.materials',
      cites: ['snippet-3'],
      status: 'evidenced',
      model: 'test',
      at: '2026-08-03T00:00:00Z',
    });

    const result = doSweep();
    expect(result.failureQuestions).toBe(1);

    const failureEntry = queue.list().find(
      (e) => e.source === 'territory-gap-fill' && e.sharpness === 'sharp',
    );
    expect(failureEntry).toBeDefined();
    expect(failureEntry!.territoryNode).toBe('fake-craft.foundations.materials');
    expect(failureEntry!.question).not.toContain('Material Selection');
    expect(failureEntry!.question).toMatch(/goes wrong/i);
  });

  it('does not re-mint a question for a node already in queue', () => {
    coverage.writeReading({
      nodeId: 'fake-craft.technique.core',
      cites: ['snippet-1'],
      status: 'evidenced',
      model: 'test',
      at: '2026-08-03T00:00:00Z',
    });

    const preDraft: QueueDraft = {
      source: 'territory-gap-fill',
      license: 'test',
      question: 'existing question',
      questionForm: 'deliberative',
      sharpness: 'weak',
      horizon: 'session',
      territoryNode: 'fake-craft.foundations.setup',
      target: 'domain',
      topic: 'fake-craft',
    };
    queue.add(preDraft);

    const preEntries = queue.list().filter((e: { source?: string }) => e.source === 'territory-gap-fill');
    expect(preEntries.length).toBe(1);

    const result = doSweep();
    // One frontier (materials, prereq not pre-populated) + one common-failure
    // (technique.core) = 2 minted. setup is skipped (pre-populated).
    expect(result.minted).toBe(2);
    expect(result.frontierQuestions).toBe(1);
    expect(result.failureQuestions).toBe(1);

    const entries = queue.list();
    const nodeIds = entries
      .filter((e: { source?: string }) => e.source === 'territory-gap-fill')
      .map((e: { territoryNode?: string }) => e.territoryNode)
      .sort();
    // 3 total: 2 frontier (materials, setup) + 1 failure (technique.core)
    expect(nodeIds).toEqual([
      'fake-craft.foundations.materials',
      'fake-craft.foundations.setup',
      'fake-craft.technique.core',
    ]);
  });

  it('respects the per-run mint cap', () => {
    for (const nodeId of [
      'fake-craft.integration.capstone',
      'fake-craft.technique.core',
      'fake-craft.foundations.materials',
    ]) {
      coverage.writeReading({
        nodeId,
        cites: ['snippet-x'],
        status: 'evidenced',
        model: 'test',
        at: '2026-08-03T00:00:00Z',
      });
    }
    const result = doSweep();
    expect(result.minted).toBeLessThanOrEqual(2);
  });

  it('does not mint common-failure for touched node', () => {
    coverage.writeReading({
      nodeId: 'fake-craft.foundations.setup',
      cites: ['snippet-4'],
      status: 'touched',
      model: 'test',
      at: '2026-08-03T00:00:00Z',
    });

    const result = doSweep();
    expect(result.minted).toBe(0);
  });
});
