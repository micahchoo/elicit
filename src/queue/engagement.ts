/**
 * The sitting-level engagement ledger (Q-115) — the queue's policy memory.
 *
 * The queue store's draw pipeline pauses when the person's replies stop
 * engaging: two consecutive strike-sittings pause draws for a cooldown
 * measured in sittings that doubles per pause (2, 4, 8, capped), and the
 * draw after the cooldown is the probe. This file owns THAT bookkeeping —
 * the state, its on-disk home, and the read/write discipline — so the
 * sitting policy is named as itself rather than living inside the question
 * store. The queue store composes it; a restart forgets nothing (Q-3: the
 * measured failure ran one opener per sitting for 20 sittings, and any
 * in-memory counter dies with the process long before that).
 *
 * The per-thread deferral (ticket 148) is a SEPARATE policy — in-memory,
 * keyed by snippet thread — and stays in the queue store beside the draw
 * it serves.
 */
import { jsonCursorFile } from '../jsonl.js';

/** The sitting-level engagement state, persisted beside the queue. */
export type EngagementState = {
  sittingCounter: number;
  consecutiveDisengaged: number;
  lastStrikeSitting: number;
  pauses: number;
  pausedUntilSitting: number;
};

export const FRESH_ENGAGEMENT: EngagementState = {
  sittingCounter: 0,
  consecutiveDisengaged: 0,
  lastStrikeSitting: -1,
  pauses: 0,
  pausedUntilSitting: 0,
};

/** The engagement file's parse: the fresh state overlaid with whatever the file holds. A file that will not parse reads as the fresh state below. */
function engagementOf(value: unknown): EngagementState {
  return { ...FRESH_ENGAGEMENT, ...(value as Partial<EngagementState>) };
}

/** The engagement file's wire format: pretty-printed, newline-terminated — the ledger's format since Q-115. */
function engagementLine(s: EngagementState): string {
  return JSON.stringify(s, null, 1) + '\n';
}

/**
 * The ledger: read/write the state, and record that a sitting started.
 * The write is best-effort — a bookkeeping failure must never break a
 * sitting, so a write that throws is swallowed (the state is re-read on
 * the next call, degrading to the fresh state rather than lying).
 */
export class EngagementLedger {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  read(): EngagementState {
    return jsonCursorFile(this.#root, 'queue-engagement.json', engagementOf, engagementLine).read() ?? { ...FRESH_ENGAGEMENT };
  }

  write(s: EngagementState): void {
    try {
      jsonCursorFile(this.#root, 'queue-engagement.json', engagementOf, engagementLine).write(s);
    } catch {
      // Never let bookkeeping break a sitting.
    }
  }

  /** One sitting started: the counter that everything else keys on. */
  noteSittingStarted(): void {
    const s = this.read();
    s.sittingCounter += 1;
    this.write(s);
  }
}
