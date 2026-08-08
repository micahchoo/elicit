/**
 * The Mode needs a deferred question declares — the sitting ladder, one
 * declaration site. Before this module, the ladder and its lookups lived
 * twice: `MINUTE_LADDER`/`moreMinutesThan`/`moreEnergyThan` in server.ts
 * (the DEFER route) and `ENERGY_LEVEL` in queue.ts (the draw's
 * modeNeeds filter), with web/main.ts carrying its own `[10, 25, 45]`
 * copy for the Mode screen. A ladder that offers a sitting length must
 * name the same length in the screen that offers it, the route that
 * defers past it, and the filter that enforces it; one declaration site
 * is what makes that a compile-time fact instead of a convention.
 *
 * Pure module: zero `node:` imports, so `web/main.ts` can bundle it
 * (precedent: `web/main.ts` already imports `src/queue/source-label.ts`,
 * which has no `node:` imports either). Type-only imports are fine.
 */

import type { Mode } from '../types.js';

/** The sitting lengths the Mode screen offers. A deferred question asks for the next one up. */
export const MINUTE_LADDER: readonly [10, 25, 45] = [10, 25, 45];

/** The next sitting length above the current one — capped at the longest the Mode screen offers. */
export function moreMinutesThan(minutes: number): number {
 return MINUTE_LADDER.find((m) => m > minutes) ?? MINUTE_LADDER[MINUTE_LADDER.length - 1]!;
}

/** The next energy level above the current one — capped at 'high'. */
export function moreEnergyThan(energy: Mode['energy']): Mode['energy'] {
 if (energy === 'low') return 'medium';
 return 'high';
}

/** Energy as an ordered scale, so a draw can compare a declared need against the sitting's level. */
export const ENERGY_LEVEL: Record<NonNullable<Mode['energy']>, number> = {
 low: 0,
 medium: 1,
 high: 2,
};

/**
 * The Mode an unprompted session runs on: nothing declared, so minutes 0,
 * the middle energy, and the inward default target (Q-19). One declaration
 * for the five server sites that used to rebuild it by hand.
 */
export const UNPROMPTED_MODE: Mode = { minutes: 0, energy: 'medium', target: 'self' };

/**
 * The Mode-energy union as a boundary check. `mode.energy` used to pass a
 * truthiness test, so any truthy string sailed into a session; the union
 * ('low' | 'medium' | 'high') is now enforced at the same boundary.
 */
export function isMode(energy: unknown): energy is Mode['energy'] {
 return energy === 'low' || energy === 'medium' || energy === 'high';
}
