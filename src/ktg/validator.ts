/**
 * KTG skeleton validator — ticket 094.
 *
 * Validates the KTG graph rules: every prereq id exists, acyclic, tier
 * consistency, spine ids exist, ids are stable slugs, no duplicates.
 * Returns `{ ok: true; value }` or `{ ok: false; reasons }`, mirroring
 * the refusal style of `adviceGuard` in the coach contract.
 */

import type { KtgNode, KtgSkeleton } from './types.js';

/** Reasons a skeleton may be rejected, one per violation. */
export type RejectionReason = string;

/** Successful validation: the value is a known-good KtgSkeleton. */
export type ValidSkeleton = { ok: true; value: KtgSkeleton };

/** Failed validation: every reason names one graph-rule violation. */
export type InvalidSkeleton = { ok: false; reasons: RejectionReason[] };

export type SkeletonResult = ValidSkeleton | InvalidSkeleton;

// ── id helpers ──

/** Stable slugs: lowercase alphanumeric, hyphens, dots only. */
const ID_RE = /^[a-z0-9][a-z0-9.-]*$/;

function isStableSlug(id: string): boolean {
  return ID_RE.test(id);
}

// ── checked array access ──

function at<T>(arr: T[], i: number): T | undefined {
  return arr[i];
}

// ── graph checks ──

/**
 * Detect cycles via DFS with three-colour marking.
 * Returns the first cycle found as a path, or null if acyclic.
 */
