import { ulid } from 'ulid';
import type {
  GateChoice,
  GateReading,
  Mode,
  SoundingEnd,
  SoundingState,
} from '../types.js';
import { rungAllowance } from './budget.js';
import { descentEnd } from './convergence.js';

/**
 * The descent ladder (plan Task 6): the object that knows which rung it is
 * on, that every question was built from the answer before it, and whether
 * the whole thing is finished. Everything else in the slice either feeds it
 * or renders it.
 *
 * Pure functions over `SoundingState`, returning new states. No disk, no
 * `complete`, no clock — `at` is passed in, as `Rung.at`.
 */

/**
 * Enter a descent. `licensingAnswer` is REQUIRED and is the verbatim text of
 * the user turn that licensed the descent — rung 0's foothold is checked
 * against it and against nothing else; without it the backwards-chain
 * invariant cannot be enforced for the first rung.
 *
 * The allowance comes from the sitting's remaining budget (budget.ts): the
 * two close moves are never inside it. The first question is NOT composed
 * here — the caller (T8's accept route) composes rung 0 from the same
 * `licensingAnswer` string and sets `pendingQuestion` after.
 */
export function enterSounding(o: {
  session: string;
  construct: string;
  licensingAnswer: string;
  mode: Mode;
  questionCount: number;
  at: string;
}): SoundingState {
  const { allowance, checkpointRung } = rungAllowance(o.mode, o.questionCount);
  return {
    id: ulid(),
    session: o.session,
    started: o.at,
    construct: o.construct,
    licensingAnswer: o.licensingAnswer,
    allowance,
    checkpointRung,
    rungs: [],
  };
}

/**
 * Record a rung: the question that was asked, the phrase it quoted, the
 * answer it drew.
 *
 * The chain runs backwards (Q-12). `foothold` must be a verbatim substring
 * of the PRECEDING answer — `s.licensingAnswer` when `s.rungs` is empty,
 * `s.rungs.at(-1)!.answer` otherwise. It is NOT checked against the `answer`
 * being recorded in the same call: the question was composed before this
 * answer existed, so checking it against this answer would demand the person
 * repeat the phrase back and would reject nearly every real rung. `composeRung`
 * guarantees the invariant at composition time; this is the second gate on the
 * same invariant, so a ladder on disk can never claim a foothold it did not
 * quote.
 *
 * The question that drew this answer is consumed: `pendingQuestion` is absent
 * until the next is composed (per the type comment, absent only while the
 * descent is blocked at the checkpoint).
 */
export function addRung(
  s: SoundingState,
  question: string,
  foothold: string,
  answer: string,
  at: string,
): SoundingState {
  const precedingAnswer =
    s.rungs.length === 0 ? s.licensingAnswer : s.rungs.at(-1)!.answer;
  if (!precedingAnswer.includes(foothold)) {
    throw new Error(
      `foothold ${JSON.stringify(foothold)} is not a substring of the preceding answer`,
    );
  }
  const next: SoundingState = {
    ...s,
    rungs: [...s.rungs, { question, foothold, answer, at }],
  };
  // Consumed — `delete`, never `= undefined` (exactOptionalPropertyTypes).
  delete next.pendingQuestion;
  return next;
}

/**
 * What the gate renders on a rung: position, total, and whether it blocks.
 * `checkpoint` is `rungs.length === s.checkpointRung`, and nothing else
 * makes it true.
 */
export function gateStateFor(s: SoundingState): GateReading {
  return {
    rung: s.rungs.length,
    of: s.allowance,
    checkpoint: s.rungs.length === s.checkpointRung,
  };
}

/**
 * The gate. It never decides the end; it decides whether to ask.
 *
 * - `'continue'` returns `end` from `descentEnd` (convergence.ts) and from
 *   nothing else — cap and convergence close the descent whether or not the
 *   gate is touched.
 * - `'park' | 'another-day'` return that choice as `end`, whatever the
 *   counter says.
 *
 * The state passes through unchanged; the caller composes the next rung from
 * the ladder when it chooses to continue.
 */
export function applyGate(
  s: SoundingState,
  choice: GateChoice,
): { state: SoundingState; end: SoundingEnd | null } {
  if (choice === 'continue') {
    return { state: s, end: descentEnd(s) };
  }
  return { state: s, end: choice };
}
