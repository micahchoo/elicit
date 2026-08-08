/**
 * The web split-module seam — one declaration of the deps contract.
 *
 * The split screens (import-review, import-entry, survey-map, waiting,
 * wiki, piece, coach, reviews, mode, drm, harvest, exchange) receive
 * their dependencies as one injected object literal at the call site —
 * the seam that keeps main.ts's edit-concurrency-safe split real. Before
 * this file, each split module re-declared the same el/api/navTo core by
 * hand. The core lives here once; the wait verb (WebDepsWithWait) and the
 * shell verbs (WebDepsShell) layer on it, and the navigation options the
 * surfaces' navTo carries are the one NavOpts declaration.
 *
 * Two wiring idioms are accepted, and the seam does not pretend they
 * merged: the screens take a per-call object literal from main.ts, while
 * the small renderers wired once at boot — territory's initTerritory,
 * panel-line's initPanelLine, protocol-meta's initProtocolMeta — receive
 * their own narrow deps through a module-local init and throw if never
 * wired, so a forgotten init is a loud failure, never a silent
 * global-document fallback.
 *
 * The shared primitive shapes come straight from main.ts's own helpers:
 * el(tag, attrs?, ...kids) and api<T>(path, body?, opts?) are the client's
 * two DOM/HTTP wrappers, injected so no split module ever touches document
 * or fetch directly. The wire types below are the surfaces' shared
 * responses (ScanResponse was the first; the waiting surface's queue,
 * harvest-queue and sweep-backlog shapes joined it), and ApiError is the
 * one client error class — the split modules' wait wrappers test
 * `instanceof ApiError`, so it must be one class across every module.
 */

import type { GateReading, QueueEntry } from '../src/types.ts';
import type { HarvestOrigin, OpenerSource } from './provenance.js';
import type { PhaseMetaLike } from './triad-surface.js';

/**
 * The navigation options the split screens' navTo carries (014 T14): the
 * survey map's focus/folder, the coach page's slug, and the region the
 * review stays inside (plan Task 13). One declaration — the per-module
 * re-declarations (waiting, survey-map) and the field-carried nav options
 * (import-review/import-entry) converge on it.
 */
export type NavOpts = {
  /** A node path the survey map should open at, scrolled to and expanded. */
  focus?: string;
  /** The survey root the reach offer named — the map opens AT it. */
  folder?: string;
  /** A coach direction slug — the coach page opens on it. */
  slug?: string;
  /** The region slug the review stays inside (plan Task 13). */
  region?: string;
};

/** The DOM/HTTP/core-navigation verbs every split screen needs. */
export interface WebDepsCore {
  main: HTMLElement;
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string>,
    ...kids: (string | Node)[]
  ) => HTMLElementTagNameMap[K];
  api: <T>(
    path: string,
    body?: unknown,
    opts?: { method?: 'GET' | 'POST'; raw?: boolean },
  ) => Promise<T>;
  navTo: (screen: string, opts?: NavOpts) => void;
  /** A bare text node — the sentence surfaces render text, never elements. */
  text: (content: string) => Text;
  /** The real document — the wiki's read-watch and the piece's export link need it. */
  document: Document;
}

/**
 * The one waiting-surface verb: beginWait(…).done()/failed() marks the
 * request lifecycle — every surface’s wait (review, wiki, waiting,
 * import-entry, piece) is this single implementation: piece.ts’s
 * pieceWait copy folded in here, same markup and same lifecycle.
 */
export interface WebDepsWithWait extends WebDepsCore {
  beginWait: (
    slot: HTMLElement,
    msg: string,
    delayMs?: number,
  ) => { done(): void; failed(cause: unknown, message?: string): void };
}

/**
 * The full-screen surfaces' layer: the shell verbs on top of the wait
 * layer. waiting, wiki and piece extend this and declare only their
 * module-specific verbs; reviews, mode, drm and harvest still declare the
 * shell verbs by hand beside WebDepsWithWait (their own surfaces' copies).
 */
