import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type { Snippet } from '../types.js';
import { noProse, noTitle, pinsResolve } from './contract.js';
import type { Entry, Gap, Marginalia, Offer, Piece, PieceStore, Pin } from './contract.js';

/**
 * Create the piece store. `snippets` is the vault's snippet map (the index
 * rebuild), injected at construction so pin validation and the vault read the
 * same markdown truth (Q-3) — production always injects, so the store never
 * scans the snippets layout itself. The optional form keeps callers that do
 * not validate pins (tests, list-only paths) from building a map.
 */
export function createPieceStore(
  root: string,
  opts?: { snippets: Record<string, Snippet> | (() => Record<string, Snippet>) },
): PieceStore {
  return new PieceStoreImpl(root, opts?.snippets);
}

/**
 * The markdown is the truth (Q-3): every piece is `pieces/<id>/piece.md`
 * frontmatter with an EMPTY body — id, created, subject, entries, offers,
 * declined, dismissedGaps, marginalia and the reversibility facts. Nothing
 * here ever deletes a file (Q-41); set-down is a reversible frontmatter
 * fact, and discard is a frontmatter field, not a deletion (Q-3).
 */
class PieceStoreImpl implements PieceStore {
  #root: string;
  /** The injected snippet source: a live resolver or a fixed map; undefined scans lazily. */
  #snippetSource: Record<string, Snippet> | (() => Record<string, Snippet>) | undefined;

  constructor(
    root: string,
    snippets?: Record<string, Snippet> | (() => Record<string, Snippet>),
  ) {
    this.#root = root;
    this.#snippetSource = snippets;
  }

