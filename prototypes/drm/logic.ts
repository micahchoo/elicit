/**
 * DRM (Day Reconstruction Method) — pure state machine.
 *
 * Models yesterday as a sequence of episodes, then probes each episode for
 * place, activity, who-with, and affect-as-prose. The gate between episodes
 * mirrors the Sounding's park/resume pattern: each completed episode shows
 * its fragment and offers "continue / park / another day."
 *
 * This module touches no disk, draws no model call, and imports nothing from
 * src/ — it is a throwaway prototype for reacting to the flow.
 */

// ── Types ──

/** The four sub-probes run on each episode, in order. */
export type ProbeStep = 'place' | 'activity' | 'who-with' | 'affect';

/** The next probe to ask, keyed by step. */
export const PROBE_QUESTIONS: Record<ProbeStep, string> = {
  place:    'Where were you?',
  activity: 'What were you doing?',
  'who-with': 'Who were you with?',
  affect:   'How did you feel?  Describe the tone of the time — the emotional color and your energy level.',
};

/** One episode: a named time block with its probe answers. */
export interface Episode {
  name: string;
  /** Approximate start hour (0–23). */
  startHour: number;
  /** Collected probes. Null = not yet asked/answered. */
  probes: Record<ProbeStep, string | null>;
}

/** A kept fragment: one episode's worth of yesterday-reconstruction material. */
export interface DREpisodeFragment {
  /** ISO date — the "yesterday" the whole reconstruction anchors to. */
  aboutWhen: string;
  episode: string;
  startHour: number;
  place: string;
  activity: string;
  whoWith: string;
  /** Prose affect — no numeric ratings. */
  affect: string;
}

/** What was saved when the sitting was parked. */
export interface DRMParkState {
  yesterday: string;
  episodes: Episode[];
  currentEpisodeIdx: number;
  probeStep: ProbeStep;
  /** Completed fragments (episodes 0 .. currentEpisodeIdx - 1). */
  fragments: DREpisodeFragment[];
}

export type DRMPhase = 'intro' | 'enumerate' | 'probe' | 'parked' | 'complete';

export interface DRMState {
  phase: DRMPhase;
  yesterday: string;
  episodes: Episode[];
  currentEpisodeIdx: number;
  probeStep: ProbeStep;
  fragments: DREpisodeFragment[];
  parkState: DRMParkState | null;
}

// ── Actions ──

export type DRMAction =
  | { kind: 'begin'; yesterday: string }
  | { kind: 'add-episode'; name: string; startHour: number }
  | { kind: 'done-enumerating' }
  | { kind: 'answer'; text: string }
  | { kind: 'gate'; choice: 'continue' | 'park' | 'another-day' }
  | { kind: 'resume'; state: DRMParkState };

// ── Messages the UI renders ──

export type DRMMessage =
  | { kind: 'intro' }
  | { kind: 'ask-episode'; count: number }
  | { kind: 'probe-question'; episode: string; step: ProbeStep; question: string }
  | { kind: 'gate'; episode: string; fragment: DREpisodeFragment; atEnd: boolean }
  | { kind: 'parked'; atEpisode: string; atStep: ProbeStep }
  | { kind: 'complete'; fragments: DREpisodeFragment[] }
  | { kind: 'error'; msg: string };

// ── Init ──

export function initDRM(): DRMState {
  return {
    phase: 'intro',
    yesterday: '',
    episodes: [],
    currentEpisodeIdx: 0,
    probeStep: 'place',
    fragments: [],
    parkState: null,
  };
}

// ── Reduce ──

