/**
 * The protocol picker's quiet radio rows — ticket 157. Pure: no DOM, so the
 * render test can exercise it directly.
 *
 * GET /api/protocols serves the open set from the markdown-def registry
 * (never a client-side hardcoded list — ticket 153); the picker renders
 * each protocol's TITLE with its blurb dimmed under it, the registry key
 * (`name`) staying the wire value POST /api/session accepts as {protocol}.
 */

/** One row of GET /api/protocols. */
export interface ProtocolRow {
 id: string;
 name: string;
 title: string;
 blurb?: string;
 rotation: boolean;
}

/** One quiet radio row in the mode picker. */
export interface ProtocolOptionRow {
 /** The wire value — the registry key POST /api/session accepts. */
 id: string;
 /** The option label: the def's title, falling back to the registry name. */
 label: string;
 /** The dimmed one-liner under the label, when the def carries one. */
 blurb?: string;
 /** rotation:false instruments are marked explicit-only (Q-85). */
 explicitOnly: boolean;
}

export function protocolOptionRows(protocols: readonly ProtocolRow[]): ProtocolOptionRow[] {
 return protocols.map((p) => ({
  id: p.id,
  label: p.title || p.name,
  ...(p.blurb !== undefined && p.blurb.trim().length > 0 ? { blurb: p.blurb.trim() } : {}),
  explicitOnly: !p.rotation,
 }));
}
