/**
 * The shared gap-fill sweep core — the cap/dedupe/coverage mechanics behind
 * the territory (094), atlas (110) and clerk gap-fill (027) sweeps.
 *
 * The territory and atlas sweeps iterate an instrument (KTG nodes or
 * atlas regions); the clerk fold (027) iterates buds and half-Construct
 * readings instead. All dedupe one question per key against the queue,
 * respect a Q-56 mint cap, and mint drafts under their own source tag.
 * Only the iterator, the question templates, the draft shape and the log
 * wording differ — this module owns the machinery once, and the sweep
 * modules are thin wrappers over it.
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

import type { QueueStore, QueueDraft, QueueEntry } from '../types.js';
import type { CoverageStore } from './coverage.js';
import { distinctFieldKeys } from '../queue/queue.js';

/** The activity-log sink both sweeps emit through. */
export type GapFillSweepLog = (e: {
  at: string;
  actor: string;
  kind: string;
  detail: string;
  refs?: string[];
}) => void;

/**
 * The queue-entry pointer field a sweep dedupes on (one question per node).
 * 'snippet' joined the union for the clerk fold's half-Construct sweep (027);
 * the composite bud+failure join rides `pointerKeyFn` instead (027).
 */
export type GapFillPointerKey = 'territoryNode' | 'atlasRegion' | 'snippet';

/**
 * One mint candidate. Built by the wrapper's generator — status eligibility,
 * the question template, the draft shape and the log wording are all
 * wrapper concerns; the core only applies the cap and the queue dedupe.
 */
export interface GapFillCandidate {
  /**
   * The dedupe key — a node id, region id, or (for the composite-key
   * callers) the joined key itself: clerk's bud+failure pair (027).
   */
  nodeId: string;
  /** The draft to enqueue when the sweep is live. */
  draft: QueueDraft;
  /** Emitted on mint (live mode); the clerk fold emits summary logs instead. */
  mintLog?: { kind: string; detail: string; refs?: string[] };
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
  /**
   * The queue-entry pointer field this sweep dedupes on (single-field
   * callers; absent when pointerKeyFn carries the composite key).
   */
  pointerKey?: GapFillPointerKey;
  /** Q-56 bound — how many candidates one run may process. */
  cap: number;
  /**
   * Coverage cache — optional: sweeps with no instrument nodes (the clerk
   * fold) omit it and the status map stays empty.
   */
  coverage?: CoverageStore;
  queue: QueueStore;
  log: GapFillSweepLog;
  now: string;
  /** When true, candidates are logged only — nothing reaches the queue (Q-35). */
  shadowMode?: boolean;
  /**
   * Composite-key dedupe (ticket 027): when set, replaces the single-field
   * pointerKey read with a key computed per queue entry — entries the fn
   * returns undefined for never block a candidate, mirroring the
   * single-field read's absent-field skip. Candidates then carry the
   * joined key in nodeId.
   */
  pointerKeyFn?: (entry: QueueEntry) => string | undefined;
  /**
   * When true, the scan CONTINUES past the cap and every dedupe-passing
   * candidate the cap held back is counted in the result's `clipped` —
   * the true backlog, not a flag (ticket 027). Default false: stop at
   * the cap, the territory/atlas behavior.
   */
  countClipped?: boolean;
}

/** What one run did. */
export interface GapFillSweepCoreResult {
  /** Candidates that passed the queue dedupe this run (capped). */
  processed: number;
  /** The candidates actually minted (empty in shadow mode). */
  minted: GapFillCandidate[];
  /** Dedupe-passing candidates the cap held back — 0 unless countClipped is on. */
  clipped: number;
}

/**
 * One capped, deduped sweep over a lazy candidate stream.
 *
 * Owns the mechanics the territory and atlas sweeps used to re-implement:
 * the coverage status cache (readReading per id, 'unprobed' fallback), the
 * existing-queue dedupe (any status blocks re-minting, Q-24/Q-41), and the
 * cap loop (Q-56) that stops pulling candidates once `cap` are processed —
 * or, with countClipped, keeps scanning and counts the held-back backlog.
 */
export function runGapFillSweepCore(
  deps: GapFillSweepCoreDeps,
  candidates: (status: ReadonlyMap<string, string>) => Iterable<GapFillCandidate>,
): GapFillSweepCoreResult {
  const { nodeIds, source, cap, queue, log, now } = deps;
  const coverage = deps.coverage;
  const pointerKey = deps.pointerKey;
  const pointerKeyFn = deps.pointerKeyFn;
  const shadowMode = deps.shadowMode ?? false;
  const countClipped = deps.countClipped ?? false;

  // Explicit coverage statuses from stored readings (Q-3: read back every call)
  const status = new Map<string, string>();
  for (const id of nodeIds) {
    status.set(id, coverage?.readReading(id)?.status ?? 'unprobed');
  }

  // One question per key, ever — any queue status blocks re-minting. The
  // per-source filter composes on top of the shared distinct-field read; a
  // pointerKeyFn replaces the single-field read with a composite key
  // (clerk's bud+failure join, 027).
  const existing = pointerKeyFn
    ? existingKeysOf(queue, source, pointerKeyFn)
    : distinctFieldKeys(
        queue.list().filter((entry) => entry.source === source),
        pointerKey!, // required when pointerKeyFn is absent
      );

  const minted: GapFillCandidate[] = [];
  let processed = 0;
  let clipped = 0;

  for (const cand of candidates(status)) {
    if (processed >= cap) {
      if (countClipped) {
        // The scan CONTINUES so the clip count is the true backlog the cap
        // held back, not a flag (ticket 027) — dedupe-passing candidates
        // only; ever-minted keys still skip silently.
        if (!existing.has(cand.nodeId)) clipped++;
        continue;
      }
      break;
    }
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
    if (cand.mintLog) {
      log({ at: now, actor: 'clerk', ...cand.mintLog });
    }
  }

  return { processed, minted, clipped };
}

/**
 * The composite-key dedupe set: same-source queue entries mapped through
 * the caller's key fn. Entries the fn cannot key (undefined) never block a
 * candidate — mirroring the single-field read, which skips absent fields.
 */
function existingKeysOf(
  queue: QueueStore,
  source: string,
  keyOf: (entry: QueueEntry) => string | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const entry of queue.list()) {
    if (entry.source !== source) continue;
    const key = keyOf(entry);
    if (key !== undefined) out.add(key);
  }
  return out;
}
