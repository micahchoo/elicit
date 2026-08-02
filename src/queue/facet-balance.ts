/**
 * Facet balance — the hard filter Q-13 names and nothing implemented.
 *
 * Measured 2026-08-02 in the real vault: 25 construct, 2 lifetime-period,
 * 1 value, 1 intention, ZERO episodes, ZERO facts. A corpus of opinions about
 * events, with no events. This module computes what the corpus is short of and
 * restricts the draw pool to questions that ask for it — before the top-k
 * random pick, never as a score (Q-13: constraints, then chance).
 *
 * It runs in shadow by default (Q-35): `draw` logs what the filter WOULD have
 * done and changes nothing until ELICIT_FACET_BALANCE=live.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { Facet } from '../types.js';

export const FACETS: readonly Facet[] = [
  'episode',
  'general-event',
  'lifetime-period',
  'fact',
  'construct',
  'intention',
  'value',
  'causal-theory',
];

/**
 * The shape of a corpus that contains a life rather than a commentary on one.
 * Episode and fact lead because CONTEXT calls them the evidentiary bedrock —
 * dateable, checkable material. Construct is capped at a share it can only
 * exceed by crowding something out, which is precisely what it did.
 *
 * PROVISIONAL (Q-35): these weights are a hypothesis about a good corpus, not
 * a measurement. They graduate with the filter.
 */
export const BLUEPRINT: Record<Facet, number> = {
  episode: 0.3,
  'general-event': 0.15,
  fact: 0.15,
  construct: 0.15,
  value: 0.1,
  'lifetime-period': 0.05,
  intention: 0.05,
  'causal-theory': 0.05,
};

export type FacetDistribution = Record<Facet, number>;

function emptyDistribution(): FacetDistribution {
  return {
    episode: 0,
    'general-event': 0,
    'lifetime-period': 0,
    fact: 0,
    construct: 0,
    intention: 0,
    value: 0,
    'causal-theory': 0,
  };
}

/** Count Facets over a set of Wiki readings. */
export function facetDistribution(readings: { facet: Facet }[]): FacetDistribution {
  const dist = emptyDistribution();
  for (const r of readings) {
    if (r.facet in dist) dist[r.facet]++;
  }
  return dist;
}

/**
 * The vault's live Facet distribution, read from `wiki/readings/*.md`
 * frontmatter. Readings are where a Facet is actually claimed; asking the
 * corpus is the only honest input to the filter.
 */
export function readVaultFacetDistribution(root: string): FacetDistribution {
  const dir = join(root, 'wiki', 'readings');
  if (!existsSync(dir)) return emptyDistribution();
  const readings: { facet: Facet }[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    try {
      const data = matter.read(join(dir, file)).data as { facet?: unknown };
      if (typeof data.facet === 'string') {
        readings.push({ facet: data.facet as Facet });
      }
    } catch {
      // Unreadable reading — the distribution is a census, not a transaction.
    }
  }
  return facetDistribution(readings);
}

export type FacetDeficit = {
  facet: Facet;
  count: number;
  /** Observed share of the corpus, 0 when the corpus is empty. */
  share: number;
  /** Blueprint share. */
  target: number;
  /** target − share. Positive means the corpus owes this Facet material. */
  deficit: number;
};

/** Every Facet's standing against the blueprint, largest deficit first. */
export function facetDeficits(dist: FacetDistribution): FacetDeficit[] {
  const total = FACETS.reduce((sum, f) => sum + dist[f], 0);
  return FACETS.map((facet) => {
    const count = dist[facet];
    const share = total === 0 ? 0 : count / total;
    const target = BLUEPRINT[facet];
    return { facet, count, share, target, deficit: target - share };
  }).sort((a, b) => b.deficit - a.deficit || a.facet.localeCompare(b.facet));
}

/**
 * Facets the corpus owes material. On an empty corpus every Facet is owed, so
 * the filter is a no-op at cold start — a new vault is not yet unbalanced.
 */
export function underRepresented(dist: FacetDistribution): Set<Facet> {
  return new Set(facetDeficits(dist).filter((d) => d.deficit > 0).map((d) => d.facet));
}

/**
 * A session's shadow blueprint: `slots` Facets, largest deficit first, each
 * pick folded back into the projection so one starving Facet cannot claim the
 * whole plan. Only the first slot is ever asked — the plan is recomputed next
 * turn, because the corpus has changed by then.
 */
export function sessionBlueprint(dist: FacetDistribution, slots: number): Facet[] {
  const projected = { ...dist };
  const plan: Facet[] = [];
  for (let i = 0; i < slots; i++) {
    const next = facetDeficits(projected)[0];
    if (!next) break;
    plan.push(next.facet);
    projected[next.facet]++;
  }
  return plan;
}

export type BalanceResult<T> = {
  kept: T[];
  dropped: T[];
  /**
   * False when the filter would empty the pool. A filter that leaves nothing
   * to ask is not a constraint, it is a silence — the pool passes through
   * untouched and the shadow log records that it did.
   */
  applied: boolean;
};

/**
 * Hard filter: keep only candidates whose `targetFacet` is owed. Candidates
 * with no `targetFacet` carry no facet claim and are dropped rather than
 * assumed — but never at the cost of emptying the pool.
 */
export function applyFacetBalance<T extends { targetFacet?: Facet }>(
  candidates: T[],
  wanted: Set<Facet>,
): BalanceResult<T> {
  // A corpus that owes every Facet owes none in particular. At cold start the
  // filter stands down rather than quietly preferring tagged material.
  if (wanted.size >= FACETS.length) return { kept: candidates, dropped: [], applied: false };

  const kept: T[] = [];
  const dropped: T[] = [];
  for (const c of candidates) {
    if (c.targetFacet !== undefined && wanted.has(c.targetFacet)) kept.push(c);
    else dropped.push(c);
  }
  if (kept.length === 0) return { kept: candidates, dropped: [], applied: false };
  return { kept, dropped, applied: true };
}

/** Compact "construct:25,lifetime-period:2" rendering for the Activity Log. */
export function formatDistribution(dist: FacetDistribution): string {
  const parts = FACETS.filter((f) => dist[f] > 0).map((f) => `${f}:${dist[f]}`);
  return parts.length > 0 ? parts.join(',') : 'empty';
}

/** True when the filter is licensed to change the draw (Q-35 graduation). */
export function facetBalanceIsLive(env: Record<string, string | undefined>): boolean {
  return env.ELICIT_FACET_BALANCE === 'live';
}