  /** The pin-validation ground truth: resolved live, else a lazy scan. */
  get #snippets(): Record<string, Snippet> {
    if (typeof this.#snippetSource === 'function') return this.#snippetSource();
    if (this.#snippetSource !== undefined) return this.#snippetSource;
    return this.#scanSnippets();
  }

  /** Fallback scan when no map was injected (legacy callers/tests). */
  #scanSnippets(): Record<string, Snippet> {
    const dir = join(this.#root, 'snippets');
    if (!existsSync(dir)) return {};
    const snippets: Record<string, Snippet> = {};
    for (const dirName of readdirSync(dir)) {
      const snippetDir = join(dir, dirName);
      if (!statSync(snippetDir).isDirectory()) continue;
      const files = readdirSync(snippetDir)
        .filter((f) => /^v\d+\.md$/.test(f))
        .sort((a, b) => {
          const va = Number(a.match(/^v(\d+)\.md$/)![1]);
          const vb = Number(b.match(/^v(\d+)\.md$/)![1]);
          return vb - va; // newest first
        });
      const newest = files[0];
      if (!newest) continue;
      const parsed = matter.read(join(snippetDir, newest));
      const data = parsed.data as {
        id: string;
        version: number;
        captured: string;
        provenance: Snippet['provenance'];
      };
      snippets[data.id] = {
        id: data.id,
        version: data.version,
        captured: data.captured,
        provenance: data.provenance,
        prose: parsed.content.trimEnd(),
      };
    }
    return snippets;
  }

  #piecesDir(): string {
    return join(this.#root, 'pieces');
  }

  #pieceDir(id: string): string {
    return join(this.#piecesDir(), id);
  }

  /** Legacy layout only: the pre-redesign arrangements/ directory. */
  #arrangementsDir(id: string): string {
    return join(this.#pieceDir(id), 'arrangements');
  }

  create(entries: Entry[], subject: string): Piece {
    const id = ulid();
    const created = new Date().toISOString();
    // `create` has no snippets map by interface, so pinsResolve is not run —
    // the two shape guards are.
    const first = noProse(entries) ?? noTitle(entries, []);
    if (first) throw new Error(first);

    mkdirSync(this.#pieceDir(id), { recursive: true });
    const piece: Piece = {
      id,
      created,
      subject,
      entries,
      offers: [],
      declined: [],
      dismissedGaps: [],
      marginalia: [],
    };
    this.#writePiece(id, piece);
    return piece;
  }

  get(id: string): Piece | null {
    if (!existsSync(join(this.#pieceDir(id), 'piece.md'))) return null;
    return this.#pieceFromDisk(id);
  }

  list(): Piece[] {
    const dir = this.#piecesDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((entry) => statSync(join(dir, entry)).isDirectory())
      .map((entry) => this.get(entry))
      .filter((p): p is Piece => p !== null);
  }

  putEntries(pieceId: string, entries: Entry[]): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    const first =
      noProse(entries) ?? noTitle(entries, piece.marginalia) ?? pinsResolve(entries, this.#snippets);
    if (first) throw new Error(first);
    piece.entries = entries;
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  putMarginalia(pieceId: string, marginalia: Marginalia[]): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    const first = noTitle(piece.entries, marginalia);
    if (first) throw new Error(first);
    piece.marginalia = marginalia;
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  addOffer(pieceId: string, offer: Offer): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    // Denial is durable: a declined passage is never re-offered (Q-39).
    if (piece.declined.includes(offer.snippet)) {
      throw new Error(`snippet ${offer.snippet} was declined and is never re-offered`);
    }
    if (!piece.offers.some((o) => o.snippet === offer.snippet)) {
      piece.offers.push(offer);
      this.#writePiece(pieceId, piece);
    }
    return this.#pieceFromDisk(pieceId);
  }

  acceptOffer(pieceId: string, offerId: string): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    const at = piece.offers.findIndex((o) => o.id === offerId);
    if (at === -1) throw new Error(`offer ${offerId} does not exist`);
    const offer = piece.offers[at]!;
    const pin: Pin = { id: ulid(), kind: 'pin', snippet: offer.snippet, version: offer.version };
    const entries = [...piece.entries, pin];
    const first =
      noProse(entries) ?? noTitle(entries, piece.marginalia) ?? pinsResolve(entries, this.#snippets);
    if (first) throw new Error(first);
    piece.offers.splice(at, 1);
    piece.entries = entries;
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  denyOffer(pieceId: string, offerId: string): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    const at = piece.offers.findIndex((o) => o.id === offerId);
    if (at === -1) throw new Error(`offer ${offerId} does not exist`);
    const snippet = piece.offers[at]!.snippet;
    piece.offers.splice(at, 1);
    if (!piece.declined.includes(snippet)) piece.declined.push(snippet);
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  dismissGap(pieceId: string, gapId: string): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    const at = piece.entries.findIndex((e) => e.id === gapId);
    if (at === -1) throw new Error(`gap ${gapId} does not exist`);
    const gap = piece.entries[at]!;
    // The durable dismissal key. The gap sweep re-finds a seam with a FRESH
    // id, so id-keyed dismissal could never block a re-find; a model gap is
    // dismissed by (preceding pin's snippet, kind) — the sweep's own lookup
    // key. A person gap keeps its id: 'not a gap' exists only on model gaps,
    // so person ids never enter the list, and the list stays readable.
    let key = gapId;
    if (gap.kind !== 'pin' && gap.placedBy === 'model' && gap.kind !== undefined) {
      for (let i = at - 1; i >= 0; i--) {
        const before = piece.entries[i]!;
        if (before.kind === 'pin') {
          key = `${before.snippet}\u0000${gap.kind}`;
          break;
        }
      }
    }
    piece.entries = piece.entries.filter((e) => e.id !== gapId);
    if (!piece.dismissedGaps.includes(key)) piece.dismissedGaps.push(key);
    const first =
      noProse(piece.entries) ?? noTitle(piece.entries, piece.marginalia) ?? pinsResolve(piece.entries, this.#snippets);
    if (first) throw new Error(first);
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  setDown(pieceId: string, by: 'user' | 'dormancy'): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    piece.setDownAt = new Date().toISOString();
    piece.setDownBy = by;
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  pickUp(pieceId: string): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    delete piece.setDownAt;
    delete piece.setDownBy;
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  discard(pieceId: string): Piece {
    this.#requirePiece(pieceId);
    const piece = this.#pieceFromDisk(pieceId);
    piece.discardedAt = new Date().toISOString();
    this.#writePiece(pieceId, piece);
    return this.#pieceFromDisk(pieceId);
  }

  #requirePiece(id: string): void {
    if (!existsSync(join(this.#pieceDir(id), 'piece.md'))) {
      throw new Error(`piece ${id} does not exist`);
    }
  }

  /** Strip present keys holding `undefined` — js-yaml refuses to dump those
   *  and the whole write is lost. Absent stays absent (a Gap with no question
   *  is not a Gap with a null question). */
  #clean(e: Entry | Offer | Marginalia): Record<string, unknown> {
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
  }

  #writePiece(id: string, piece: Piece): void {
    const fm: Record<string, unknown> = {
      id: piece.id,
      created: piece.created,
      subject: piece.subject,
      entries: piece.entries.map((e) => this.#clean(e)),
      offers: piece.offers.map((o) => this.#clean(o)),
      declined: piece.declined,
      dismissedGaps: piece.dismissedGaps,
      marginalia: piece.marginalia.map((m) => this.#clean(m)),
    };
    // Every optional field is written under a guard, never as a present key
    // holding `undefined`. An absent setDownAt means picked up (Q-41); an
    // absent discardedAt means the piece is live (Q-3).
    if (piece.setDownAt) fm.setDownAt = piece.setDownAt;
    if (piece.setDownBy) fm.setDownBy = piece.setDownBy;
    if (piece.discardedAt) fm.discardedAt = piece.discardedAt;
    writeFileSync(join(this.#pieceDir(id), 'piece.md'), matter.stringify('', fm), 'utf-8');
  }

  /**
   * Legacy migration (redesign-2026-08-09 §4): the arrangement named by the
   * old `current` key IS the entries; its marginalia are taken over with
   * `principle` notes dropped (they described the convicted ordering, §9).
   * The other arrangement files are ignored — never deleted (Q-3). Legacy
   * entries are rewritten: pins pass through unchanged, and every gap loses
   * its `kind: 'gap'` discriminator and gains `placedBy` — 'model' when it
   * carried `pending` (the ordering pass's mark, Q-39), 'person' otherwise —
   * so the migrated list is guard-clean (a `kind: 'gap'` is not a GapKind).
   * The FIRST WRITE to a migrated piece rewrites piece.md in the new shape,
   * after which the arrangements/ directory is never consulted again. Reads
   * alone never write.
   */
  #legacyArrangement(
    id: string,
    current: string | undefined,
  ): { entries: Entry[]; marginalia: Marginalia[] } | null {
    const dir = this.#arrangementsDir(id);
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    if (files.length === 0) return null;
    const file = current !== undefined && files.includes(`${current}.md`) ? `${current}.md` : files[0]!;
    const parsed = matter.read(join(dir, file));
    const data = parsed.data as { entries?: Entry[]; marginalia?: Marginalia[] };
    return {
      entries: Array.isArray(data.entries)
        ? data.entries.map((e) => this.#migrateEntry(e))
        : [],
      marginalia: Array.isArray(data.marginalia) ? data.marginalia : [],
    };
  }

  /** One legacy entry in the new shape (see #legacyArrangement). */
  #migrateEntry(e: Entry): Entry {
    if (e.kind === 'pin') return e;
    const legacy = e as { id: string; kind: string; question?: string; pending?: string };
    const gap: Gap = {
      id: legacy.id,
      placedBy: legacy.pending !== undefined ? 'model' : 'person',
    };
    if (legacy.question !== undefined) gap.question = legacy.question;
    if (legacy.pending !== undefined) gap.pending = legacy.pending;
    return gap;
  }

  #pieceFromDisk(id: string): Piece {
    const parsed = matter.read(join(this.#pieceDir(id), 'piece.md'));
    const data = parsed.data as {
      id: string;
      created: string;
      subject?: string;
      entries?: Entry[];
      offers?: Offer[];
      declined?: string[];
      dismissedGaps?: string[];
      marginalia?: Marginalia[];
      setDownAt?: string;
      setDownBy?: 'user' | 'dormancy';
      discardedAt?: string;
      current?: string;
    };
    const piece: Piece = {
      id: data.id,
      created: data.created,
      subject: '',
      entries: [],
      offers: [],
      declined: [],
      dismissedGaps: [],
      marginalia: [],
    };
    if (Array.isArray(data.entries)) {
      // The new shape: the gathering and the order live in piece.md.
      piece.subject = typeof data.subject === 'string' ? data.subject : '';
      piece.entries = data.entries;
      if (Array.isArray(data.offers)) piece.offers = data.offers;
      if (Array.isArray(data.declined)) piece.declined = data.declined;
      if (Array.isArray(data.dismissedGaps)) piece.dismissedGaps = data.dismissedGaps;
      if (Array.isArray(data.marginalia)) piece.marginalia = data.marginalia;
    } else {
      // Legacy: the current arrangement is the entries (see #legacyArrangement).
      const legacy = this.#legacyArrangement(id, data.current);
      piece.entries = legacy?.entries ?? [];
      // Legacy marginalia can carry `note: 'principle'` (the convicted
      // ordering's notes, §9); the type says that cannot happen, but the
      // disk may disagree — cast so the runtime drop survives the type.
      piece.marginalia = (legacy?.marginalia ?? []).filter((m) => (m.note as string) !== 'principle');
    }
    if (data.setDownAt !== undefined) piece.setDownAt = data.setDownAt;
    if (data.setDownBy !== undefined) piece.setDownBy = data.setDownBy;
    if (data.discardedAt !== undefined) piece.discardedAt = data.discardedAt;
    return piece;
  }
}
