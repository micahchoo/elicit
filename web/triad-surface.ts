/**
 * The triad chip surface (ticket 159, slice 7): the pure seam behind the
 * exchange screen's chip interaction. people-grid's triads phase declares
 * the 'triads' renderer; the turn response's phase meta carries it plus
 * the three names. When both are present the screen renders the names as
 * tappable chips; anything else falls back to the generic question block,
 * never a crash. The decision and the tap logic live here, DOM-free, so
 * the fallback is testable without a framework.
 */

/** The machine phase meta the turn and drm responses carry (ticket 159):
 *  the phase id/label/step/of, the phase's renderer when it declares one,
 *  and the renderer's payload — 'triads' carries the three names as chips. */
export interface PhaseMetaLike {
 id: string;
 label: string;
 step: number;
 of: number;
 renderer?: string;
 /** The chip surface's names (ticket 159, slice 7): present only while the
  *  active phase declares the 'triads' renderer. */
 triad?: { names: string[] };
}

/**
 * The chip surface decision: the chips render only when the ACTIVE phase
 * declares the 'triads' renderer AND the meta carries the three names. An
 * unknown renderer, a missing renderer, or missing/short names all fall
 * back to the generic question block — the prose answer is always the
 * floor. Mirrors the server's degradation rule (fewer than three named
 * people never reaches a triad question).
 */
export function triadSurface(meta: PhaseMetaLike | null | undefined): { names: string[] } | null {
 if (meta?.renderer !== 'triads') return null;
 const names = meta.triad?.names;
 if (names === undefined || names.length < 3) return null;
 return { names: names.slice(0, 3) };
}

/**
 * The tap logic: a tapped name toggles off when already selected; a new
 * name joins while under the two-chip cap; a third tap is ignored until
 * one of the two is dropped (selection is explicit, never implicit
 * replacement). Pure so the interaction is testable without a DOM.
 */
export function toggleTriad(selected: string[], name: string): string[] {
 if (selected.includes(name)) return selected.filter((n) => n !== name);
 if (selected.length >= 2) return selected;
 return [...selected, name];
}
