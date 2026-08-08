import type {
 CutProposal,
 GateReading,
 HarvestDecision,
 Snippet,
} from '../src/types.ts';
import { type OpenerSource } from './provenance.js';
import { renderImportEntry } from './import-entry.js';
import { renderCoachPage } from './coach.js';
import { initPanelLine } from './panel-line.js';
import { renderWaiting } from './waiting.js';
import { renderWiki, releaseWiki } from './wiki.js';
import { renderPiece, setCurrentPieceId, type PieceEnriched, type PieceLite } from './piece.js';
import { renderHarvest, type HarvestDeps } from './harvest.js';
import { renderReviews } from './reviews.js';
import { ApiError } from './deps.js';
import type { EndResponse, HarvestQueueEntry, NavOpts, QueueData } from './deps.js';
import { initTerritory } from './territory.js';
import { readableDate } from './dates.js';
import { pasteTracker } from './paste-tracker.js';
import { initProtocolMeta } from './protocol-meta.js';
import { type PhaseMetaLike } from './triad-surface.js';

import { renderExchange, type ExchangeDeps } from './exchange.js';
import { wireDictation, type DictationDeps } from './dictation.js';
import { renderDRM, type DrmDeps } from './drm.js';
import { renderMode, type ModeDeps } from './mode.js';

/* ─── DOM helpers ─── */

function el<K extends keyof HTMLElementTagNameMap>(
 tag: K,
 attrs?: Record<string, string>,
 ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
 const e = document.createElement(tag);
 if (attrs) {
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
 }
 for (const c of children) {
  e.append(typeof c === 'string' ? document.createTextNode(c) : c);
 }
 return e;
}

function $<T extends HTMLElement>(sel: string): T {
 return document.querySelector(sel) as T;
}

// The split modules' DOM verbs, wired once at boot: the territory
// renderer takes its el through the seam (web/deps.ts), never a global
// document. renderTerritory's own el(tag, className, text) signature is
// adapted onto main.ts's el(tag, attrs?, ...kids) here, at the call site.
initTerritory({
 el: (tag, className, text) => el(tag as keyof HTMLElementTagNameMap, className === null ? undefined : { class: className }, text),
});
// The one-line panel wrapper's verbs, wired the same way: el for the error
// line, and a text-node maker for the offer line.
initPanelLine({ el, text: (s) => document.createTextNode(s) });
// The protocol titles (ticket 157) fetch through the same seam: the mode
// row, the exchange label and the DRM offer all render the once-cached map.
initProtocolMeta({ api });

/* ─── State ─── */

type Screen = 'mode' | 'home' | 'exchange' | 'harvest' | 'done' | 'waiting' | 'login' | 'setup' | 'unprompted' | 'wiki' | 'reviews' | 'inbox' | 'import' | 'material' | 'library' | 'piece' | 'coach' | 'drm';

interface AppState {
 screen: Screen;
 sessionId: string | null;
 question: string | null;
 proposals: CutProposal[];
 decisions: HarvestDecision[];
 juxtaposition: { snippetText: string; snippetDate: string } | null;
 /** Lineage of a resurfaced opener (080): shown dimmed above the question, cleared on the next turn. */
 lineageQuestion: string | null;
 lineageContext: string | null;
 /** How the opener was dealt (Q-18): set from SessionResponse.source, cleared on the next turn. */
 openerSource: OpenerSource | null;
 sttAvailable: boolean;
 turnHadSpeech: boolean;
 /** Epoch ms when the sitting's countdown runs out; set when the sitting begins. */
 sessionDeadline: number | null;
 /** Session whose harvest is running behind the /end response (084). */
 pendingReviewSession: string | null;
 /** Live descent reading (012 T9): set on every rung, null when no descent is open. */
 sounding: GateReading | null;
 /** The one-shot offer (012 T9): set once, cleared by either word. */
 soundingOffer: { construct: string; allowance: number; sentence: string } | null;
 /** The pulse prompt text to show before the first question (ticket 105). */
 pulsePrompt: string | null;
 /** The first question held while the pulse is shown (ticket 105). */
 pendingQuestion: string | null;
 /** The Coach page's slug (090 T11): set by navTo('coach', { slug }). */
 coachSlug: string | null;
 /** The protocol this sitting runs — auto-rotated by server (ticket 140). */
 sessionProtocol: string | null;
 /** Buds from the last harvest, shown on the done screen (ticket 140). */
 pendingBuds: unknown[];
 /** Fragment currently quoted in the question (Q-104): set from session/turn responses. */
 quotedFragment: string | null;
 /** Snippet ref for the current question's quoted fragment (Q-109): rides with quotedFragment. */
 snippetRef: string | null;
 /**
  * The machine phase meta (ticket 159, slice 3): set from the turn response
  * while a machine is active — { id, label, step, of } — rendered dimmed
  * above the question block. Null on non-machine sittings.
  */
 phaseMeta: PhaseMetaLike | null;
}
const state: AppState = {
 screen: 'mode',
 sessionId: null,
 question: null,
 proposals: [],
 decisions: [],
 juxtaposition: null,
 lineageQuestion: null,
 lineageContext: null,
 openerSource: null,
 sttAvailable: false,
 turnHadSpeech: false,
 sessionDeadline: null,
 pendingReviewSession: null,
 sounding: null,
 soundingOffer: null,
 coachSlug: null,
 pulsePrompt: null,
 pendingQuestion: null,
 sessionProtocol: null,
 pendingBuds: [],
 quotedFragment: null,
 snippetRef: null,
 phaseMeta: null,
};

