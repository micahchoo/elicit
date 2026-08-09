import type { Snippet } from '../types.js';

/**
 * The composition's two layers (redesign-2026-08-09 §4): the gathering —
 * which passages belong, alive and growing across sittings — and the order —
 * the person's, by drag, silently. There is exactly ONE list of entries: no
 * arrangements, no `current`, no ordering subsystem (Q-38 retired, Q-42
 * amended). Ordering was convicted by the archive; a named seam (a gap)
 * survives it.
 */

export type Pin = { id: string; kind: 'pin'; snippet: string; version: number };

/** The four lacks the gap sweep may find (redesign-2026-08-09 §7). */
export type GapKind = 'leap' | 'unsupported' | 'thin' | 'unclosed';

/**
 * A hole in the composition. `placedBy` is load-bearing: it decides queue
 * weight, expiry rate, and whether the hole renders as your commitment or as
 * a suggestion you may refuse. `kind` is model-placed only; `pending` is a
 * model-marked gap's verified question text, waiting to be minted — NEVER set
 * on a person's gap, whose question is minted at once (Q-39). The QueueEntry
 * id in `question` is the join key that finds the gap's answer: the entry
 * carries this Gap's own id, and so does the Provenance of every Snippet
 * harvested from the answer (Q-39, threaded by T1).
 */
export type Gap = {
  id: string;
  placedBy: 'person' | 'model';
  kind?: GapKind;
  question?: string;
  pending?: string;
};

export type Entry = Pin | Gap;

/**
 * A passage a sitting produced that may belong to the composition
 * (redesign-2026-08-09 §5.3 — auto-gather offers, it never adds). The offer's
 * own id is the accept/deny key on the wire; `sourceSitting` names the
 * sitting that produced it, for display.
 */
export type Offer = {
  id: string;
  snippet: string;
  version: number;
  sourceSitting: string;
};

export type MarginaliaNote = 'role' | 'stale-pin';
export type Marginalia = {
  id: string;
  /** The entry this annotates, or null for the composition as a whole. */
  on: string | null;
  note: MarginaliaNote;
  text: string;
  at: string;
  model?: string;          // Q-34 — absent when no model wrote it
};

/**
 * A composition — an organising method for like-minded snippets across
 * sittings. `subject` is the person's words: the gathering criterion, and
 * NEVER part of the export (Q-1 — the subject describes the gathering, not
 * the writing). `declined` holds durably refused offers and `dismissedGaps`
 * durably dismissed model gaps: neither is ever re-offered (Q-39's rule —
 * nothing is placed without the person's touch — and denial is durable, or
 * the feature becomes a nag). `setDownAt` is Q-41's reversible shelf, and
 * `discardedAt` is Q-3's field write: the file stays.
 */
export type Piece = {
  id: string;
  created: string;
  subject: string;
  entries: Entry[];
  offers: Offer[];
  declined: string[];
  dismissedGaps: string[];
  marginalia: Marginalia[];
  /** Absent = picked up. Present = set down (Q-41). There is no done flag. */
  setDownAt?: string;
  setDownBy?: 'user' | 'dormancy';
  discardedAt?: string;
};

export interface PieceStore {
  create(entries: Entry[], subject: string): Piece;
  get(id: string): Piece | null;
  list(): Piece[];
  /** Replaces the entry list whole. The only write path for entries. */
  putEntries(pieceId: string, entries: Entry[]): Piece;
  /** Replaces the marginalia list whole. The only write path for Marginalia. */
  putMarginalia(pieceId: string, marginalia: Marginalia[]): Piece;
  /** Appends one offer; a passage already offered is not offered twice. */
  addOffer(pieceId: string, offer: Offer): Piece;
  /** `put it in` — the offered passage becomes a pin, appended; the offer is consumed. */
  acceptOffer(pieceId: string, offerId: string): Piece;
  /** `not this one` — the offer is removed and the passage declined durably. */
  denyOffer(pieceId: string, offerId: string): Piece;
  /** `not a gap` — the model gap is removed and dismissed durably. */
  dismissGap(pieceId: string, gapId: string): Piece;
  setDown(pieceId: string, by: 'user' | 'dormancy'): Piece;
  pickUp(pieceId: string): Piece;
  /** Q-3: a field write — discardedAt set, the file stays. */
  discard(pieceId: string): Piece;
}

// ── The three guards ──────────────────────────────────────────────────────
// Each returns null when clean and a reason string when not. The store calls
// all three before every write and throws on the first reason. Guards never
// repair — a bad entry list is refused whole.

/**
 * Every entry is a `pin` or a `gap` and carries no key outside its declared
 * shape. An entry with an extra string field is agent prose smuggled into
 * the body. A gap's `kind` is model-placed only and `pending` is a
 * model-marked gap's verified text — a person's gap carries neither
 * (redesign-2026-08-09 §6: a model-placed gap can carry only {id, kind,
 * placedBy, question, pending}).
 */
export function noProse(entries: Entry[]): string | null {
  for (const entry of entries) {
    const allowed =
      entry.kind === 'pin'
        ? ['id', 'kind', 'snippet', 'version']
        : ['id', 'kind', 'placedBy', 'question', 'pending'];
    if (entry.kind !== 'pin' && entry.placedBy !== 'person' && entry.placedBy !== 'model') {
      return `entry ${entry.id} is neither a pin nor a gap`;
    }
    for (const key of Object.keys(entry)) {
      if (!allowed.includes(key)) {
        return `entry ${entry.id} carries a key outside its shape: ${key}`;
      }
    }
    if (entry.kind !== 'pin') {
      if (entry.kind !== undefined && entry.placedBy !== 'model') {
        return `gap ${entry.id} carries a kind — a gap kind is model-placed only`;
      }
      if (entry.pending !== undefined && entry.placedBy !== 'model') {
        return `gap ${entry.id} carries pending — a person's gap is minted at once, never pending`;
      }
    }
  }
  return null;
}

/**
 * No `title` key on any entry or Marginalia. Q-1: a title is body text.
 */
export function noTitle(entries: Entry[], marginalia: Marginalia[]): string | null {
  for (const entry of entries) {
    if ('title' in entry) {
      return `entry ${entry.id} carries a title — a title is body text`;
    }
  }
  for (const m of marginalia) {
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
export function pinsResolve(entries: Entry[], snippets: Record<string, Snippet>): string | null {
  for (const entry of entries) {
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
