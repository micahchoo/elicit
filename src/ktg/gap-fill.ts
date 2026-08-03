/**
 * Territory gap-fill sweep — ticket 094 Phase 3.
 *
 * Reads a KTG skeleton against its coverage store and mints questions for:
 * 1. Unprobed hard prereqs of evidenced nodes (the prereq is the gap)
 * 2. Unprobed frontier nodes adjacent to evidenced nodes
 * 3. Evidenced nodes with a `commonFailure` (composed-style probe)
 *
 * Minted question text never quotes node labels or tree terminology.
 * The tree stays agent-side — questions reach the territory, asked a
 * different way, same discipline as still-true revisits.
 *
 * One question per node, ever, deduped by `territoryNode`.
 *
 * ZERO-LLM: this module never references or receives the model call.
 * Every question is a template around the node's oneLine (the functional
 * description of what the node lets you do).
 *
 * Uses the explicit status on NodeReading (readReading().status), not
 * derivation from sitting resolution. Coverage is set by the agent at
 * write time — the Seeding/Confirm posture: weak priors until touched.
 */

import type { QueueStore, QueueDraft } from '../types.js';
import type { KtgSkeleton, KtgNode } from './types.js';
import type { CoverageStore } from './coverage.js';

/** The docket log sink, narrowed to what the sweep emits. */
export type TerritoryGapFillLog = (e: {
  at: string;
  actor: string;
  kind: string;
  detail: string;
  refs?: string[];
}) => void;

/** How many territory questions one run may mint (Q-56 bound). */
const TERRITORY_MINT_CAP = 2;

/**
 * The territory gap-fill sweep. Called by the docket's gap-fill thunk.
 */
export function runTerritoryGapFillSweep(deps: {
  skeleton: KtgSkeleton;
  coverage: CoverageStore;
  queue: QueueStore;
  log: TerritoryGapFillLog;
  now: string;
}): { minted: number; frontierQuestions: number; failureQuestions: number } {
  const { skeleton, coverage, queue, log, now } = deps;

  let minted = 0;
  let frontierQuestions = 0;
  let failureQuestions = 0;

  const nodesById = new Map<string, KtgNode>();
  for (const node of skeleton.nodes) {
    nodesById.set(node.id, node);
  }

  // Collect explicit coverage statuses from stored readings
  const statusCache = new Map<string, string>();
  for (const node of skeleton.nodes) {
    statusCache.set(
      node.id,
      coverage.readReading(node.id)?.status ?? 'unprobed',
    );
  }

  // Load existing queue entries to dedupe
  const existing = new Set<string>();
  for (const entry of queue.list()) {
    if (entry.territoryNode && entry.source === 'territory-gap-fill') {
      existing.add(entry.territoryNode);
    }
  }

  // Pass 1: unprobed hard prereqs of evidenced nodes
  for (const node of skeleton.nodes) {
    if (minted >= TERRITORY_MINT_CAP) break;
    if (statusCache.get(node.id) !== 'evidenced') continue;
    for (const prereqId of node.prereqs) {
      if (minted >= TERRITORY_MINT_CAP) break;
      if (statusCache.get(prereqId) !== 'unprobed') continue;
      if (existing.has(prereqId)) continue;

      const prereqNode = nodesById.get(prereqId);
      if (!prereqNode) continue;

      const question = frontierQuestion(prereqNode);
      if (!question) continue;

      const draft: QueueDraft = {
        source: 'territory-gap-fill',
        license: `territory gap: ${prereqNode.id} (prereq of ${node.id})`,
        question,
        questionForm: 'deliberative',
        sharpness: 'weak',
        horizon: 'session',
        territoryNode: prereqNode.id,
        target: 'domain',
        topic: skeleton.domain,
      };

      queue.add(draft);
      existing.add(prereqNode.id);
      minted++;
      frontierQuestions++;
      log({
        at: now,
        actor: 'clerk',
        kind: 'territory-gap-fill',
        detail: `minted frontier question for node ${prereqNode.id} (hard prereq of evidenced ${node.id})`,
        refs: [prereqNode.id, node.id],
      });
    }
  }

  // Pass 2: unprobed frontier nodes adjacent to evidenced ones
  for (const node of skeleton.nodes) {
    if (minted >= TERRITORY_MINT_CAP) break;
    if (statusCache.get(node.id) !== 'unprobed') continue;
    if (existing.has(node.id)) continue;

    const hasEvidencedSuccessor = skeleton.nodes.some(
      (other) =>
        other.prereqs.includes(node.id) &&
        statusCache.get(other.id) === 'evidenced',
    );
    if (!hasEvidencedSuccessor) continue;

    const question = frontierQuestion(node);
    if (!question) continue;

    const draft: QueueDraft = {
      source: 'territory-gap-fill',
      license: `territory frontier: ${node.id}`,
      question,
      questionForm: 'deliberative',
      sharpness: 'weak',
      horizon: 'session',
      territoryNode: node.id,
      target: 'domain',
      topic: skeleton.domain,
    };

    queue.add(draft);
    existing.add(node.id);
    minted++;
    frontierQuestions++;
    log({
      at: now,
      actor: 'clerk',
      kind: 'territory-gap-fill',
      detail: `minted frontier question for node ${node.id} (adjacent to evidenced)`,
      refs: [node.id],
    });
  }

  // Pass 3: common_failure probes on evidenced nodes
  for (const node of skeleton.nodes) {
    if (minted >= TERRITORY_MINT_CAP) break;
    if (statusCache.get(node.id) !== 'evidenced') continue;
    if (existing.has(node.id)) continue;

    const failure = (node as Record<string, unknown>).commonFailure;
    if (typeof failure !== 'string' || failure.trim() === '') continue;

    const question = failureProbe(node);
    if (!question) continue;

    const draft: QueueDraft = {
      source: 'territory-gap-fill',
      license: `territory common-failure: ${node.id}`,
      question,
      questionForm: 'deliberative',
      sharpness: 'sharp',
      horizon: 'now',
      territoryNode: node.id,
      target: 'domain',
      topic: skeleton.domain,
    };

    queue.add(draft);
    existing.add(node.id);
    minted++;
    failureQuestions++;
    log({
      at: now,
      actor: 'clerk',
      kind: 'territory-gap-fill',
      detail: `minted common-failure probe for evidenced node ${node.id}`,
      refs: [node.id],
    });
  }

  return { minted, frontierQuestions, failureQuestions };
}

// Question templates (ZERO-LLM, never quote node labels)

/**
 * Frontier question for an unprobed node.
 * Uses the node's oneLine (functional description), never the label.
 */
function frontierQuestion(node: KtgNode): string | null {
  const desc = node.oneLine?.trim();
  if (!desc) return null;
  const verb = desc.charAt(0).toLowerCase() + desc.slice(1);
  return `What would it look like to ${verb}? Walk me through it.`;
}

/**
 * Common-failure probe for an evidenced node.
 * Describes a known pitfall without naming it, asks for a story.
 */
function failureProbe(node: KtgNode): string | null {
  const oneLine = node.oneLine?.trim();
  if (!oneLine) return null;
  const verb = oneLine.charAt(0).toLowerCase() + oneLine.slice(1);
  return `When you ${verb}, what goes wrong most often? Tell me about a time it did.`;
}
