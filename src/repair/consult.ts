// Consultation helpers over repair records. Pure — no I/O — so every draw
// point (queue draw, resonance, juxtaposition, composed minting, harvester)
// can ask the same three questions without touching the disk themselves.
//
// Q-106: a repair on ANY version quarantines the whole snippet. The text is
// never edited; lineage is what happened, and these helpers are how the rest
// of the system finds out.

import type { RepairRecord } from '../types.js';

/** A snippet@version or snippetId is under repair if ANY version matches — the whole snippet is quarantined (Q-106). */
export function isUnderRepair(repairs: RepairRecord[], snippetRef: string): boolean {
  const id = snippetRef.split('@')[0]!;
  return repairs.some(r => r.snippetRef.split('@')[0] === id);
}

/** The set of bare snippet ids under repair (for queue entry expiry — strip @version). */
export function repairedSnippetIds(repairs: RepairRecord[]): Set<string> {
  return new Set(repairs.map(r => r.snippetRef.split('@')[0]!));
}

/** The set of full snippetRefs (snippetId@version) under repair. */
function repairedSnippetRefs(repairs: RepairRecord[]): Set<string> {
  return new Set(repairs.map(r => r.snippetRef));
}