const main = $('main')!;
/** The scroll surface under the shell; `clear()` empties only this. */
const surface = el('div', { id: 'surface' });
main.append(surface);

/** The harvest seam object, built once: the harvest route renders through
 * it, and the reviews screen re-enters the harvest through the same object
 * (openEntry hands the screen over with the same deps). */
const harvestDeps: HarvestDeps = {
 main: surface, el, api, beginWait,
 navTo: (s: string) => navTo(s as Screen),
 renderShell, clear,
 setScreen: (s: string) => { state.screen = s as Screen; },
 sessionId: () => state.sessionId,
 proposals: () => state.proposals,
 decisions: () => state.decisions,
 setDecisions: (d: HarvestDecision[]) => { state.decisions = d; },
 setPendingBuds: (b: unknown[]) => { state.pendingBuds = b; },
 renderDone,
 document,
 text: (s: string) => document.createTextNode(s),
};

const dictationDeps: DictationDeps = {
 api,
 navTo: (s: string) => navTo(s as Screen),
 fetch,
 showQuietError,
 sttAvailable: () => state.sttAvailable,
 setSttAvailable: (v: boolean) => { state.sttAvailable = v; },
 window,
};

/** The session clock's interval, stopped when the screen it hangs on leaves. */
let clockTimer: ReturnType<typeof setInterval> | null = null;

/** The exchange seam object, built once: renderExchange's deps, with the
 *  writable session-state handle bound to the real AppState — the router
 *  and the other screens see every write. */
const exchangeDeps: ExchangeDeps = {
 main: surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait,
 renderShell, clear,
 showQuietError,
 setScreen: (s: string) => { state.screen = s as Screen; },
 session: {
  sessionId: () => state.sessionId,
  setSessionId: (id: string | null) => { state.sessionId = id; },
  sessionDeadline: () => state.sessionDeadline,
  setSessionDeadline: (d: number | null) => { state.sessionDeadline = d; },
  sessionProtocol: () => state.sessionProtocol,
  setSessionProtocol: (p: string | null) => { state.sessionProtocol = p; },
  sttAvailable: () => state.sttAvailable,
  setSttAvailable: (v: boolean) => { state.sttAvailable = v; },
  turnHadSpeech: () => state.turnHadSpeech,
  setTurnHadSpeech: (v: boolean) => { state.turnHadSpeech = v; },
  question: () => state.question,
  setQuestion: (q: string | null) => { state.question = q; },
  pulsePrompt: () => state.pulsePrompt,
  setPulsePrompt: (p: string | null) => { state.pulsePrompt = p; },
  pendingQuestion: () => state.pendingQuestion,
  setPendingQuestion: (q: string | null) => { state.pendingQuestion = q; },
  setPendingReviewSession: (id: string | null) => { state.pendingReviewSession = id; },
  lineageQuestion: () => state.lineageQuestion,
  setLineageQuestion: (q: string | null) => { state.lineageQuestion = q; },
  lineageContext: () => state.lineageContext,
  setLineageContext: (c: string | null) => { state.lineageContext = c; },
  openerSource: () => state.openerSource,
  setOpenerSource: (s: OpenerSource | null) => { state.openerSource = s; },
  quotedFragment: () => state.quotedFragment,
  setQuotedFragment: (f: string | null) => { state.quotedFragment = f; },
  snippetRef: () => state.snippetRef,
  setSnippetRef: (r: string | null) => { state.snippetRef = r; },
  juxtaposition: () => state.juxtaposition,
  setJuxtaposition: (j: { snippetText: string; snippetDate: string } | null) => { state.juxtaposition = j; },
  sounding: () => state.sounding,
  setSounding: (r: GateReading | null) => { state.sounding = r; },
  soundingOffer: () => state.soundingOffer,
  setSoundingOffer: (o: { construct: string; allowance: number; sentence: string } | null) => { state.soundingOffer = o; },
  phaseMeta: () => state.phaseMeta,
  setPhaseMeta: (m: PhaseMetaLike | null) => { state.phaseMeta = m; },
 },
 sessionClock: () => clockTimer,
 setSessionClock: (t: ReturnType<typeof setInterval> | null) => { clockTimer = t; },
 document,
 wireDictation: (opts) => wireDictation(dictationDeps, opts),
};

/** The mode seam object, built once: renderMode's deps, with the writable
 *  session-state handle bound to the real AppState the way exchangeDeps is
 *  — the router and the other screens see every write — plus the hand-off
 *  into the exchange screen. */
