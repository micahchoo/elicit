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
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

  #path(): string {
    return join(this.#root, 'queue-engagement.json');
  }

  read(): EngagementState {
    try {
      const parsed = JSON.parse(readFileSync(this.#path(), 'utf8')) as Partial<EngagementState>;
      return { ...FRESH_ENGAGEMENT, ...parsed };
    } catch {
      return { ...FRESH_ENGAGEMENT };
    }
  }

  write(s: EngagementState): void {
    try {
      writeFileSync(this.#path(), JSON.stringify(s, null, 1) + '\n');
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
