import type { Complete, Turn } from '../types.js';
import type { ProtocolDef } from './registry.js';

/**
 * The protocol phase machine (ticket 159, slice 1): the per-sitting driver
 * that turns a protocol def's declared phases into one-question-at-a-time
 * elicitation. Pure by construction — no I/O, no session coupling; the
 * elicitor wires it (slice 3), persistence is slice 5.
 *
 * Advance is hybrid (settled 2026-08-06): code floors (a phase never ends
 * before its declared minimum exchanges) + model-suggested markers. The
 * model emits `[SATURATED]` or `[NEXT_PHASE:<id>]` instead of a question;
 * the driver ratifies only legal transitions.
 */

// ── Types ──

/**
 * One declared phase of a protocol. Parsed from the def's `phases:`
 * frontmatter list; the prompt is the phase's interviewer instructions.
 */
export interface PhaseDef {
 id: string;
 label: string;
 /** Code floor: the phase never advances before this many exchanges. */
 minExchanges: number;
 prompt: string;
 /**
  * UI-phase contract placeholder (slice 6): when present, the phase renders
  * through the phase renderer instead of prose. Typed here, wired in slice 6.
  */
 renderer?: string;
}

/**
 * The machine's durable state. `exchanges` is per-phase: index i holds the
 * answer count for the phase at `phaseIndex` position i, so advancing never
 * erases a phase's history. `ui` carries a UI phase's structured input
 * (drm episodes, later triad selections) — slice 6.
 */
export interface MachineState {
 protocol: string;
 phaseIndex: number;
 /** per-phase answer counts */
 exchanges: number[];
 startedAt: string;
 lastQuestionAt?: string;
 ui?: Record<string, unknown>;
}

/**
 * One triad round recorded in the machine's ui (ticket 159, slice 7): the
 * three names the phase presented and the two the person tapped as alike.
 * The ui shape is `{ triads: TriadSelection[] }` under the key `triads`.
 */
export interface TriadSelection {
 names: string[];
 selected: [string, string];
}

/** A ratified-able advance signal parsed out of a model output. */
export type MachineMarker =
 | { kind: 'saturated' }
 | { kind: 'nextPhase'; id: string };

/** The outcome of ratifying a model output against the machine. */
export interface AdvanceResult {
 /**
  * The machine state after ratification. On an ignored (illegal or
  * premature) suggestion this is the SAME state object — the machine stays
  * and the caller re-asks.
  */
 state: MachineState;
 /** true only when [SATURATED] was ratified at the last phase. */
 closed: boolean;
}

// ── Marker grammar ──

/** The saturation marker, emitted instead of a question when the phase is done. */
export const SATURATED_MARKER = '[SATURATED]';

/** The advance marker: [NEXT_PHASE:<id>] names the target phase. */
export const NEXT_PHASE_PATTERN = /\[NEXT_PHASE:([^\]]+)\]/;

/**
 * Extract the advance marker from a model output. Anything without a marker
 * is a question (returns null). [SATURATED] wins over [NEXT_PHASE] when both
 * appear — the closing signal is the stronger one.
 */
export function parseMachineMarker(output: string): MachineMarker | null {
 if (output.includes(SATURATED_MARKER)) return { kind: 'saturated' };
 const match = output.match(NEXT_PHASE_PATTERN);
 if (match !== null) return { kind: 'nextPhase', id: match[1]! };
 return null;
}

// ── Prompt composition ──

/**
 * The shape rules every machine question must satisfy at the composition
 * seam — the emit-gate-relevant form (ticket 144): one question, complete
 * prose, no leaked template tokens or placeholder slots. The machine does
 * not run the emit gate itself (the elicitor's guard pipeline does, slice
 * 3); this is the prompt-side enforcement, so the questions arrive
 * shape-clean.
 */
export const MACHINE_SHAPE_RULES = `SHAPE (non-negotiable):
- Ask exactly ONE question. No preamble, no acknowledgment, no summary, no judgment.
- One complete sentence: no template tokens, no placeholder slots, no mid-phrase breaks.
- Never ask about "this conversation" itself.
- Never repeat a question you have already asked in this conversation; vary the sentence shape.`;

/**
 * The marker grammar: how the model suggests an advance instead of asking.
 * Floors are CODE-enforced — a premature marker is ignored by the driver,
 * never honored on the model's say-so.
 */
