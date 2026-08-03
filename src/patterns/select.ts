/**
 * Pattern selection — filter-then-random, never argmax (Q-13).
 *
 * Q-82: the pattern is selected by Q-13's discipline. The operator does not
 * choose, and no pattern can become the favorite. Within the licensed set,
 * uniform random among survivors. Ship shadow-first (Q-35): in shadow mode,
 * the selection is logged but null is returned, and the caller falls through
 * to existing behavior.
 */

import type { Pattern, LicensingContext } from './types.js';
import { licensePattern } from './license.js';
import { THRESHOLDS } from '../wiki/thresholds.js';

/** A log sink matching the ThresholdLogFn shape but emitted directly. */
type LogFn = (e: { at: string; actor: string; kind: string; detail: string }) => void;

/**
 * Filter to the licensed set and select one at random.
 *
 * Returns null when:
 * - No patterns are licensed
 * - The patternSelection threshold is shadow (log-only mode)
 *
 * In shadow mode, a `pattern-selection-shadow` event is emitted.
 * In live mode, a `pattern-selection-live` event is emitted and the
 * pattern is returned.
 *
 * `random` defaults to Math.random — inject a seeded PRNG for test determinism.
 */
export function selectPattern(
  patterns: Pattern[],
  ctx: LicensingContext,
  log?: LogFn,
  random: () => number = Math.random,
): Pattern | null {
  // Filter to licensed set
  const licensed = patterns.filter((p) => licensePattern(p, ctx));
  if (licensed.length === 0) return null;

  const threshold = THRESHOLDS['patternSelection'];

  // Shadow mode: log and return null — caller falls through
  if (!threshold.live) {
    if (log) {
      log({
        at: new Date().toISOString(),
        actor: 'clerk',
        kind: 'pattern-selection-shadow',
        detail: `eligible=${licensed.length} selected=shadow`,
      });
    }
    return null;
  }

  // Live mode: uniform random among survivors
  const pick = licensed[Math.floor(random() * licensed.length)]!;

  if (log) {
    log({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'pattern-selection-live',
      detail: `eligible=${licensed.length} selected=${pick.id}`,
    });
  }

  return pick;
}

/**
 * Select a deep-tier pattern only. Used by the Sounding rung composer
 * when a descent is active — deep patterns are Sounding-class (Q-82).
 */
export function selectDeepPattern(
  patterns: Pattern[],
  ctx: LicensingContext,
  log?: LogFn,
  random?: () => number,
): Pattern | null {
  const deep = patterns.filter((p) => p.tier === 'deep');
  return selectPattern(deep, ctx, log, random);
}

/**
 * Select a cheap-tier pattern only. Used by ordinary composition paths
 * — cheap patterns are ordinary composed questions (Q-82).
 */
export function selectCheapPattern(
  patterns: Pattern[],
  ctx: LicensingContext,
  log?: LogFn,
  random?: () => number,
): Pattern | null {
  const cheap = patterns.filter((p) => p.tier === 'cheap');
  return selectPattern(cheap, ctx, log, random);
}
