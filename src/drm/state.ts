/**
 * DRM (Day Reconstruction Method) — state machine.
 *
 * Ported from prototypes/drm/logic.ts, adapted for Q-85 constitution:
 * - Affect probe OPEN first, nudge only on thin answers
 * - Start times only
 * - Individual fragments per probe answer (not combined per episode)
 * - Gate always visible during probe phase
 * - Fragments carry about-when = yesterday by construction
 */

import { ulid } from 'ulid';
import type { DRMEpisode, DRMFragment, DRMParkedState, DRMPhase, DRMProbeStep, DRMState } from './types.js';
import { DRM_PROBE_QUESTIONS, DRM_AFFECT_NUDGE } from './types.js';
import { isContentFree } from '../elicitor/answer-shape.js';

const PROBE_STEPS: DRMProbeStep[] = ['place', 'activity', 'who-with', 'affect'];

// ── Init ──

export function initDRM(session: string): DRMState {
  const now = new Date().toISOString();
  // Yesterday in ISO date form (local timezone)
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
  return {
    id: ulid(),
    session,
    yesterday,
    phase: 'intro',
    episodes: [],
    currentEpisodeIdx: 0,
    probeStep: 'place',
    fragments: [],
    started: now,
  };
}

// ── State transitions ──

export function beginDRM(state: DRMState): { state: DRMState; yesterday: string } {
  if (state.phase !== 'intro') throw new Error('Already started');
  const next: DRMState = { ...state, phase: 'enumerate' };
  return { state: next, yesterday: state.yesterday };
}

export function addEpisode(state: DRMState, name: string, startHour: number): DRMState {
  if (state.phase !== 'enumerate') throw new Error('Not enumerating');
  if (startHour < 0 || startHour > 23) throw new Error('Hour must be 0–23');
  const ep: DRMEpisode = {
    name,
    startHour,
    probes: { place: null, activity: null, 'who-with': null, affect: null },
  };
  return { ...state, episodes: [...state.episodes, ep] };
}

export function doneEnumerating(state: DRMState): DRMState {
  if (state.phase !== 'enumerate') throw new Error('Not enumerating');
  if (state.episodes.length === 0) throw new Error('Name at least one episode');
  return { ...state, phase: 'probe', currentEpisodeIdx: 0, probeStep: 'place' };
}

