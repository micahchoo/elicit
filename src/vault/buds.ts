/**
 * The buds/ layout — one store for the Bud annotations (Q-6).
 *
 * The vault's write custody is centralized (saveBud, src/vault/vault.ts),
 * but the read side was not: import/repair.ts hand-rolled matter.read of
 * `{root}/buds/<id>.md` to quote a deferred dangler's question. Buds are
 * Marginalia-class (Q-6, Q-8): agent annotations beside the corpus, never
 * Snippets, never in a Piece — this module owns the layout's read side.
 */
import { join } from 'node:path';
import matter from 'gray-matter';

/** One Bud's prose, or null when it is missing or unreadable. */
export function readBud(root: string, id: string): { fragment: string } | null {
  try {
    const parsed = matter.read(join(root, 'buds', `${id}.md`));
    return { fragment: parsed.content.trim() };
  } catch {
    return null;
  }
}
