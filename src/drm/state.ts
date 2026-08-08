/**
 * DRM (Day Reconstruction Method) — the pure state transitions, over the
 * machine's ui.
 *
 * Ticket 159, slice 6: the DRM flow's state lives in MachineState.ui as
 * DrmUi (src/drm/types.ts). The machine carries what a machine carries —
 * the protocol ('drm'), the phaseIndex (enumerate → probe → gate), the
 * startedAt — and this module holds the drm-specific transitions: the
 * episode list, the probe position, the fragments, the yesterday anchor.
 * The five drm routes drive the machine by calling these pure functions on
 * machine.ui and writing the result back; no drm state lives in a bespoke
 * SessionState field anymore.
 *
 * Q-85 constitution (unchanged from the prototypes/drm port):
 * - Affect probe OPEN first, nudge only on thin answers
 * - Start times only
 * - Individual fragments per probe answer (not combined per episode)
 * - Gate always visible during probe phase
 * - Fragments carry about-when = yesterday by construction
 */

import type { DRMEpisode, DRMFragment, DRMParkedState, DRMProbeStep, DRMState, DrmUi } from './types.js';
import { DRM_PROBE_QUESTIONS, DRM_AFFECT_NUDGE } from './types.js';
import { isContentFree } from '../language/thin-answer.js';

const PROBE_STEPS: DRMProbeStep[] = ['place', 'activity', 'who-with', 'affect'];

// ── Init ──

/**
 * Fresh ui for a new DRM: the yesterday anchor and empty collections. The
 * machine itself is started with startMachine(drmDef) — it begins at the
 * enumerate phase (index 0) — and this ui rides inside it.
 */
export function initDRM(): DrmUi {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
  return {
    yesterday,
    episodes: [],
    currentEpisodeIdx: 0,
    probeStep: 'place',
    fragments: [],
  };
}

// ── State transitions ──

/**
 * Append one episode block. The route guards the machine's enumerate phase
 * before calling — the ui itself has no phase (the machine's phaseIndex is
 * the phase).
 */
export function addEpisode(ui: DrmUi, name: string, startHour: number): DrmUi {
  if (startHour < 0 || startHour > 23) throw new Error('Hour must be 0–23');
  const ep: DRMEpisode = {
    name,
    startHour,
    probes: { place: null, activity: null, 'who-with': null, affect: null },
  };
  return { ...ui, episodes: [...ui.episodes, ep] };
}

/**
 * End enumeration: at least one block must be named, and the probe position
 * resets to the first episode's first probe. The machine's advance to the
 * probe phase (phaseIndex 1) is the route's act — the UI phase advances by
 * code, not by marker.
 */
export function doneEnumerating(ui: DrmUi): DrmUi {
  if (ui.episodes.length === 0) throw new Error('Name at least one episode');
  return { ...ui, currentEpisodeIdx: 0, probeStep: 'place' };
}

/** Answer the current probe; the fragment lands when the affect probe is done. */
export function answerProbe(ui: DrmUi, text: string): {
  ui: DrmUi;
  /** The fragment produced, if this was the last probe in the episode. */
  fragment: DRMFragment | null;
  /** True when all probes in this episode are done — gate should show. */
  atGate: boolean;
  /** True when this was the last episode's last probe. */
  atEnd: boolean;
} {
  const ep = ui.episodes[ui.currentEpisodeIdx];
  if (!ep) throw new Error('No current episode');

  // Record the answer
  const updatedEp: DRMEpisode = {
    ...ep,
    probes: { ...ep.probes, [ui.probeStep]: text },
  };
  const updatedEps = ui.episodes.map((e, i) =>
    i === ui.currentEpisodeIdx ? updatedEp : e,
  );

  const stepIdx = PROBE_STEPS.indexOf(ui.probeStep);
  if (stepIdx === -1) throw new Error('Invalid probe step');

  if (stepIdx < PROBE_STEPS.length - 1) {
    // More probes in this episode
    const nextStep = PROBE_STEPS[stepIdx + 1]!;
    return {
      ui: { ...ui, episodes: updatedEps, probeStep: nextStep },
      fragment: null,
      atGate: false,
      atEnd: false,
    };
  }

  // All probes done for this episode — build fragment for the affect answer
  // and signal the gate. The fragment is ONLY the affect answer; the other
  // probe answers are fragments from their own turns (built when answered).
  const fragment = buildFragment(ui, updatedEp, 'affect');
  const atEnd = ui.currentEpisodeIdx >= ui.episodes.length - 1;
  return {
    ui: { ...ui, episodes: updatedEps },
    fragment,
    atGate: true,
    atEnd,
  };
}

/**
 * Build a fragment from one probe answer. Called for each probe step as it's
 * answered, so each probe answer is its own independently-harvestable fragment.
 */
