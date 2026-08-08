/**
 * The legacy DRM park record — ticket 159, slice 6: DRM parks now persist
 * the phase machine itself (src/protocols/park.ts writes the machine side-
 * record with the DrmUi inside, and the pointer source is 'parked-machine').
 * This module keeps the OLD {root}/drm/{id}.md frontmatter format so a
 * pre-slice-6 parked DRM still resumes: the drm resume route's compat
 * branch reads it with readDRM and rebuilds the machine. Nothing writes a
 * legacy record in production anymore — writeDRM survives as the format's
 * writer for the roundtrip test and for symmetry with the reader.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { DRMParkedState, DRMProbeStep } from '../types.js';
import type { DRMEpisode, DRMFragment } from '../types.js';

/** {root}/drm/{id}.md — the whole DRM state, frontmatter only. */
function drmPath(root: string, id: string): string {
  return join(root, 'drm', `${id}.md`);
}

export function writeDRM(root: string, parked: DRMParkedState): void {
  const fm: Record<string, unknown> = {
    id: parked.id,
    session: parked.session,
    yesterday: parked.yesterday,
    started: parked.started,
    ended: parked.ended,
    endedBy: parked.endedBy,
    episodes: parked.episodes.map((ep: DRMEpisode) => ({
      name: ep.name,
      startHour: ep.startHour,
      probes: { ...ep.probes },
    })),
    currentEpisodeIdx: parked.currentEpisodeIdx,
    probeStep: parked.probeStep,
    fragments: parked.fragments.map((f: DRMFragment) => ({
      episode: f.episode,
      aboutWhen: f.aboutWhen,
      step: f.step,
      question: f.question,
      answer: f.answer,
    })),
  };
  mkdirSync(join(root, 'drm'), { recursive: true });
  writeFileSync(drmPath(root, parked.id), matter.stringify('', fm), 'utf-8');
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
