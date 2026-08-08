import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { createAnnotationStore } from '../src/clerk/annotation-store.js';
import type { AnnotationRecord } from '../src/clerk/annotation-store.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-annotations-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const id = (): string => ulid();

const annotation = (snippetId: string, version = 1): AnnotationRecord => ({
  kind: 'annotation',
  snippetId,
  version,
  expression: 'it',
  referent: 'the reading from Tuesday',
  model: 'test-model',
  modelAt: '2026-08-02T00:00:00.000Z',
});

const silence = (snippetId: string, version = 1): AnnotationRecord => ({
  kind: 'silence',
  snippetId,
  version,
  model: 'test-model',
  modelAt: '2026-08-02T00:00:00.000Z',
});

describe('createAnnotationStore', () => {
  it('round-trips an annotation record to disk', () => {
    const store = createAnnotationStore(root);
    const rec = annotation(id());
    store.put(rec);
    // First put created the annotations dir and the one-file-per-id layout.
    expect(existsSync(join(root, 'annotations', `${rec.snippetId}.json`))).toBe(true);
    expect(store.get(rec.snippetId)).toEqual(rec);
  });

  it('round-trips a silence record to disk', () => {
    const store = createAnnotationStore(root);
    const rec = silence(id());
    store.put(rec);
    expect(store.get(rec.snippetId)).toEqual(rec);
  });

  it('returns null for a snippet with no record', () => {
    const store = createAnnotationStore(root);
    expect(store.get(id())).toBeNull();
  });

  it('returns an empty list from a fresh store', () => {
    const store = createAnnotationStore(root);
    expect(store.list()).toEqual([]);
  });

  it('overwrites the current record for the same snippet (no history)', () => {
    const store = createAnnotationStore(root);
    const snippetId = id();
    store.put(annotation(snippetId, 1));
    const newer: AnnotationRecord = {
      kind: 'annotation',
      snippetId,
      version: 2,
      expression: 'the project',
      referent: 'the second reading',
      model: 'test-model',
      modelAt: '2026-08-02T01:00:00.000Z',
    };
    store.put(newer);
    expect(store.get(snippetId)).toEqual(newer);
    expect(readdirSync(join(root, 'annotations'))).toHaveLength(1);
  });

  it('skips a file that is not valid JSON with a warning and leaves it on disk', () => {
    const store = createAnnotationStore(root);
    const snippetId = id();
    const dir = join(root, 'annotations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${snippetId}.json`), '{ not json', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(store.get(snippetId)).toBeNull();
      expect(warn).toHaveBeenCalled();
      // Never repaired — byte for byte where the writer left it.
      expect(readFileSync(join(dir, `${snippetId}.json`), 'utf-8')).toBe('{ not json');
    } finally {
      warn.mockRestore();
    }
  });

  it('skips a file that parses but fails validation, with a warning', () => {
    const store = createAnnotationStore(root);
    const snippetId = id();
    const dir = join(root, 'annotations');
    mkdirSync(dir, { recursive: true });
    // Valid JSON, but an annotation with no expression and a bad version.
    writeFileSync(
      join(dir, `${snippetId}.json`),
      JSON.stringify({ kind: 'annotation', snippetId, version: 0, referent: 'x', model: 'm', modelAt: 't' }),
      'utf-8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(store.get(snippetId)).toBeNull();
      expect(warn).toHaveBeenCalled();
      expect(store.list()).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('throws on a record with a missing required field', () => {
    const store = createAnnotationStore(root);
    const snippetId = id();
    const missingExpression = {
      kind: 'annotation',
      snippetId,
      version: 1,
      referent: 'x',
      model: 'm',
      modelAt: 't',
    } as unknown as AnnotationRecord;
    expect(() => store.put(missingExpression)).toThrow();
    const missingModel = { kind: 'silence', snippetId, version: 1, modelAt: 't' } as unknown as AnnotationRecord;
    expect(() => store.put(missingModel)).toThrow();
    // Nothing reached disk.
    expect(existsSync(join(root, 'annotations'))).toBe(false);
  });

  it('throws on a non-positive version', () => {
    const store = createAnnotationStore(root);
    expect(() => store.put({ ...annotation(id()), version: 0 })).toThrow();
    expect(() => store.put({ ...annotation(id()), version: -1 })).toThrow();
    expect(() => store.put({ ...annotation(id()), version: 1.5 })).toThrow();
  });

  it('throws on a non-ULID or path-traversal snippet id', () => {
    const store = createAnnotationStore(root);
    expect(() => store.put({ ...annotation('not-a-ulid') })).toThrow();
    expect(() => store.put({ ...annotation('../../etc/passwd') })).toThrow();
    expect(() => store.put({ ...annotation('') })).toThrow();
    // A hostile id wrote nothing outside the store.
    expect(existsSync(join(root, 'etc'))).toBe(false);
  });

  it('lists records sorted by snippet id', () => {
    const store = createAnnotationStore(root);
    // Known ids in a deliberate non-sorted insertion order: C, A, B.
    const a = 'AAAAAAAAAAAAAAAAAAAAAAAAAA';
    const b = 'BBBBBBBBBBBBBBBBBBBBBBBBBB';
    const c = 'CCCCCCCCCCCCCCCCCCCCCCCCCC';
    store.put(silence(c));
    store.put(annotation(a));
    store.put(silence(b));
    expect(store.list().map((r) => r.snippetId)).toEqual([a, b, c]);
  });

  const intentionHorizon = (snippetId: string, version = 1, horizon: 'now' | 'session' | 'days' = 'days'): AnnotationRecord => ({
    kind: 'intention-horizon',
    snippetId,
    version,
    horizon,
    model: 'test-model',
    modelAt: '2026-08-02T00:00:00.000Z',
  });

  it('round-trips an intention-horizon-ambiguous record in its own namespace', () => {
    const store = createAnnotationStore(root);
    const sid = id();
    store.put({
      kind: 'intention-horizon-ambiguous',
      snippetId: sid,
      version: 2,
      datingQuestion: 'When did you expect to finish?',
      model: 'test-model',
      modelAt: '2026-08-02T00:00:00.000Z',
    });
    const got = store.get(sid, 'intention-horizon-ambiguous');
    expect(got).not.toBeNull();
    if (got && got.kind === 'intention-horizon-ambiguous') {
      expect(got.datingQuestion).toBe('When did you expect to finish?');
      expect(got.version).toBe(2);
    }
    // The ambiguous record must NOT collide with the referent or horizon namespaces.
    expect(store.get(sid)).toBeNull();
    expect(store.get(sid, 'intention-horizon')).toBeNull();
  });

  it('round-trips an intention-horizon record', () => {
    const store = createAnnotationStore(root);
    const sid = id();
    store.put(intentionHorizon(sid));
    const got = store.get(sid, 'intention-horizon');
    expect(got).not.toBeNull();
    expect(got!.kind).toBe('intention-horizon');
    expect(got!.snippetId).toBe(sid);
    if (got && got.kind === 'intention-horizon') {
      expect(got.horizon).toBe('days');
    }
  });

  it('keeps intention-horizon and referent annotations separate for one snippet', () => {
    const store = createAnnotationStore(root);
    const sid = id();
    store.put(annotation(sid));
    store.put(intentionHorizon(sid));
    // Default get reads referent annotation
    const ref = store.get(sid);
    expect(ref).not.toBeNull();
    expect(ref!.kind).toBe('annotation');
    // Kind-specific get reads intention-horizon
    const ih = store.get(sid, 'intention-horizon');
    expect(ih).not.toBeNull();
    expect(ih!.kind).toBe('intention-horizon');
  });

  it('returns null for intention-horizon when only a referent record exists', () => {
    const store = createAnnotationStore(root);
    const sid = id();
    store.put(annotation(sid));
    expect(store.get(sid, 'intention-horizon')).toBeNull();
  });

  it('lists intention-horizon records separately', () => {
    const store = createAnnotationStore(root);
    const a = 'AAAAAAAAAAAAAAAAAAAAAAAAAA';
    const b = 'BBBBBBBBBBBBBBBBBBBBBBBBBB';
    store.put(annotation(a));
    store.put(intentionHorizon(b));
    // list() with no kind: both records
    expect(store.list().length).toBe(2);
    // list('intention-horizon'): only the horizon record
    const ihList = store.list('intention-horizon');
    expect(ihList.length).toBe(1);
    expect(ihList[0]!.snippetId).toBe(b);
  });
  it('overwrites intention-horizon record for same snippet (no history)', () => {
    const store = createAnnotationStore(root);
    const sid = id();
    store.put(intentionHorizon(sid, 1));
    store.put(intentionHorizon(sid, 2, 'now'));
    const got = store.get(sid, 'intention-horizon');
    expect(got).not.toBeNull();
    if (got && got.kind === 'intention-horizon') {
      expect(got.horizon).toBe('now');
      expect(got.version).toBe(2);
    }
  });


  it('throws on an intention-horizon record with invalid horizon', () => {
    const store = createAnnotationStore(root);
    expect(() =>
      store.put({ kind: 'intention-horizon', snippetId: id(), version: 1, horizon: 'never' as unknown as 'now', model: 'x', modelAt: 'x' as unknown as string }),
    ).toThrow();
  });
});
