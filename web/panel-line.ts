/**
 * The one-line waiting panels' three states (ticket 154).
 *
 * The waiting surface's five one-line panels — reach, sweep backlog, coach,
 * cadence, anniversary — are each a single sentence that hides itself via
 * CSS `:empty`. Before this module, a downed endpoint, a thrown parse, and
 * genuinely nothing to offer all painted the same thing: an absent panel.
 * The product's quietness is deliberate; a failure borrowing that quietness
 * is not.
 *
 * Three states, decided by `panelLine` and rendered by `renderPanelLine`:
 * - offer: the line text, rendered in the panel's own class
 * - none: null — the panel element stays empty and `:empty` hides it
 * - error: one muted `quiet-error` line, "couldn't check <label> just now" —
 *   never the offer class, so a broken endpoint is distinguishable from an
 *   empty offer when the panel is inspected
 *
 * The decision is pure (no DOM), so the three states are unit-tested here;
 * the element work is the thin `renderPanelLine` wrapper below, whose DOM
 * verbs arrive through `initPanelLine` at boot (the seam, web/deps.ts) —
 * the waiting and wiki surfaces call it without ever touching document.
 * Future one-line panels inherit the helper.
 */

import type { WebDepsCore } from './deps.js';

/** One waiting panel's rendered state: the offer line, the error line, or
 * nothing (null — the panel stays empty and `:empty` hides it). */
export type PanelLine =
  | { kind: 'offer'; text: string }
  | { kind: 'error'; text: string }
  | null;

/**
 * Decide a one-line panel's state (ticket 154).
 *
 * `kind`:
 * - 'offer' — a real offer; `offerText` is the line, rendered in the
 *   panel's own class. Callers with richer offers (reach, coach,
 *   anniversary) take the decision here and render their own content.
 * - 'none' — genuinely nothing to offer; the panel stays empty.
 * - 'error' — the read failed; one muted line, never the offer class.
 *
 * `label` names the panel in the error sentence ("couldn't check the coach
 * just now").
 */
export function panelLine(
  kind: 'offer' | 'none' | 'error',
  label: string,
  offerText?: string,
): PanelLine {
  if (kind === 'none') return null;
  if (kind === 'error') return { kind: 'error', text: `couldn't check ${label} just now` };
  return { kind: 'offer', text: offerText ?? '' };
}

/** The DOM verbs the wrapper needs, injected once at boot (web/deps.ts). */
export interface PanelLineDeps {
  el: WebDepsCore['el'];
  /** A bare text node — the offer line is a text node, never an element. */
  text: WebDepsCore['text'];
}

let renderDeps: PanelLineDeps | null = null;

/**
 * Wire the wrapper's DOM verbs. main.ts passes its el and a text-node maker
 * once at boot; renderPanelLine throws before painting if never wired, so a
 * forgotten init is a loud failure, never a silent global-document fallback.
 */
export function initPanelLine(deps: PanelLineDeps): void {
 renderDeps = deps;
}

/**
 * Render one panel's line into `container`, replacing its previous contents.
 * The three states:
 * - offer: the line text as a text node, styled by the panel's own class;
 *   panels with richer offers (reach, coach, anniversary) render their own
 *   content after `panelLine` says 'offer'
 * - nothing: the panel cleared — `:empty` keeps it off the page
 * - error: one muted `quiet-error` line, NEVER the offer class, so a broken
 *   endpoint is distinguishable from an empty offer when the panel is
 *   inspected.
 *
 * The contract the sweep-backlog press target builds on: the panel element
 * (`div.sweep-backlog-line`) persists in every state — the offer text as
 * its text node, the error as a `p.quiet-error` child — and the class never
 * changes.
 */
export function renderPanelLine(container: HTMLElement, line: PanelLine | null): void {
 const deps = renderDeps;
 if (deps === null) {
  throw new Error('panel-line not initialized — call initPanelLine(el, text) before rendering');
 }
 container.replaceChildren();
 if (line === null) return;
 if (line.kind === 'error') {
  // The muted error line must be legible where the panel dims its offers:
  // opacity caps its whole group (cadence/reach fade to 0.55), so lift the
  // container's opacity or the error inherits the offer's dimness. Elements
  // are fresh per render; the reset in the offer branch keeps the wrapper
  // safe for any reused container.
  container.style.opacity = '1';
  container.append(deps.el('p', { class: 'quiet-error' }, line.text));
 } else {
  container.style.opacity = '';
  container.append(deps.text(line.text));
 }
}
