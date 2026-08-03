import { ulid } from 'ulid';
import type { Snippet } from '../types.js';
import type { Pin } from './contract.js';

/**
 * The one Arrangement pass 1 produces, and the reason pass 1 needs no model.
 *
 * Pure and deterministic: the dates arrive through `startedOf` or not at all
 * (Q-59 — a 2018 essay harvested yesterday belongs in 2018, so the sitting's
 * date decides, never the import's). This module never touches the filesystem.
 */
export function chronological(
  snippets: Snippet[],
  startedOf: (session: string) => string | null,
): Pin[] {
  const dated = snippets.map((s) => ({
    s,
    date: startedOf(s.provenance.session) ?? s.captured,
  }));

  // Ascending by sitting start date; ties break on snippet id ascending —
  // ULIDs are monotonic, so the second key is meaningful and the output is
  // byte-for-byte stable across calls.
  dated.sort((a, b) => {
    const byDate = Date.parse(a.date) - Date.parse(b.date);
    if (byDate !== 0) return byDate;
    return a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0;
  });

  // Each pin names the version that is latest at pin time and stays there
  // (Q-5, Q-39 — a pin never tracks a later version).
  return dated.map(({ s }) => ({
    id: ulid(),
    kind: 'pin',
    snippet: s.id,
    version: s.version,
  }));
}