export const MACHINE_MARKER_GRAMMAR = `ADVANCE GRAMMAR:
- When the current phase's material is genuinely exhausted and further probing would only restate, output exactly ${SATURATED_MARKER} and nothing else.
- When the current phase's work is complete and a later phase should begin, output exactly [NEXT_PHASE:<id>] and nothing else — <id> is the target phase's id from this protocol's phase list.
- The driver enforces a per-phase minimum number of exchanges; an advance marker emitted before that floor is met is ignored and the phase continues.
- Any other output is taken as the question to ask.`;

/**
 * Compose the system prompt for the machine's current phase: the phase's own
 * interviewer prompt + the shape rules + the marker grammar. Exposed so the
 * composition seam is testable and so the elicitor (slice 3) can reproduce
 * the exact prompt when it needs the raw model output. Returns null when the
 * def carries no phases or the machine has no current phase (the machine has
 * nothing to ask).
 */
export function composeMachineSystemPrompt(
 def: ProtocolDef,
 state: MachineState,
): string | null {
 const phases = def.phases;
 if (phases === undefined) return null;
 const phase = phases[state.phaseIndex];
 if (phase === undefined) return null;
 return `${phase.prompt}\n\n${MACHINE_SHAPE_RULES}\n\n${MACHINE_MARKER_GRAMMAR}`;
}

// ── The driver ──

/**
 * Start a machine for a def at phase 0. A def without phases (non-machine)
 * starts an inert machine whose questions are always null.
 */
export function startMachine(def: ProtocolDef, startedAt?: string): MachineState {
 return {
  protocol: def.name,
  phaseIndex: 0,
  exchanges: (def.phases ?? []).map(() => 0),
  startedAt: startedAt ?? new Date().toISOString(),
 };
}

/**
 * Bump the current phase's answer count. The elicitor calls this after each
 * user answer; the floors in advanceMachine read these counts. Pure.
 */
export function recordExchange(state: MachineState): MachineState {
 return {
  ...state,
  exchanges: state.exchanges.map((n, i) => (i === state.phaseIndex ? n + 1 : n)),
 };
}

/**
 * Ask the machine's current-phase question: compose the system prompt and
 * call `complete`. Returns the question text, or null when the model emitted
 * an advance marker (or nothing) instead of a question — the caller then
 * ratifies with advanceMachine. To ratify, the elicitor needs the raw
 * output; wrap `complete` to record it (the driver stays pure):
 *
 *   let lastOutput: string | undefined;
 *   const recording: Complete = async (system, turns, opts) => {
 *    lastOutput = await complete(system, turns, opts);
 *    return lastOutput;
 *   };
 */
export async function machineQuestion(
 state: MachineState,
 def: ProtocolDef,
 turns: Turn[],
 complete: Complete,
): Promise<string | null> {
 const system = composeMachineSystemPrompt(def, state);
 if (system === null) return null;
 const output = (await complete(system, turns)).trim();
 if (output.length === 0) return null;
 return parseMachineMarker(output) === null ? output : null;
}

/**
 * Ratify a model output: honor `[SATURATED]` / `[NEXT_PHASE:<id>]` only when
 * the current phase's minExchanges floor is met AND the transition is legal
 * (a forward move to a phase id that exists in the def; [SATURATED] only at
 * the last phase). Anything else — a question, an unknown id, a non-forward
 * id, a premature marker — is ignored: the machine stays (the same state
 * object is returned) and the caller re-asks.
 */
export function advanceMachine(
 state: MachineState,
 def: ProtocolDef,
 modelOutput: string,
): AdvanceResult {
 const phases = def.phases;
 if (phases === undefined) return { state, closed: false };
 const marker = parseMachineMarker(modelOutput);
 if (marker === null) return { state, closed: false };
 const phase = phases[state.phaseIndex];
 if (phase === undefined) return { state, closed: false };
 const floorMet = (state.exchanges[state.phaseIndex] ?? 0) >= phase.minExchanges;
 if (!floorMet) return { state, closed: false };

 if (marker.kind === 'saturated') {
  // [SATURATED] closes only at the last phase; earlier it is an illegal
  // transition (the model should have suggested [NEXT_PHASE:<id>]).
  if (state.phaseIndex === phases.length - 1) return { state, closed: true };
  return { state, closed: false };
 }

 const targetIndex = phases.findIndex((p) => p.id === marker.id);
 if (targetIndex === -1 || targetIndex <= state.phaseIndex) {
  return { state, closed: false };
 }
 return { state: { ...state, phaseIndex: targetIndex }, closed: false };
}