export function buildProbeFragment(
  ui: DrmUi,
  episode: DRMEpisode,
  step: DRMProbeStep,
): DRMFragment {
  return buildFragment(ui, episode, step);
}

/**
 * The gate (Q-44): continue / park / another-day. `parked` is the ui a
 * 'park' persists — the NEXT episode to probe, this one being complete —
 * and the route writes it into the machine record as the resume point.
 */
export function applyGate(
  ui: DrmUi,
  choice: 'continue' | 'park' | 'another-day',
): {
  ui: DrmUi;
  /** The ui a 'park' writes to the side-record (resume point); null otherwise. */
  parked: DrmUi | null;
  /** True when the walk is over — complete close or another-day. */
  complete: boolean;
} {
  const ep = ui.episodes[ui.currentEpisodeIdx];
  if (!ep) throw new Error('No current episode');

  if (choice === 'continue') {
    const nextIdx = ui.currentEpisodeIdx + 1;
    if (nextIdx >= ui.episodes.length) {
      return { ui: { ...ui, currentEpisodeIdx: nextIdx }, parked: null, complete: true };
    }
    return {
      ui: { ...ui, currentEpisodeIdx: nextIdx, probeStep: 'place' },
      parked: null,
      complete: false,
    };
  }

  if (choice === 'park') {
    const parked: DrmUi = { ...ui, currentEpisodeIdx: ui.currentEpisodeIdx + 1, probeStep: 'place' };
    return { ui, parked, complete: false };
  }

  // 'another-day' — abandon, keep fragments (they live in the transcript)
  return { ui, parked: null, complete: true };
}

/**
 * Legacy resume (pre-slice-6 park records, read by the drm resume route's
 * compat branch): rebuild the live DRMState from a parked record. New parks
 * persist the machine itself, so the machine path resumes straight off the
 * record — this function only serves the old {root}/drm/<id>.md files.
 */
export function resumeDRM(parked: DRMParkedState, session: string): DRMState {
  const now = new Date().toISOString();
  const state: DRMState = {
    id: parked.id,
    session,
    yesterday: parked.yesterday,
    phase: 'probe',
    episodes: parked.episodes,
    currentEpisodeIdx: parked.currentEpisodeIdx,
    probeStep: parked.probeStep,
    fragments: parked.fragments,
    started: now,
  };

  // If all episodes already done (parked after last episode), complete immediately
  if (parked.currentEpisodeIdx >= parked.episodes.length) {
    return { ...state, phase: 'complete' };
  }

  return state;
}

/** What the gate renders: current episode index, total, and a short label. */
export function gateReading(ui: DrmUi): {
  episode: number;
  of: number;
  label: string;
} {
  const ep = ui.episodes[ui.currentEpisodeIdx];
  return {
    episode: ui.currentEpisodeIdx + 1,
    of: ui.episodes.length,
    label: ep ? `episode ${ui.currentEpisodeIdx + 1}: ${ep.name}` : '',
  };
}

/**
 * The question text for the current probe, with episode context for the
 * transcript agent turn. The harvester copies this to the proposal's `question`
 * field, and lineageBlock renders it in the harvest review card.
 */
export function probeQuestion(ui: DrmUi): string {
  const ep = ui.episodes[ui.currentEpisodeIdx];
  const context = ep ? `${ep.name} (~${ep.startHour}:00)` : '';
  const base = DRM_PROBE_QUESTIONS[ui.probeStep];
  return context ? `\u2190 ${context} \u00b7 ${base}` : base;
}

/**
 * The raw probe question for transcript storage — no arrow, no middot,
 * no episode label. The episode context travels in the probe metadata
 * on the API response, not in the transcript.
 */
export function transcriptQuestion(ui: DrmUi): string {
  return DRM_PROBE_QUESTIONS[ui.probeStep];
}

/**
 * The affect probe with optional nudge. Open first; if the answer is content-free,
 * append the dimensional nudge (Q-85).
 */
export function affectQuestionWithNudge(ui: DrmUi, previousAnswer: string | null): string {
  const ep = ui.episodes[ui.currentEpisodeIdx];
  const context = ep ? `${ep.name} (~${ep.startHour}:00)` : '';
  let text = DRM_PROBE_QUESTIONS['affect'];

  if (previousAnswer && isContentFree(previousAnswer)) {
    text = `${text}\n\n${DRM_AFFECT_NUDGE}`;
  }

  return context ? `\u2190 ${context} \u00b7 ${text}` : text;
}

// ── Helpers ──

function buildFragment(
  ui: DrmUi,
  ep: DRMEpisode,
  step: DRMProbeStep,
): DRMFragment {
  return {
    episode: `${ep.name} (~${ep.startHour}:00)`,
    aboutWhen: ui.yesterday,
    step,
    question: `\u2190 ${ep.name} (~${ep.startHour}:00) \u00b7 ${DRM_PROBE_QUESTIONS[step]}`,
    answer: ep.probes[step] ?? '',
  };
}