const modeDeps: ModeDeps = {
 main: surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait,
 renderShell, clear,
 setScreen: (s: string) => { state.screen = s as Screen; },
 session: {
  sessionId: () => state.sessionId,
  setSessionId: (id: string | null) => { state.sessionId = id; },
  sessionDeadline: () => state.sessionDeadline,
  setSessionDeadline: (d: number | null) => { state.sessionDeadline = d; },
  sessionProtocol: () => state.sessionProtocol,
  setSessionProtocol: (p: string | null) => { state.sessionProtocol = p; },
  sttAvailable: () => state.sttAvailable,
  setSttAvailable: (v: boolean) => { state.sttAvailable = v; },
  turnHadSpeech: () => state.turnHadSpeech,
  setTurnHadSpeech: (v: boolean) => { state.turnHadSpeech = v; },
  question: () => state.question,
  setQuestion: (q: string | null) => { state.question = q; },
  pulsePrompt: () => state.pulsePrompt,
  setPulsePrompt: (p: string | null) => { state.pulsePrompt = p; },
  pendingQuestion: () => state.pendingQuestion,
  setPendingQuestion: (q: string | null) => { state.pendingQuestion = q; },
  setPendingReviewSession: (id: string | null) => { state.pendingReviewSession = id; },
  lineageQuestion: () => state.lineageQuestion,
  setLineageQuestion: (q: string | null) => { state.lineageQuestion = q; },
  lineageContext: () => state.lineageContext,
  setLineageContext: (c: string | null) => { state.lineageContext = c; },
  openerSource: () => state.openerSource,
  setOpenerSource: (s: OpenerSource | null) => { state.openerSource = s; },
  quotedFragment: () => state.quotedFragment,
  setQuotedFragment: (f: string | null) => { state.quotedFragment = f; },
  snippetRef: () => state.snippetRef,
  setSnippetRef: (r: string | null) => { state.snippetRef = r; },
  juxtaposition: () => state.juxtaposition,
  setJuxtaposition: (j: { snippetText: string; snippetDate: string } | null) => { state.juxtaposition = j; },
  sounding: () => state.sounding,
  setSounding: (r: GateReading | null) => { state.sounding = r; },
  soundingOffer: () => state.soundingOffer,
  setSoundingOffer: (o: { construct: string; allowance: number; sentence: string } | null) => { state.soundingOffer = o; },
  phaseMeta: () => state.phaseMeta,
  setPhaseMeta: (m: PhaseMetaLike | null) => { state.phaseMeta = m; },
 },
 text: (s: string) => document.createTextNode(s),
 document,
 showError,
 renderExchange: () => renderExchange(exchangeDeps),
};

/** The DRM seam object, built once: renderDRM's deps on the flat verbs the
 *  screen needs — the session id, the harvest hand-off, and the dictation
 *  wiring bound to the shared dictationDeps — plus the core seam. */
const drmDeps: DrmDeps = {
 main: surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait,
 renderShell, clear,
 setScreen: (s: string) => { state.screen = s as Screen; },
 sessionId: () => state.sessionId,
 setPendingReviewSession: (id: string | null) => { state.pendingReviewSession = id; },
 text: (s: string) => document.createTextNode(s),
 document,
 wireDictation: (opts) => wireDictation(dictationDeps, opts),
};

/* ─── Navigation ─── */

function navTo(screen: Screen, opts?: NavOpts) {
 const target = '#/' + screen;
 if (location.hash !== target) location.hash = target;
 state.screen = screen;
 if (screen === 'coach' && opts?.slug !== undefined) state.coachSlug = opts.slug;
 switch (screen) {
  case 'mode':
  case 'home': renderMode(modeDeps); break;
  case 'exchange':
   // A sitting must be under way; a bare hash cannot fake one.
   if (!state.sessionId) { navTo('home'); break; }
   renderExchange(exchangeDeps); break;
  case 'harvest':
   // A harvest needs a session and its proposals; otherwise home.
   if (!state.sessionId || state.proposals.length === 0) { navTo('home'); break; }
   renderHarvest(harvestDeps); break;
  case 'done': renderDone(); break;
  case 'waiting': renderWaiting({
   main: surface, el, api,
   navTo: (s: string, opts?: NavOpts) => navTo(s as Screen, opts),
   beginWait,
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   screen: () => state.screen,
   sessionId: () => state.sessionId,
   setQuestion: (q: string) => { state.question = q; },
   text: (s: string) => document.createTextNode(s),
   document,
   fetch,
  }); break;
  case 'reviews':
  case 'inbox': renderReviews({
   main: surface, el, api,
   navTo: (s: string) => navTo(s as Screen),
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   screen: () => state.screen,
   setSessionId: (id: string) => { state.sessionId = id; },
   setProposals: (p: CutProposal[]) => { state.proposals = p; },
   pendingReview: () => state.pendingReviewSession,
   setPendingReview: (v: string | null) => { state.pendingReviewSession = v; },
   text: (s: string) => document.createTextNode(s),
   document,
   renderHarvest: () => renderHarvest(harvestDeps),
  }); break;
  // The seam widens navTo: the entry module takes `(screen: string)`, this
  // app's screens are the Screen union, and the entry only ever asks for
  // screens the union contains.
  // The opts seam (014 T14): the reach offer's `reach it` lands the map on
  // the region it named, carrying the survey root it was relative to — the
  // parameters are optional, so every other call site is untouched, and they
  // are forwarded only where the map renders.
  case 'import': renderShell(); renderImportEntry({
    main: surface, el, api, beginWait,
    navTo: (s: string) => navTo(s as Screen),
    // exactOptionalPropertyTypes: absent means absent, never present-undefined.
    ...(opts?.focus !== undefined ? { focus: opts.focus } : {}),
    ...(opts?.folder !== undefined ? { folder: opts.folder } : {}),
    ...(opts?.region !== undefined ? { region: opts.region } : {}),
    text: (s: string) => document.createTextNode(s),
    document,
    selection: () => document.getSelection()?.toString() ?? '',
   }); break;
  case 'wiki': renderWiki({
   main: surface, el, api, navTo: (s: string) => navTo(s as Screen),
   beginWait,
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   text: (s: string) => document.createTextNode(s),
   document, window,
  }); break;
  case 'unprompted': renderUnprompted(); break;
  case 'login': renderLogin(); break;
  case 'setup': renderSetup(); break;
  case 'material':
  case 'library': renderMaterial(); break;
  case 'coach':
   // The page needs a slug to fetch; a bare hash cannot fake one.
   if (state.coachSlug === null) { navTo('waiting'); break; }
   renderShell();
   renderCoachPage({
    main: surface,
    el,
    api,
    navTo: (s: string) => navTo(s as Screen),
    text: (s: string) => document.createTextNode(s),
    document,
   }, state.coachSlug);
   break;
  case 'piece': renderPiece({
   main: surface, el, api, beginWait, navTo: (s: string) => navTo(s as Screen),
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   text: (s: string) => document.createTextNode(s),
   document,
   wireDictation: (opts) => wireDictation(dictationDeps, opts),
  }); break;
  case 'drm':
   if (!state.sessionId) { navTo('home'); break; }
   renderDRM(drmDeps); break;
 }
}

