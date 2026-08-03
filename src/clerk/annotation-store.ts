// The Clerk's resolved-referent annotations: model-stamped agent prose
// about snippets, kept apart from the person's words.
//
// Ticket 074: an annotation is the Clerk's own sentence naming what a
// dangling "it" in a snippet points at — evidence for the measurement,
// never a gate on anything. These records are DERIVED and disposable:
// re-annotating a snippet's new version overwrites the old record, and
// nothing here keeps history, because an annotation is a reading of the
// text, not the text.
//
// The store lives OUTSIDE the vault — production roots it at
// `data/annotations` — because the vault is the person's record and 074
// forbids the Clerk writing there (Q-3). One file per snippet id, holding
// the CURRENT record.
//
// The wiki store's three rules run through this module unchanged:
//
//   - **Validate before write.** `put` is the last thing between a record
//     and the disk. Every required field must be present and non-empty,
//     the version a positive integer, and the snippet id a ULID — the
//     shape check also kills path traversal, so an id can never escape
//     `annotations/`. A record that fails these checks THROWS: it reached
//     `put` from code, and a store that silently dropped a caller's
//     record would be a store that lies about what it holds.
//   - **No method deletes a file.** There is no `delete` in this module,
//     and that absence is the contract (Q-29).
//   - **Malformed in, skipped out — never repaired.** A hand-edited or
//     half-written file is dropped from `get` with a warning and left on
//     disk byte for byte (the ClaimStore precedent). One bad file must
//     not take down a docket run, and a store that "fixes" a file is a
//     store that can silently invent a referent.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type AnnotationRecord =
  | { kind: 'annotation'; snippetId: string; version: number; expression: string; referent: string; model: string; modelAt: string }
  | { kind: 'silence'; snippetId: string; version: number; model: string; modelAt: string };

export interface AnnotationStore {
  get(snippetId: string): AnnotationRecord | null;
  put(record: AnnotationRecord): void;
  list(): AnnotationRecord[];
}

export function createAnnotationStore(root: string): AnnotationStore {
  return new AnnotationStoreImpl(root);
}

const ANNOTATIONS = 'annotations';

/**
 * Snippet ids are ULIDs. The check is looser than Crockford base32 on
 * purpose — `[A-Z0-9]{26}` is the whole alphabet — and its real job is
 * the boundary: an id containing `/`, `\`, or `.` never reaches the file
 * name, so a hostile id cannot write outside `annotations/`.
 */
const SNIPPET_ID = /^[A-Z0-9]{26}$/;

/** A required string: present, a string, and not just whitespace. */
function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

type Parsed =
  | { ok: true; record: AnnotationRecord }
  | { ok: false; why: string };

/**
 * One validator for both directions of the boundary: `put` throws on a
 * bad record, `get`/`list` warn and skip a bad file. Two copies of the
 * shape would drift; this is the only place the record's invariants live.
 */
function parseRecord(v: unknown): Parsed {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return { ok: false, why: 'record is not a JSON object' };
  }
  const rec = v as Record<string, unknown>;
  const snippetId = text(rec.snippetId);
  const model = text(rec.model);
  const modelAt = text(rec.modelAt);
  if (snippetId === null) return { ok: false, why: 'missing snippetId' };
  if (!SNIPPET_ID.test(snippetId)) {
    return { ok: false, why: `snippetId ${JSON.stringify(snippetId)} is not a 26-char ULID` };
  }
  if (typeof rec.version !== 'number' || !Number.isInteger(rec.version) || rec.version < 1) {
    return { ok: false, why: 'version must be a positive integer' };
  }
  if (model === null) return { ok: false, why: 'missing model' };
  if (modelAt === null) return { ok: false, why: 'missing modelAt' };
  if (rec.kind === 'annotation') {
    const expression = text(rec.expression);
    const referent = text(rec.referent);
    if (expression === null) return { ok: false, why: 'annotation without an expression' };
    if (referent === null) return { ok: false, why: 'annotation without a referent' };
    return {
      ok: true,
      record: { kind: 'annotation', snippetId, version: rec.version, expression, referent, model, modelAt },
    };
  }
  if (rec.kind === 'silence') {
    return { ok: true, record: { kind: 'silence', snippetId, version: rec.version, model, modelAt } };
  }
  return { ok: false, why: `kind is ${JSON.stringify(rec.kind)} — expected annotation or silence` };
}

function warnSkip(path: string, why: string): void {
  console.warn(`AnnotationStore: skipping malformed file ${path} — ${why}`);
}

class AnnotationStoreImpl implements AnnotationStore {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  /** The annotations directory, created on demand — first `put` makes it. */
  #dir(): string {
    const d = join(this.#root, ANNOTATIONS);
    mkdirSync(d, { recursive: true });
    return d;
  }

  #path(snippetId: string): string {
    return join(this.#dir(), `${snippetId}.json`);
  }

  get(snippetId: string): AnnotationRecord | null {
    const path = join(this.#root, ANNOTATIONS, `${snippetId}.json`);
    if (!existsSync(path)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (e) {
      warnSkip(path, `not valid JSON — ${String(e)}`);
      return null;
    }
    const result = parseRecord(parsed);
    if (!result.ok) {
      warnSkip(path, result.why);
      return null;
    }
    return result.record;
  }

  put(record: AnnotationRecord): void {
    const result = parseRecord(record);
    if (!result.ok) {
      throw new Error(`AnnotationStore: refusing to write — ${result.why}`);
    }
    // Write the validated, canonical record — the store owns the shape,
    // and an extra key from a sloppy caller is not an annotation.
    writeFileSync(this.#path(result.record.snippetId), `${JSON.stringify(result.record, null, 2)}\n`, 'utf-8');
  }

  /** Sorted by snippet id, so `list` is deterministic — `readdirSync` order is not. */
  list(): AnnotationRecord[] {
    const dir = join(this.#root, ANNOTATIONS);
    if (!existsSync(dir)) return [];
    const records: AnnotationRecord[] = [];
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()) {
      const path = join(dir, file);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, 'utf-8'));
      } catch (e) {
        warnSkip(path, `not valid JSON — ${String(e)}`);
        continue;
      }
      const result = parseRecord(parsed);
      if (!result.ok) {
        warnSkip(path, result.why);
        continue;
      }
      records.push(result.record);
    }
    return records;
  }
}
