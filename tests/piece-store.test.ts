import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ulid } from 'ulid';
import { createPieceStore } from '../src/piece/store.js';
import type { Arrangement, ArrangementEntry, Pin } from '../src/piece/contract.js';
import type { Snippet } from '../src/types.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piece-store-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const pin = (id: string, snippet: string, version: number): Pin => ({
  id,
  kind: 'pin',
  snippet,
  version,
});

const arrangement = (entries: ArrangementEntry[]): Arrangement => ({
  id: ulid(),
  principle: 'chronology',
  entries,
  marginalia: [],
  created: new Date().toISOString(),
});

/** Writes a Snippet version file under <root>/snippets, the vault's layout. */
function writeSnippet(version: Snippet): void {
  const dir = join(root, 'snippets', version.id);
  mkdirSync(dir, { recursive: true });
  const fm = {
    id: version.id,
    version: version.version,
    captured: version.captured,
    provenance: version.provenance,
  };
  writeFileSync(join(dir, `v${version.version}.md`), matter.stringify(version.prose, fm), 'utf-8');
}

const makeSnippet = (id: string, version: number): Snippet => ({
  id,
  version,
  captured: new Date().toISOString(),
  provenance: { kind: 'harvest', session: 'sit-1', question: 'q', questionForm: 'theoretical' },
  prose: `prose of ${id} v${version}`,
});

describe('createPieceStore', () => {
  it('create writes piece.md and one arrangement file, both with empty bodies', () => {
    const store = createPieceStore(root);
    const piece = store.create([pin('e-a', 'snip-1', 1), pin('e-b', 'snip-2', 1)]);

    const pieceFile = join(root, 'pieces', piece.id, 'piece.md');
    expect(existsSync(pieceFile)).toBe(true);
    const pieceData = matter.read(pieceFile);
    expect(pieceData.content.trim()).toBe('');
    expect(pieceData.data.current).toBe(piece.current);

    const arrangementFiles = readdirSync(join(root, 'pieces', piece.id, 'arrangements'));
    expect(arrangementFiles).toHaveLength(1);
    const arrangementData = matter.read(
      join(root, 'pieces', piece.id, 'arrangements', arrangementFiles[0]!),
    );
    expect(arrangementData.content.trim()).toBe('');
  });

  it('get() round-trips entries deep-equal, including entry ids', () => {
    const store = createPieceStore(root);
    const entries: ArrangementEntry[] = [
      pin('e-a', 'snip-1', 1),
      pin('e-b', 'snip-1', 2),
      pin('e-c', 'snip-2', 1),
    ];
    const piece = store.create(entries);

    const read = store.get(piece.id);
    expect(read).not.toBeNull();
    expect(read!.id).toBe(piece.id);
    expect(read!.arrangements).toHaveLength(1);
    expect(read!.arrangements[0]!.entries).toEqual(entries);
  });

  it('setDown then pickUp leaves frontmatter with no setDownAt key at all', () => {
    const store = createPieceStore(root);
    const piece = store.create([]);

    store.setDown(piece.id, 'user');
    let data = matter.read(join(root, 'pieces', piece.id, 'piece.md')).data;
    expect(typeof data.setDownAt).toBe('string');
    expect(data.setDownBy).toBe('user');

    const picked = store.pickUp(piece.id);
    expect(picked.setDownAt).toBeUndefined();
    expect(picked.setDownBy).toBeUndefined();
    data = matter.read(join(root, 'pieces', piece.id, 'piece.md')).data;
    expect('setDownAt' in data).toBe(false);
    expect('setDownBy' in data).toBe(false);
  });

  it('putArrangement with an entry carrying a stray text field throws with the guard reason', () => {
    const store = createPieceStore(root);
    const piece = store.create([]);
    const stray = {
      id: 'e-x',
      kind: 'pin',
      snippet: 'snip-1',
      version: 1,
      text: 'agent prose',
    } as unknown as ArrangementEntry;

    expect(() => store.putArrangement(piece.id, arrangement([stray]))).toThrow(
      /entry e-x carries a key outside its shape: text/,
    );
  });

  it('putArrangement on a missing piece id throws', () => {
    const store = createPieceStore(root);
    expect(() => store.putArrangement('no-such-piece', arrangement([]))).toThrow();
  });

  it('setCurrent refuses an arrangement id that is not on disk', () => {
    const store = createPieceStore(root);
    const piece = store.create([]);
    expect(() => store.setCurrent(piece.id, 'ghost-arrangement')).toThrow();
  });

  it('a piece with three arrangements round-trips all three and current names the right one', () => {
    const store = createPieceStore(root);
    const piece = store.create([]);
    const second = { ...arrangement([]), principle: 'argument' as const };
    const third = { ...arrangement([]), principle: 'contrast' as const };
    store.addArrangement(piece.id, second);
    store.addArrangement(piece.id, third);
    store.setCurrent(piece.id, third.id);

    const read = store.get(piece.id)!;
    // ULIDs minted in the same millisecond share their time prefix and sort
    // by random suffix, so compare as sets — the contract is that all three
    // round-trip, not their array order.
    expect(read.arrangements.map((a) => a.id).sort()).toEqual(
      [piece.current, second.id, third.id].sort(),
    );
    expect(read.arrangements.map((a) => a.principle).sort()).toEqual(
      ['chronology', 'argument', 'contrast'].sort(),
    );
    expect(read.arrangements).toHaveLength(3);
    expect(read.current).toBe(third.id);
    expect(store.list().map((p) => p.id)).toEqual([piece.id]);
  });

  it('list() on a root with no pieces/ dir returns []', () => {
    const store = createPieceStore(root);
    expect(store.list()).toEqual([]);
  });

  it('putArrangement resolves pins against the store root snippets: beyond latest throws, current passes', () => {
    const store = createPieceStore(root);
    const piece = store.create([]);
    writeSnippet(makeSnippet('snip-a', 1));
    writeSnippet(makeSnippet('snip-a', 2)); // latest is v2

    const good = arrangement([pin('e-1', 'snip-a', 2)]);
    store.putArrangement(piece.id, good);
    expect(store.get(piece.id)!.arrangements.map((a) => a.id).sort()).toEqual(
      [piece.current, good.id].sort(),
    );

    const beyondLatest = arrangement([pin('e-2', 'snip-a', 3)]);
    expect(() => store.putArrangement(piece.id, beyondLatest)).toThrow(/whose latest is 2/);

    const unknownSnippet = arrangement([pin('e-3', 'no-such-snippet', 1)]);
    expect(() => store.putArrangement(piece.id, unknownSnippet)).toThrow(/does not exist/);
  });
});
