/**
 * DRM park/resume persistence — follows the Sounding park.ts pattern.
 *
 * Parks: writes {root}/drm/{id}.md (frontmatter-only, Q-3 truth)
 * Resumes: reads from disk, rebuilds state
 * Park pointer: mints a QueueEntry with source 'parked-drm'
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { DRMParkedState, DRMProbeStep, QueueEntry, QueueStore, Target } from '../types.js';
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

/**
 * The 'park' word mints this: a pointer whose `question` records the last
 * episode probed — what was on the table — never a composed next probe.
 * The draw never serves it; resumption reads the DRM file, not the pointer
 * (Q-3, following Q-64's Sounding pattern).
 */
export function parkDRMPointer(
  queue: QueueStore,
  parked: DRMParkedState,
  target?: Target,
): QueueEntry {
  const lastEp = parked.episodes[parked.currentEpisodeIdx - 1] ?? parked.episodes.at(-1);
  const label = lastEp ? `DRM: ${lastEp.name}` : 'DRM parked';
  return queue.add({
    source: 'parked-drm' as QueueEntry['source'],
    license: 'user',
    question: label,
    questionForm: 'deliberative',
    sharpness: 'weak',
    horizon: 'session',
    drmId: parked.id,
    ...(target ? { target } : {}),
  });
}