function detectCycle(nodes: KtgNode[]): string[] | null {
  const ids = new Set(nodes.map((n) => n.id));
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();

  for (const n of nodes) colour.set(n.id, WHITE);

  function visit(id: string, path: string[]): string[] | null {
    const c = colour.get(id);
    if (c === BLACK) return null;
    if (c === GREY) {
      const idx = path.indexOf(id);
      return [...path.slice(idx), id];
    }
    colour.set(id, GREY);
    const node = nodes.find((n) => n.id === id);
    if (!node) return null;
    for (const prereq of node.prereqs) {
      if (!ids.has(prereq)) continue;
      const cycle = visit(prereq, [...path, id]);
      if (cycle) return cycle;
    }
    colour.set(id, BLACK);
    return null;
  }

  for (const n of nodes) {
    if (colour.get(n.id) === WHITE) {
      const cycle = visit(n.id, []);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** Compute the expected tier from hard prereqs: 1 + max(tier of prereqs). */
function expectedTier(
  node: KtgNode,
  nodeMap: Map<string, KtgNode>,
): number {
  if (node.prereqs.length === 0) return 1;
  let maxTier = 0;
  for (const pid of node.prereqs) {
    const p = nodeMap.get(pid);
    if (!p) continue;
    if (p.tier > maxTier) maxTier = p.tier;
  }
  return maxTier + 1;
}

// ── helpers for reading unknown fields ──

function strVal(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function intVal(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function strArr(obj: Record<string, unknown>, key: string): string[] | null {
  const v = obj[key];
  if (!Array.isArray(v)) return null;
  // Filter to strings only
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

// ── top-level validation ──

export function validateKtgSkeleton(raw: unknown): SkeletonResult {
  const reasons: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { ok: false, reasons: ['skeleton must be an object'] };
  }

  const skel = raw as Record<string, unknown>;

  // ── structural checks ──
  if (!strVal(skel, 'domain')) {
    reasons.push('domain must be a non-empty string');
  }
  if (!strVal(skel, 'level')) {
    reasons.push('level must be a non-empty string');
  }

  const provenance = skel.provenance;
  if (!provenance || typeof provenance !== 'object') {
    reasons.push('provenance must be an object');
  } else {
    const p = provenance as Record<string, unknown>;
    if (!strVal(p, 'generator')) reasons.push('provenance.generator must be a non-empty string');
    if (!strVal(p, 'generatedAt')) reasons.push('provenance.generatedAt must be a non-empty string');
    if (!strVal(p, 'domain')) reasons.push('provenance.domain must be a non-empty string');
    if (!strVal(p, 'targetLevel')) reasons.push('provenance.targetLevel must be a non-empty string');
  }

  if (!Array.isArray(skel.nodes)) {
    reasons.push('nodes must be an array');
    return { ok: false, reasons };
  }

  const rawNodes = skel.nodes as unknown[];

  if (rawNodes.length === 0) {
    reasons.push('nodes must not be empty');
    return { ok: false, reasons };
  }

  // ── build lookup maps ──
  const nodeMap = new Map<string, KtgNode>();
  const idSet = new Set<string>();

  for (let i = 0; i < rawNodes.length; i++) {
    const item = at(rawNodes, i);
    if (item === undefined || item === null || typeof item !== 'object') {
      reasons.push(`nodes[${i}] must be an object`);
      continue;
    }
    const n = item as Record<string, unknown>;
    const id = strVal(n, 'id');
    if (!id) {
      reasons.push(`nodes[${i}] must have a non-empty string id`);
      continue;
    }
    if (idSet.has(id)) {
      reasons.push(`duplicate node id: ${id}`);
      continue;
    }
    if (!isStableSlug(id)) {
      reasons.push(`node id ${id} is not a stable slug`);
    }
    idSet.add(id);

    const prereqs = strArr(n, 'prereqs') ?? [];

    const node: KtgNode = {
      id,
      label: strVal(n, 'label') ?? id,
      tier: intVal(n, 'tier') ?? -1,
      cluster: strVal(n, 'cluster') ?? '',
      prereqs,
      oneLine: strVal(n, 'oneLine') ?? '',
      hours: intVal(n, 'hours') ?? 0,
    };
    nodeMap.set(id, node);
  }

  // ── per-node field checks ──
  for (let i = 0; i < rawNodes.length; i++) {
    const item = at(rawNodes, i);
    if (item === undefined || item === null || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const id = strVal(n, 'id');
    if (!id || !nodeMap.has(id)) continue;

    if (!strVal(n, 'label')) {
      reasons.push(`node ${id}: label must be a non-empty string`);
    }
    if (intVal(n, 'tier') === null || (intVal(n, 'tier') ?? 0) < 1) {
      reasons.push(`node ${id}: tier must be a positive integer`);
    }
    if (!strVal(n, 'cluster')) {
      reasons.push(`node ${id}: cluster must be a non-empty string`);
    }
    if (!strVal(n, 'oneLine')) {
      reasons.push(`node ${id}: oneLine must be a non-empty string`);
    }
    const hrs = intVal(n, 'hours');
    if (hrs === null || hrs < 0) {
      reasons.push(`node ${id}: hours must be a non-negative integer`);
    }
    if (!Array.isArray(n.prereqs)) {
      reasons.push(`node ${id}: prereqs must be an array`);
    } else {
      for (let j = 0; j < (n.prereqs as unknown[]).length; j++) {
        const pid = (n.prereqs as unknown[])[j];
        if (typeof pid !== 'string') {
          reasons.push(`node ${id}: prereqs[${j}] must be a string`);
        }
      }
    }
  }

  // ── cluster existence ──
  if (Array.isArray(skel.clusters)) {
    const clusterIds = new Set<string>();
    for (const c of skel.clusters as Record<string, unknown>[]) {
      if (c && typeof c === 'object') {
        const cid = strVal(c, 'id');
        if (cid) clusterIds.add(cid);
      }
    }
    for (const node of nodeMap.values()) {
      if (node.cluster && !clusterIds.has(node.cluster)) {
        reasons.push(`node ${node.id}: cluster ${node.cluster} does not exist`);
      }
    }
  }

  // ── school existence ──
  const schoolIds = new Set<string>();
  if (Array.isArray(skel.schools)) {
    for (const s of skel.schools as Record<string, unknown>[]) {
      if (s && typeof s === 'object') {
        const sid = strVal(s, 'id');
        if (sid) schoolIds.add(sid);
      }
    }
    for (let i = 0; i < rawNodes.length; i++) {
      const item = at(rawNodes, i);
      if (item === undefined || item === null || typeof item !== 'object') continue;
      const n = item as Record<string, unknown>;
      const id = strVal(n, 'id');
      if (!id || !nodeMap.has(id)) continue;
      const weights = n.schoolWeights;
      if (weights && typeof weights === 'object') {
        for (const sid of Object.keys(weights as Record<string, unknown>)) {
          if (!schoolIds.has(sid)) {
            reasons.push(`node ${id}: schoolWeights references unknown school ${sid}`);
          }
        }
      }
    }
  }

  // ── prereq existence ──
  for (const node of nodeMap.values()) {
    for (const pid of node.prereqs) {
      if (!nodeMap.has(pid)) {
        reasons.push(`node ${node.id}: prereq ${pid} does not exist`);
      }
    }
  }

  // ── cycle detection ──
  const cycle = detectCycle(Array.from(nodeMap.values()));
  if (cycle) {
    reasons.push(`cycle detected: ${cycle.join(' → ')}`);
  }

  // ── tier consistency: tier-1 nodes have no prereqs ──
  for (const node of nodeMap.values()) {
    if (node.tier === 1 && node.prereqs.length > 0) {
      reasons.push(
        `node ${node.id}: tier 1 but has prereqs: ${node.prereqs.join(', ')}`,
      );
    }
  }

  // ── tier = 1 + max prereq tier ──
  for (const node of nodeMap.values()) {
    if (node.prereqs.length === 0) continue;
    const allExist = node.prereqs.every((pid) => nodeMap.has(pid));
    if (!allExist) continue;
    const expected = expectedTier(node, nodeMap);
    if (node.tier !== expected) {
      reasons.push(
        `node ${node.id}: tier is ${node.tier}, expected ${expected} (1 + max prereq tier)`,
      );
    }
  }

  // ── spine ids exist ──
  if (Array.isArray(skel.spine)) {
    const spineArr = skel.spine as string[];
    for (let j = 0; j < spineArr.length; j++) {
      const sid = spineArr[j];
      if (sid === undefined) continue;
      if (!nodeMap.has(sid)) {
        reasons.push(`spine[${j}]: node id ${sid} does not exist`);
      }
    }
  }

  // ── school quarrelsWith references ──
  if (Array.isArray(skel.schools)) {
    for (const s of skel.schools as Record<string, unknown>[]) {
      if (!s || typeof s !== 'object') continue;
      const sid = strVal(s, 'id');
      if (!sid) continue;
      const qw = s.quarrelsWith;
      if (Array.isArray(qw)) {
        for (const qid of qw as string[]) {
          if (!schoolIds.has(qid)) {
            reasons.push(
              `school ${sid}: quarrelsWith references unknown school ${qid}`,
            );
          }
        }
      }
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }

  return { ok: true, value: skel as unknown as KtgSkeleton };
}