export function reduceDRM(state: DRMState, action: DRMAction): { state: DRMState; messages: DRMMessage[] } {
  const msgs: DRMMessage[] = [];

  switch (action.kind) {

    case 'begin': {
      if (state.phase !== 'intro') {
        msgs.push({ kind: 'error', msg: 'Already started.' });
        return { state, messages: msgs };
      }
      const next: DRMState = {
        ...state,
        phase: 'enumerate',
        yesterday: action.yesterday,
      };
      msgs.push({ kind: 'intro' });
      msgs.push({ kind: 'ask-episode', count: 0 });
      return { state: next, messages: msgs };
    }

    case 'add-episode': {
      if (state.phase !== 'enumerate') {
        msgs.push({ kind: 'error', msg: 'Not enumerating.' });
        return { state, messages: msgs };
      }
      const ep: Episode = {
        name: action.name,
        startHour: action.startHour,
        probes: { place: null, activity: null, 'who-with': null, affect: null },
      };
      const next: DRMState = {
        ...state,
        episodes: [...state.episodes, ep],
      };
      msgs.push({ kind: 'ask-episode', count: next.episodes.length });
      return { state: next, messages: msgs };
    }

    case 'done-enumerating': {
      if (state.phase !== 'enumerate') {
        msgs.push({ kind: 'error', msg: 'Not enumerating.' });
        return { state, messages: msgs };
      }
      if (state.episodes.length === 0) {
        msgs.push({ kind: 'error', msg: 'Name at least one episode.' });
        return { state, messages: msgs };
      }
      const next: DRMState = {
        ...state,
        phase: 'probe',
        currentEpisodeIdx: 0,
        probeStep: 'place',
      };
      msgs.push(probeMsg(next));
      return { state: next, messages: msgs };
    }

    case 'answer': {
      if (state.phase !== 'probe') {
        msgs.push({ kind: 'error', msg: 'Not in probe phase.' });
        return { state, messages: msgs };
      }
      const ep = state.episodes[state.currentEpisodeIdx];
      if (!ep) {
        msgs.push({ kind: 'error', msg: 'No current episode.' });
        return { state, messages: msgs };
      }

      // Record the answer
      const updatedEp: Episode = {
        ...ep,
        probes: { ...ep.probes, [state.probeStep]: action.text },
      };
      const updatedEps = state.episodes.map((e, i) =>
        i === state.currentEpisodeIdx ? updatedEp : e,
      );

      // Advance to next sub-probe or to gate
      const steps: ProbeStep[] = ['place', 'activity', 'who-with', 'affect'] as const;
      const stepIdx = steps.indexOf(state.probeStep);
      if (stepIdx === -1) {
        msgs.push({ kind: 'error', msg: 'Invalid probe step.' });
        return { state, messages: msgs };
      }

      if (stepIdx < steps.length - 1) {
        // More probes in this episode
        const nextStep = steps[stepIdx + 1]!;
        const next: DRMState = {
          ...state,
          episodes: updatedEps,
          probeStep: nextStep,
        };
        msgs.push(probeMsg(next));
        return { state: next, messages: msgs };
      }

      // All probes done for this episode — build fragment and show gate
      const fragment = buildFragment(state.yesterday, updatedEp);
      const next: DRMState = {
        ...state,
        episodes: updatedEps,
        // probeStep stays 'affect' but we're at the gate
      };
      const atEnd = state.currentEpisodeIdx >= state.episodes.length - 1;
      msgs.push({
        kind: 'gate',
        episode: updatedEp.name,
        fragment,
        atEnd,
      });
      return { state: next, messages: msgs };
    }

    case 'gate': {
      if (state.phase !== 'probe') {
        msgs.push({ kind: 'error', msg: 'Not at a gate.' });
        return { state, messages: msgs };
      }

      const ep = state.episodes[state.currentEpisodeIdx];
      if (!ep) {
        msgs.push({ kind: 'error', msg: 'No current episode.' });
        return { state, messages: msgs };
      }

      if (action.choice === 'continue') {
        // Build the fragment for the completed episode
        const fragment = buildFragment(state.yesterday, ep);
        const fragments = [...state.fragments, fragment];

        const nextIdx = state.currentEpisodeIdx + 1;
        if (nextIdx >= state.episodes.length) {
          // All done
          msgs.push({ kind: 'complete', fragments });
          return {
            state: { ...state, phase: 'complete', fragments },
            messages: msgs,
          };
        }

        const next: DRMState = {
          ...state,
          fragments,
          currentEpisodeIdx: nextIdx,
          probeStep: 'place',
        };
        msgs.push(probeMsg(next));
        return { state: next, messages: msgs };
      }

      if (action.choice === 'park') {
        // Build fragment for completed episode before parking
        const fragment = buildFragment(state.yesterday, ep);
        const fragments = [...state.fragments, fragment];
        const parkState: DRMParkState = {
          yesterday: state.yesterday,
          episodes: state.episodes,
          currentEpisodeIdx: state.currentEpisodeIdx + 1, // next episode on resume
          probeStep: 'place', // start fresh on the next episode
          fragments,
        };
        msgs.push({ kind: 'parked', atEpisode: ep.name, atStep: 'place' });
        return {
          state: {
            ...state,
            phase: 'parked',
            fragments,
            parkState,
          },
          messages: msgs,
        };
      }

      // 'another-day' — abandon the whole sitting
      msgs.push({ kind: 'complete', fragments: state.fragments });
      return {
        state: { ...state, phase: 'complete', fragments: state.fragments },
        messages: msgs,
      };
    }

    case 'resume': {
      if (state.phase !== 'parked' && state.phase !== 'intro') {
        msgs.push({ kind: 'error', msg: 'Nothing parked.' });
        return { state, messages: msgs };
      }
      const ps = action.state;
      const next: DRMState = {
        ...state,
        phase: 'probe',
        yesterday: ps.yesterday,
        episodes: ps.episodes,
        currentEpisodeIdx: ps.currentEpisodeIdx,
        probeStep: ps.probeStep,
        fragments: ps.fragments,
        parkState: null,
      };
      // If all episodes done after resume, complete
      if (ps.currentEpisodeIdx >= ps.episodes.length) {
        msgs.push({ kind: 'complete', fragments: ps.fragments });
        return {
          state: { ...next, phase: 'complete' },
          messages: msgs,
        };
      }
      msgs.push(probeMsg(next));
      return { state: next, messages: msgs };
    }

    default:
      msgs.push({ kind: 'error', msg: 'Unknown action.' });
      return { state, messages: msgs };
  }
}

// ── Helpers ──

function probeMsg(state: DRMState): DRMMessage {
  const ep = state.episodes[state.currentEpisodeIdx];
  if (!ep) return { kind: 'error', msg: 'Missing episode.' };
  return {
    kind: 'probe-question',
    episode: ep.name,
    step: state.probeStep,
    question: PROBE_QUESTIONS[state.probeStep],
  };
}

/** Build a fragment from a completed episode. */
export function buildFragment(yesterday: string, ep: Episode): DREpisodeFragment {
  return {
    aboutWhen: yesterday,
    episode: `${ep.name} (~${ep.startHour}:00)`,
    startHour: ep.startHour,
    place: ep.probes.place ?? '',
    activity: ep.probes.activity ?? '',
    whoWith: ep.probes['who-with'] ?? '',
    affect: ep.probes.affect ?? '',
  };
}

/** Render a fragment as a Snippet-like prose block for display. */
export function fragmentText(f: DREpisodeFragment): string {
  const lines = [
    `about-when: ${f.aboutWhen}`,
    `episode:    ${f.episode}`,
    `place:      ${f.place}`,
    `activity:   ${f.activity}`,
    `who-with:   ${f.whoWith}`,
    `affect:     ${f.affect}`,
  ];
  return lines.join('\n');
}