/**
 * Every routable name. The hash is honored only for these.
 */
const SCREENS: readonly Screen[] = [
 'mode', 'home', 'exchange', 'harvest', 'done', 'waiting', 'login',
 'setup', 'unprompted', 'wiki', 'reviews', 'inbox', 'import',
 'material', 'library', 'piece', 'coach', 'drm',
];

/** The screen a hash names, or null when it names nothing routable. */
function screenFromHash(): Screen | null {
 const name = location.hash.replace(/^#\/?/, '');
 return (SCREENS as readonly string[]).includes(name) ? (name as Screen) : null;
}

/** The canonical screen a hash name lands on; aliases collapse here. */
function canonicalOf(screen: Screen): Screen {
 switch (screen) {
  case 'home': return 'mode';
  case 'library': return 'material';
  case 'inbox': return 'reviews';
  case 'drm': return 'drm';
  default: return screen;
 }
}

// Hash routing: navTo writes the hash, this listener reads it back. An
// event for the current screen (our own write, or an alias of it) is
// skipped so a navigation never re-renders twice.
window.addEventListener('hashchange', () => {
 const screen = screenFromHash();
 if (!screen) { navTo('home'); return; }
 if (canonicalOf(screen) === canonicalOf(state.screen)) return;
 navTo(screen);
});

/* ── Live refresh (ticket 150): the Activity Log is the change feed ── */
// The server pushes one SSE event per log append (Q-23 — every actor
// writes through that spine, so an append IS "something changed").
// Screens that only READ re-render when the log moves; screens holding
// the person's unsent words or pending decisions (exchange, drm,
// harvest, piece, import, coach) are never re-rendered underneath them.
const LIVE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
 'waiting', 'wiki', 'reviews', 'inbox', 'unprompted',
]);
let liveSource: EventSource | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
// The docket heartbeat appends evaluation events every few seconds even
// when nothing changed (coach-offer with offered=none, reach-evaluated
// with candidates=0, license checks). Those must not repaint the screen —
// only MATERIAL events (something minted, committed, answered, repaired)
// are worth a refresh. Heartbeats follow their naming pattern, so the
// filter is mostly suffix rules; unknown kinds default to material.
const HEARTBEAT_SUFFIXES = ['-evaluated', '-license', '-checked', '-shadow', '-clipped', '-skip'];
const HEARTBEAT_KINDS = new Set([
 'coach-offer', 'docket-run', 'run-started', 'queue-floor',
 'index-rebuilt', 'still-true-minted', 'pulse-answered',
 // A rejected draft changed nothing a read-only screen shows.
 'question-rejected',
]);
function isHeartbeat(kind: string): boolean {
 if (HEARTBEAT_KINDS.has(kind)) return true;
 return HEARTBEAT_SUFFIXES.some((sfx) => kind.endsWith(sfx));
}
// The suffix list can never enumerate every quiet kind — each docket cycle
// emits a tail of them (wiki-job-skipped, opener-minted with "minted 0",
// expired with "expired 0", wiki-run with unchanged counts…), and unknown
// kinds default to material, so an at-rest cycle still repainted the screen.
// The structural filter: an idle cycle re-emits BYTE-IDENTICAL detail
// strings. A kind whose detail has not changed since its last appearance
// changed nothing — skip it; any count that moves refreshes as before.
const lastDetailByKind = new Map<string, string>();
function isRepeat(kind: string, detail: string): boolean {
 const prev = lastDetailByKind.get(kind);
 lastDetailByKind.set(kind, detail);
 return prev === detail;
}
function startLiveRefresh() {
 if (liveSource) return;
 liveSource = new EventSource('/api/events');
 // A burst of material appends (a docket run's mints) collapses into one
 // refresh, trailing the burst by a second.
 liveSource.onmessage = (ev: MessageEvent<string>) => {
  if (!LIVE_SCREENS.has(state.screen)) return;
  let kind = '';
  let detail = '';
  try {
   const parsed = JSON.parse(ev.data) as { kind?: string; detail?: string };
   kind = parsed.kind ?? '';
   detail = parsed.detail ?? '';
  } catch {
   return;
  }
  if (isHeartbeat(kind)) return;
  if (isRepeat(kind, detail)) return;
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
   liveTimer = null;
   if (LIVE_SCREENS.has(state.screen)) navTo(state.screen);
  }, 1000);
 };
 // EventSource reconnects by itself; nothing to do on error.
}



/**
 * Read routes, by prefix. `/api/wiki` is matched exactly (with its query
 * string) rather than by prefix, because `/api/wiki/claim/:id/read` sits under
 * the same path and is the one write the wiki surface makes.
 */
const GET_PREFIXES = ['/api/activity', '/api/stt/status', '/api/cadence', '/api/snippets', '/api/harvest-queue', '/api/pieces', '/api/anniversary', '/api/protocols', '/api/territory', '/api/sweep-backlog'];

