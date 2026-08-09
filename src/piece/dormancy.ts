import type { Piece } from './contract.js';

/**
 * `dormancy` — one decision, Q-41's second half: a Piece nobody has touched
 * in a long time is set down by the system rather than left minting
 * questions into a queue the person is not reading. It is silent (Q-22:
 * agent initiative ends at the app's edge — nothing reaches out), logged
 * (Q-23: the ledger is what makes background autonomy trustworthy), and
 * reversible — picking it up resumes minting, and no flag anywhere says
 * "unfinished". Dormancy is signal, never debt (Q-24): the caller's log
 * sentence carries no reproach, and this module never announces anything.
 *
 * Pure and memoryless: same inputs, same answer, on every call — no I/O, no
 * clock, no model. `lastTouched` is passed in, never read here; the caller
 * (the Docket's dormancy sweep) derives it as the newest of the Piece's
 * `created` and the `captured` of any snippet pinned in it. A set-down Piece
 * is never auto-set-down again (Q-41), so the log does not repeat.
 */
export function isDormant(p: Piece, lastTouched: string, now: number, days: number): boolean {
  if (p.setDownAt !== undefined) return false;
  return Date.parse(lastTouched) < now - days * 86_400_000;
}
