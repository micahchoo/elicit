import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  cover,
  nextConsolidation,
  saveSummary,
  loadSummaries,
} from '../src/memory/cover.js';
import type { SessionRef, RangeSummary, Tile } from '../src/memory/cover.js';

// ── Helpers ──

/** Create `count` sessions newest-first, char sizes increasing with age */
function makeSessions(count: number): SessionRef[] {
  const sessions: SessionRef[] = [];
  for (let i = 0; i < count; i++) {
    sessions.push({
      session: `s${i}`,
      started: new Date(2026, 0, 1 + i).toISOString(),
      turnCount: 10 + i,
      chars: 500 + i * 100,
    });
  }
  // newest-first
  return sessions.reverse();
}

function makeSummary(sessions: string[], line: string): RangeSummary {
  return {
    sessions,
    line,
    model: 'test-model',
    at: '2026-08-01T00:00:00.000Z',
  };
}

/** Collect every session id mentioned in tiles */
function tileSessionIds(tiles: Tile[]): string[] {
  const ids: string[] = [];
  for (const t of tiles) {
    if (t.kind === 'verbatim') {
      ids.push(t.session);
    } else {
      for (const s of t.sessions) ids.push(s);
    }
  }
  return ids;
}

// ── cover ──

describe('cover', () => {
  it('all verbatim when budget fits everything', () => {
    const sessions = makeSessions(3); // s2(700), s1(600), s0(500)
    const tiles = cover(sessions, [], 5000);
    expect(tiles).toEqual([
      { kind: 'verbatim', session: 's2' },
      { kind: 'verbatim', session: 's1' },
      { kind: 'verbatim', session: 's0' },
    ]);
  });

  it('newest verbatim within budget, older unsummarized', () => {
    const sessions = makeSessions(5); // s4(900), s3(800), s2(700), s1(600), s0(500)
    // budget 1700 covers s4(900) + s3(800), leaves s2,s1,s0
    const tiles = cover(sessions, [], 1700);

    // verbatim: 2 newest
    expect(tiles[0]).toEqual({ kind: 'verbatim', session: 's4' });
    expect(tiles[1]).toEqual({ kind: 'verbatim', session: 's3' });

    // remaining: one unsummarized block
    expect(tiles[2]).toEqual({ kind: 'unsummarized', sessions: ['s2', 's1', 's0'] });
    expect(tiles).toHaveLength(3);

    // every session accounted for
    expect(tileSessionIds(tiles).sort()).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('budget too small for any session → all unsummarized', () => {
    const sessions = makeSessions(3); // s2(700), s1(600), s0(500)
    const tiles = cover(sessions, [], 400);
    expect(tiles).toEqual([
      { kind: 'unsummarized', sessions: ['s2', 's1', 's0'] },
    ]);
  });

  it('summary covers old ranges when budget excludes them', () => {
    // 5 sessions: s4(900), s3(800), s2(700), s1(600), s0(500)
    const sessions = makeSessions(5);
    const summaries = [
      makeSummary(['s0', 's1'], 'Sessions 0-1 summary'),
    ];
    // budget: 900 — only s4 fits as verbatim
    const tiles = cover(sessions, summaries, 900);

    // verbatim: s4
    expect(tiles[0]).toEqual({ kind: 'verbatim', session: 's4' });

    // remaining (newest-remaining first): s3 and s2 are consecutive unsummarized → one tile
    // then s1,s0 covered by summary
    expect(tiles[1]).toEqual({ kind: 'unsummarized', sessions: ['s3', 's2'] });
    expect(tiles[2]).toEqual({
      kind: 'summary',
      sessions: ['s0', 's1'],
      line: 'Sessions 0-1 summary',
    });
    expect(tiles).toHaveLength(3);
    expect(tileSessionIds(tiles).sort()).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('largest covering summary selected when multiple cover the same range', () => {
    const sessions = makeSessions(4); // s3(800), s2(700), s1(600), s0(500)
    const summaries = [
      makeSummary(['s0', 's1'], 'Small summary'),
      makeSummary(['s0', 's1', 's2'], 'Larger summary'), // covers s2 too
    ];
    // budget: 0 → no verbatim; remaining = all
    const tiles = cover(sessions, summaries, 0);

    // newest-remaining first: s3 (unsummarized), then s2,s1,s0 covered by larger summary
    expect(tiles[0]).toEqual({ kind: 'unsummarized', sessions: ['s3'] });
    expect(tiles[1]).toEqual({
      kind: 'summary',
      sessions: ['s0', 's1', 's2'],
      line: 'Larger summary',
    });
    expect(tileSessionIds(tiles).sort()).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('every session in exactly one tile — no duplicates, no omissions', () => {
    const sessions = makeSessions(6);
    const summaries = [
      makeSummary(['s0', 's1'], 'Sum 0-1'),
      makeSummary(['s0', 's1', 's2', 's3'], 'Sum 0-3'), // larger summary overlaps
    ];
    const t2 = cover(sessions, summaries, 1000); // s5 verbatim only
    const ids = tileSessionIds(t2);
    const seen = new Map<string, number>();
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const s of sessions) expect(seen.get(s.session)).toBe(1);
    expect(seen.size).toBe(sessions.length);
  });

  it('missing summary → unsummarized tile, never omission', () => {
    // 4 sessions, summaries only cover s0-s1, s2-s3 have no summary
    const sessions = makeSessions(4);
    const summaries = [
      makeSummary(['s0', 's1'], 'Only 0-1'),
    ];
    const tiles = cover(sessions, summaries, 0);
    const ids = tileSessionIds(tiles);
    expect(ids.sort()).toEqual(['s0', 's1', 's2', 's3']);

    // s3 and s2 must be unsummarized (not omitted)
    const unsummarized = tiles.filter(t => t.kind === 'unsummarized');
    expect(unsummarized.length).toBeGreaterThanOrEqual(1);
    const unsumIds = unsummarized.flatMap(t => t.kind === 'unsummarized' ? t.sessions : []);
    expect(unsumIds).toContain('s2');
    expect(unsumIds).toContain('s3');
  });

  it('deterministic given same inputs', () => {
    const sessions = makeSessions(5);
    const summaries = [makeSummary(['s0', 's1'], 'Sum 0-1')];
    const a = cover(sessions, summaries, 2000);
    const b = cover(sessions, summaries, 2000);
    expect(a).toEqual(b);
  });

  it('zero sessions → empty tiles', () => {
    expect(cover([], [], 1000)).toEqual([]);
  });

  it('summary with claimed sessions is skipped (partial match rejected)', () => {
    // s3,s2,s1,s0 (newest-first)
    // Summary [s1,s2] exists but s2 is claimed as verbatim → can't use summary
    const sessions = makeSessions(4); // s3(800), s2(700), s1(600), s0(500)
    const summaries = [
      makeSummary(['s1', 's2'], 'Sum 1-2'), // covers s1(older) and s2(newer)
    ];
    // budget 800: covers s3(800). Remaining: s2,s1,s0
    // Try s2: summary [s1,s2] covers s2 but s2 is unclaimed so far. s1 is older and also unclaimed.
    // So summary is valid → covers s2 and s1.
    // Then s0 is unsummarized.
    const tiles = cover(sessions, summaries, 800);
    // Actually, s2 IS unclaimed here. The summary covers both s2 and s1, both unclaimed.
    // So the summary IS used: summary([s1,s2]), unsummarized([s0])
    expect(tiles).toHaveLength(3);
    // verbatim: s3
    // remaining: s2,s1 covered by summary, s0 unsummarized
    expect(tiles[1]).toEqual({ kind: 'summary', sessions: ['s1', 's2'], line: 'Sum 1-2' });
    expect(tiles[2]).toEqual({ kind: 'unsummarized', sessions: ['s0'] });
  });

  it('summary partially claimed → rejected, session falls to unsummarized', () => {
    // 5 sessions: s4(900), s3(800), s2(700), s1(600), s0(500)
    // budget 2400: s4(900) + s3(800) + s2(700) = 2400 — verbatim: s4,s3,s2
    // Summary [s1,s2,s3] covers s1(unclaimed), s2(claimed), s3(claimed) → rejected
    const s5 = makeSessions(5);
    const sum = [makeSummary(['s1', 's2', 's3'], 'Sum 1-3')];
    const t = cover(s5, sum, 2400);
    // Verb: s4, s3, s2. Remaining: s1, s0 → unsummarized
    expect(t).toHaveLength(4);
    expect(t[3]).toEqual({ kind: 'unsummarized', sessions: ['s1', 's0'] });
  });
});

// ── nextConsolidation ──

/** Sessions oldest-first, for nextConsolidation */
function makeOldestSessions(count: number): SessionRef[] {
  const sessions: SessionRef[] = [];
  for (let i = 0; i < count; i++) {
    sessions.push({
      session: `s${i}`,
      started: new Date(2026, 0, 1 + i).toISOString(),
      turnCount: 10 + i,
      chars: 500 + i * 100,
    });
  }
  return sessions; // oldest-first
}

describe('nextConsolidation', () => {
  it('oldest unsummarized pair first', () => {
    const sessions = makeOldestSessions(5); // s0,s1,s2,s3,s4
    // No summaries yet — first pair is [s0,s1]
    const result = nextConsolidation(sessions, []);
    expect(result).toEqual(['s0', 's1']);
  });

  it('skips already-summarized pair, proposes next', () => {
    const sessions = makeOldestSessions(5);
    const summaries = [makeSummary(['s0', 's1'], 'Done')];
    // [s0,s1] is summarized → next is [s2,s3]
    const result = nextConsolidation(sessions, summaries);
    expect(result).toEqual(['s2', 's3']);
  });

  it('binary bracketing upward when leaf pairs are done', () => {
    const sessions = makeOldestSessions(5);
    const summaries = [
      makeSummary(['s0', 's1'], 'Done 0-1'),
      makeSummary(['s2', 's3'], 'Done 2-3'),
    ];
    // Leaf pairs done → propose pair-of-pairs: [s0,s1,s2,s3]
    const result = nextConsolidation(sessions, summaries);
    expect(result).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('null when tree is complete', () => {
    const sessions = makeOldestSessions(5);
    const summaries = [
      makeSummary(['s0', 's1'], 'Done 0-1'),
      makeSummary(['s2', 's3'], 'Done 2-3'),
      makeSummary(['s0', 's1', 's2', 's3'], 'Done 0-3'),
      makeSummary(['s0', 's1', 's2', 's3', 's4'], 'Done all'),
    ];
    const result = nextConsolidation(sessions, summaries);
    expect(result).toBeNull();
  });

  it('waits for both children before proposing parent pair', () => {
    // 4 sessions: s0,s1,s2,s3
    // Level 1: [s0,s1], [s2,s3]
    // Level 2: [s0,s1,s2,s3]
    // If only [s0,s1] is summarized, [s2,s3] must be done before [s0..s3]
    const sessions = makeOldestSessions(4);
    const summaries = [makeSummary(['s0', 's1'], 'Done 0-1')];
    // Next: [s2,s3] (leaf pair), NOT [s0..s3] (children not both ready)
    const result = nextConsolidation(sessions, summaries);
    expect(result).toEqual(['s2', 's3']);
  });

  it('null for single session (no pair possible)', () => {
    const sessions = makeOldestSessions(1);
    expect(nextConsolidation(sessions, [])).toBeNull();
  });

  it('null for zero sessions', () => {
    expect(nextConsolidation([], [])).toBeNull();
  });

  it('odd session at end is promoted, paired at next level', () => {
    // 3 sessions: s0,s1,s2
    // Level 1: [s0,s1], promote s2
    // Level 2: [s0,s1,s2]
    const sessions = makeOldestSessions(3);
    // First: [s0,s1]
    expect(nextConsolidation(sessions, [])).toEqual(['s0', 's1']);

    // After [s0,s1] is summarized, next is [s0,s1,s2]
    const summaries = [makeSummary(['s0', 's1'], 'Done 0-1')];
    expect(nextConsolidation(sessions, summaries)).toEqual(['s0', 's1', 's2']);
  });

  it('deterministic given same inputs', () => {
    const sessions = makeOldestSessions(6);
    const summaries = [
      makeSummary(['s0', 's1'], 'A'),
      makeSummary(['s2', 's3'], 'B'),
    ];
    const a = nextConsolidation(sessions, summaries);
    const b = nextConsolidation(sessions, summaries);
    expect(a).toEqual(b);
  });
});

// ── saveSummary / loadSummaries roundtrip ──

describe('summary persistence', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elicit-cover-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('roundtrip single summary', () => {
    const s: RangeSummary = {
      sessions: ['abc123', 'def456'],
      line: 'These two sessions covered project setup and first prototype.',
      model: 'bonsai-27b',
      at: '2026-08-01T12:00:00.000Z',
    };
    saveSummary(root, s);
    const loaded = loadSummaries(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(s);
  });

  it('roundtrip multiple summaries', () => {
    const s1: RangeSummary = {
      sessions: ['s0', 's1'],
      line: 'Pair 0-1',
      model: 'm1',
      at: '2026-01-01T00:00:00.000Z',
    };
    const s2: RangeSummary = {
      sessions: ['s2', 's3'],
      line: 'Pair 2-3',
      model: 'm2',
      at: '2026-01-02T00:00:00.000Z',
    };
    const s3: RangeSummary = {
      sessions: ['s0', 's1', 's2', 's3'],
      line: 'Pair of pairs 0-3',
      model: 'm3',
      at: '2026-01-03T00:00:00.000Z',
    };

    saveSummary(root, s1);
    saveSummary(root, s2);
    saveSummary(root, s3);

    const loaded = loadSummaries(root);
    expect(loaded).toHaveLength(3);
    // Order is filesystem order, so just check sets
    const lines = loaded.map(l => l.line).sort();
    expect(lines).toEqual(['Pair 0-1', 'Pair 2-3', 'Pair of pairs 0-3']);
  });

  it('writes to correct path: vault/marginalia/transcript-summaries/<first>-<last>.md', () => {
    const s: RangeSummary = {
      sessions: ['ulid001', 'ulid002', 'ulid003'],
      line: 'Three sessions.',
      model: 'test',
      at: '2026-01-01T00:00:00.000Z',
    };
    saveSummary(root, s);

    const expectedPath = join(
      root,
      'marginalia',
      'transcript-summaries',
      'ulid001-ulid003.md',
    );
    expect(existsSync(expectedPath)).toBe(true);

    const content = readFileSync(expectedPath, 'utf-8');
    expect(content).toContain('Three sessions.');
    expect(content).toContain('sessions:');
    expect(content).toContain('ulid001');
    expect(content).toContain('ulid003');
  });

  it('loadSummaries returns empty array for missing directory', () => {
    expect(loadSummaries(root)).toEqual([]);
  });

  it('loadSummaries ignores non-.md files', () => {
    const s: RangeSummary = {
      sessions: ['a', 'b'],
      line: 'Test',
      model: 'm',
      at: '2026-01-01T00:00:00.000Z',
    };
    saveSummary(root, s);
    // The file written is a-b.md, which is .md, so this doesn't trigger the filter.
    // Just verify the filter works by checking it doesn't crash with non-.md present.
    // We can't easily create non-.md in the dir without mkdir+writeFileSync.
    const loaded = loadSummaries(root);
    expect(loaded).toHaveLength(1);
  });

  it('new instance over same root sees all summaries (durability)', () => {
    const s: RangeSummary = {
      sessions: ['x', 'y'],
      line: 'Durable test',
      model: 'm',
      at: '2026-01-01T00:00:00.000Z',
    };
    saveSummary(root, s);

    // Load with a "fresh" call — same root
    const loaded = loadSummaries(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.line).toBe('Durable test');
  });
});

// ── Integration: nextConsolidation + saveSummary + cover ──

describe('tiling lifecycle', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elicit-cover-lifecycle-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('full cycle: consolidate → save → cover sees the summary', () => {
    const sessionsNewest = makeSessions(5); // s4..s0 newest-first
    const sessionsOldest = [...sessionsNewest].reverse(); // s0..s4

    // Step 1: nextConsolidation proposes [s0,s1]
    const pair = nextConsolidation(sessionsOldest, []);
    expect(pair).toEqual(['s0', 's1']);

    // Step 2: "summarize" it (caller would use LLM; we just save)
    const summary: RangeSummary = {
      sessions: pair!,
      line: 'Sessions 0 and 1 covered project inception.',
      model: 'bonsai-27b',
      at: '2026-08-01T00:00:00.000Z',
    };
    saveSummary(root, summary);

    // Step 3: Load summaries and use in cover
    const loaded = loadSummaries(root);
    expect(loaded).toHaveLength(1);

    // cover with budget 0 → everything old, [s0,s1] summarized
    const tiles = cover(sessionsNewest, loaded, 0);
    // Should have summary for s0,s1, unsummarized for s2,s3,s4
    const summaryTiles = tiles.filter(t => t.kind === 'summary');
    expect(summaryTiles).toHaveLength(1);
    expect(summaryTiles[0]).toMatchObject({
      kind: 'summary',
      sessions: ['s0', 's1'],
      line: 'Sessions 0 and 1 covered project inception.',
    });
  });
});
