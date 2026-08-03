import { describe, expect, it } from 'vitest';
import type { Piece } from '../src/piece/contract.js';
import { isDormant } from '../src/piece/dormancy.js';

// ── fixtures ──────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const DAY = 86_400_000;

/** Absent setDownAt = picked up (Q-41); there is no done flag. */
function piece(overrides: Partial<Piece> = {}): Piece {
  return {
    id: 'p-1',
    created: new Date(NOW - 90 * DAY).toISOString(),
    current: 'arr-1',
    arrangements: [],
    ...overrides,
  };
}

// ── isDormant ─────────────────────────────────────────────────────────────

describe('isDormant', () => {
  it('is false for a Piece touched yesterday', () => {
    const p = piece();
    const lastTouched = new Date(NOW - DAY).toISOString();
    expect(isDormant(p, lastTouched, NOW, 45)).toBe(false);
  });

  it('is true for a Piece touched 60 days ago', () => {
    const p = piece();
    const lastTouched = new Date(NOW - 60 * DAY).toISOString();
    expect(isDormant(p, lastTouched, NOW, 45)).toBe(true);
  });

  it('is false for a Piece already set down, however old (Q-41 — no repeat)', () => {
    const p = piece({ setDownAt: new Date(NOW - 30 * DAY).toISOString(), setDownBy: 'dormancy' });
    const lastTouched = new Date(NOW - 60 * DAY).toISOString();
    expect(isDormant(p, lastTouched, NOW, 45)).toBe(false);
  });

  it('is false at exactly the cutoff — the age must be strictly older', () => {
    const p = piece();
    const lastTouched = new Date(NOW - 45 * DAY).toISOString();
    expect(isDormant(p, lastTouched, NOW, 45)).toBe(false);
  });

  it('is pure: same inputs, same answer, on every call — no clock inside', () => {
    const p = piece();
    const lastTouched = new Date(NOW - 60 * DAY).toISOString();
    const first = isDormant(p, lastTouched, NOW, 45);
    const second = isDormant(p, lastTouched, NOW, 45);
    expect(first).toBe(true);
    expect(second).toBe(first);
  });
});
