/**
 * Atlas gap-fill sweep — ticket 110, graduated 2026-08-03.
 *
 * Reads atlas instruments against their coverage stores and mints questions
 * for unprobed regions. Shipped shadow-first (Q-35): the sweep ran, evaluated
 * coverage, logged candidates and minted nothing. Graduated by decision
 * 2026-08-03 (Micah) — `shadowMode: false` mints into the queue; the module
 * default stays shadow so a caller must opt in to acting. The cap is live
 * (Q-56) in both modes: the sweep stops after ATLAS_MINT_CAP candidates.
 *
 * One question per region, ever, deduped by `atlasRegion` on the queue
 * entry — any status blocks re-minting (the gap-fill any-status rule).
 *
 * Questions are ZERO-LLM templates: each one names the TOPIC like any opener,
 * never the gap (Q-79: "you've never mentioned X" is banned). Soft openers by
 * structural design — atlas regions are deliberately crude territory maps,
 * and the questions never chain follow-ups.
 *
 * Region-to-corpus links are readings under Q-50 statuses (unconfirmed until
 * touched), never priors (Q-66 killed priors). Coverage is a fact about the
 * ARCHIVE, never about the person (Q-79).
 */

import type { QueueStore, QueueDraft } from '../types.js';
import type { AtlasInstrument, AtlasRegion } from './atlas-types.js';
import type { CoverageStore } from './coverage.js';
import { runGapFillSweepCore, type GapFillCandidate } from './sweep-core.js';

/** The docket log sink, narrowed to what the sweep emits. */
export type AtlasGapFillLog = (e: {
  at: string;
  actor: string;
  kind: string;
  detail: string;
  refs?: string[];
}) => void;

/** How many atlas questions one run may evaluate or mint (Q-56 bound, live). */
const ATLAS_MINT_CAP = 2;

/**
 * The atlas gap-fill sweep. Called by the docket's atlas thunk.
 *
 * In shadow mode (the default), candidates are logged and nothing is added
 * to the queue. In live mode, at most ATLAS_MINT_CAP questions are minted,
 * deduped by region id against every existing atlas-gap-fill entry.
 */
export function runAtlasGapFillSweep(deps: {
  atlas: AtlasInstrument;
  coverage: CoverageStore;
  queue: QueueStore;
  log: AtlasGapFillLog;
  now: string;
  /** When true, log candidates only — add nothing to the queue. */
  shadowMode?: boolean;
}): { candidateCount: number; scanned: number; minted: number } {
  const { atlas, coverage, queue, log, now } = deps;
  const shadowMode = deps.shadowMode ?? true; // default: shadow-first (Q-35)

  const result = runGapFillSweepCore(
    {
      nodeIds: atlas.regions.map((region) => region.id),
      source: 'atlas-gap-fill',
      pointerKey: 'atlasRegion',
      cap: ATLAS_MINT_CAP,
      coverage,
      queue,
      log,
      now,
      shadowMode,
    },
    atlasCandidates(atlas),
  );

  return {
    candidateCount: result.processed,
    scanned: atlas.regions.length,
    minted: result.minted.length,
  };
}

/**
 * The atlas candidate stream: every unprobed region whose template produces
 * a question. Status eligibility is decided here against the core's
 * coverage cache; the core applies the cap and the queue dedupe.
 */
function atlasCandidates(
  atlas: AtlasInstrument,
): (status: ReadonlyMap<string, string>) => Generator<GapFillCandidate> {
  return function* atlasCandidatesInner(
    status: ReadonlyMap<string, string>,
  ): Generator<GapFillCandidate> {
    for (const region of atlas.regions) {
      if (status.get(region.id) !== 'unprobed') continue;

      const question = atlasRegionQuestion(region);
      if (!question) continue;

      yield {
        nodeId: region.id,
        draft: {
          source: 'atlas-gap-fill',
          license: `atlas gap: region ${region.id} (${atlas.instrument})`,
          question,
          questionForm: 'deliberative',
          horizon: 'session',
          atlasRegion: region.id,
        },
        mintLog: {
          kind: 'atlas-gap-fill-minted',
          detail: `minted question for atlas "${atlas.instrument}" region ${region.id}`,
          refs: [region.id, atlas.instrument],
        },
        shadowLog: {
          kind: 'atlas-gap-fill-candidate',
          detail: `shadow candidate for atlas "${atlas.instrument}" region ${region.id}: "${question}"`,
          refs: [region.id, atlas.instrument],
        },
      };
    }
  };
}

// ── Question template (ZERO-LLM, never quote region labels, Q-79 opener form) ──

/**
 * Generate an opener-depth question for an atlas region.
 * Names the TOPIC like any opener — never frames a gap as a lack (Q-79).
 * Soft openers by design: atlas regions are deliberately crude territory
 * maps, so questions never chain follow-ups.
 */
function atlasRegionQuestion(region: AtlasRegion): string | null {
  const topic = region.oneLine?.trim();
  if (!topic) return null;
  return `Tell me about ${topic}.`;
}
