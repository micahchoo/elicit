import { describe, it, expect } from 'vitest';
import { chronological } from '../src/piece/arrange.js';
import type { Pin } from '../src/piece/contract.js';
import type { Snippet } from '../src/types.js';

// ── fixtures ──────────────────────────────────────────────────────────────

const TODAY = '2026-08-02T12:00:00.000Z';

function snippet(id: string, session: string, version = 1, captured = TODAY): Snippet {
  return {
    id,
    version,
    captured,
    provenance: {
      kind: 'unprompted',
      session,
      question: '',
      questionForm: 'deliberative',
    },
    prose: `prose of ${id}`,
  };
}

/** A startedOf that maps sessions to sitting dates; an unknown session → null. */
function startedOf(map: Record<string, string>): (session: string) => string | null {
  return (session: string) => map[session] ?? null;
}

// ── chronological ─────────────────────────────────────────────────────────

describe('chronological', () => {
  it('orders by sitting start date, never by capture time (Q-59)', () => {
    const from2018 = snippet('01HARVESTED-TODAY', 's-2018', 3);
    const from2022 = snippet('02HARVESTED-TODAY', 's-2022', 2);
    const from2026 = snippet('03HARVESTED-TODAY', 's-2026', 1);
    // All three were captured today — capture time must not decide the order.
    const bySession = startedOf({
      's-2018': '2018-04-11T00:00:00.000Z',
      's-2022': '2022-09-30T00:00:00.000Z',
      's-2026': '2026-01-15T00:00:00.000Z',
    });
    const pins = chronological([from2026, from2018, from2022], bySession);
    expect(pins.map((p) => p.snippet)).toEqual([
      '01HARVESTED-TODAY',
      '02HARVESTED-TODAY',
      '03HARVESTED-TODAY',
    ]);
  });

  it('falls back to captured when the session has no transcript, and is not dropped', () => {
    const known = snippet('a-known', 's-known', 1, '2019-01-01T00:00:00.000Z');
    const orphan = snippet('b-orphan', 's-ghost', 1, '2020-06-15T00:00:00.000Z');
    const bySession = startedOf({ 's-known': '2021-03-03T00:00:00.000Z' });
    const pins = chronological([known, orphan], bySession);
    expect(pins).toHaveLength(2);
    // The orphan's captured date (2020) precedes the known sitting (2021).
    expect(pins.map((p) => p.snippet)).toEqual(['b-orphan', 'a-known']);
  });

  it('tie-breaks two snippets from the same sitting by id, stably, across calls', () => {
    const a = snippet('01AAAA', 's-shared');
    const b = snippet('01BBBB', 's-shared');
    const bySession = startedOf({ 's-shared': '2015-05-05T00:00:00.000Z' });
    const first = chronological([b, a], bySession);
    const second = chronological([b, a], bySession);
    expect(first.map((p) => p.snippet)).toEqual(['01AAAA', '01BBBB']);
    expect(second.map((p) => p.snippet)).toEqual(first.map((p) => p.snippet));
  });

  it('returns pins with distinct fresh entry ids and the snippets\u2019 current versions', () => {
    const a = snippet('s-a', 's-one', 4);
    const b = snippet('s-b', 's-two', 7);
    const bySession = startedOf({
      's-one': '2020-01-01T00:00:00.000Z',
      's-two': '2020-01-02T00:00:00.000Z',
    });
    const pins = chronological([a, b], bySession);
    expect(pins).toHaveLength(2);
    expect(new Set(pins.map((p) => p.id)).size).toBe(2);
    for (const p of pins) expect(p.kind).toBe('pin');
    expect(
      pins.map((p) => ({ snippet: p.snippet, version: p.version })),
    ).toEqual([
      { snippet: 's-a', version: 4 },
      { snippet: 's-b', version: 7 },
    ]);
  });

  it('returns [] for an empty input', () => {
    expect(chronological([], () => null)).toEqual([]);
  });
});

// ── the pin shape is exactly the contract's ───────────────────────────────

const _pinCheck: Pin = { id: '01', kind: 'pin', snippet: 's', version: 1 };
void _pinCheck;
