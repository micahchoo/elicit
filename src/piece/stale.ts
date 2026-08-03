import { ulid } from 'ulid';
import type { Snippet } from '../types.js';
import type { Arrangement, Marginalia } from './contract.js';

/**
 * `stale-pin` — one flag per pin that names an older version of its snippet
 * (Q-39's dimmed flag). A pin to a past version can be deliberate — pinning a
 * past self's words is itself diachronic signal — so this lint NEVER re-pins:
 * it adds an annotation and is structurally incapable of changing a pin. The
 * module has no write path and takes no model handle: no model wrote the flag
 * (Q-34), and the Docket can run it on every pass without doing damage (Q-31).
 *
 * Pure and memoryless: the same arrangement and snippet map yield the same
 * findings, in entry order, on every call. Each finding repeats by design —
 * the caller (T10) dedupes by `(on, note)` before writing. `id` and `at` are
 * per-call envelopes; the input arrangement is never mutated.
 */
export function stalePins(a: Arrangement, snippets: Record<string, Snippet>): Marginalia[] {
  const flags: Marginalia[] = [];
  for (const entry of a.entries) {
    if (entry.kind !== 'pin') continue;
    const current = snippets[entry.snippet];
    if (current === undefined) continue;
    if (entry.version >= current.version) continue;
    flags.push({
      id: ulid(),
      on: entry.id,
      note: 'stale-pin',
      text:
        `pinned ${entry.snippet}@${entry.version} while the register now holds ` +
        `${entry.snippet}@${current.version} — the pin stays as pinned; ` +
        'an older pin is a choice, not an error (Q-39)',
      at: new Date().toISOString(),
    });
  }
  return flags;
}
