import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type { Snippet } from '../types.js';
import { noProse, noTitle, pinsResolve } from './contract.js';
import type {
  Arrangement,
  ArrangementEntry,
  Marginalia,
  Piece,
  PieceStore,
  Principle,
} from './contract.js';

export function createPieceStore(root: string): PieceStore {
  return new PieceStoreImpl(root);
}

/**
 * The markdown is the truth (Q-3): every piece is `pieces/<id>/piece.md`
 * frontmatter with an EMPTY body, and every arrangement is
 * `pieces/<id>/arrangements/<aid>.md`, also frontmatter only. Nothing here
 * ever deletes a file (Q-41); set-down is a reversible frontmatter fact.
 */
class PieceStoreImpl implements PieceStore {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #piecesDir(): string {
    return join(this.#root, 'pieces');
  }

  #pieceDir(id: string): string {
    return join(this.#piecesDir(), id);
  }

  #arrangementsDir(id: string): string {
    return join(this.#pieceDir(id), 'arrangements');
  }

  create(entries: ArrangementEntry[]): Piece {
    const id = ulid();
    const created = new Date().toISOString();
    const current = ulid();
    const arrangement: Arrangement = {
      id: current,
      principle: 'chronology',
      entries,
      marginalia: [],
      created,
    };
    // `create` has no snippets map by interface, so pinsResolve is not run —
    // the two shape guards are.
    const first = noProse(arrangement) ?? noTitle(arrangement);
    if (first) throw new Error(first);

    mkdirSync(this.#arrangementsDir(id), { recursive: true });
    this.#writeArrangement(id, arrangement);
    const piece: Piece = { id, created, current, arrangements: [arrangement] };
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

  putArrangement(pieceId: string, a: Arrangement): Piece {
    this.#requirePiece(pieceId);
    const first = noProse(a) ?? noTitle(a) ?? pinsResolve(a, this.#snippets());
    if (first) throw new Error(first);
    this.#writeArrangement(pieceId, a);
    return this.#pieceFromDisk(pieceId);
  }

  addArrangement(pieceId: string, a: Arrangement): Piece {
    this.#requirePiece(pieceId);
    const first = noProse(a) ?? noTitle(a) ?? pinsResolve(a, this.#snippets());
    if (first) throw new Error(first);
    this.#writeArrangement(pieceId, a);
    return this.#pieceFromDisk(pieceId);
  }

  setCurrent(pieceId: string, arrangementId: string): Piece {
    this.#requirePiece(pieceId);
    const dir = this.#arrangementsDir(pieceId);
    const onDisk = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.md'))
          .map((f) => f.replace(/\.md$/, ''))
      : [];
    if (!onDisk.includes(arrangementId)) {
      throw new Error(`arrangement ${arrangementId} is not on disk for piece ${pieceId}`);
    }
    const piece = this.#pieceFromDisk(pieceId);
    piece.current = arrangementId;
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

  #requirePiece(id: string): void {
    if (!existsSync(join(this.#pieceDir(id), 'piece.md'))) {
      throw new Error(`piece ${id} does not exist`);
    }
  }

  #writePiece(id: string, piece: Piece): void {
    const fm: Record<string, unknown> = {
      id: piece.id,
      created: piece.created,
      current: piece.current,
    };
    // Every optional field is written under a guard, never as a present key
    // holding `undefined` — `matter.stringify` throws on that and the whole
    // write is lost. An absent setDownAt means picked up (Q-41).
    if (piece.setDownAt) fm.setDownAt = piece.setDownAt;
    if (piece.setDownBy) fm.setDownBy = piece.setDownBy;
    writeFileSync(join(this.#pieceDir(id), 'piece.md'), matter.stringify('', fm), 'utf-8');
  }

  #writeArrangement(pieceId: string, a: Arrangement): void {
    // Guards ran before this is ever called, so the only thing to strip is
    // present keys holding `undefined` — js-yaml refuses to dump those and
    // the whole write is lost. Absent stays absent (a Gap with no question
    // is not a Gap with a null question).
    const clean = (e: ArrangementEntry | Marginalia): Record<string, unknown> =>
      Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));
    const fm: Record<string, unknown> = {
      id: a.id,
      principle: a.principle,
      created: a.created,
      entries: a.entries.map(clean),
      marginalia: a.marginalia.map(clean),
    };
    if (a.model) fm.model = a.model;
    writeFileSync(
      join(this.#arrangementsDir(pieceId), `${a.id}.md`),
      matter.stringify('', fm),
      'utf-8',
    );
  }

  #readArrangement(pieceId: string, file: string): Arrangement {
    const parsed = matter.read(join(this.#arrangementsDir(pieceId), file));
    const data = parsed.data as {
      id: string;
      principle: Principle;
      created: string;
      model?: string;
      entries: ArrangementEntry[];
      marginalia: Marginalia[];
    };
    const a: Arrangement = {
      id: data.id,
      principle: data.principle,
      created: data.created,
      entries: data.entries ?? [],
      marginalia: data.marginalia ?? [],
    };
    if (data.model !== undefined) a.model = data.model;
    return a;
  }

  #pieceFromDisk(id: string): Piece {
    const parsed = matter.read(join(this.#pieceDir(id), 'piece.md'));
    const data = parsed.data as {
      id: string;
      created: string;
      current: string;
      setDownAt?: string;
      setDownBy?: 'user' | 'dormancy';
    };
    const piece: Piece = {
      id: data.id,
      created: data.created,
      current: data.current,
      arrangements: this.#readArrangements(id),
    };
    if (data.setDownAt !== undefined) piece.setDownAt = data.setDownAt;
    if (data.setDownBy !== undefined) piece.setDownBy = data.setDownBy;
    return piece;
  }

  #readArrangements(id: string): Arrangement[] {
    const dir = this.#arrangementsDir(id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => this.#readArrangement(id, f))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /**
   * The snippets map for pinsResolve, rebuilt from this store's own root —
   * latest v<N>.md per snippet id (Q-3). PRIVATE: the store's only read of
   * another module's files, and the only place pin validation gets its
   * ground truth.
   */
  #snippets(): Record<string, Snippet> {
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
}
