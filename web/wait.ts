/**
 * The waiting affordance — the one implementation every surface's beginWait
 * is (web/deps.ts declares it; wave C gives it a home): a hairline drawing
 * across the measure plus one dimmed line, and the quiet error line a failed
 * call leaves. WAIT_FAILED is the shared default sentence; piece.ts's local
 * copy folds in here.
 *
 * Injection, not import (the seam, web/deps.ts): the DOM verb arrives via
 * initWait at boot — the territory pattern. beginWait throws before painting
 * if never wired, so a forgotten init is loud.
 */
import { ApiError } from './deps.js';
import type { WebDepsCore } from './deps.js';

export const WAIT_FAILED = 'that did not go through — try again';

export interface Wait {
 /** The call returned. Take the affordance away. */
 done(): void;
 /** The call failed. Leave one dimmed line where the affordance was. */
 failed(cause: unknown, message?: string): void;
}

/** The waiting machinery's deps, injected once at boot (web/deps.ts). */
export interface WaitDeps {
 el: WebDepsCore['el'];
}

let waitDeps: WaitDeps | null = null;

/** Wire the DOM verb once at boot. */
export function initWait(deps: WaitDeps): void {
 waitDeps = deps;
}

function wired(): WaitDeps {
 const deps = waitDeps;
 if (deps === null) {
  throw new Error('wait not initialized — call initWait before beginWait');
 }
 return deps;
}

export function showQuietError(container: HTMLElement, message: string) {
 const deps = wired();
 container.append(deps.el('p', { class: 'quiet-error' }, message));
}

/**
 * Say that something is happening, in the register of the page: a hairline
 * drawing across the measure plus one dimmed line. `delayMs` holds it back so
 * a fast call does not flash.
 *
 * Phase 2 (ticket 039) replaces the label of the /end wait with turn-by-turn
 * progress, once the chunked harvest reports which turn it is reading.
 */
export function beginWait(container: HTMLElement, label: string, delayMs = 0): Wait {
 const deps = wired();
 for (const stale of container.querySelectorAll(':scope > .wait, :scope > .quiet-error')) {
  stale.remove();
 }

 const block = deps.el('div', { class: 'wait' });
 block.append(
  deps.el('div', { class: 'wait-rule' }, deps.el('span', { class: 'wait-sweep' })),
  deps.el('p', { class: 'wait-label' }, label),
 );

 let timer: ReturnType<typeof setTimeout> | null = null;
 if (delayMs > 0) timer = setTimeout(() => container.append(block), delayMs);
 else container.append(block);

 let live = true;
 /** Ends the wait once; reports whether this call is the one that ended it. */
 function stop(): boolean {
  if (timer !== null) {
   clearTimeout(timer);
   timer = null;
  }
  const wasLive = live;
  live = false;
  return wasLive;
 }

 return {
  done() {
   if (stop()) block.remove();
  },
  failed(cause: unknown, message = WAIT_FAILED) {
   if (!stop()) return;
   console.error(cause);
   block.remove();
   if (cause instanceof ApiError && cause.handled) return;
   showQuietError(container, message);
  },
 };
}
