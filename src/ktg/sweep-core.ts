/**
 * The shared gap-fill sweep core — the cap/dedupe/coverage mechanics behind
 * the territory (094) and atlas (110) sweeps.
 *
 * Both sweeps iterate an instrument (KTG nodes or atlas regions), dedupe
 * one question per node against the queue, respect a Q-56 mint cap, and
 * mint drafts under their own source tag. Only the iterator, the question
 * templates, the draft shape and the log wording differ — this module owns
 * the machinery once, and the sweep modules are thin wrappers over it.
 *
 * The core is deliberately dumb about WHAT is being swept: the caller
 * supplies a lazy candidate generator, which owns every status-eligibility
 * decision (a pass may target 'unprobed' nodes, 'evidenced' nodes, or
 * anything between). The core decides, per candidate, whether the queue
 * already holds one for that node, whether the run cap is exhausted, and
 * whether to mint or shadow-log.
 *
 * ZERO-LLM, like both sweeps it serves: every question is a template the
 * caller builds.
 */

import type { QueueStore, QueueDraft } from '../types.js';
import type { CoverageStore } from './coverage.js';

/** The activity-log sink both sweeps emit through. */
export type GapFillSweepLog = (e: {
  at: string;
  actor: string;
  kind: string;
  detail: string;
  refs?: string[];
}) => void;

/** The queue-entry pointer field a sweep dedupes on (one question per node). */
export type GapFillPointerKey = 'territoryNode' | 'atlasRegion';

/**
 * One mint candidate. Built by the wrapper's generator — status eligibility,
 * the question template, the draft shape and the log wording are all
 * wrapper concerns; the core only applies the cap and the queue dedupe.
 */
export interface GapFillCandidate {
  /** The dedupe key — a node id or region id. */
  nodeId: string;
  /** The draft to enqueue when the sweep is live. */
  draft: QueueDraft;
  /** Emitted on mint (live mode). */
  mintLog: { kind: string; detail: string; refs?: string[] };
  /** Emitted instead of minting in shadow mode (Q-35). */
  shadowLog?: { kind: string; detail: string; refs?: string[] };
  /** Wrapper-local tally bucket (e.g. 'frontier' vs 'failure'). */
  category?: string;
}

/** The core sweep deps — the mechanics, parameterized by what varies. */
export interface GapFillSweepCoreDeps {
  /** Every node/region id of the instrument — drives the coverage status cache. */
  nodeIds: readonly string[];
  /** The queue-entry source tag minted under and deduped against. */
  source: string;
  /** The queue-entry pointer field this sweep dedupes on. */
  pointerKey: GapFillPointerKey;
  /** Q-56 bound — how many candidates one run may process. */
  cap: number;
  coverage: CoverageStore;
  queue: QueueStore;
  log: GapFillSweepLog;
  now: string;
  /** When true, candidates are logged only — nothing reaches the queue (Q-35). */
  shadowMode?: boolean;
}

/** What one run did. */
export interface GapFillSweepCoreResult {
  /** Candidates that passed the queue dedupe this run (capped). */
  processed: number;
  /** The candidates actually minted (empty in shadow mode). */
  minted: GapFillCandidate[];
}

/**
 * One capped, deduped sweep over a lazy candidate stream.
 *
 * Owns the mechanics the territory and atlas sweeps used to re-implement:
 * the coverage status cache (readReading per id, 'unprobed' fallback), the
 * existing-queue dedupe (any status blocks re-minting, Q-24/Q-41), and the
 * cap loop (Q-56) that stops pulling candidates once `cap` are processed.
 */
export function runGapFillSweepCore(
  deps: GapFillSweepCoreDeps,
  candidates: (status: ReadonlyMap<string, string>) => Iterable<GapFillCandidate>,
): GapFillSweepCoreResult {
  const { nodeIds, source, pointerKey, cap, coverage, queue, log, now } = deps;
  const shadowMode = deps.shadowMode ?? false;

  // Explicit coverage statuses from stored readings (Q-3: read back every call)
  const status = new Map<string, string>();
  for (const id of nodeIds) {
    status.set(id, coverage.readReading(id)?.status ?? 'unprobed');
  }

  // One question per node, ever — any queue status blocks re-minting.
  const existing = new Set<string>();
  for (const entry of queue.list()) {
    const key = entry[pointerKey];
    if (key && entry.source === source) existing.add(key);
  }

  const minted: GapFillCandidate[] = [];
  let processed = 0;

  for (const cand of candidates(status)) {
    if (processed >= cap) break;
    if (existing.has(cand.nodeId)) continue;
    processed++;

    if (shadowMode) {
      if (cand.shadowLog) {
        log({ at: now, actor: 'clerk', ...cand.shadowLog });
      }
      continue;
    }

    queue.add(cand.draft);
    existing.add(cand.nodeId);
    minted.push(cand);
    log({ at: now, actor: 'clerk', ...cand.mintLog });
  }

  return { processed, minted };
}