function isReadPath(path: string): boolean {
 if (GET_PREFIXES.some((p) => path.startsWith(p))) return true;
 // /api/queue is matched exactly, not by prefix: the GET is the pile itself,
 // while park / unpark / answer sit under the same path and are POSTs — a
 // prefix match would send them out as GETs (the /api/reach lesson below).
 if (path === '/api/queue' || path.startsWith('/api/queue?')) return true;
 // The piece paths are matched exactly, the way /api/wiki is: the GET reads
 // are one piece and its export, while every verb beneath /api/piece/:id/ is
 // a POST (reorder, prose, gap, gap/accept, set-down, pick-up).
 // /api/reach is matched the same exact way, not by prefix: the GET is the
 // offer itself, while /api/reach/decline sits under the same path and is
 // the one POST the reach surface makes — a prefix match would send the
 // decline out as a GET and 404 it (seeding pre-dispatch finding, 014 T14).
 return path === '/api/wiki' || path.startsWith('/api/wiki?')
  || path === '/api/reach' || path.startsWith('/api/reach?')
  || /^\/api\/piece\/[^/]+$/.test(path)
  || /^\/api\/piece\/[^/]+\/export$/.test(path)
  // Coach reads: the waiting evaluation, and the page GET. Every other
  // /api/coach/* path is a write. 'waiting', 'direction' and 'quest' are
  // reserved in directionSlugFor (src/coach/contract.ts, T2), so a
  // one-segment path that is none of them can only be a page slug.
  || path === '/api/coach/waiting'
  || /^\/api\/coach\/(?!direction$|quest$|waiting$)[^/]+$/.test(path);
}

async function api<T>(path: string, body?: unknown, opts?: { method?: 'GET' | 'POST'; raw?: boolean }): Promise<T> {
 const method = opts?.method ?? (isReadPath(path) ? 'GET' : 'POST');
 const init: RequestInit = { method };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 }
 const res = await fetch(path, init);
 if (!res.ok) {
  // A 401 from /api/login is a wrong password, not an expired session —
  // the login screen must stay put so it can say so.
  if (res.status === 401 && !path.startsWith('/api/login')) {
   navTo('login');
   throw new ApiError('unauthorized', 401, true);
  }
  if (res.status === 403) {
   let setupRequired = false;
   try {
    const data = await res.json() as { error?: string };
    setupRequired = data.error === 'setup required';
   } catch { /* not JSON */ }
   if (setupRequired) {
    // Server wants setup from host machine — this client is remote
    showError('finish setup from the host machine');
    throw new ApiError('setup required', 403, true);
   }
   throw new ApiError('403 Forbidden', 403);
  }
  const text = await res.text();
  throw new ApiError(`${res.status} ${res.statusText}: ${text}`, res.status);
 }
 if (opts?.raw) return res as unknown as T;
 return res.json() as T;
}

/* ─── Render ─── */

/* ── The shell ── */

/** The nav word a screen lights in the shell; '' lights none. */
function navWordOf(screen: Screen): string {
 switch (screen) {
  case 'mode':
  case 'home': return 'home';
  case 'wiki': return 'wiki';
  case 'material':
  case 'library': return 'library';
  case 'waiting': return 'waiting';
  case 'import': return 'import';
  case 'reviews':
  case 'inbox': return 'inbox';
  default: return '';
 }
}

/**
 * The persistent top nav, built once and kept by `clear()`. Every authed
 * screen calls it; each call re-lights the active word and refreshes the
 * inbox count. Login and setup render without it.
 */
function renderShell(): void {
 let nav = main.querySelector<HTMLElement>('.topnav');
 if (!nav) {
  nav = el('nav', { class: 'topnav' });
  nav.append(el('a', { class: 'wordmark', href: '#/home' }, 'elicit'));
  const links: [Screen, string][] = [
   ['home', 'home'],
   ['wiki', 'wiki'],
   ['library', 'library'],
   ['waiting', 'open questions'],
   ['import', 'import'],
   ['inbox', 'inbox'],
  ];
  for (const [screen, word] of links) {
   const link = el('a', { class: 'nav-link', href: `#/${screen}` }, word);
   link.dataset.screen = screen;
   nav.append(link);
  }
  main.prepend(nav);
 }
 const here = navWordOf(state.screen);
 for (const link of nav.querySelectorAll<HTMLAnchorElement>('a')) {
  link.classList.toggle('here', here !== '' && link.dataset.screen === here);
 }
 refreshInboxBadge();
}

/** The inbox count: a small number when harvests wait, nothing when none. */
function refreshInboxBadge(): void {
 (async () => {
  try {
   const data = await api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
   const inbox = main.querySelector<HTMLAnchorElement>('.topnav a[data-screen="inbox"]');
   if (!inbox) return;
   const badge = inbox.querySelector('.topnav-count');
   if (data.pending.length === 0) {
    badge?.remove();
    return;
   }
   if (badge) {
    badge.textContent = String(data.pending.length);
    return;
   }
   inbox.append(el('span', { class: 'topnav-count' }, String(data.pending.length)));
  } catch {
   // The badge is a nicety; a failed read just means no count.
  }
 })();
}

function clear() {
 // The wiki's page-level machinery (read-watch observer, correcting-mode
 // key handler) is released here, on every navigation, so no listener
 // outlives the page it was attached to.
 releaseWiki(document);
 surface.innerHTML = '';
 // The session clock hangs in the shell; it leaves with the exchange screen.
 main.querySelector<HTMLElement>('.session-clock')?.remove();
 if (clockTimer !== null) {
  clearInterval(clockTimer);
  clockTimer = null;
 }
}

