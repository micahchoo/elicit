/**
 * The gazetteer — a derived, rebuildable entity index (ticket 100).
 *
 * Every person, place, project, or institution named in Snippets becomes
 * a node with aliases, mentioning snippet versions, and the questions that
 * targeted it. The index is derived from snippets and rebuildable (Q-3);
 * it lives outside the vault at `data/gazetteer/entities/` — same pattern
 * as the annotation store, because entity readings are Marginalia-class
 * agent prose, never the person's words.
 *
 * One JSON file per entity (`<entityId>.json`). The file is the truth;
 * reads go to disk every time (Q-3: a restart resumes, nothing is cached).
 *
 * The store's three rules mirror the annotation store and coverage store:
 *   - **Validate before write.** `put` checks id shape (stable slug),
 *     non-empty name, and valid kind.
 *   - **No method deletes a file.** There is no `delete` in this module.
 *   - **Malformed in, skipped out.** A bad file is dropped from `get`/`list`
 *     with a warning and left on disk byte for byte.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What kind of named entity. Open set for future expansion. */
export type EntityKind = 'person' | 'place' | 'project' | 'institution';

/**
 * One entity node in the gazetteer. The id is a stable slug derived from
 * the entity name and kind, e.g. `person-jane-doe`, `place-san-francisco`.
 * Aliases are alternative names or forms the model proposed.
 */
export type GazetteerEntity = {
  id: string;
  name: string;
  kind: EntityKind;
  /** Alternative names or forms — model-proposed, unioned on merge. */
  aliases: string[];
  /** SnippetId@version cites where this entity was mentioned. */
  mentions: string[];
  /** ISO-8601 timestamp of the last write. */
  updatedAt: string;
};

export type GazetteerStore = {
  /** Persist (or overwrite) the entity record. */
  put(entity: GazetteerEntity): void;
  /** The stored entity, or null when no file exists or it is malformed. */
  get(id: string): GazetteerEntity | null;
  /** Every entity on disk, newest file first. */
  list(): GazetteerEntity[];
  /**
   * Entities with mention count at or above the threshold.
   * Sorted by mention count descending — the "most mentioned" first.
   */
  byMentionCount(threshold: number): GazetteerEntity[];
};

export function createGazetteerStore(root: string): GazetteerStore {
  return new GazetteerStoreImpl(root);
}

// ── Validation ──

/** Stable slugs: lowercase alphanumeric, hyphens, dots only (KTG pattern). */
const ID_RE = /^[a-z0-9][a-z0-9.-]*$/;

const VALID_KINDS: Record<string, true> = {
  person: true,
  place: true,
  project: true,
  institution: true,
};

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

type Parsed =
  | { ok: true; entity: GazetteerEntity }
  | { ok: false; why: string };

function parseEntity(v: unknown): Parsed {
  if (v === null || typeof v !== 'object') return { ok: false, why: 'not an object' };
  const o = v as Record<string, unknown>;

  const id = text(o.id);
  if (id === null || !ID_RE.test(id)) return { ok: false, why: `invalid id: ${String(o.id)}` };

  const name = text(o.name);
  if (name === null) return { ok: false, why: `missing or empty name` };

  const kind = text(o.kind);
  if (kind === null || !(kind in VALID_KINDS)) return { ok: false, why: `invalid kind: ${String(o.kind)}` };

  const aliases: string[] = [];
  if (Array.isArray(o.aliases)) {
    for (const a of o.aliases) {
      const t = text(a);
      if (t !== null) aliases.push(t);
    }
  }

  const mentions: string[] = [];
  if (Array.isArray(o.mentions)) {
    for (const m of o.mentions) {
      const t = text(m);
      if (t !== null) mentions.push(t);
    }
  }

  const updatedAt = text(o.updatedAt);
  if (updatedAt === null) return { ok: false, why: `missing or empty updatedAt` };

  return { ok: true, entity: { id, name, kind: kind as EntityKind, aliases, mentions, updatedAt } };
}

function warnSkip(path: string, why: string): void {
  console.warn(`GazetteerStore: skipping malformed file ${path} — ${why}`);
}

// ── Implementation ──

const ENTITIES_DIR = 'entities';

class GazetteerStoreImpl implements GazetteerStore {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #dir(): string {
    return join(this.#root, ENTITIES_DIR);
  }

  #path(id: string): string {
    // Id has already passed the stable-slug check, so it cannot contain
    // path separators — no traversal risk.
    return join(this.#dir(), `${id}.json`);
  }

  put(entity: GazetteerEntity): void {
    // Validate
    if (!ID_RE.test(entity.id)) {
      throw new Error(`GazetteerStore.put: invalid id "${entity.id}"`);
    }
    if (entity.name.trim() === '') {
      throw new Error(`GazetteerStore.put: empty name for ${entity.id}`);
    }
    if (!(entity.kind in VALID_KINDS)) {
      throw new Error(`GazetteerStore.put: invalid kind "${entity.kind}" for ${entity.id}`);
    }

    const dir = this.#dir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(
      this.#path(entity.id),
      JSON.stringify(entity, null, 2) + '\n',
      'utf-8',
    );
  }

  get(id: string): GazetteerEntity | null {
    const path = this.#path(id);
    if (!existsSync(path)) return null;

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      warnSkip(path, 'not valid JSON');
      return null;
    }

    const parsed = parseEntity(raw);
    if (!parsed.ok) {
      warnSkip(path, parsed.why);
      return null;
    }
    return parsed.entity;
  }

  list(): GazetteerEntity[] {
    const dir = this.#dir();
    if (!existsSync(dir)) return [];

    const entities: GazetteerEntity[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5); // strip .json
      const entity = this.get(id);
      if (entity !== null) entities.push(entity);
    }

    // Newest first
    entities.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return entities;
  }

  byMentionCount(threshold: number): GazetteerEntity[] {
    return this.list()
      .filter((e) => e.mentions.length >= threshold)
      .sort((a, b) => b.mentions.length - a.mentions.length);
  }
}
