/**
 * Atlas gap-fill sweep tests — ticket 110, graduated 2026-08-03.
 *
 * The module default stays shadow (Q-35): candidates are logged, nothing
 * is minted. Live mode (`shadowMode: false`, what the server passes since
 * graduation) mints into the queue, deduped by `atlasRegion`. The cap is
 * live (Q-56) in both modes: at most ATLAS_MINT_CAP candidates per run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAtlasOrThrow } from '../src/ktg/loader.js';
import { createAtlasCoverageStore } from '../src/ktg/coverage.js';
import { runAtlasGapFillSweep, type AtlasGapFillLog } from '../src/ktg/atlas-gap-fill.js';
import type { AtlasInstrument } from '../src/ktg/atlas-types.js';
import { createQueueStore } from '../src/queue/queue.js';
import type { QueueStore } from '../src/types.js';

let root: string;
let queue: QueueStore;
let logEntries: Parameters<AtlasGapFillLog>[0][];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-atlas-gapfill-'));
  mkdirSync(join(root, 'vault', 'queue'), { recursive: true });
  queue = createQueueStore(join(root, 'vault'));
  logEntries = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeLog(): AtlasGapFillLog {
  return (e) => { logEntries.push(e); };
}

function doSweep(atlas: AtlasInstrument, shadowMode?: boolean) {
  const coverage = createAtlasCoverageStore(root);
  return runAtlasGapFillSweep({
    atlas,
    coverage,
    queue,
    log: makeLog(),
    now: '2026-08-03T00:00:00Z',
    ...(shadowMode !== undefined ? { shadowMode } : {}),
  });
}

// Load the seed atlas for test use (validated at load time)
const indexicalChecklist = loadAtlasOrThrow('indexical-checklist');
const lifeStoryChapters = loadAtlasOrThrow('life-story-chapters');
const timeUseGrid = loadAtlasOrThrow('time-use-grid');

describe('atlas gap-fill sweep — candidates', () => {
  it('generates candidates for all unprobed regions in a fresh atlas', () => {
    const result = doSweep(indexicalChecklist);

    // Scanned all 7 regions, but capped at ATLAS_MINT_CAP (2)
    expect(result.scanned).toBe(7);
    expect(result.candidateCount).toBe(2);

    // All entries are shadow candidates with the correct kind
    for (const entry of logEntries) {
      expect(entry.kind).toBe('atlas-gap-fill-candidate');
      expect(entry.actor).toBe('clerk');
      expect(entry.refs).toBeDefined();
      expect(entry.refs!.length).toBeGreaterThanOrEqual(2);
      expect(entry.refs![1]).toBe('indexical-checklist');
    }
  });

  it('generates opener-depth questions that name the topic, never the gap (Q-79)', () => {
    doSweep(indexicalChecklist);

    for (const entry of logEntries) {
      // The detail names the atlas internally for audit trail — Q-79
      // only bans gap-framing from user-visible question text.
      // Never frame a gap or mention the region status
      expect(entry.detail).not.toMatch(/never/i);
      expect(entry.detail).not.toMatch(/missing/i);
      expect(entry.detail).not.toMatch(/haven't/i);
      // Must start with "Tell me about" — opener-depth
      expect(entry.detail).toMatch(/"Tell me about /);
    }
  });

  it('skips regions that are already touched or evidenced', () => {
    const coverage = createAtlasCoverageStore(root);

    // Mark first 5 regions as touched/evidenced
    const regions = indexicalChecklist.regions;
    for (let i = 0; i < 5 && i < regions.length; i++) {
      coverage.writeReading({
        nodeId: regions[i]!.id,
        cites: [`snippet-${i}`],
        status: i < 2 ? 'evidenced' : 'touched',
        model: 'test',
        at: '2026-08-03T00:00:00Z',
      });
    }

    const result = runAtlasGapFillSweep({
      atlas: indexicalChecklist,
      coverage,
      queue,
      log: makeLog(),
      now: '2026-08-03T00:00:00Z',
    });

    // Only the 2 remaining unprobed regions generate candidates
    // (regions 6 and 7 of 7, capped at 2)
    expect(result.candidateCount).toBe(2);
    expect(result.scanned).toBe(7);

    // Verify candidates are for the unprobed regions
    const candidateIds = logEntries.map((e) => e.refs![0]);
    const unprobed = regions.slice(5);
    for (const id of candidateIds) {
      expect(unprobed.some((r) => r.id === id)).toBe(true);
    }
  });

  it('respects the per-run candidate cap (Q-56 live bound)', () => {
    // All 7 regions unprobed, cap is 2
    const result = doSweep(indexicalChecklist);
    expect(result.candidateCount).toBeLessThanOrEqual(2);
    expect(logEntries.length).toBe(2);
  });

  it('generates zero candidates when all regions are evidenced', () => {
    const coverage = createAtlasCoverageStore(root);

    for (const region of indexicalChecklist.regions) {
      coverage.writeReading({
        nodeId: region.id,
        cites: ['snippet-a', 'snippet-b'],
        status: 'evidenced',
        model: 'test',
        at: '2026-08-03T00:00:00Z',
      });
    }

    const result = runAtlasGapFillSweep({
      atlas: indexicalChecklist,
      coverage,
      queue,
      log: makeLog(),
      now: '2026-08-03T00:00:00Z',
    });

    expect(result.candidateCount).toBe(0);
    expect(result.scanned).toBe(7);
    expect(logEntries.length).toBe(0);
  });

  it('scans the right number of regions per atlas', () => {
    expect(doSweep(indexicalChecklist).scanned).toBe(7);
    expect(doSweep(lifeStoryChapters).scanned).toBe(5);
    expect(doSweep(timeUseGrid).scanned).toBe(6);
  });

  it('writes no queue in shadow mode — log-only', () => {
    const result = doSweep(indexicalChecklist);
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(result.minted).toBe(0);
    expect(logEntries.length).toBeGreaterThan(0);
    expect(queue.list().length).toBe(0);
  });
});

describe('atlas gap-fill sweep — live mode (graduated 2026-08-03)', () => {
  it('mints capped questions with atlasRegion set', () => {
    const result = doSweep(indexicalChecklist, false);

    expect(result.minted).toBe(2);
    expect(result.candidateCount).toBe(2);

    const entries = queue.list({ source: 'atlas-gap-fill' });
    expect(entries.length).toBe(2);
    for (const entry of entries) {
      expect(entry.atlasRegion).toBeDefined();
      expect(entry.sharpness).toBe('weak');
      expect(entry.question).toMatch(/^Tell me about /);
    }
    for (const e of logEntries) {
      expect(e.kind).toBe('atlas-gap-fill-minted');
    }
  });

  it('never re-mints a region — one question per region, ever', () => {
    doSweep(indexicalChecklist, false);
    doSweep(indexicalChecklist, false);

    const regions = queue.list({ source: 'atlas-gap-fill' }).map((e) => e.atlasRegion);
    expect(new Set(regions).size).toBe(regions.length);
  });
});

describe('atlas gap-fill sweep — regions with empty oneLine', () => {
  it('skips a region whose oneLine is empty', () => {
    const atlas: AtlasInstrument = {
      instrument: 'test-atlas',
      label: 'Test Atlas',
      description: 'Test',
      quarrelsWith: [],
      provenance: {
        generator: 'test',
        generatedAt: '2026-08-03T00:00:00Z',
        instrument: 'test-atlas',
      },
      regions: [
        { id: 'test-atlas.empty', label: 'Empty', oneLine: '' },
        { id: 'test-atlas.valid', label: 'Valid', oneLine: 'a topic worth asking about' },
      ],
    };

    const result = doSweep(atlas);
    expect(result.scanned).toBe(2);
    // Only the valid region generates a candidate
    expect(result.candidateCount).toBe(1);
    expect(logEntries[0]!.detail).toContain('a topic worth asking about');
  });
});
