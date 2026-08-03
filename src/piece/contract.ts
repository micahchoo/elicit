import type { Snippet } from '../types.js';

export type Principle = 'chronology' | 'argument' | 'contrast';

export type Pin = { id: string; kind: 'pin'; snippet: string; version: number };
export type Gap = {
  id: string;
  kind: 'gap';
  /**
   * The QueueEntry this gap minted. Absent = nothing was minted (set down, or
   * not yet chosen). Also the join key that finds the gap's answer: the entry
   * carries this Gap's own id, and so does the Provenance of every Snippet
   * harvested from the answer (Q-39, threaded by T1).
   */
  question?: string;
  /**
   * A model-marked gap's verified question text, waiting to be minted at choose
   * time. NEVER set on a user-inserted gap — the person's question is minted at
   * once. Not Piece text and not Marginalia; the exporter omits every gap whole.
   */
  pending?: string;
};
export type ArrangementEntry = Pin | Gap;

export type MarginaliaNote = 'principle' | 'role' | 'stale-pin';
export type Marginalia = {
  id: string;
  /** The entry this annotates, or null for the Arrangement as a whole. */
  on: string | null;
  note: MarginaliaNote;
  text: string;
  at: string;
  model?: string;          // Q-34 — absent when no model wrote it
};

export type Arrangement = {
  id: string;
  principle: Principle;
  entries: ArrangementEntry[];
  marginalia: Marginalia[];
  created: string;
  model?: string;
};

export type Piece = {
  id: string;
  created: string;
  /** Absent = picked up. Present = set down (Q-41). There is no done flag. */
  setDownAt?: string;
  setDownBy?: 'user' | 'dormancy';
  /** The Arrangement the surface renders; always an id in `arrangements`. */
  current: string;
  arrangements: Arrangement[];
};

export interface PieceStore {
  create(entries: ArrangementEntry[]): Piece;
  get(id: string): Piece | null;
  list(): Piece[];
  /** Replaces one Arrangement whole. The only write path for entries. */
  putArrangement(pieceId: string, a: Arrangement): Piece;
  addArrangement(pieceId: string, a: Arrangement): Piece;
  setCurrent(pieceId: string, arrangementId: string): Piece;
  setDown(pieceId: string, by: 'user' | 'dormancy'): Piece;
  pickUp(pieceId: string): Piece;
}

// ── The five guards ───────────────────────────────────────────────────────
// Each returns null when clean and a reason string when not. The store calls
// all five before every write and throws on the first reason. Guards never
// repair — a bad Arrangement is refused whole.

/**
 * Every entry is a `pin` or a `gap` and carries no key outside its declared
 * shape. An entry with an extra string field is agent prose smuggled into
 * the body.
 */
export function noProse(a: Arrangement): string | null {
  for (const entry of a.entries) {
    const allowed =
      entry.kind === 'pin'
        ? ['id', 'kind', 'snippet', 'version']
        : entry.kind === 'gap'
          ? ['id', 'kind', 'question', 'pending']
          : null;
    if (allowed === null) {
      return `entry ${entry.id} is neither a pin nor a gap`;
    }
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) {
        return `entry ${entry.id} carries a key outside its shape: ${key}`;
      }
    }
  }
  return null;
}

/**
 * No `title` key on the Arrangement, on any entry, or on any Marginalia.
 * Q-1: a title is body text.
 */
export function noTitle(a: Arrangement): string | null {
  if ('title' in a) {
    return 'the Arrangement carries a title — a title is body text';
  }
  for (const entry of a.entries) {
    if ('title' in entry) {
      return `entry ${entry.id} carries a title — a title is body text`;
    }
  }
  for (const m of a.marginalia) {
    if ('title' in m) {
      return `marginalia ${m.id} carries a title — a title is body text`;
    }
  }
  return null;
}

/**
 * Every pin's `snippet` exists and its `version` is >= 1 and <= the snippet's
 * latest version. A pin to a version that does not exist is refused; a pin to
 * an OLDER version than the latest is fine (Q-5 — keeping an old pin is
 * deliberate).
 */
export function pinsResolve(a: Arrangement, snippets: Record<string, Snippet>): string | null {
  for (const entry of a.entries) {
    if (entry.kind !== 'pin') continue;
    const latest = snippets[entry.snippet];
    if (!latest) {
      return `pin ${entry.id} names snippet ${entry.snippet}, which does not exist`;
    }
    if (entry.version < 1) {
      return `pin ${entry.id} names version ${entry.version}, which is below 1`;
    }
    if (entry.version > latest.version) {
      return `pin ${entry.id} names version ${entry.version} of ${entry.snippet}, whose latest is ${latest.version}`;
    }
  }
  return null;
}

/**
 * The candidate's pins are a permutation of the base's, keyed by
 * `snippet@version`. Used only on model output (T11); a user reorder trivially
 * satisfies it and a user removal does not go through it.
 */
export function samePinSet(base: ArrangementEntry[], candidate: ArrangementEntry[]): string | null {
  const pinKeys = (entries: ArrangementEntry[]): string[] =>
    entries
      .filter((e): e is Pin => e.kind === 'pin')
      .map((e) => `${e.snippet}@${e.version}`)
      .sort();
  const baseKeys = pinKeys(base);
  const candidateKeys = pinKeys(candidate);
  if (baseKeys.length !== candidateKeys.length) {
    return `candidate holds ${candidateKeys.length} pins, base holds ${baseKeys.length}`;
  }
  for (let i = 0; i < baseKeys.length; i++) {
    if (baseKeys[i] !== candidateKeys[i]) {
      return `pin ${baseKeys[i]} differs from the candidate's ${candidateKeys[i]}`;
    }
  }
  return null;
}

/**
 * At most 3 candidates, and no principle appears twice (Q-38 — never
 * shuffles of one).
 */
export function distinctPrinciples(candidates: Arrangement[]): string | null {
  if (candidates.length > 3) {
    return `candidate gate holds ${candidates.length} arrangements; at most 3 (Q-38)`;
  }
  const seen = new Set<Principle>();
  for (const a of candidates) {
    if (seen.has(a.principle)) {
      return `principle ${a.principle} appears more than once (Q-38)`;
    }
    seen.add(a.principle);
  }
  return null;
}
