import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueueEntry, QueueStore, Target } from '../types.js';
import type { MachineState } from './machine.js';

/**
 * The machine side-record (ticket 159, slice 5): `{root}/machines/
 * <sessionId>.json` carrying the whole MachineState, written on park AND on
 * every ratified phase advance (the ladder's durability register). Reads are
 * lenient: a half-written or corrupt record reads back as null — the caller
 * skips it with a log line and restarts the machine at phase 0, never a
 * crash, never a machine that hides a valid record beside it. JSON rather
 * than the soundings' frontmatter markdown because the state is plain
 * data — no prose to keep human-readable — and the plan names the file
 * `.json` explicitly.
 */
function machinePath(root: string, sessionId: string): string {
 return join(root, 'machines', `${sessionId}.json`);
}

/** Write the whole machine state under `{root}/machines/{sessionId}.json`. */
export function writeMachineState(root: string, sessionId: string, state: MachineState): void {
 mkdirSync(join(root, 'machines'), { recursive: true });
 writeFileSync(machinePath(root, sessionId), JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Read the machine state back; null when the file is missing, unparsable, or
 * not the machine shape (a corrupt record must degrade, never throw).
 */
export function readMachineState(root: string, sessionId: string): MachineState | null {
 try {
  const parsed = JSON.parse(readFileSync(machinePath(root, sessionId), 'utf-8')) as Record<string, unknown>;
  if (
   typeof parsed.protocol !== 'string'
   || typeof parsed.phaseIndex !== 'number'
   || !Array.isArray(parsed.exchanges)
   || parsed.exchanges.some((n) => typeof n !== 'number')
   || typeof parsed.startedAt !== 'string'
  ) {
   return null;
  }
  return {
   protocol: parsed.protocol,
   phaseIndex: parsed.phaseIndex,
   exchanges: parsed.exchanges as number[],
   startedAt: parsed.startedAt,
   ...(typeof parsed.lastQuestionAt === 'string' ? { lastQuestionAt: parsed.lastQuestionAt } : {}),
   ...(parsed.ui !== undefined && parsed.ui !== null && typeof parsed.ui === 'object'
    ? { ui: parsed.ui as Record<string, unknown> }
    : {}),
  };
 } catch {
  return null;
 }
}

/**
 * Remove the side-record. Lenient: a missing record is not an error — the
 * end flows call this defensively and must never throw over a file that was
 * already cleaned up.
 */
export function removeMachineState(root: string, sessionId: string): void {
 try {
  rmSync(machinePath(root, sessionId));
 } catch {
  /* already gone — the end flows remove defensively */
 }
}

/**
 * The 'park' word mints this: a pointer whose `question` names the phase
 * the machine sits in — what was on the table — never a composed next
 * question (Q-45). The draw never serves it (the queue's pointer filter);
 * a resumption reads the side-record, not the pointer (Q-3, following
 * Q-64's Sounding pattern). `machineId` (the parked session) keys the
 * record; `machineProtocol` survives a corrupt record so a restart at
 * phase 0 still runs the instrument the person parked.
 */
export function parkMachinePointer(
 queue: QueueStore,
 state: MachineState,
 sessionId: string,
 phases: { id: string; label: string }[],
 target?: Target,
): QueueEntry {
 const phase = phases[state.phaseIndex];
 const label = phase
  ? `${phase.label} (${state.protocol}, phase ${state.phaseIndex + 1} of ${phases.length})`
  : `${state.protocol} machine parked`;
 return queue.add({
  source: 'parked-machine',
  license: 'user',
  question: label,
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'session',
  machineId: sessionId,
  machineProtocol: state.protocol,
  ...(target ? { target } : {}),
 });
}
