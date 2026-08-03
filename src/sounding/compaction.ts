import type { ParkedLadder, Rung } from '../types.js';

/**
 * Task 10 of the soundings slice — the short view of a finished ladder.
 *
 * The local model degrades on long payloads, so a resume must not hand back
 * nine rungs: it gets the last two verbatim and the rest behind one line.
 * This does NOT call `cover()` (Q-45 / ADR-0002 layer 3): a rung is not a
 * SessionRef and the ladder is not a binary-bracketed tree. It reuses
 * cover's SHAPE — newest verbatim, older behind one line — and its Marginalia
 * storage convention only (the summary line lives in `marginalia/`, stamped
 * by the model that wrote it).
 */
export type CompactedLadder = {
  /** The LAST 1-2 rungs, newest last — never more (Q-45). */
  verbatim: Rung[];
  /**
   * The earlier rungs behind one line. `null` when the Docket has not run
   * yet — a missing summary degrades to LESS context, never more.
   */
  summarized: { count: number; line: string } | null;
  /**
   * Rungs beyond `verbatim` that have no summary line. Nonzero only while
   * `summary` is null.
   */
  unsummarized: number;
};

/**
 * Two rungs verbatim, one line for the rest. `verbatim.at(-1)!.answer` is
 * what the resumed question's foothold must come from, so newest-last is
 * load-bearing. When `summary` is null the earlier rungs are reported as
 * `unsummarized` and are NOT included verbatim — never the whole ladder
 * (Q-45: a missing summary degrades to less context, never more).
 */
export function compactLadder(l: ParkedLadder, summary: string | null): CompactedLadder {
  const verbatim = l.rungs.slice(-2);
  if (summary === null) {
    return { verbatim, summarized: null, unsummarized: l.rungs.length - verbatim.length };
  }
  return {
    verbatim,
    summarized: { count: l.rungs.length - verbatim.length, line: summary },
    unsummarized: 0,
  };
}
