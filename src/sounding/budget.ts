import type { Mode } from '../types.js';

/**
 * The floor at 8 is ruled, not inferred — Q-63. When a Sounding is licensed
 * with fewer than 8 questions of budget remaining, the allowance floors at 8
 * and the sitting grows past its declared minutes: the descent IS the sitting
 * from that point, the two close moves stay reserved beyond the allowance,
 * and the consent ask states the real expected length, which is what keeps
 * the overrun consented rather than suffered. Do not make MIN_RUNGS
 * configurable, and do not add a compensating guard in the license.
 */
const MIN_RUNGS = 8;
const MAX_RUNGS = 12;

/**
 * The fixed question count a sitting runs on (canon §5.3): minutes are no
 * longer declared, so the budget is one constant. Both the elicitor's door
 * (`questionCount >= SESSION_BUDGET - 2`) and the descent allowance read it,
 * so they cannot drift apart.
 */
export const SESSION_BUDGET = 10;

/**
 * Turns the sitting's remaining budget into a rung count for the offer.
 *
 * The two close moves are NEVER inside the allowance: `rungAllowance` computes
 * from `budget - 2 - questionCount` (Q-20, Q-47), and the caller adds nothing
 * back. Always `8 <= allowance <= 12`, `checkpointRung === Math.ceil(allowance / 2)`.
 */
export function rungAllowance(mode: Mode, questionCount: number): { allowance: number; checkpointRung: number } {
  const budget = SESSION_BUDGET;
  const remaining = budget - 2 - questionCount; // the two close moves, reserved (Q-20, Q-47)
  const allowance = Math.min(MAX_RUNGS, Math.max(MIN_RUNGS, remaining));
  return { allowance, checkpointRung: Math.ceil(allowance / 2) };
}

/**
 * The consent ask's length line: states the number of rungs the descent will
 * hold, in words the person can hold. No promise about what it will find.
 */
export function expectedLengthSentence(allowance: number): string {
  return `This descent runs ${allowance} rungs.`;
}
