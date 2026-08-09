/**
 * Shared HTTP-route guards (Wave C3 F3/F8): the decision-array validator
 * both the import review and the session harvest routes run, the
 * text-required guard, and the capture-channel guard.
 *
 * Homed here (not in src/import/contract.ts, which is types-only by its
 * own contract) so src/server.ts and src/session/routes.ts can both
 * import them without a cycle. The channel vocabulary itself —
 * CAPTURE_CHANNELS and isCaptureChannel — lives in src/types.ts beside
 * the union they are the runtime face of.
 */
import type { Context } from 'hono';
import { isCaptureChannel, type CaptureChannel } from './types.js';

/**
 * One validation pass for a POSTed decision array (F3): the import review
 * route and the session harvest route validate the same shape — action
 * membership, then index bounds, then the 400 `{error, entry}` reply —
 * with byte-identical messages. The harvest's extra capture-channel check
 * is the opt-in. Returns the 400 body, or null when every decision is
 * valid.
 */
export function validateDecisions(
 actions: readonly string[],
 decisions: readonly { action?: unknown; cut?: unknown; proposal?: unknown; channel?: unknown }[],
 opts: {
  /** The index field name: 'cut' for import review, 'proposal' for harvest. */
  indexField: 'cut' | 'proposal';
  /** The number of candidates the indices index into. */
  count: number;
  /** The harvest's channel check: reject an invalid capture channel. */
  checkChannel?: boolean;
 },
): { error: string; entry: unknown } | null {
 for (const d of decisions) {
  if (!actions.includes(d.action as string)) {
   return { error: `invalid action "${String(d.action)}" in decision`, entry: d };
  }
  if (opts.indexField === 'cut') {
   if (typeof d.cut !== 'number' || !Number.isInteger(d.cut) || d.cut < 0 || d.cut >= opts.count) {
    return { error: `invalid cut index ${String(d.cut)} (have ${opts.count} cuts)`, entry: d };
   }
  } else if (typeof d.proposal !== 'number' || d.proposal < 0 || d.proposal >= opts.count) {
   return { error: `invalid proposal index ${d.proposal} (have ${opts.count} proposals)`, entry: d };
  }
  if (opts.checkChannel && d.channel !== undefined && !isCaptureChannel(d.channel)) {
   return { error: `invalid channel "${String(d.channel)}" in decision`, entry: d };
  }
 }
 return null;
}

/**
 * The text-required guard the capture routes share (F8): empty text answers
 * the same 400 the inline copies did; valid text comes back trimmed. The
 * caller narrows the Response out:
 * `const text = requireText(c, body.text); if (text instanceof Response) return text;`
 * A site whose required-field message is not the shared one passes it:
 * `requireText(c, body.pointer, 'pointer, name and sentence are required')`.
 */
export function requireText(c: Context, text: unknown, message = 'text is required'): string | Response {
 if (typeof text !== 'string' || text.trim().length === 0) {
  return c.json({ error: message }, 400);
 }
 return text.trim();
}

/**
 * The capture-channel guard the one-turn capture routes share (F8): an
 * invalid channel answers the same 400 the inline copies did; valid or
 * absent narrows to the channel (absent stays undefined).
 */
export function checkedChannel(c: Context, channel: unknown): CaptureChannel | undefined | Response {
 if (channel !== undefined && !isCaptureChannel(channel)) {
  return c.json({ error: `invalid channel "${String(channel)}"` }, 400);
 }
 return isCaptureChannel(channel) ? channel : undefined;
}
