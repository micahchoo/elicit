/**
 * Atlas gap-fill sweep tests — ticket 110.
 *
 * Shadow-first (Q-35): the sweep evaluates coverage and logs candidates
 * but never calls queue.add. The cap is live (Q-56): at most ATLAS_MINT_CAP
 * candidates per run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAtlasOrThrow } from '../src/ktg/atlas-loader.js';
import { createAtlasCoverageStore } from '../src/ktg/atlas-coverage.js';
import { runAtlasGapFillSweep, type AtlasGapFillLog } from '../src/ktg/atlas-gap-fill.js';
import type { AtlasInstrument } from '../src/ktg/atlas-types.js';

let root: string;
let logEntries: Parameters<AtlasGapFillLog>[0][];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-atlas-gapfill-'));
  logEntries = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeLog(): AtlasGapFillLog {
  return (e) => { logEntries.push(e); };
}

function doSweep(atlas: AtlasInstrument) {
  const coverage = createAtlasCoverageStore(root);
  return runAtlasGapFillSweep({
    atlas,
    coverage,
    log: makeLog(),
    now: '2026-08-03T00:00:00Z',
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

  it('writes no queue — shadow-first means log-only', () => {
    // This test verifies the sweep does NOT call queue.add
    // (the sweep function doesn't even receive a queue parameter)
    const result = doSweep(indexicalChecklist);
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(logEntries.length).toBeGreaterThan(0);
    // No queue parameter in the function signature — shadow by construction
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