function showError(msg: string) {
 const err = el('p', { class: 'error-msg' }, msg);
 surface.append(err);
}

/* ── Waiting ── */

const WAIT_FAILED = 'that did not go through — try again';

interface Wait {
 /** The call returned. Take the affordance away. */
 done(): void;
 /** The call failed. Leave one dimmed line where the affordance was. */
 failed(cause: unknown, message?: string): void;
}

function showQuietError(container: HTMLElement, message: string) {
 container.append(el('p', { class: 'quiet-error' }, message));
}

/**
 * Say that something is happening, in the register of the page: a hairline
 * drawing across the measure plus one dimmed line. `delayMs` holds it back so
 * a fast call does not flash.
 *
 * Phase 2 (ticket 039) replaces the label of the /end wait with turn-by-turn
 * progress, once the chunked harvest reports which turn it is reading.
 */
function beginWait(container: HTMLElement, label: string, delayMs = 0): Wait {
 for (const stale of container.querySelectorAll(':scope > .wait, :scope > .quiet-error')) {
  stale.remove();
 }

 const block = el('div', { class: 'wait' });
 block.append(
  el('div', { class: 'wait-rule' }, el('span', { class: 'wait-sweep' })),
  el('p', { class: 'wait-label' }, label),
 );

 let timer: ReturnType<typeof setTimeout> | null = null;
 if (delayMs > 0) timer = setTimeout(() => container.append(block), delayMs);
 else container.append(block);

 let live = true;
 /** Ends the wait once; reports whether this call is the one that ended it. */
 function stop(): boolean {
  if (timer !== null) {
   clearTimeout(timer);
   timer = null;
  }
  const wasLive = live;
  live = false;
  return wasLive;
 }

 return {
  done() {
   if (stop()) block.remove();
  },
  failed(cause: unknown, message = WAIT_FAILED) {
   if (!stop()) return;
   console.error(cause);
   block.remove();
   if (cause instanceof ApiError && cause.handled) return;
   showQuietError(container, message);
  },
 };
}

/* ── Login screen ── */

function renderLogin() {
 clear();
 // No nav before auth: a stale shell from a previous session leaves.
 main.querySelector('.topnav')?.remove();
 state.screen = 'login';

 const div = el('div', { class: 'screen active login-form' });
 const heading = el('h1', { class: 'login-heading' }, 'elicit');
 const input = el('input', {
  class: 'login-input',
  type: 'password',
  placeholder: 'password',
 });
 const submit = el('button', { class: 'submit-btn' }, 'enter');
 const errorSlot = el('div', { class: 'error-slot' });

 submit.addEventListener('click', async () => {
  submit.disabled = true;
  errorSlot.innerHTML = '';
  const wait = beginWait(errorSlot, 'checking…');
  try {
   await api('/api/login', { password: input.value });
   wait.done();
   startLiveRefresh();
   navTo('mode');
  } catch (e) {
   const rejected = e instanceof ApiError && e.status === 401;
   wait.failed(e, rejected ? 'wrong password' : undefined);
   submit.disabled = false;
   input.focus();
  }
 });

 input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit.click();
 });

 div.append(heading, input, submit, errorSlot);
 surface.append(div);
 input.focus();
}

/* ── Setup screen ── */

function renderSetup() {
 clear();
 // No nav before auth: a stale shell from a previous session leaves.
 main.querySelector('.topnav')?.remove();
 state.screen = 'setup';

 const div = el('div', { class: 'screen active login-form' });
 const heading = el('h1', { class: 'login-heading' }, 'set a password');
 const hint = el('p', { style: 'color: var(--dim); font-size: 0.9rem; margin-bottom: 0.5rem' }, 'choose a password to gate LAN access');
 const input = el('input', {
  class: 'login-input',
  type: 'password',
  placeholder: 'password',
 });
 const confirm = el('input', {
  class: 'login-input',
  type: 'password',
  placeholder: 'confirm password',
 });
 // Who the vault is about — optional, skippable, changeable later via
 // POST /api/profile. The wiki writes about the person; given a name and
 // pronouns it uses them instead of "the user".
 const nameHint = el('p', { style: 'color: var(--dim); font-size: 0.9rem; margin: 0.75rem 0 0.5rem' }, 'what should the wiki call you? (optional)');
 const nameInput = el('input', {
  class: 'login-input',
  type: 'text',
  placeholder: 'your name',
 });
 const pronounsInput = el('input', {
  class: 'login-input',
  type: 'text',
  placeholder: 'your pronouns (e.g. they/them)',
 });
 const submit = el('button', { class: 'submit-btn' }, 'set password');
 const errorSlot = el('div', { class: 'error-slot' });
 const backLink = el('button', { class: 'nav-link' }, '\u2190 back');
 backLink.addEventListener('click', () => navTo('mode'));

 submit.addEventListener('click', async () => {
  const pw = input.value;
  if (!pw) {
   errorSlot.innerHTML = '';
   errorSlot.append('password cannot be empty');
   return;
  }
  if (pw !== confirm.value) {
   errorSlot.innerHTML = '';
   errorSlot.append('passwords do not match');
   return;
  }
  submit.disabled = true;
  errorSlot.innerHTML = '';
  const wait = beginWait(errorSlot, 'saving the password…');
  try {
   await api('/api/setup', { password: pw });
   // Best-effort: the password gate is set either way, and the profile can
   // be set later through the same route.
   if (nameInput.value.trim() || pronounsInput.value.trim()) {
    try {
     await api('/api/profile', {
      name: nameInput.value.trim(),
      pronouns: pronounsInput.value.trim(),
     });
    } catch {
     // The vault opens without a profile; nothing is lost but the name.
    }
   }
   wait.done();
   navTo('mode');
  } catch (e) {
   wait.failed(e);
   submit.disabled = false;
  }
 });

 confirm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit.click();
 });

 div.append(backLink, heading, hint, input, confirm, nameHint, nameInput, pronounsInput, submit, errorSlot);
 surface.append(div);
 input.focus();
}

