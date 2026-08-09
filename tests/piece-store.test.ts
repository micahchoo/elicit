import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { ulid } from 'ulid';
import { createPieceStore } from '../src/piece/store.js';
import type { Entry, Gap, Offer, Pin } from '../src/piece/contract.js';
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

const offer = (id: string, snippet: string): Offer => ({
  id,
  snippet,
  version: 1,
  sourceSitting: 'sit-1',
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
  it('create writes piece.md with an empty body, the entries and the subject in frontmatter, and no current key', () => {
    const store = createPieceStore(root);
    const piece = store.create([pin('e-a', 'snip-1', 1), pin('e-b', 'snip-2', 1)], 'the clock');

    const pieceFile = join(root, 'pieces', piece.id, 'piece.md');
    expect(existsSync(pieceFile)).toBe(true);
    const pieceData = matter.read(pieceFile);
    expect(pieceData.content.trim()).toBe('');
    expect(pieceData.data.subject).toBe('the clock');
    expect((pieceData.data.entries as { id: string }[]).map((e) => e.id)).toEqual(['e-a', 'e-b']);
    // The ordering subsystem's keys are gone from the write (Q-42).
    expect('current' in pieceData.data).toBe(false);
    expect('arrangements' in pieceData.data).toBe(false);
    // No arrangements/ directory is created at all.
    expect(existsSync(join(root, 'pieces', piece.id, 'arrangements'))).toBe(false);
  });

  it('get() round-trips entries, subject, offers, declined and dismissedGaps deep-equal, including entry ids', () => {
    const store = createPieceStore(root);
    writeSnippet(makeSnippet('snip-1', 2));
    const entries: Entry[] = [
      pin('e-a', 'snip-1', 1),
      pin('e-b', 'snip-1', 2),
      { id: 'e-c', placedBy: 'person', question: 'q-id' },
      { id: 'e-d', placedBy: 'model', kind: 'leap', pending: 'what goes between these?' },
    ];
    const piece = store.create(entries, 'the clock');
    const o1 = offer('off-1', 'snip-9');
    store.addOffer(piece.id, o1);
    store.denyOffer(piece.id, 'off-1');
    store.addOffer(piece.id, offer('off-2', 'snip-10'));
    store.dismissGap(piece.id, 'e-d');

    const read = store.get(piece.id);
    expect(read).not.toBeNull();
    expect(read!.id).toBe(piece.id);
    expect(read!.subject).toBe('the clock');
    expect(read!.entries).toEqual([
      pin('e-a', 'snip-1', 1),
      pin('e-b', 'snip-1', 2),
      { id: 'e-c', placedBy: 'person', question: 'q-id' },
    ]);
    // denied offer: gone from offers, its passage durably declined
    expect(read!.offers.map((o) => o.id)).toEqual(['off-2']);
    expect(read!.declined).toEqual(['snip-9']);
    // a model gap is dismissed by (preceding pin's snippet, kind) — the
    // sweep's re-find key, never a fresh-id-vulnerable gap id
    expect(read!.dismissedGaps).toEqual(['snip-1\u0000leap']);
  });

  it('setDown then pickUp leaves frontmatter with no setDownAt key at all; discard writes discardedAt', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'the clock');

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

    // Q-3: discard is a field write — the file stays.
    const discarded = store.discard(piece.id);
    expect(discarded.discardedAt).toBeDefined();
    data = matter.read(join(root, 'pieces', piece.id, 'piece.md')).data;
    expect(typeof data.discardedAt).toBe('string');
    expect(existsSync(join(root, 'pieces', piece.id, 'piece.md'))).toBe(true);
    expect(store.get(piece.id)!.discardedAt).toBe(discarded.discardedAt);
  });

  it('putEntries with an entry carrying a stray text field throws with the guard reason', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'the clock');
    const stray = {
      id: 'e-x',
      kind: 'pin',
      snippet: 'snip-1',
      version: 1,
      text: 'agent prose',
    } as unknown as Entry;

    expect(() => store.putEntries(piece.id, [stray])).toThrow(
      /entry e-x carries a key outside its shape: text/,
    );
  });

  it('putEntries refuses a kind on a person gap and pending on a person gap — model fields only (redesign §6)', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'the clock');

    expect(() =>
      store.putEntries(piece.id, [{ id: 'g-1', placedBy: 'person', kind: 'leap' }]),
    ).toThrow(/model-placed only/);

    expect(() =>
      store.putEntries(piece.id, [{ id: 'g-1', placedBy: 'person', pending: 'words' }]),
    ).toThrow(/never pending/);

    // A model gap with kind and pending is clean — that is the sweep's shape.
    expect(() =>
      store.putEntries(piece.id, [{ id: 'g-1', placedBy: 'model', kind: 'leap', pending: 'words' }]),
    ).not.toThrow();
  });

  it('putEntries on a missing piece id throws', () => {
    const store = createPieceStore(root);
    expect(() => store.putEntries('no-such-piece', [])).toThrow();
  });

  it('putMarginalia replaces the marginalia list whole and refuses a title', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'the clock');
    const notes = [
      { id: 'm-1', on: 'e-a', note: 'role' as const, text: 'sets the scene', at: new Date().toISOString() },
    ];
    store.putMarginalia(piece.id, notes);
    expect(store.get(piece.id)!.marginalia).toEqual(notes);

    const titled = {
      ...notes[0]!,
      title: 'A note',
    } as unknown as (typeof notes)[number];
    expect(() => store.putMarginalia(piece.id, [titled])).toThrow(/title/);
  });

  it('addOffer never offers twice and never re-offers a declined passage', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'the clock');
    store.addOffer(piece.id, offer('off-1', 'snip-9'));
    store.addOffer(piece.id, offer('off-2', 'snip-9')); // same passage, new offer id
    expect(store.get(piece.id)!.offers).toHaveLength(1);
    expect(store.get(piece.id)!.offers[0]!.id).toBe('off-1');

    store.denyOffer(piece.id, 'off-1');
    expect(() => store.addOffer(piece.id, offer('off-3', 'snip-9'))).toThrow(/never re-offered/);
    expect(store.get(piece.id)!.declined).toEqual(['snip-9']);
  });

  it('acceptOffer appends the offered passage as a pin and consumes the offer', () => {
    const store = createPieceStore(root);
    writeSnippet(makeSnippet('snip-9', 1));
    const piece = store.create([pin('e-a', 'snip-9', 1)], 'the clock');
    store.addOffer(piece.id, offer('off-1', 'snip-9'));

    const after = store.acceptOffer(piece.id, 'off-1');
    expect(after.offers).toHaveLength(0);
    const placed = after.entries.at(-1)!;
    expect(placed.kind).toBe('pin');
    if (placed.kind === 'pin') {
      expect(placed.snippet).toBe('snip-9');
      expect(placed.version).toBe(1);
    }

    // A second accept of the same offer id is refused — the offer is gone.
    expect(() => store.acceptOffer(piece.id, 'off-1')).toThrow(/does not exist/);
  });

  it('legacy pieces migrate: the current arrangement becomes the entries, principle notes drop, the rest are ignored but never deleted', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'legacy');
    // Simulate the pre-redesign layout: an arrangements/ directory with two
    // arrangements, one current — with a legacy gap carrying the old
    // `kind: 'gap'` discriminator (which is not a GapKind and must convert).
    const dir = join(root, 'pieces', piece.id, 'arrangements');
    mkdirSync(dir, { recursive: true });
    const currentId = ulid();
    const otherId = ulid();
    const legacyEntries = [
      pin('e-1', 'snip-1', 1),
      { id: 'g-1', kind: 'gap', question: 'q-id' },
      { id: 'g-2', kind: 'gap', pending: 'model words' },
    ];
    writeFileSync(
      join(dir, `${currentId}.md`),
      matter.stringify('', {
        id: currentId,
        principle: 'chronology',
        created: new Date().toISOString(),
        entries: legacyEntries,
        marginalia: [
          { id: 'm-1', on: null, note: 'principle', text: 'ordered as it happened', at: new Date().toISOString() },
          { id: 'm-2', on: 'e-1', note: 'role', text: 'sets the scene', at: new Date().toISOString() },
        ],
      }),
      'utf-8',
    );
    writeFileSync(
      join(dir, `${otherId}.md`),
      matter.stringify('', { id: otherId, principle: 'argument', created: new Date().toISOString(), entries: [] }),
      'utf-8',
    );
    // A fully LEGACY piece.md: no entries key — id/created/current only.
    // (The new store writes entries: [] on create, which would read as the
    // new shape; the legacy layout never had an entries key at all.)
    writeFileSync(
      join(root, 'pieces', piece.id, 'piece.md'),
      matter.stringify('', { id: piece.id, created: new Date().toISOString(), current: currentId }),
      'utf-8',
    );

    const migrated = store.get(piece.id)!;
    // The current arrangement's entries, with the legacy gaps rewritten:
    // the old `kind: 'gap'` discriminator is gone, placedBy derives from
    // pending presence.
    expect(migrated.entries).toEqual([
      pin('e-1', 'snip-1', 1),
      { id: 'g-1', placedBy: 'person', question: 'q-id' },
      { id: 'g-2', placedBy: 'model', pending: 'model words' },
    ]);
    // The principle note described the convicted ordering and does not
    // migrate; the role note survives.
    expect(migrated.marginalia.map((m) => m.note)).toEqual(['role']);
    expect(migrated.subject).toBe('');
    expect(migrated.offers).toEqual([]);
    expect(migrated.declined).toEqual([]);
    // Nothing was deleted (Q-3): both arrangement files are still there.
    expect(readdirSync(dir).sort()).toEqual([`${currentId}.md`, `${otherId}.md`].sort());
  });

  it('the first write to a migrated piece rewrites piece.md in the new shape, and the arrangements dir is never consulted again', () => {
    const store = createPieceStore(root);
    writeSnippet(makeSnippet('snip-2', 1));
    const piece = store.create([], 'legacy');
    const dir = join(root, 'pieces', piece.id, 'arrangements');
    mkdirSync(dir, { recursive: true });
    const currentId = ulid();
    writeFileSync(
      join(dir, `${currentId}.md`),
      matter.stringify('', {
        id: currentId,
        principle: 'chronology',
        created: new Date().toISOString(),
        entries: [pin('e-1', 'snip-1', 1)],
      }),
      'utf-8',
    );
    writeFileSync(
      join(root, 'pieces', piece.id, 'piece.md'),
      matter.stringify('', { id: piece.id, created: new Date().toISOString(), current: currentId }),
      'utf-8',
    );
    expect(store.get(piece.id)!.entries.map((e) => e.id)).toEqual(['e-1']);

    // The next write migrates piece.md permanently.
    const after = store.putEntries(piece.id, [pin('e-2', 'snip-2', 1)]);
    expect(after.entries.map((e) => e.id)).toEqual(['e-2']);
    const data = matter.read(join(root, 'pieces', piece.id, 'piece.md')).data;
    expect((data.entries as { id: string }[]).map((e) => e.id)).toEqual(['e-2']);
    expect('current' in data).toBe(false);

    // The old arrangement file is now inert: change it on disk, re-read —
    // the piece stays on the migrated shape.
    writeFileSync(
      join(dir, `${currentId}.md`),
      matter.stringify('', {
        id: currentId,
        principle: 'chronology',
        created: new Date().toISOString(),
        entries: [pin('e-ghost', 'snip-9', 1)],
      }),
      'utf-8',
    );
    expect(store.get(piece.id)!.entries.map((e) => e.id)).toEqual(['e-2']);
  });

  it('list() on a root with no pieces/ dir returns []', () => {
    const store = createPieceStore(root);
    expect(store.list()).toEqual([]);
  });

  it('putEntries resolves pins against the store root snippets: beyond latest throws, current passes', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'the clock');
    writeSnippet(makeSnippet('snip-a', 1));
    writeSnippet(makeSnippet('snip-a', 2)); // latest is v2

    store.putEntries(piece.id, [pin('e-1', 'snip-a', 2)]);
    expect(store.get(piece.id)!.entries).toEqual([pin('e-1', 'snip-a', 2)]);

    expect(() => store.putEntries(piece.id, [pin('e-2', 'snip-a', 3)])).toThrow(/whose latest is 2/);
    expect(() => store.putEntries(piece.id, [pin('e-3', 'no-such-snippet', 1)])).toThrow(/does not exist/);
  });

  it('dismissGap removes the gap, records the dismissal, and refuses an unknown gap', () => {
    const store = createPieceStore(root);
    writeSnippet(makeSnippet('snip-1', 1));
    const piece = store.create([], 'the clock');
    store.putEntries(piece.id, [
      pin('e-1', 'snip-1', 1),
      { id: 'g-model', placedBy: 'model', kind: 'unclosed', pending: 'how did that end?' },
      { id: 'g-person', placedBy: 'person', question: 'q-id' },
    ]);

    // A person gap keeps its id in dismissedGaps (it is never re-found).
    store.dismissGap(piece.id, 'g-person');
    expect(store.get(piece.id)!.dismissedGaps).toEqual(['g-person']);
    expect(store.get(piece.id)!.entries.map((e) => e.id)).toEqual(['e-1', 'g-model']);

    store.dismissGap(piece.id, 'g-model');
    expect(store.get(piece.id)!.entries.map((e) => e.id)).toEqual(['e-1']);
    expect(store.get(piece.id)!.dismissedGaps).toEqual(['g-person', 'snip-1\u0000unclosed']);

    expect(() => store.dismissGap(piece.id, 'g-gone')).toThrow(/does not exist/);
  });

  it('a migrated model gap keeps its placedBy through a write (the field is load-bearing)', () => {
    const store = createPieceStore(root);
    const piece = store.create([], 'legacy');
    const dir = join(root, 'pieces', piece.id, 'arrangements');
    mkdirSync(dir, { recursive: true });
    const currentId = ulid();
    writeFileSync(
      join(dir, `${currentId}.md`),
      matter.stringify('', {
        id: currentId,
        principle: 'chronology',
        created: new Date().toISOString(),
        entries: [{ id: 'g-1', kind: 'gap', pending: 'model words' }],
      }),
      'utf-8',
    );
    writeFileSync(
      join(root, 'pieces', piece.id, 'piece.md'),
      matter.stringify('', { id: piece.id, created: new Date().toISOString(), current: currentId }),
      'utf-8',
    );

    const migrated = store.get(piece.id)!;
    const gap = migrated.entries[0]! as Gap;
    expect(gap.placedBy).toBe('model');
    expect(gap.pending).toBe('model words');
    expect(gap.kind).toBeUndefined();

    // A write round-trips it without the guards rejecting anything.
    store.setDown(piece.id, 'user');
    const reread = store.get(piece.id)!;
    expect((reread.entries[0] as Gap).placedBy).toBe('model');
  });
});
