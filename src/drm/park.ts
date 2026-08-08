/**
 * The legacy DRM park record — ticket 159, slice 6: DRM parks now persist
 * the phase machine itself (src/protocols/park.ts writes the machine side-
 * record with the DrmUi inside, and the pointer source is 'parked-machine').
 * This module keeps the OLD {root}/drm/{id}.md frontmatter format so a
 * pre-slice-6 parked DRM still resumes: the drm resume route's compat
 * branch reads it with readDRM and rebuilds the machine. Nothing writes a
 * legacy record in production anymore; readDRM is the compat read and the
 * format's only remaining half.
 */

import { join } from 'node:path';
import matter from 'gray-matter';
import type { DRMParkedState, DRMProbeStep } from '../types.js';
import type { DRMEpisode, DRMFragment } from '../types.js';

/**
 * The pointer-source kind of a LEGACY DRM park (pre-slice-6). Nothing
 * writes it in production anymore — drm parks now mint 'parked-machine'
 * pointers — but old pointers stay in the store and must stay undrawable.
 * Owned here, not by the queue's draw.
 */
export const PARKED_DRM_SOURCE = 'parked-drm' as const;

/** {root}/drm/{id}.md — the whole DRM state, frontmatter only. */
function drmPath(root: string, id: string): string {
  return join(root, 'drm', `${id}.md`);
}

export function readDRM(root: string, id: string): DRMParkedState | null {
  try {
    const d = matter.read(drmPath(root, id)).data as Record<string, unknown>;
    return {
      id: d.id as string,
      session: d.session as string,
      yesterday: d.yesterday as string,
      phase: 'parked',
      episodes: (d.episodes as DRMEpisode[]) ?? [],
      currentEpisodeIdx: (d.currentEpisodeIdx as number) ?? 0,
      probeStep: (d.probeStep as DRMProbeStep) ?? 'place',
      fragments: (d.fragments as DRMFragment[]) ?? [],
      started: d.started as string,
      ended: d.ended as string,
      endedBy: (d.endedBy as DRMParkedState['endedBy']) ?? 'park',
    };
  } catch {
    return null;
  }
}
