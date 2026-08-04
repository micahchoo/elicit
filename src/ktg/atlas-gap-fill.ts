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
 * never the gap (Q-79: "you've never mentioned X" is banned). Weak sharpness
 * by structural design — atlas regions are deliberately crude territory maps,
 * so the questions are soft openers. Never chain follow-ups.
 *
 * Region-to-corpus links are readings under Q-50 statuses (unconfirmed until
 * touched), never priors (Q-66 killed priors). Coverage is a fact about the
 * ARCHIVE, never about the person (Q-79).
 */

import type { QueueStore, QueueDraft } from '../types.js';
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

  let candidateCount = 0;
  let minted = 0;

  // Collect explicit coverage statuses from stored readings
  const statusCache = new Map<string, string>();
  for (const region of atlas.regions) {
    statusCache.set(
      region.id,
      coverage.readReading(region.id)?.status ?? 'unprobed',
    );
  }

  // One question per region, ever — any status blocks re-minting.
  const existing = new Set<string>();
  for (const entry of queue.list()) {
    if (entry.source === 'atlas-gap-fill' && entry.atlasRegion) {
      existing.add(entry.atlasRegion);
    }
  }

  // Scan unprobed regions and mint (or log) candidate questions
  for (const region of atlas.regions) {
    if (candidateCount >= ATLAS_MINT_CAP) break;
    if (statusCache.get(region.id) !== 'unprobed') continue;
    if (existing.has(region.id)) continue;

    const question = atlasRegionQuestion(region);
    if (!question) continue;

    candidateCount++;

    if (shadowMode) {
      log({
        at: now,
        actor: 'clerk',
        kind: 'atlas-gap-fill-candidate',
        detail: `shadow candidate for atlas "${atlas.instrument}" region ${region.id}: "${question}"`,
        refs: [region.id, atlas.instrument],
      });
      continue;
    }

    const draft: QueueDraft = {
      source: 'atlas-gap-fill',
      license: `atlas gap: region ${region.id} (${atlas.instrument})`,
      question,
      questionForm: 'deliberative',
      sharpness: 'weak',
      horizon: 'session',
      atlasRegion: region.id,
    };

    queue.add(draft);
    existing.add(region.id);
    minted++;
    log({
      at: now,
      actor: 'clerk',
      kind: 'atlas-gap-fill-minted',
      detail: `minted question for atlas "${atlas.instrument}" region ${region.id}`,
      refs: [region.id, atlas.instrument],
    });
  }

  // All regions were scanned via the status cache read above
  const scanned = atlas.regions.length;

  return { candidateCount, scanned, minted };
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
