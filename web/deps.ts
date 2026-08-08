/**
 * The web split-module seam — one declaration of the deps contract.
 *
 * Every module split out of main.ts (import-review, survey-map, coach,
 * import-entry) receives its dependencies as one injected object literal at
 * the call site — the seam that keeps main.ts's edit-concurrency-safe split
 * real. Before this file, each split module re-declared the same
 * el/api/navTo core by hand (and territory.ts fell off the seam entirely,
 * using global document with a different el() signature). The core lives
 * here once; modules that need the extra verbs (beginWait for the review,
 * folder/focus for the map) extend it.
 *
 * The shared primitive shapes come straight from main.ts's own helpers:
 * el(tag, attrs?, ...kids) and api<T>(path, body?) are the client's two
 * DOM/HTTP wrappers, injected so no split module ever touches document or
 * fetch directly.
 */

/** The DOM/HTTP/core-navigation verbs every split screen needs. */
export interface WebDepsCore {
  main: HTMLElement;
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string>,
    ...kids: (string | Node)[]
  ) => HTMLElementTagNameMap[K];
  api: <T>(path: string, body?: unknown) => Promise<T>;
  navTo: (screen: string) => void;
}

/** The waiting-surface verb: beginWait(…).done()/failed() marks the request lifecycle. */
export interface WebDepsWithWait extends WebDepsCore {
  beginWait: (
    slot: HTMLElement,
    msg: string,
  ) => { done(): void; failed(cause: unknown, message?: string): void };
}

/** `POST /api/import/scan` — counts, and every file that did not come in, and why. */
export type ScanResponse = {
  pending: number;
  refused: { file: string; reason: string }[];
  skipped: number;
  adopted: number;
};
