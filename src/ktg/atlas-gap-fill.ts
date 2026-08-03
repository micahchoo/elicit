/**
 * Atlas gap-fill sweep — ticket 110.
 *
 * Reads atlas instruments against their coverage stores and generates
 * candidate questions for unprobed regions. Shadow-first (Q-35): the sweep
 * runs, evaluates coverage, generates candidate questions, and LOGS them —
 * but does NOT add them to the queue. The cap is live (Q-56) even in shadow:
 * the sweep stops evaluating after ATLAS_MINT_CAP candidates.
 *
 * Questions are ZERO-LLM templates: each one names the TOPIC like any opener,
 * never the gap (Q-79: "you've never mentioned X" is banned). Weak sharpness
 * by structural design — atlas regions are deliberately crude territory maps,
 * so the questions are soft openers. Never chain follow-ups.
 *
 * Region-to-corpus links are readings under Q-50 statuses (unconfirmed until
 * touched), never priors (Q-66 killed priors). Coverage is a fact about the
 * ARCHIVE, never about the person (Q-79).
 */

import type { AtlasInstrument, AtlasRegion } from './atlas-types.js';
import type { CoverageStore } from './coverage.js';

/** The docket log sink, narrowed to what the sweep emits. */
export type AtlasGapFillLog = (e: {
  at: string;
  actor: string;
  kind: string;
  detail: string;
  refs?: string[];
}) => void;

/** How many atlas questions one run may evaluate (Q-56 bound, live). */
const ATLAS_MINT_CAP = 2;

/**
 * The atlas gap-fill sweep. Called by the docket's atlas thunk.
 *
 * Shadow-first (Q-35): evaluates coverage and logs candidates, but does
 * not call queue.add. The cap is live (Q-56): at most ATLAS_MINT_CAP
 * candidates are evaluated per run.
 */
export function runAtlasGapFillSweep(deps: {
  atlas: AtlasInstrument;
  coverage: CoverageStore;
  log: AtlasGapFillLog;
  now: string;
}): { candidateCount: number; scanned: number } {
  const { atlas, coverage, log, now } = deps;

  let candidateCount = 0;
  let scanned = 0;

  // Collect explicit coverage statuses from stored readings
  const statusCache = new Map<string, string>();
  for (const region of atlas.regions) {
    statusCache.set(
      region.id,
      coverage.readReading(region.id)?.status ?? 'unprobed',
    );
  }

  // Scan unprobed regions and generate candidate questions
  for (const region of atlas.regions) {
    if (candidateCount >= ATLAS_MINT_CAP) break;
    if (statusCache.get(region.id) !== 'unprobed') continue;

    const question = atlasRegionQuestion(region);
    if (!question) continue;

    candidateCount++;
    log({
      at: now,
      actor: 'clerk',
      kind: 'atlas-gap-fill-candidate',
      detail: `shadow candidate for atlas "${atlas.instrument}" region ${region.id}: "${question}"`,
      refs: [region.id, atlas.instrument],
    });
  }


  // All regions were scanned via the status cache read above
  scanned = atlas.regions.length;

   return { candidateCount, scanned };
}

// ── Question template (ZERO-LLM, never quote region labels, Q-79 opener form) ──

/**
 * Generate an opener-depth question for an atlas region.
 * Names the TOPIC like any opener — never frames a gap as a lack (Q-79).
 * Weak sharpness by design: atlas regions are deliberately crude territory
 * maps, so questions are soft openers that never chain follow-ups.
 */
function atlasRegionQuestion(region: AtlasRegion): string | null {
  const topic = region.oneLine?.trim();
  if (!topic) return null;
  return `Tell me about ${topic}.`;
}
