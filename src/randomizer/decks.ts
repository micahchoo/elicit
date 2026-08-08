/**
 * Deck loading — the first of Q-18's two draw channels.
 *
 * Two sources, because the tree has two and neither is redundant:
 *
 *   - `data/decks/*.jsonl` — what ticket 004 and then 042 actually produced:
 *     371 entries harvested from public are.na channels and filtered by
 *     `scripts/curate-deck.ts`. They ship with the repo, they are regenerable
 *     from that script, and they are not the person's private material.
 *   - `<vault>/decks/*.md` — a deck the person writes by hand, in markdown,
 *     read with `gray-matter` exactly as `src/vault/vault.ts` reads every
 *     other vault file. This is where Q-3 lands, and it is the literal
 *     "user-curated deck" of Q-18.
 *
 * A vault deck REPLACES a shipped deck of the same name rather than merging
 * with it. Q-18's authority note on ticket 004 says the user retains prune
 * authority over a delegated curation; overwriting by name is what exercising
 * that authority looks like from the person's side — write the file, and the
 * agent's version of that deck stops being dealt.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { DeckEntry, Facet } from '../types.js';
import { FACETS } from '../queue/facet-balance.js';

/** Where the shipped decks live, relative to the repo root. */
export const DEFAULT_DECK_DIR = 'data/decks';

/** Where a person's own decks live inside the vault. */
export const VAULT_DECK_DIR = 'decks';

/**
 * The facets a deck card may target: the durable life-material facets only.
 * `momentary-state` (a transient feeling — no standing question targets it) and
 * the knowledge-practice facets (`habit`, `know-what`, `know-how`, `know-why`)
 * are excluded from the canonical FACETS rather than listed here by hand, so a
 * Facet added upstream reaches decks automatically.
 */
const DECK_FACETS: ReadonlySet<string> = new Set<string>(
  FACETS.filter(
    (f) => f !== 'momentary-state' && f !== 'habit' && f !== 'know-what' && f !== 'know-how' && f !== 'know-why',
  ),
);

function asFacet(v: unknown): Facet | undefined {
  return typeof v === 'string' && DECK_FACETS.has(v) ? (v as Facet) : undefined;
}

function listFiles(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
  } catch {
    return [];
  }
}

/**
 * Read the shipped JSONL decks. Malformed lines are skipped rather than
 * failing the file — same stance as `src/elicitor/bank.ts`, and for the same
 * reason: a deck with a bad line is still a deck.
 *
 * The deck name comes from the FILE, not from the row's `deck` field. The row
 * carries one too, and a mismatch would give two names to one deck and split
 * the cooldown key; the filename is the one an operator can see.
 */
export function loadJsonlDecks(dir: string): DeckEntry[] {
  const entries: DeckEntry[] = [];
  for (const file of listFiles(dir, '.jsonl')) {
    const deck = file.slice(0, -'.jsonl'.length);
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      const question = typeof row.question === 'string' ? row.question.trim() : '';
      if (!question) continue;
      const facet = asFacet(row.targetFacet);
      // Conditional spread throughout: a present key holding `undefined` is a
      // different thing from a missing key, and it throws the moment an entry
      // is written back through `matter.stringify`.
      entries.push({
        question,
        channel: typeof row.channel === 'string' ? row.channel : deck,
        blockId: typeof row.blockId === 'number' ? row.blockId : entries.length + 1,
        deck,
        curatedBy: typeof row.curatedBy === 'string' ? row.curatedBy : 'unknown',
        ...(typeof row.channelTitle === 'string' ? { channelTitle: row.channelTitle } : {}),
        ...(facet ? { targetFacet: facet } : {}),
      });
    }
  }
  return entries;
}

/**
 * Read the person's own decks from vault markdown.
 *
 * One file per deck. Frontmatter names the deck and who curated it; the body
 * is prose the person may write anything into, and every line that begins a
 * markdown list item is one question. Everything else in the body — headings,
 * notes to self, blank lines — is ignored, so the file stays a page of text
 * rather than a data format wearing markdown.
 *
 *     ---
 *     deck: mornings
 *     curatedBy: hand
 *     targetFacet: episode      # optional, applies to the whole deck
 *     ---
 *
 *     - What did you notice first today?
 *     - Which room did you avoid?
 *
 * `blockId` is the question's 1-based position in the file. The cooldown needs
 * a stable key per card and a hand-written deck has no are.na block behind it;
 * position is stable as long as the person only appends, and a reordered deck
 * costs at worst one early repeat.
 */
export function loadVaultDecks(root: string): DeckEntry[] {
  const dir = join(root, VAULT_DECK_DIR);
  const entries: DeckEntry[] = [];
  for (const file of listFiles(dir, '.md')) {
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter.read(join(dir, file));
    } catch {
      continue;
    }
    const data = parsed.data as Record<string, unknown>;
    const deck = typeof data.deck === 'string' ? data.deck : file.slice(0, -'.md'.length);
    const curatedBy = typeof data.curatedBy === 'string' ? data.curatedBy : 'user';
    const facet = asFacet(data.targetFacet);
    let position = 0;
    for (const line of parsed.content.split('\n')) {
      const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
      if (!m) continue;
      position++;
      entries.push({
        question: m[1]!,
        channel: `vault:${deck}`,
        blockId: position,
        deck,
        curatedBy,
        ...(facet ? { targetFacet: facet } : {}),
      });
    }
  }
  return entries;
}

/**
 * Every deck available to the draw. Vault decks win by name — see the note at
 * the top of this file.
 */
export function loadDecks(opts?: { deckDir?: string; vaultRoot?: string }): DeckEntry[] {
  const shipped = loadJsonlDecks(opts?.deckDir ?? DEFAULT_DECK_DIR);
  const mine = opts?.vaultRoot ? loadVaultDecks(opts.vaultRoot) : [];
  const overridden = new Set(mine.map((e) => e.deck));
  return [...shipped.filter((e) => !overridden.has(e.deck)), ...mine];
}

/** The cooldown key for one card. Stable across restarts, unique per deck. */
export function deckCardRef(e: DeckEntry): string {
  return `deck:${e.deck}:${e.blockId}`;
}