/* ── Unprompted entry: a blank page, no question ── */

function renderUnprompted() {
 clear();
 state.screen = 'unprompted';
 renderShell();
 state.sessionId = null;
 state.question = null;
 state.proposals = [];
 state.decisions = [];

 const div = el('div', { class: 'screen active' });

 const backRow = el('div', { class: 'blank-page-nav' });
 const backBtn = el('button', { class: 'nav-link' }, '← back');
 backBtn.addEventListener('click', () => navTo('mode'));
 backRow.append(backBtn);

 const page = el('textarea', {
  class: 'blank-page',
  rows: '1',
 }) as HTMLTextAreaElement;
 const pageTracker = pasteTracker(page);

 const micBtn = el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
 const micStatus = el('span', { class: 'mic-status' });
 const doneBtn = el('button', { class: 'harvest-now' }, 'done');
 const pageControls = el('div', { class: 'blank-page-controls' });
 pageControls.append(micBtn, micStatus, doneBtn);
 const errorSlot = el('div', { class: 'error-slot' });

 function grow() {
  page.style.height = 'auto';
  page.style.height = page.scrollHeight + 'px';
 }
 page.addEventListener('input', grow);

 doneBtn.addEventListener('click', async () => {
  const text = page.value.trim();
  if (!text) return;
  const pasted = pageTracker.isPasted(text);
  pageTracker.reset();
  doneBtn.disabled = true;
  page.disabled = true;
  errorSlot.innerHTML = '';
  const wait = beginWait(errorSlot, 'reading what you wrote…');
  try {
   const res = await api<EndResponse>(
    '/api/unprompted',
    { text, channel: pasted ? 'pasted' : state.turnHadSpeech ? 'spoken' : 'typed' },
   );
   state.sessionId = res.sessionId;
   state.pendingReviewSession = res.sessionId;
   wait.done();
   state.turnHadSpeech = false;
   navTo('reviews');
  } catch (e) {
   wait.failed(e);
   doneBtn.disabled = false;
   page.disabled = false;
  }
 });

 div.append(backRow, page, pageControls, errorSlot);
 surface.append(div);

 wireDictation(dictationDeps, {
  textarea: page,
  micBtn,
  micStatus,
  errorSlot,
  onSpeech: () => { state.turnHadSpeech = true; },
 });

 requestAnimationFrame(() => {
  page.focus();
  grow();
 });
}

/* ── Done screen ── */

function renderDone() {
 clear();
 state.screen = 'done';
 renderShell();
 const div = el('div', { class: 'screen active' });
 const msg = el(
  'p',
  { class: 'done-message' },
  'your answers are saved.',
 );
 const backBtn = el('button', { class: 'submit-btn', style: 'margin-top: 1rem' }, 'back');
 backBtn.addEventListener('click', () => navTo('mode'));
 div.append(msg, backBtn);

  if (state.pendingBuds.length > 0) {
   const budsSection = el('div', { class: 'done-buds' });
   budsSection.append(el('p', { class: 'done-buds-heading' }, `${state.pendingBuds.length} fragment${state.pendingBuds.length === 1 ? '' : 's'} did not stand on ${state.pendingBuds.length === 1 ? 'its' : 'their'} own`));
   for (const bud of state.pendingBuds) {
    const b = bud as { text: string };
    budsSection.append(el('p', { class: 'done-bud-text' }, b.text));
   }
   div.append(budsSection);
  }
 surface.append(div);
}



/* ── the material screen: choosing what a Piece is made of ── */

function renderMaterial() {
 clear();
 state.screen = 'material';
 renderShell();

 const div = el('div', { class: 'screen active material-surface' });

 const nav = el('div', { class: 'material-nav' });
 // One margin word, present only while at least one paragraph is lit.
 const compose = el('button', { class: 'nav-link' }, 'compose');
 compose.hidden = true;
 nav.append(compose);
 div.append(nav);

 // The library's two tabs: the material stack and the dated piece lines.
 const tabs = el('div', { class: 'library-tabs' });
 const snippetsTab = el('button', { class: 'nav-link library-tab here' }, 'snippets');
 const piecesTab = el('button', { class: 'nav-link library-tab' }, 'pieces');
 snippetsTab.dataset.tab = 'snippets';
 piecesTab.dataset.tab = 'pieces';
 tabs.append(snippetsTab, ' \u00b7 ', piecesTab);
 div.append(tabs);

 const column = el('div', { class: 'material-column' });
 div.append(column);
 surface.append(div);

 const selected = new Set<string>();

 compose.addEventListener('click', () => {
  const ids = [...selected];
  if (ids.length === 0) return;
  const wait = beginWait(column, 'stacking them\u2026');
  api<PieceEnriched>('/api/piece', { snippets: ids })
   .then((piece) => {
    wait.done();
    setCurrentPieceId(piece.id);
    navTo('piece');
   })
   .catch((e: unknown) => wait.failed(e));
 });

 const wait = beginWait(column, 'reading\u2026');
 (async () => {
  try {
   const [snippetsRes, piecesRes] = await Promise.all([
    api<{ snippets: Snippet[] }>('/api/snippets'),
    api<{ pieces: PieceLite[] }>('/api/pieces'),
   ]);
   wait.done();
   paintMaterial(column, snippetsRes.snippets, piecesRes.pieces, selected, compose, tabs);
  } catch (e) {
   wait.failed(e);
  }
 })();
}

