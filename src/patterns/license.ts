/**
 * Pattern licensing — per-pattern rules for when a derivation is permitted.
 *
 * Each pattern carries a derivesFrom contract that lists what source material
 * it needs. This module checks whether the current context satisfies that
 * contract. The rules come from the ticket-102 catalogue's licensing situations.
 *
 * Deep patterns additionally require isLateSession — they are Sounding-class
 * and enter only through the consent gate (Q-82).
 */

import type { Pattern, LicensingContext } from './types.js';

/**
 * Is this pattern licensed given the available snippets and sitting state?
 *
 * The check is structural, never model-inferred:
 * 1. Enough snippets with matching facets exist
 * 2. Every required facet is covered
 * 3. Every alsoNeeds facet is covered
 * 4. Deep patterns need isLateSession
 */
export function licensePattern(pattern: Pattern, ctx: LicensingContext): boolean {
  // Deep patterns need late-session consent (Q-82)
  if (pattern.tier === 'deep' && !ctx.isLateSession) return false;

  const { availableSnippets } = ctx;

  // Count snippets matching at least one required facet
  const requiredSet = new Set(pattern.derivesFrom.facets);
  const matching = availableSnippets.filter((s) => requiredSet.has(s.facet));

  if (matching.length < pattern.derivesFrom.minSnippets) return false;

  // facets are OR — any matching facet qualifies. The count check above
  // already verifies enough material exists.

  // Every alsoNeeds facet must have at least one snippet (anywhere in the set)
  if (pattern.derivesFrom.alsoNeeds) {
    for (const facet of pattern.derivesFrom.alsoNeeds) {
      if (!availableSnippets.some((s) => s.facet === facet)) return false;
    }
  }

  return true;
}
