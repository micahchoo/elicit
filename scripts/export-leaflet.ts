/**
 * Leaflet export — a named door, and the reason it stays shut (Q-57).
 *
 * The feed hands over rendered HTML. The three quotations that nearly
 * entered the 2017-2026 corpus were catchable only because the markdown
 * source preserved inline citation structure — one of them had neither
 * quote marks nor its own citation and survived scrutiny only because the
 * adjacent paragraph was still a paragraph. Rendered output flattens the
 * structure that catch depends on, so a fetcher would import someone
 * else's sentence as the user's and be structurally incapable of noticing.
 *
 * What this script owes: each source's authorship question is answered by
 * the human who writes that script (Q-51), which is why there is no
 * generic exporter.
 *
 * Not built yet. The door has a name so the ruling cannot erode quietly
 * into "just this one fetcher".
 */

/** Export one source's corpus to a folder. Never wired; see the header. */
export function exportToFolder(_out: string): Promise<void> {
  throw new Error('not built — see Q-57');
}
