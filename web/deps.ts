/**
 * The web split-module seam — one declaration of the deps contract.
 *
 * Every module split out of main.ts (import-review, survey-map, coach,
 * import-entry) receives its dependencies as one injected object literal at
 * the call site — the seam that keeps main.ts's edit-concurrency-safe split
 * real. Before this file, each split module re-declared the same
 * el/api/navTo core by hand (and territory.ts fell off the seam entirely,
 * using global document with a different el() signature — it now receives
 * its DOM verb through initTerritory at boot, the same seam). The core
 * lives here once; modules that need the extra verbs (beginWait for the
 * review, folder/focus for the map) extend it.
 *
 * The shared primitive shapes come straight from main.ts's own helpers:
 * el(tag, attrs?, ...kids) and api<T>(path, body?) are the client's two
 * DOM/HTTP wrappers, injected so no split module ever touches document or
 * fetch directly. The wire types below are the surfaces' shared responses
 * (ScanResponse was the first; the waiting surface's queue, harvest-queue
 * and sweep-backlog shapes joined it), and ApiError is the one client error
 * class — the split modules' wait wrappers test `instanceof ApiError`, so
 * it must be one class across every module.
 */

import type { QueueEntry } from '../src/types.ts';
import type { HarvestOrigin } from './provenance.js';

/** The DOM/HTTP/core-navigation verbs every split screen needs. */
export interface WebDepsCore {
  main: HTMLElement;
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string>,
    ...kids: (string | Node)[]
  ) => HTMLElementTagNameMap[K];
  api: <T>(
    path: string,
    body?: unknown,
    opts?: { method?: 'GET' | 'POST'; raw?: boolean },
  ) => Promise<T>;
  navTo: (screen: string) => void;
}

/** The waiting-surface verb: beginWait(…).done()/failed() marks the request lifecycle. */
export interface WebDepsWithWait extends WebDepsCore {
  beginWait: (
    slot: HTMLElement,
    msg: string,
    delayMs?: number,
  ) => { done(): void; failed(cause: unknown, message?: string): void };
}

/** `POST /api/import/scan` — counts, and every file that did not come in, and why. */
export type ScanResponse = {
  pending: number;
  refused: { file: string; reason: string }[];
  skipped: number;
  adopted: number;
};

/**
 * A failed call. `handled` means api() already put the explanation on screen,
 * so the caller's waiting affordance leaves without adding a second line.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly handled: boolean;
  constructor(message: string, status: number, handled = false) {
    super(message);
    this.status = status;
    this.handled = handled;
  }
}

export interface HarvestQueueEntry {
  sessionId: string;
  started: string;
  protocol: string;
  origin: HarvestOrigin;
  proposalCount: number;
}

/** GET /api/sweep-backlog — ticket 139, with the dated sittings of 156. */
export interface SweepBacklogResponse {
  pendingReadings: number;
  freshReadings: number;
  lastRecorded: number;
  at: string | null;
  /** The sittings that left sweep work, most recent day first (ticket 156). */
  sittings: { date: string; readings: number }[];
}

/** GET /api/activity — the change-feed line shape. */
export interface ActivityEvent {
  at: string;
  actor: string;
  kind: string;
  detail: string;
}

export interface QueueData {
  open: Array<QueueEntry & { rungsKept?: number }>;
  /** Questions the person parked from the open pane — held until put back. */
  parked?: QueueEntry[];
}
