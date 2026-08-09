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

/** The max repair `at` per bare snippet id (wave 5 — the since-last-read lens
 * needs the repair DATE, not just the taint: `repairClaims[id].at > lastRead`
 * is what makes a claim full-ink again). Same strip-@version rule as the set. */
export function repairAtsById(repairs: RepairRecord[]): Map<string, string> {
  const ats = new Map<string, string>();
  for (const r of repairs) {
    const id = r.snippetRef.split('@')[0]!;
    const prev = ats.get(id);
    if (prev === undefined || r.at > prev) ats.set(id, r.at);
  }
  return ats;
}

/** The set of full snippetRefs (snippetId@version) under repair. */
function repairedSnippetRefs(repairs: RepairRecord[]): Set<string> {
  return new Set(repairs.map(r => r.snippetRef));
}
