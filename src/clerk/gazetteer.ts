/**
 * Gazetteer entity extraction — ticket 100.
 *
 * One model call per snippet: the Clerk's careful model reads a Snippet
 * and names every person, place, project, and institution it finds.
 * Each extraction carries a model stamp (Q-34) and is Marginalia-class
 * agent prose — never the person's words, never quotable into a Piece.
 *
 * The extraction returns entities as structured records; the caller
 * (the docket job) merges them into the GazetteerStore — naming is
 * extraction, storage is the docket's job, and the two are separate
 * for the same reason `annotate.ts` returns records rather than
 * writing them itself (Q-36: generation is free, validation is rigid).
 */

import type { Complete, Snippet } from '../types.js';
import type { EntityKind } from './gazetteer-store.js';

/** One entity the model found in a snippet. */
export type EntityExtraction = {
  /** The canonical name the model assigns. */
  name: string;
  /** What kind of entity. */
  kind: EntityKind;
  /** Alternative names or forms — model-proposed, unioned on merge. */
  aliases: string[];
};

/** The model's extraction result for one snippet. */
export type ExtractionResult = {
  /** The snippet this extraction reads. */
  snippetId: string;
  /** The snippet version at extraction time. */
  version: number;
  /** Entities found, or empty when the model found none. */
  entities: EntityExtraction[];
  /** Which model produced this — the stamp (Q-34). */
  model: string;
  /** ISO-8601 timestamp of the extraction. */
  modelAt: string;
};

/**
 * Derive a stable entity id from kind and name.
 * Stable slugs: kind-slugified-name, using KTG's id regex pattern.
 */
export function entityId(kind: EntityKind, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return `${kind}-${slug}`;
}

// ── The prompt ──

const EXTRACTION_SYSTEM =
  'You read a passage and name every person, place, project, and ' +
  'institution it mentions. A "project" is a named effort or undertaking; ' +
  'an "institution" is a named organization or company. Include aliases ' +
  '(nicknames, abbreviations, alternate forms) when the text uses them. ' +
  'Reply with ONLY valid JSON: an object with an "entities" array. ' +
  'Each entity has "name", "kind" (one of person/place/project/institution), ' +
  'and "aliases" (string array). If you find no entities, return ' +
  '{"entities": []}. Never include commentary outside the JSON.';

// ── The call ──

/**
 * Extract named entities from a snippet. Makes at most one model call.
 * Returns the extraction result with model stamp, or throws on failure.
 */
export async function extractEntities(
  snippet: Snippet,
  complete: Complete,
  modelName: string,
): Promise<ExtractionResult> {
  const now = new Date().toISOString();

  const text = (await complete(EXTRACTION_SYSTEM, [{
    role: 'user' as const,
    text: snippet.prose,
    at: now,
  }], { temperature: 0.1 })) ?? '';

  let entities: EntityExtraction[] = [];

  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed?.entities)) {
      for (const e of parsed.entities) {
        if (e === null || typeof e !== 'object') continue;
        const name = typeof e.name === 'string' ? e.name.trim() : '';
        if (name === '') continue;
        const kind = typeof e.kind === 'string' ? e.kind.trim().toLowerCase() : '';
        if (kind !== 'person' && kind !== 'place' && kind !== 'project' && kind !== 'institution') continue;
        const aliases: string[] = [];
        if (Array.isArray(e.aliases)) {
          for (const a of e.aliases) {
            if (typeof a === 'string' && a.trim() !== '') {
              aliases.push(a.trim());
            }
          }
        }
        entities.push({ name, kind: kind as EntityKind, aliases });
      }
    }
  } catch {
    // Model returned non-JSON — treat as no entities found.
  }

  return {
    snippetId: snippet.id,
    version: snippet.version,
    entities,
    model: modelName,
    modelAt: now,
  };
}
