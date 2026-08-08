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
 * Three states, decided by `panelLine` and rendered by main.ts's
 * `renderPanelLine`:
 * - offer: the line text, rendered in the panel's own class
 * - none: null — the panel element stays empty and `:empty` hides it
 * - error: one muted `quiet-error` line, "couldn't check <label> just now" —
 *   never the offer class, so a broken endpoint is distinguishable from an
 *   empty offer when the panel is inspected
 *
 * The decision is pure (no DOM), so the three states are unit-tested here;
 * the element work stays a thin wrapper in main.ts. Future one-line panels
 * inherit the helper.
 */

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
