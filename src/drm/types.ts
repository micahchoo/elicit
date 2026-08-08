/**
 * DRM (Day Reconstruction Method) — types and constants.
 *
 * Q-85 constitution:
 * - Affect probe OPEN first ("how did that time feel?")
 * - Dimensional nudge only on thin answers (content-free pivot heuristic)
 * - Start times only — duration-guessing is rounding theater
 * - Gate always visible (Q-44 pattern)
 * - Fragments pass ordinary harvest review with episode context
 * - about-when = yesterday by construction
 */

/** The four sub-probes run on each episode, in order. */
export type DRMProbeStep = 'place' | 'activity' | 'who-with' | 'affect';

/** The next probe to ask, keyed by step. */
export const DRM_PROBE_QUESTIONS: Record<DRMProbeStep, string> = {
  place:     'Where were you?',
  activity:  'What were you doing?',
  'who-with': 'Who were you with?',
  affect:    'How did that time feel?',
};

/** The dimensional nudge appended to thin affect answers (Q-85). */
export const DRM_AFFECT_NUDGE =
  'Try describing the emotional color and your energy level — what kind of feeling, and how engaged or drained?';

/** One episode: a named time block with its probe answers. */
export interface DRMEpisode {
  name: string;
  /** Approximate start hour (0–23). Start times only — Q-85. */
  startHour: number;
  /** Collected probes. Null = not yet asked/answered. */
  probes: Record<DRMProbeStep, string | null>;
}

/** A kept fragment: one probe answer from one episode. */
export interface DRMFragment {
  /** The episode this fragment belongs to. */
  episode: string;
  /** The ISO date — "yesterday" the reconstruction anchors to. */
  aboutWhen: string;
  /** Which probe step produced this answer. */
  step: DRMProbeStep;
  /** The probe question text (includes episode context for harvest review). */
  question: string;
  /** The verbatim answer text. */
  answer: string;
}

/**
 * The DRM flow's state as it lives inside the phase machine (ticket 159,
 * slice 6): MachineState.ui holds exactly these fields. The machine itself
 * carries what a machine carries — protocol ('drm'), phaseIndex
 * (enumerate → probe → gate), startedAt — and `id`/`session`/`phase`/
 * `started` of the old DRMState are machine-adjacent (the side-record is
 * keyed by session id; the phase IS the machine's phaseIndex; startedAt is
 * the machine's). The five drm routes drive the machine by running the
 * pure transitions in src/drm/state.ts on this ui and writing the result
 * back to machine.ui.
 */
export interface DrmUi {
  /** The ISO date — "yesterday" the reconstruction anchors to. */
  yesterday: string;
  episodes: DRMEpisode[];
  /** The episode the probes are on. */
  currentEpisodeIdx: number;
  /** The next sub-probe to ask for the current episode. */
  probeStep: DRMProbeStep;
  fragments: DRMFragment[];
}

export type DRMPhase = 'intro' | 'enumerate' | 'probe' | 'parked' | 'complete';

/** A live DRM instrument session. */
export interface DRMState {
  id: string;
  session: string;
  yesterday: string;
  phase: DRMPhase;
  episodes: DRMEpisode[];
  currentEpisodeIdx: number;
  probeStep: DRMProbeStep;
  fragments: DRMFragment[];
  started: string;
}

/** A finished DRM: a live state stamped with when and how it ended. */
export type DRMParkedState = DRMState & {
  ended: string;
  /** 'complete' names the walk that ran to the end of every episode. */
  endedBy: 'park' | 'another-day' | 'complete';
};
