import { describe, expect, it } from 'vitest';
import type { Arrangement, Marginalia } from '../src/piece/contract.js';
import type { Complete, Snippet } from '../src/types.js';
import { stalePins } from '../src/piece/stale.js';

// ── fixtures ──────────────────────────────────────────────────────────────

const TODAY = '2026-08-02T12:00:00.000Z';

function snippet(id: string, version: number): Snippet {
  return {
    id,
    version,
    captured: TODAY,
    provenance: {
      kind: 'unprompted',
      session: 's-test',
      question: '',
      questionForm: 'deliberative',
    },
    prose: `prose of ${id} v${version}`,
  };
}

const v1 = snippet('s-a', 1);
const v2 = snippet('s-a', 2);
const v3 = snippet('s-a', 3);

function arrangement(entries: Arrangement['entries']): Arrangement {
  return { id: 'arr-1', principle: 'chronology', entries, marginalia: [], created: TODAY };
}

/** The finding content the caller dedupes by (on, note) — the pure part. */
function findings(found: Marginalia[]) {
  return found.map(({ on, note, text }) => ({ on, note, text }));
}

// ── stalePins ─────────────────────────────────────────────────────────────

describe('stalePins', () => {
  it('flags a pin to an older version once, on the entry id, with no model', () => {
    const a = arrangement([
      { id: 'e1', kind: 'pin', snippet: 's-a', version: 1 },
      { id: 'e2', kind: 'gap' },
    ]);
    const found = stalePins(a, { 's-a': v3 });
    expect(found).toHaveLength(1);
    expect(found[0]!.note).toBe('stale-pin');
    expect(found[0]!.on).toBe('e1');
    expect(found[0]!).not.toHaveProperty('model');
    expect(found[0]!.text.length).toBeGreaterThan(0);
  });

  it('flags nothing for a pin to the current version', () => {
    const a = arrangement([{ id: 'e1', kind: 'pin', snippet: 's-a', version: 3 }]);
    expect(stalePins(a, { 's-a': v3 })).toEqual([]);
  });

  it('does not mutate the arrangement — in particular no pin version changes', () => {
    const a = arrangement([
      { id: 'e1', kind: 'pin', snippet: 's-a', version: 1 },
      { id: 'e2', kind: 'pin', snippet: 's-a', version: 2 },
    ]);
    const before = structuredClone(a);
    stalePins(a, { 's-a': v3 });
    expect(a).toEqual(before);
  });

  it('is pure and memoryless: same findings, same order, on every call', () => {
    const a = arrangement([
      { id: 'e1', kind: 'pin', snippet: 's-a', version: 1 },
      { id: 'e2', kind: 'pin', snippet: 's-a', version: 2 },
      { id: 'e3', kind: 'pin', snippet: 's-a', version: 3 },
    ]);
    const snippets: Record<string, Snippet> = { 's-a': v3 };
    const first = stalePins(a, snippets);
    const second = stalePins(a, snippets);
    // Fresh id + clock per finding; the findings themselves repeat (Q-39 —
    // the caller dedupes by (on, note)).
    expect(findings(first)).toEqual([
      { on: 'e1', note: 'stale-pin', text: first[0]!.text },
      { on: 'e2', note: 'stale-pin', text: first[1]!.text },
    ]);
    expect(findings(second)).toEqual(findings(first));
    for (const m of [...first, ...second]) {
      expect(typeof m.id).toBe('string');
      expect(m.id.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(m.at))).toBe(false);
    }
  });

  it('yields nothing for a gap entry', () => {
    const a = arrangement([{ id: 'e1', kind: 'gap' }]);
    expect(stalePins(a, { 's-a': v3 })).toEqual([]);
  });

  it('exports nothing taking a Complete', () => {
    const complete: Complete = (_system, _turns) => Promise.resolve('');
    // Never executed — the body below defines the call without running it.
    // If stalePins' first parameter WERE a Complete, its @ts-expect-error
    // would be unused and tsc would fail this file (Q-34, Q-31).
    const calls = () => {
      // @ts-expect-error stalePins takes an Arrangement, never a Complete
      stalePins(complete, { 's-a': v1 });
    };
    expect(calls).toBeTypeOf('function');
  });
});