function paintMaterial(
 column: HTMLElement,
 snippets: Snippet[],
 pieces: PieceLite[],
 selected: Set<string>,
 compose: HTMLButtonElement,
 tabs: HTMLElement,
) {
 column.innerHTML = '';

 // The snippets tab: the material as a stack — dated paragraphs, most
 // recent first — under a filter that hides lines as you type. The server
 // carries no sitting date here, so captured order stands in — a known
 // presentational deviation, recorded by the driver; the load-bearing
 // sitting order happens server-side at pinning time (Q-59).
 const snippetsArea = el('div', { class: 'library-snippets' });
 const filter = el('input', { class: 'library-filter', type: 'text', placeholder: 'filter your words\u2026' });
 snippetsArea.append(filter);
 const stacked = [...snippets].sort((a, b) => b.captured.localeCompare(a.captured));
 const rows: { para: HTMLElement; prose: string }[] = [];
 const list = el('div', { class: 'material-snippets' });
 for (const s of stacked) {
  const para = el('div', { class: 'material-snippet' });
  para.append(
   el('span', { class: 'material-date' }, readableDate(s.captured)),
   el('p', { class: 'material-prose' }, s.prose),
  );
  if (selected.has(s.id)) para.classList.add('lit');
  // Touching a paragraph lights it: ink goes dim to full, the way the
  // harvest surface keeps a span by touching it (Q-58).
  para.addEventListener('click', () => {
   if (selected.has(s.id)) {
    selected.delete(s.id);
    para.classList.remove('lit');
   } else {
    selected.add(s.id);
    para.classList.add('lit');
   }
   compose.hidden = selected.size === 0;
   compose.textContent = `compose ${selected.size}`;
  });
  list.append(para);
  rows.push({ para, prose: s.prose });
 }
 snippetsArea.append(
  stacked.length === 0 ? el('p', { class: 'empty-msg' }, 'nothing here yet') : list,
 );

 // The pieces tab: dated lines, one per piece, with the first pin's
 // opening words as a preview when it has any.
 const piecesArea = el('div', { class: 'material-pieces' });
 if (pieces.length === 0) {
  piecesArea.append(el('p', { class: 'empty-msg' }, 'nothing here yet'));
 } else {
  for (const p of pieces) {
   const firstPin = p.arrangement?.entries.find((e) => e.kind === 'pin');
   const prose = firstPin?.kind === 'pin' ? firstPin.prose : undefined;
   let text = readableDate(p.created);
   if (prose) {
    const preview = prose.replace(/\s+/g, ' ').trim();
    text += ' \u2014 ' + (preview.length > 48 ? preview.slice(0, 48) + '\u2026' : preview);
   }
   const line = el('button', { class: 'nav-link material-piece-line' }, text);
   line.addEventListener('click', () => {
    setCurrentPieceId(p.id);
    navTo('piece');
   });
   piecesArea.append(line);
  }
 }

 // Both tabs stay rendered in the column, so the selection and the filter
 // survive a switch; the tabs only move which region is visible.
 column.append(snippetsArea);
 column.append(piecesArea);
 piecesArea.hidden = true;

 const tabButtons = tabs.querySelectorAll<HTMLButtonElement>('.library-tab');
 for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
   for (const other of tabButtons) other.classList.remove('here');
   btn.classList.add('here');
   snippetsArea.hidden = btn.dataset.tab !== 'snippets';
   piecesArea.hidden = btn.dataset.tab !== 'pieces';
  });
 }

 filter.addEventListener('input', () => {
  const q = filter.value.trim().toLowerCase();
  for (const row of rows) row.para.hidden = q !== '' && !row.prose.toLowerCase().includes(q);
 });
}

/* ─── Bootstrap ─── */

(async () => {
 // First paint waits on two calls. If they are quick the page just appears;
 // if they are not, the page says it is starting rather than sitting blank.
 const wait = beginWait(surface, 'starting…', 400);
 try {
  // Check if password needs to be set (no auth file; we are on loopback)
  let needsSetup = false;
  try {
   const resp = await fetch('/api/auth/status');
   if (resp.ok) {
    const status = await resp.json() as { needsSetup: boolean };
    needsSetup = status.needsSetup;
   }
  } catch { /* server may return HTML on non-loopback */ }

  if (needsSetup) {
   // A fresh install still honors a deep link; only the default differs —
   // home carries the set-a-password hint until a password exists.
   const fromHash = screenFromHash();
   startLiveRefresh();
   if (fromHash && fromHash !== 'mode' && fromHash !== 'home') navTo(fromHash);
   else renderMode(modeDeps, true);
   return;
  }

  // Auth file exists — check if we have a valid session
  try {
   await api<QueueData>('/api/queue');
   startLiveRefresh();
   // The hash names a screen; empty or unknown takes the default boot.
   const fromHash = screenFromHash();
   if (fromHash) navTo(fromHash); else renderMode(modeDeps, false);
  } catch {
   renderLogin();
  }
 } finally {
  wait.done();
 }
})();
