import { describe, it, expect } from 'vitest';
import { anniversaryDraw } from '../src/randomizer/randomizer.js';
import type { DatedSnippet } from '../src/randomizer/strata.js';
import type { Stratum } from '../src/types.js';

function snap(opts: {
  id?: string;
  wroteAt: string;
  prose?: string;
  stratum?: Stratum;
  question?: string;
  context?: string;
}): DatedSnippet {
  const base: DatedSnippet = {
    id: opts.id ?? '01TEST',
    version: 1,
    prose: opts.prose ?? 'sample text',
    session: '01SESS',
    wroteAt: opts.wroteAt,
    stratum: opts.stratum ?? 'recent',
  };
  // exactOptionalPropertyTypes: use conditional spreads
  return {
    ...base,
    ...(opts.question !== undefined ? { question: opts.question } : {}),
    ...(opts.context !== undefined ? { context: opts.context } : {}),
  };
}

describe('anniversaryDraw', () => {
  it('returns null when no snippet anniversary falls today', () => {
    const snips = [snap({ wroteAt: '2025-07-15T12:00:00Z' })];
    // August 3 — not July 15
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result).toBeNull();
  });

  it('returns a draw when a snippet was written on this month+day', () => {
    const snips = [snap({ wroteAt: '2025-08-03T12:00:00Z' })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result).not.toBeNull();
    const draw = result!.draw.draw;
    if (draw.kind !== 'anniversary') throw new Error('expected an anniversary draw');
    expect(draw.snippetId).toBe('01TEST');
    expect(result!.draw.provenance).toBe('resurfacing');
    expect(result!.draw.questionForm).toBe('deliberative');
    expect(result!.draw.question).toContain('2025-08-03');
    expect(result!.draw.question).toContain('sample text');
  });

  it('picks uniformly from multiple matching anniversaries', () => {
    const snips = [
      snap({ id: 'A', wroteAt: '2025-08-03T10:00:00Z', prose: 'alpha' }),
      snap({ id: 'B', wroteAt: '2024-08-03T10:00:00Z', prose: 'beta' }),
      snap({ id: 'C', wroteAt: '2023-08-03T10:00:00Z', prose: 'gamma' }),
    ];
    // With rng=0, pick() returns first element (index 0 of shuffled)
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result).not.toBeNull();
    expect(result!.ref).toBe('A');
  });

  it('handles one-year-ago phrasing', () => {
    const snips = [snap({ wroteAt: '2025-08-03T12:00:00Z' })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result!.draw.question).toContain('1 year ago');
  });

  it('handles multi-year-ago phrasing', () => {
    const snips = [snap({ wroteAt: '2023-08-03T12:00:00Z' })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result!.draw.question).toContain('3 years ago');
  });

  it('handles this-year phrasing', () => {
    const snips = [snap({ wroteAt: '2026-08-03T12:00:00Z' })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result!.draw.question).toContain('this year');
  });

  it('carries snippetQuestion and context when present', () => {
    const snips = [snap({
      wroteAt: '2025-08-03T12:00:00Z',
      question: 'What matters most?',
      context: 'She paused before answering.',
    })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result!.draw.snippetQuestion).toBe('What matters most?');
    expect(result!.draw.context).toBe('She paused before answering.');
  });

  it('omits snippetQuestion and context when absent', () => {
    const snips = [snap({ wroteAt: '2025-08-03T12:00:00Z' })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect('snippetQuestion' in result!.draw).toBe(false);
    expect('context' in result!.draw).toBe(false);
  });

  it('matches month+day regardless of year', () => {
    const snips = [
      snap({ id: 'old', wroteAt: '2018-08-03T12:00:00Z' }),
      snap({ id: 'new', wroteAt: '2026-08-03T12:00:00Z' }),
    ];
    // Both match month+day
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result).not.toBeNull();
  });

  it('does not match different day in same month', () => {
    const snips = [snap({ wroteAt: '2025-08-02T12:00:00Z' })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result).toBeNull();
  });

  it('does not match different month same day', () => {
    const snips = [snap({ wroteAt: '2025-07-03T12:00:00Z' })];
    const result = anniversaryDraw(snips, () => 0, new Date('2026-08-03T12:00:00Z'));
    expect(result).toBeNull();
  });

  it('is deterministic given the same random seed', () => {
    const snips = [
      snap({ id: 'X', wroteAt: '2025-08-03T10:00:00Z', prose: 'xylophone' }),
      snap({ id: 'Y', wroteAt: '2024-08-03T10:00:00Z', prose: 'yacht' }),
    ];
    // A seeded RNG that always returns the same value
    let call = 0;
    const seeded = () => (call++ === 0 ? 0.3 : 0.7);

    const r1 = anniversaryDraw(snips, seeded, new Date('2026-08-03T12:00:00Z'));
    call = 0;
    const r2 = anniversaryDraw(snips, seeded, new Date('2026-08-03T12:00:00Z'));
    expect(r1!.ref).toBe(r2!.ref);
  });
});