export interface WebDepsShell extends WebDepsWithWait {
  renderShell: () => void;
  clear: () => void;
  setScreen: (screen: string) => void;
}

/**
 * The writable session-state handle the exchange and dictation surfaces
 * receive through the seam: every sitting field a surface reads has a
 * getter, every field it mutates has a setter. main.ts passes a live
 * handle that mutates the REAL AppState object, so the router and the
 * other screens see the writes — the waiting surface's sessionId()/
 * setQuestion getters (main.ts), extended to setters for the fields the
 * exchange mutates (question, sounding, pendingReview, ...).
 */
export interface SessionState {
  sessionId: () => string | null;
  setSessionId: (id: string | null) => void;
  sessionDeadline: () => number | null;
  setSessionDeadline: (deadline: number | null) => void;
  sessionProtocol: () => string | null;
  setSessionProtocol: (protocol: string | null) => void;
  sttAvailable: () => boolean;
  setSttAvailable: (available: boolean) => void;
  turnHadSpeech: () => boolean;
  setTurnHadSpeech: (spoken: boolean) => void;
  question: () => string | null;
  setQuestion: (question: string | null) => void;
  pulsePrompt: () => string | null;
  setPulsePrompt: (prompt: string | null) => void;
  pendingQuestion: () => string | null;
  setPendingQuestion: (question: string | null) => void;
  setPendingReviewSession: (sessionId: string | null) => void;
  lineageQuestion: () => string | null;
  setLineageQuestion: (question: string | null) => void;
  lineageContext: () => string | null;
  setLineageContext: (context: string | null) => void;
  openerSource: () => OpenerSource | null;
  setOpenerSource: (source: OpenerSource | null) => void;
  quotedFragment: () => string | null;
  setQuotedFragment: (fragment: string | null) => void;
  snippetRef: () => string | null;
  setSnippetRef: (ref: string | null) => void;
  juxtaposition: () => { snippetText: string; snippetDate: string } | null;
  setJuxtaposition: (juxtaposition: { snippetText: string; snippetDate: string } | null) => void;
  sounding: () => GateReading | null;
  setSounding: (reading: GateReading | null) => void;
  soundingOffer: () => { construct: string; allowance: number; sentence: string } | null;
  setSoundingOffer: (offer: { construct: string; allowance: number; sentence: string } | null) => void;
  phaseMeta: () => PhaseMetaLike | null;
  setPhaseMeta: (meta: PhaseMetaLike | null) => void;
}

/** `POST /api/session/:id/end` and `/api/unprompted` — the session whose harvest runs behind the response (084). */
export interface EndResponse {
  sessionId: string;
}

/** `POST /api/import/scan` — counts, and every file that did not come in, and why. */
export type ScanResponse = {
  pending: number;
  refused: { file: string; reason: string }[];
  skipped: number;
  adopted: number;
};

/**
 * A failed call. `handled` means api() already put the explanation on screen,
 * so the caller's waiting affordance leaves without adding a second line.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly handled: boolean;
  constructor(message: string, status: number, handled = false) {
    super(message);
    this.status = status;
    this.handled = handled;
  }
}

export interface HarvestQueueEntry {
  sessionId: string;
  started: string;
  protocol: string;
  origin: HarvestOrigin;
  proposalCount: number;
}

/** GET /api/sweep-backlog — ticket 139, with the dated sittings of 156. */
export interface SweepBacklogResponse {
  pendingReadings: number;
  freshReadings: number;
  lastRecorded: number;
  at: string | null;
  /** The sittings that left sweep work, most recent day first (ticket 156). */
  sittings: { date: string; readings: number }[];
}

/** GET /api/activity — the change-feed line shape. */
export interface ActivityEvent {
  at: string;
  actor: string;
  kind: string;
  detail: string;
}

export interface QueueData {
  open: Array<QueueEntry & { rungsKept?: number }>;
  /** Questions the person parked from the open pane — held until put back. */
  parked?: QueueEntry[];
}
