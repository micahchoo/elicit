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
import { runGapFillSweepCore, type GapFillCandidate } from './sweep-core.js';

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

  const nodesById = new Map<string, KtgNode>();
  for (const node of skeleton.nodes) {
    nodesById.set(node.id, node);
  }

  const result = runGapFillSweepCore(
    {
      nodeIds: skeleton.nodes.map((node) => node.id),
      source: 'territory-gap-fill',
      pointerKey: 'territoryNode',
      cap: TERRITORY_MINT_CAP,
      coverage,
      queue,
      log,
      now,
    },
    territoryCandidates(skeleton, nodesById),
  );

  const frontierQuestions = result.minted.filter(
    (cand) => cand.category === 'frontier',
  ).length;
  const failureQuestions = result.minted.filter(
    (cand) => cand.category === 'failure',
  ).length;
  return { minted: result.minted.length, frontierQuestions, failureQuestions };
}

/**
 * The territory candidate stream: pass 1 (unprobed hard prereqs of evidenced
 * nodes), pass 2 (unprobed frontier nodes with an evidenced successor),
 * pass 3 (common-failure probes on evidenced nodes). Status eligibility is
 * decided here against the core's coverage cache; the core applies the cap
 * and the queue dedupe across the whole stream.
 */
function territoryCandidates(
  skeleton: KtgSkeleton,
  nodesById: Map<string, KtgNode>,
): (status: ReadonlyMap<string, string>) => Generator<GapFillCandidate> {
  return function* territoryCandidatesInner(
    status: ReadonlyMap<string, string>,
  ): Generator<GapFillCandidate> {
    // Pass 1: unprobed hard prereqs of evidenced nodes (the prereq is the gap)
    for (const node of skeleton.nodes) {
      if (status.get(node.id) !== 'evidenced') continue;
      for (const prereqId of node.prereqs) {
        if (status.get(prereqId) !== 'unprobed') continue;
        const prereqNode = nodesById.get(prereqId);
        if (!prereqNode) continue;

        const question = frontierQuestion(prereqNode);
        if (!question) continue;

        yield {
          nodeId: prereqNode.id,
          draft: {
            source: 'territory-gap-fill',
            license: `territory gap: ${prereqNode.id} (prereq of ${node.id})`,
            question,
            questionForm: 'deliberative',
            horizon: 'session',
            territoryNode: prereqNode.id,
            target: 'domain',
            topic: skeleton.domain,
          },
          mintLog: {
            kind: 'territory-gap-fill',
            detail: `minted frontier question for node ${prereqNode.id} (hard prereq of evidenced ${node.id})`,
            refs: [prereqNode.id, node.id],
          },
          category: 'frontier',
        };
      }
    }

    // Pass 2: unprobed frontier nodes adjacent to evidenced ones
    for (const node of skeleton.nodes) {
      if (status.get(node.id) !== 'unprobed') continue;

      const hasEvidencedSuccessor = skeleton.nodes.some(
        (other) =>
          other.prereqs.includes(node.id) &&
          status.get(other.id) === 'evidenced',
      );
      if (!hasEvidencedSuccessor) continue;

      const question = frontierQuestion(node);
      if (!question) continue;

      yield {
        nodeId: node.id,
        draft: {
          source: 'territory-gap-fill',
          license: `territory frontier: ${node.id}`,
          question,
          questionForm: 'deliberative',
          horizon: 'session',
          territoryNode: node.id,
          target: 'domain',
          topic: skeleton.domain,
        },
        mintLog: {
          kind: 'territory-gap-fill',
          detail: `minted frontier question for node ${node.id} (adjacent to evidenced)`,
          refs: [node.id],
        },
        category: 'frontier',
      };
    }

    // Pass 3: common_failure probes on evidenced nodes
    for (const node of skeleton.nodes) {
      if (status.get(node.id) !== 'evidenced') continue;

      const failure = (node as Record<string, unknown>).commonFailure;
      if (typeof failure !== 'string' || failure.trim() === '') continue;

      const question = failureProbe(node);
      if (!question) continue;

      yield {
        nodeId: node.id,
        draft: {
          source: 'territory-gap-fill',
          license: `territory common-failure: ${node.id}`,
          question,
          questionForm: 'deliberative',
          horizon: 'now',
          territoryNode: node.id,
          target: 'domain',
          topic: skeleton.domain,
        },
        mintLog: {
          kind: 'territory-gap-fill',
          detail: `minted common-failure probe for evidenced node ${node.id}`,
          refs: [node.id],
        },
        category: 'failure',
      };
    }
  };
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
