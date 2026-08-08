/**
 * The territory surface — ticket 152.
 *
 * The join the docket sweeps already produce but nothing served: skeleton
 * and atlas nodes, each carrying the NodeReading its sweep wrote under
 * `vault/ktg/coverage/` and `vault/atlases/coverage/`. This module is a
 * pure read surface — it persists nothing. Node states derive from the
 * reading files' cites via the CoverageStore's Q-50 logic (cites from one
 * identifiable sitting touch, two or more sittings evidence); a cite whose
 * snippet the resolver cannot place never inflates 'touched' into
 * 'evidenced' (coverage.ts attribution policy).
 *
 * Response shape (documented here; web/territory.ts renders it):
 *
 *   {
 *     instruments: [
 *       {
 *         id: 'ktg:fake-craft' | 'atlas:time-use-grid', // kind-prefixed id
 *         kind: 'ktg' | 'atlas',
 *         name: 'fake-craft' | 'Time-Use Grid',          // header line
 *         nodes: [                                       // flat, outline order
 *           { id, name, depth, role, state, citeCount }
 *         ]
 *       }
 *     ]
 *   }
 *
 * `depth` is the outline indentation the renderer applies (1 = cluster or
 * region row, 2 = ktg node row); `role` tells the renderer how to style
 * the row. Cluster rows carry the strongest state of their children and
 * the sum of their cites — an aggregate, never a reading.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadKtgSkeleton } from './ktg/loader.js';
import { loadAtlas } from './ktg/loader.js';
import {
  createCoverageStore,
  type NodeCoverageStatus,
  type SittingResolver,
} from './ktg/coverage.js';
import { createAtlasCoverageStore } from './ktg/coverage.js';
import type { KtgSkeleton, KtgNode } from './ktg/types.js';
import type { AtlasInstrument } from './ktg/atlas-types.js';

export type TerritoryNodeRole = 'cluster' | 'node' | 'region';

/** One outline row: a ktg cluster, a ktg node, or an atlas region. */
export type TerritoryNode = {
  id: string;
  name: string;
  /** Outline depth the renderer indents by: 1 = cluster/region, 2 = node. */
  depth: number;
  role: TerritoryNodeRole;
  state: NodeCoverageStatus;
  citeCount: number;
};

/** One mapped instrument: a ktg skeleton or an atlas. */
export type TerritoryInstrument = {
  id: string;
  kind: 'ktg' | 'atlas';
  name: string;
  nodes: TerritoryNode[];
};

/** GET /api/territory payload — see the module doc for the shape. */
export type TerritoryResponse = {
  instruments: TerritoryInstrument[];
};

/** The .json slugs in a data directory, sorted so the outline is stable. */
function jsonSlugs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/** Strongest child state — cluster rows aggregate, they never read. */
function aggregateState(states: NodeCoverageStatus[]): NodeCoverageStatus {
  if (states.includes('evidenced')) return 'evidenced';
  if (states.includes('touched')) return 'touched';
  return 'unprobed';
}

/** One ktg skeleton as an instrument: cluster rows, then their node rows. */
function ktgInstrument(
  skeleton: KtgSkeleton,
  vaultRoot: string,
  sittingOf: SittingResolver,
): TerritoryInstrument {
  const coverage = createCoverageStore(vaultRoot);
  const nodesByCluster = new Map<string, KtgNode[]>();
  for (const node of skeleton.nodes) {
    const list = nodesByCluster.get(node.cluster) ?? [];
    list.push(node);
    nodesByCluster.set(node.cluster, list);
  }
  const rows: TerritoryNode[] = [];
  for (const cluster of skeleton.clusters) {
    const nodes = nodesByCluster.get(cluster.id) ?? [];
    const nodeRows: TerritoryNode[] = nodes.map((node) => {
      const reading = coverage.readReading(node.id);
      return {
        id: node.id,
        name: node.label,
        depth: 2,
        role: 'node' as const,
        state: coverage.coverageForNode(node.id, sittingOf),
        citeCount: reading?.cites.length ?? 0,
      };
    });
    rows.push({
      id: `${skeleton.domain}.${cluster.id}`,
      name: cluster.name,
      depth: 1,
      role: 'cluster',
      state: aggregateState(nodeRows.map((r) => r.state)),
      citeCount: nodeRows.reduce((n, r) => n + r.citeCount, 0),
    });
    rows.push(...nodeRows);
  }
  return { id: `ktg:${skeleton.domain}`, kind: 'ktg', name: skeleton.domain, nodes: rows };
}

/** One atlas instrument: its regions, each at outline depth 1. */
function atlasInstrument(
  atlas: AtlasInstrument,
  vaultRoot: string,
  sittingOf: SittingResolver,
): TerritoryInstrument {
  const coverage = createAtlasCoverageStore(vaultRoot);
  const nodes: TerritoryNode[] = atlas.regions.map((region) => {
    const reading = coverage.readReading(region.id);
    return {
      id: region.id,
      name: region.label,
      depth: 1,
      role: 'region' as const,
      state: coverage.coverageForNode(region.id, sittingOf),
      citeCount: reading?.cites.length ?? 0,
    };
  });
  return { id: `atlas:${atlas.instrument}`, kind: 'atlas', name: atlas.label, nodes };
}

/**
 * Build the territory response for a vault: every skeleton in
 * `data/ktg/` and atlas in `data/atlases/`, joined with the readings the
 * sweeps wrote. Reads only — the vault is never written to.
 */
export function buildTerritoryResponse(
  vaultRoot: string,
  sittingOf: SittingResolver,
): TerritoryResponse {
  const instruments: TerritoryInstrument[] = [];
  for (const domain of jsonSlugs(join(vaultRoot, 'data', 'ktg'))) {
    const skeleton = loadKtgSkeleton(domain, vaultRoot);
    if (!skeleton.ok) continue;
    instruments.push(ktgInstrument(skeleton.value, vaultRoot, sittingOf));
  }
  for (const instrument of jsonSlugs(join(vaultRoot, 'data', 'atlases'))) {
    const atlas = loadAtlas(instrument, vaultRoot);
    if (!atlas.ok) continue;
    instruments.push(atlasInstrument(atlas.value, vaultRoot, sittingOf));
  }
  return { instruments };
}
