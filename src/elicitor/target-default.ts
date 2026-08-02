/**
 * What Target to offer when the user has not declared one.
 *
 * Q-19: "without a declared Target the inward default wins by gravity." The
 * default was hardcoded to 'self' in two places, and the vault shows where
 * that leads. The API contract still accepts an absent target — it must never
 * crash — but the fallback now reads the corpus instead of assuming.
 *
 * This is a suggestion, not a decision. An explicit `mode.target` always wins.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Target } from '../types.js';

/** How many consecutive inward sittings it takes to offer the workshop instead. */
export const INWARD_RUN_LIMIT = 3;

/**
 * The Target to pre-fill, given recent sittings NEWEST FIRST.
 *
 * A run of inward sittings is the signal: after three, the mirror has had its
 * turn and the workshop is offered first. Anything else keeps 'self', which is
 * where a new user with no history starts.
 */
export function suggestTarget(recent: Target[]): Target {
  const run = recent.slice(0, INWARD_RUN_LIMIT);
  if (run.length >= INWARD_RUN_LIMIT && run.every((t) => t === 'self')) return 'domain';
  return 'self';
}

/**
 * Targets of the most recent sittings, newest first, read from transcript
 * frontmatter. Transcript filenames are ULIDs, so filename order is time
 * order. A transcript written before Targets existed counts as 'self' —
 * that is what it silently was.
 */
export function recentSittingTargets(root: string, limit = INWARD_RUN_LIMIT): Target[] {
  const dir = join(root, 'transcripts');
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, limit);

  const targets: Target[] = [];
  for (const file of files) {
    try {
      const data = matter.read(join(dir, file)).data as { mode?: { target?: unknown } };
      targets.push(data.mode?.target === 'domain' ? 'domain' : 'self');
    } catch {
      // Unreadable transcript — skip it rather than guess at its Target.
    }
  }
  return targets;
}

/** The corpus-aware default for a vault: what the UI should pre-fill. */
export function suggestTargetForVault(root: string): {
  target: Target;
  recent: Target[];
} {
  const recent = recentSittingTargets(root);
  return { target: suggestTarget(recent), recent };
}
