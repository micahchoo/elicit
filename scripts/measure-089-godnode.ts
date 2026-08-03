/**
 * Ticket 089 — lint.godNodeFanout, re-scoped from facets to referents,
 * measured against the live vault. READ-ONLY: no vault writes, no model
 * calls, no log lines (noop log).
 *
 * The BEFORE numbers are already on disk — the shadow log's `shadow-decision`
 * lines, quoted in the ticket's Resolution. This script computes the AFTER:
 * the re-scoped predicate with the threshold flipped live over the real graph
 * (Q-35: graduation is flipping one boolean), and the live-claim-per-referent
 * distribution that grounds the count.
 *
 *   npx tsx scripts/measure-089-godnode.ts
 */

import { join } from 'node:path';

import { createClaimStore } from '../src/wiki/store.js';
import { createVault } from '../src/vault/vault.js';
import { lint, type ThresholdRegister } from '../src/wiki/lint.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { ClaimGraph, LogFn } from '../src/wiki/contract.js';

const VAULT_ROOT = process.env.ELICIT_VAULT_ROOT ?? join(import.meta.dirname, '..', 'vault');

// ── Vault, read-only ──

const vault = createVault(VAULT_ROOT);
const store = createClaimStore(VAULT_ROOT);
const index = vault.rebuildIndex();
const slice = store.loadSlice();

const graph: ClaimGraph = {
  ...slice,
  snippets: index.snippets,
  readings: index.readings,
};

const noopLog: LogFn = () => void 0;

// The shipped register with lint.godNodeFanout flipped live — the after-number
// the ticket asks for.
const GOD_NODE_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'lint.godNodeFanout': { ...THRESHOLDS['lint.godNodeFanout'], live: true },
};

// The same liveness predicate lint.ts applies (not exported; replicated here
// so the distribution and the lint agree about what "live" means).
function isLive(c: ClaimGraph['claims'][number]): boolean {
  return c.archived !== true && c.supersededBy === undefined;
}

// ── The live-claim-per-referent distribution ──

const perReferent = new Map<string, string[]>();
const perFacet = new Map<string, string[]>();
let live = 0;
for (const c of graph.claims) {
  if (!isLive(c)) continue;
  live++;
  const facetIds = perFacet.get(c.facet);
  if (facetIds) facetIds.push(c.id);
  else perFacet.set(c.facet, [c.id]);
  // Dedupe within the claim, exactly like the predicate being measured: a
  // claim naming two referents contributes to both counts.
  for (const slug of new Set(c.referents)) {
    const ids = perReferent.get(slug);
    if (ids) ids.push(c.id);
    else perReferent.set(slug, [c.id]);
  }
}

// ── The after-numbers ──

const findings = lint(graph, GOD_NODE_LIVE, noopLog);
const byKind = new Map<string, number>();
for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);

console.log(
  `vault: ${graph.claims.length} claims, ${live} live (${graph.claims.length - live} archived/superseded), ` +
    `${Object.keys(index.snippets).length} snippets, ${Object.keys(index.readings).length} readings, ` +
    `${graph.referents.length} referents`
);
console.log('---');
console.log('live-claim-per-referent distribution (the after-count is grounded in this):');
for (const slug of [...perReferent.keys()].sort()) {
  console.log(`  ${slug}: ${perReferent.get(slug)!.length} live claim(s)`);
}
console.log('---');
console.log('live-claim-per-facet distribution (the dropped reading, for contrast):');
for (const facet of [...perFacet.keys()].sort()) {
  console.log(`  ${facet}: ${perFacet.get(facet)!.length} live claim(s)`);
}
console.log('---');
console.log('lint findings by kind, lint.godNodeFanout flipped live:');
if (findings.length === 0) console.log('  (none)');
for (const [kind, n] of [...byKind.entries()].sort()) console.log(`  ${kind}: ${n}`);
console.log(`god-node-referent findings: ${byKind.get('god-node-referent') ?? 0}`);
console.log(`god-node-facet findings: ${byKind.get('god-node-facet') ?? 0}`);