export function answerProbe(state: DRMState, text: string): {
  state: DRMState;
  /** The fragment produced, if this was the last probe in the episode. */
  fragment: DRMFragment | null;
  /** True when all probes in this episode are done — gate should show. */
  atGate: boolean;
  /** True when this was the last episode's last probe. */
  atEnd: boolean;
} {
  if (state.phase !== 'probe') throw new Error('Not in probe phase');
  const ep = state.episodes[state.currentEpisodeIdx];
  if (!ep) throw new Error('No current episode');

  // Record the answer
  const updatedEp: DRMEpisode = {
    ...ep,
    probes: { ...ep.probes, [state.probeStep]: text },
  };
  const updatedEps = state.episodes.map((e, i) =>
    i === state.currentEpisodeIdx ? updatedEp : e,
  );

  const stepIdx = PROBE_STEPS.indexOf(state.probeStep);
  if (stepIdx === -1) throw new Error('Invalid probe step');

  if (stepIdx < PROBE_STEPS.length - 1) {
    // More probes in this episode
    const nextStep = PROBE_STEPS[stepIdx + 1]!;
    return {
      state: { ...state, episodes: updatedEps, probeStep: nextStep },
      fragment: null,
      atGate: false,
      atEnd: false,
    };
  }

  // All probes done for this episode — build fragment for the affect answer
  // and signal the gate. The fragment is ONLY the affect answer; the other
  // probe answers are fragments from their own turns (built when answered).
  const fragment = buildFragment(state, updatedEp, 'affect');
  const atEnd = state.currentEpisodeIdx >= state.episodes.length - 1;
  return {
    state: { ...state, episodes: updatedEps },
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
  state: DRMState,
  episode: DRMEpisode,
  step: DRMProbeStep,
): DRMFragment {
  return buildFragment(state, episode, step);
}

export function applyGate(
  state: DRMState,
  choice: 'continue' | 'park' | 'another-day',
): {
  state: DRMState;
  /** The parked state, if choice was 'park'. */
  parked: DRMParkedState | null;
  /** True when all episodes probed. */
  complete: boolean;
} {
  if (state.phase !== 'probe') throw new Error('Not at a gate');

  const ep = state.episodes[state.currentEpisodeIdx];
  if (!ep) throw new Error('No current episode');

  if (choice === 'continue') {
    const nextIdx = state.currentEpisodeIdx + 1;
    if (nextIdx >= state.episodes.length) {
      return {
        state: { ...state, phase: 'complete' },
        parked: null,
        complete: true,
      };
    }
    return {
      state: {
        ...state,
        currentEpisodeIdx: nextIdx,
        probeStep: 'place',
      },
      parked: null,
      complete: false,
    };
  }

  if (choice === 'park') {
    const now = new Date().toISOString();
    const parked: DRMParkedState = {
      ...state,
      // Park at the NEXT episode — this one is complete
      currentEpisodeIdx: state.currentEpisodeIdx + 1,
      probeStep: 'place',
      ended: now,
      endedBy: 'park',
    };
    return {
      state: { ...state, phase: 'parked' },
      parked,
      complete: false,
    };
  }

  // 'another-day' — abandon, keep fragments
  return {
    state: { ...state, phase: 'complete' },
    parked: null,
    complete: true,
  };
}

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
export function gateReading(state: DRMState): {
  episode: number;
  of: number;
  label: string;
} {
  const ep = state.episodes[state.currentEpisodeIdx];
  return {
    episode: state.currentEpisodeIdx + 1,
    of: state.episodes.length,
    label: ep ? `episode ${state.currentEpisodeIdx + 1}: ${ep.name}` : '',
  };
}

/**
 * The question text for the current probe, with episode context for the
 * transcript agent turn. The harvester copies this to the proposal's `question`
 * field, and lineageBlock renders it in the harvest review card.
 */
export function probeQuestion(state: DRMState): string {
  const ep = state.episodes[state.currentEpisodeIdx];
  const context = ep ? `${ep.name} (~${ep.startHour}:00)` : '';
  const base = DRM_PROBE_QUESTIONS[state.probeStep];
  return context ? `\u2190 ${context} \u00b7 ${base}` : base;
}

/**
 * The raw probe question for transcript storage — no arrow, no middot,
 * no episode label. The episode context travels in the probe metadata
 * on the API response, not in the transcript.
 */
export function transcriptQuestion(state: DRMState): string {
  return DRM_PROBE_QUESTIONS[state.probeStep];
}

/**
 * The affect probe with optional nudge. Open first; if the answer is content-free,
 * append the dimensional nudge (Q-85).
 */
export function affectQuestionWithNudge(state: DRMState, previousAnswer: string | null): string {
  const ep = state.episodes[state.currentEpisodeIdx];
  const context = ep ? `${ep.name} (~${ep.startHour}:00)` : '';
  let text = DRM_PROBE_QUESTIONS['affect'];

  if (previousAnswer && isContentFree(previousAnswer)) {
    text = `${text}\n\n${DRM_AFFECT_NUDGE}`;
  }

  return context ? `\u2190 ${context} \u00b7 ${text}` : text;
}

// ── Helpers ──

function buildFragment(
  state: DRMState,
  ep: DRMEpisode,
  step: DRMProbeStep,
): DRMFragment {
  return {
    episode: `${ep.name} (~${ep.startHour}:00)`,
    aboutWhen: state.yesterday,
    step,
    question: `\u2190 ${ep.name} (~${ep.startHour}:00) \u00b7 ${DRM_PROBE_QUESTIONS[step]}`,
    answer: ep.probes[step] ?? '',
  };
}
