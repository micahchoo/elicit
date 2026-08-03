import type { Mode, QueueEntry, SoundingState } from '../types.js';
import type { CompactedLadder } from './compaction.js';
import { compactLadder } from './compaction.js';
import { rungAllowance } from './budget.js';
import { readLadder } from './park.js';

/**
 * Pick a parked descent back up (plan Task 12).
 *
 * The Queue pointer names the ladder and nothing else (Q-64): the ladder is
 * the truth (Q-3), so the resumed state is rebuilt from disk, never from the
 * pointer. Returns `null` when the ladder file is missing — a dead pointer
 * is a 404 for the route, never a crash.
 *
 * Behavioral invariants (the plan's contracts):
 * - The allowance and checkpoint are recomputed from the NEW sitting's
 *   remaining budget (Q-47) — never restored from the parked ladder. The
 *   person consented to a length in a sitting that has ended; the new
 *   sitting's consent ask states the new number.
 * - `licensingAnswer` is carried forward unchanged, so the file keeps saying
 *   what originally licensed the descent. Rung 0's check never re-runs on a
 *   resume — there are already rungs, so `addRung` compares against
 *   `rungs.at(-1)!.answer`.
 * - The returned state's rungs are the parked ladder's FULL rungs: resumed
 *   rungs APPEND to the same `soundings/<id>.md` on the next write (one
 *   descent, one file, however many sittings it spans).
 * - No `pendingQuestion` on the returned state: the resumed question is
 *   composed FRESH at resume time (Q-45) by the route, which sets it after.
 */
export function resumeSounding(
  root: string,
  entry: QueueEntry,
  mode: Mode,
  questionCount: number,
  summary: string | null,
): { state: SoundingState; compacted: CompactedLadder } | null {
  if (!entry.soundingId) return null;
  const parked = readLadder(root, entry.soundingId);
  if (!parked) return null;
  const { allowance, checkpointRung } = rungAllowance(mode, questionCount);
  return {
    state: {
      id: parked.id,
      session: parked.session,
      started: parked.started,
      construct: parked.construct,
      licensingAnswer: parked.licensingAnswer,
      allowance,
      checkpointRung,
      rungs: parked.rungs,
    },
    compacted: compactLadder(parked, summary),
  };
}
