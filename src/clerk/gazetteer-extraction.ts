/**
 * Gazetteer extraction — ticket 100, extracted from server.ts's docket wiring.
 *
 * Reads the gazetteer entity index's existing mention cites, then walks the
 * vault's snippets newest-first (cap live at birth, Q-56: at most 5 per run)
 * and runs the model extraction on each snippet not yet cited. Extracted
 * entities merge into the store: existing entities gain the cite (and any
 * new aliases), new entities are created. A failed extraction is counted,
 * never fatal.
 */
import type { Complete, Vault } from '../types.js';
import type { EventKind } from '../log/kinds.js';
import type { GazetteerStore } from './gazetteer-store.js';
import { extractEntities, entityId } from './gazetteer.js';

/** The docket log sink, narrowed to what this sweep emits. */
export type GazetteerExtractionLog = (e: {
  at: string;
  actor: 'clerk';
  kind: EventKind;
  detail: string;
  refs?: string[];
}) => void;

/** At most this many snippets per run (Q-56 bound, live at birth). */
const EXTRACTION_CAP = 5;

export async function runGazetteerExtraction(deps: {
  vault: Vault;
  store: GazetteerStore;
  complete: Complete;
  modelName: string;
  log: GazetteerExtractionLog;
}): Promise<{ extracted: number; entities: number; failed: number }> {
  const allEntities = deps.store.list();
  const extractedCiteSet = new Set<string>();
  for (const entity of allEntities) {
    for (const m of entity.mentions) extractedCiteSet.add(m);
  }
  const snippets = Object.values(deps.vault.rebuildIndex().snippets);
  let extracted = 0;
  let entities = 0;
  let failed = 0;
  for (const s of snippets.sort((a, b) => b.captured.localeCompare(a.captured))) {
    if (extracted >= EXTRACTION_CAP) break;
    const cite = `${s.id}@${s.version}`;
    if (extractedCiteSet.has(cite)) continue;
    try {
      const result = await extractEntities(s, deps.complete, deps.modelName);
      extracted++;
      for (const ext of result.entities) {
        const id = entityId(ext.kind, ext.name);
        const existing = deps.store.get(id);
        if (existing) {
          // Merge: add mention cite if not already present, union aliases
          if (!existing.mentions.includes(cite)) {
            existing.mentions.push(cite);
          }
          for (const alias of ext.aliases) {
            if (!existing.aliases.includes(alias)) {
              existing.aliases.push(alias);
            }
          }
          existing.updatedAt = new Date().toISOString();
          deps.store.put(existing);
        } else {
          deps.store.put({
            id,
            name: ext.name,
            kind: ext.kind,
            aliases: ext.aliases,
            mentions: [cite],
            updatedAt: new Date().toISOString(),
          });
          entities++;
        }
      }
    } catch {
      failed++;
    }
  }
  return { extracted, entities, failed };
}
