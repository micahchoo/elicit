import type {
 CaptureChannel,
 CutProposal,
 GateReading,
 HarvestDecision,
 Mode,
 Snippet,
 SoundingEnd,
 Target,
} from '../src/types.ts';
import { relativeTime } from '../src/log/format.js';
import { MINUTE_LADDER } from '../src/queue/mode-needs.js';
import { descentCloseWord, originWord, sourceWord, type OpenerSource } from './provenance.js';
import { renderImportEntry } from './import-entry.js';
import { renderCoachPage } from './coach.js';
import { initPanelLine } from './panel-line.js';
import { renderWaiting, takeDrmResumeProbe } from './waiting.js';
import { renderWiki, releaseWiki } from './wiki.js';
import { renderPiece, setCurrentPieceId, pieceWait, type PieceEnriched, type PieceLite } from './piece.js';
import { ApiError } from './deps.js';
import type { ActivityEvent, HarvestQueueEntry, QueueData } from './deps.js';
import { initTerritory } from './territory.js';
import { readableDate } from './dates.js';
import { lineageBlock } from './lineage.js';
import { pasteTracker } from './paste-tracker.js';
import { HARVEST_FAILED_SENTENCE, harvestFailedFor } from './harvest-failure.js';
import { protocolOptionRows, type ProtocolRow } from './protocol-options.js';
import { validTrim as validTrimRule } from './trim-validity.js';
import { triadSurface, toggleTriad, type PhaseMetaLike } from './triad-surface.js';

/* ─── API types ─── */

interface SessionResponse {
 sessionId: string;
 question: string;
 /** Present when the Randomizer dealt the opener (Q-18). */
 source?: OpenerSource;
 /** Display-only lineage of a resurfaced opener (080) — never part of the question. */
 snippetQuestion?: string;
 context?: string;
 /** The rotated pulse prompt (ticket 105): present when the server wants a momentary-state line. */
 pulsePrompt?: string;
 /** The protocol this sitting uses — auto-rotated by server (ticket 140). */
 protocol?: string;
 /** Fragment quoted in the opening question (Q-104): carries the "not mine" verb. */
 quotedFragment?: string;
 /** Snippet ref for the opening question's quoted fragment (Q-109). */
 snippetRef?: string;
}

interface TurnData {
 kind: 'probe' | 'saturated' | 'checkpoint' | 'descent-closed' | 'declined' | 'door' | 'continue';
 text?: string;
 juxtaposition?: { snippetText: string; snippetDate: string };
 /** Live descent reading (012 T9): present on every rung, never cached. */
 sounding?: GateReading;
 /** The one-shot offer (012 T9): present at most once per sitting. */
 soundingOffer?: { construct: string; allowance: number; sentence: string };
 /** The descent closed on this answer (012 T9) — cap or convergence, no gate press. */
 descentClosed?: SoundingEnd;
 /** Closing acknowledgment rendered before navigating to reviews (ticket 135). */
 closingText?: string;
 /** Fragment quoted in the question (Q-104): present on probe responses, carries the "not mine" verb. */
 quotedFragment?: string;
 /** Snippet ref for the current question's quoted fragment (Q-109): rides with quotedFragment. */
 snippetRef?: string;
 /**
  * The machine phase meta (ticket 159, slice 4): every sitting now carries
  * a machine (reflective formalized), so the turn response's `phase` field
  * is always the machine shape { id, label, step, of } — the polymorphic
  * session-phase-string wire is retired. Other routes that reuse the type
  * (the sounding gate) still send the session phase string, which
 *  applyProbe ignores.
 */
phase?: PhaseMetaLike;
}

interface EndResponse {
 sessionId: string;
}

interface HarvestQueueRecord {
 sessionId: string;
 proposals: CutProposal[];
}

/** GET /api/protocols — the open set the mode row renders (tickets 153/157). */
interface ProtocolsResponse {
 protocols: ProtocolRow[];
}

/**
 * The once-fetched protocol metadata (ticket 157): the exchange label, the
 * DRM screen, and the mode picker all render the def TITLE mapped client-side
 * from GET /api/protocols. Fetched once, cached in module state; a failed
 * fetch falls back to the registry key, which still renders. `protocolRows`
 * doubles as the picker's row source, so the picker and the labels can never
 * disagree about the set.
 */
const protocolRows: ProtocolRow[] = [];
let protocolMetaPromise: Promise<void> | null = null;

function ensureProtocolMeta(): Promise<void> {
 if (!protocolMetaPromise) {
  protocolMetaPromise = api<ProtocolsResponse>('/api/protocols')
   .then((res) => {
    protocolRows.length = 0;
    protocolRows.push(...res.protocols);
   })
   .catch((e) => {
    console.error('could not fetch protocol titles \u2014 surfaces render with registry ids', e);
   });
 }
 return protocolMetaPromise;
}

/** The def's title for a registry key; the key itself when unknown (ticket 157). */
function protocolTitle(id: string): string {
 const row = protocolRows.find((p) => p.id === id);
 return row ? (row.title || row.name) : id;
}

interface HarvestResponse {
 buds: unknown[];
}

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

/* ─── Navigation ─── */

function navTo(screen: Screen, opts?: { focus?: string; folder?: string; slug?: string }) {
 const target = '#/' + screen;
 if (location.hash !== target) location.hash = target;
 state.screen = screen;
 if (screen === 'coach' && opts?.slug !== undefined) state.coachSlug = opts.slug;
 switch (screen) {
  case 'mode':
  case 'home': renderMode(); break;
  case 'exchange':
   // A sitting must be under way; a bare hash cannot fake one.
   if (!state.sessionId) { navTo('home'); break; }
   renderExchange(); break;
  case 'harvest':
   // A harvest needs a session and its proposals; otherwise home.
   if (!state.sessionId || state.proposals.length === 0) { navTo('home'); break; }
   renderHarvest(); break;
  case 'done': renderDone(); break;
  case 'waiting': renderWaiting({
   main: surface, el, api,
   navTo: (s: string, opts?: { focus?: string; folder?: string; slug?: string }) => navTo(s as Screen, opts),
   beginWait,
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   screen: () => state.screen,
   sessionId: () => state.sessionId,
   setQuestion: (q: string) => { state.question = q; },
   text: (s: string) => document.createTextNode(s),
   fetch,
  }); break;
  case 'reviews':
  case 'inbox': renderReviews(); break;
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
   }, state.coachSlug);
   break;
  case 'piece': renderPiece({
   main: surface, el, api, navTo: (s: string) => navTo(s as Screen),
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   document,
   wireDictation,
  }); break;
  case 'drm':
   if (!state.sessionId) { navTo('home'); break; }
   renderDRM(); break;
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

/* ── Mode screen ── */

function renderMode(showSetupHint?: boolean) {
 clear();
 state.screen = 'mode';
 renderShell();
 state.juxtaposition = null;

 const div = el('div', { class: 'screen active mode-form' });

 // Region one — begin: the sitting controls, under one heading.
 const beginHeading = el('h2', { class: 'home-heading' }, 'start a sitting');

 const minutesRow = el('div', { class: 'mode-row' });
 const minLabel = el('label', {}, 'how long?');
 const minSelect = el('select', { class: 'mode-select' });
 for (const m of MINUTE_LADDER) {
  minSelect.append(el('option', { value: String(m) }, `${m} minutes`));
 }
 minutesRow.append(minLabel, minSelect);

 const energyRow = el('div', { class: 'mode-row' });
 const enLabel = el('label', {}, 'energy?');
 const enSelect = el('select', { class: 'mode-select' });
 for (const e of ['low', 'medium', 'high'] as const) {
  enSelect.append(el('option', { value: e }, e));
 }
 energyRow.append(enLabel, enSelect);

 const targetRow = el('div', { class: 'mode-row' });
 const tgtLabel = el('label', {}, 'about?');
 const tgtSelect = el('select', { class: 'mode-select' });
 tgtSelect.append(el('option', { value: 'self' }, 'myself'));
 tgtSelect.append(el('option', { value: 'domain' }, 'something I know'));
 targetRow.append(tgtLabel, tgtSelect);

 // The protocol row (tickets 153/157): one quiet radio list in the mode
 // grammar — "let it choose" first (rotation — no protocol sent), then one
 // row per protocol from the open set the ROUTE returns, never a hardcoded
 // list: the TITLE as the option label, the blurb dimmed under it,
 // "(explicit only)" for rotation:false instruments (drm, people-grid —
 // Q-85) the server never picks on its own. The row enters the DOM only
 // when the fetch succeeds; a failure logs to the console and renders no
 // row — rotation still works, and the row's absence is not an error state.
 const protocolRow = el('div', { class: 'mode-row protocol-row' });
 const protoLabel = el('label', {}, 'protocol?');
 const optionList = el('div', { class: 'protocol-options' });
 protocolRow.append(protoLabel, optionList);

 /** One quiet radio: the title as the label, the blurb dimmed under it. */
 function protocolRadio(id: string, label: string, blurb: string | undefined, explicitOnly: boolean): HTMLLabelElement {
  const input = el('input', { type: 'radio', name: 'protocol-pick', value: id });
  if (id === '') input.checked = true;
  const labelSpan = el('span', { class: 'protocol-option-label' }, label);
  if (explicitOnly) labelSpan.append(el('span', { class: 'protocol-explicit-only' }, ' (explicit only)'));
  const option = el('label', { class: 'protocol-option' });
  option.append(input, labelSpan);
  if (blurb !== undefined) option.append(el('span', { class: 'protocol-option-blurb' }, blurb));
  return option;
 }

 void ensureProtocolMeta()
  .then(() => {
   if (protocolRows.length === 0) return;
   optionList.append(protocolRadio('', 'let it choose', undefined, false));
   for (const row of protocolOptionRows(protocolRows)) {
    optionList.append(protocolRadio(row.id, row.label, row.blurb, row.explicitOnly));
   }
   div.insertBefore(protocolRow, topicInput);
  });

 const topicInput = el('input', {
  class: 'topic-input',
  type: 'text',
  placeholder: 'what would you like to talk about? (optional)',
 });

 const navRow = el('div', { class: 'mode-nav' });
 const writeLink = el('button', { class: 'nav-link' }, 'just write');
 writeLink.addEventListener('click', () => navTo('unprompted'));
 navRow.append(writeLink);

 if (showSetupHint) {
  const setupLink = el('button', { class: 'nav-link' }, 'set a password');
  setupLink.addEventListener('click', () => navTo('setup'));
  navRow.append(setupLink);
 }

 const submit = el('button', { class: 'submit-btn' }, 'begin');
 const errorSlot = el('div', { class: 'error-slot' });

 async function begin(shuffle: boolean) {
  submit.disabled = true;
  shuffleLink.disabled = true;
  errorSlot.innerHTML = '';
  const wait = beginWait(
   errorSlot,
   shuffle ? 'shuffling…' : 'finding a question…',
  );
  try {
   const mode: Mode = {
    minutes: Number(minSelect.value),
    energy: enSelect.value as Mode['energy'],
    target: tgtSelect.value as Target,
   };
   const t = topicInput.value.trim();
   if (t) mode.topic = t;

   // The protocol rides the session when the person picked one; "let it
   // choose" sends nothing — absent means rotation, exactly as before
   // (ticket 153). exactOptionalPropertyTypes: the field is added, never
   // assigned undefined.
   const body: { mode: Mode; shuffle?: boolean; protocol?: string } =
    shuffle ? { mode, shuffle: true } : { mode };
   const checked = optionList.querySelector<HTMLInputElement>('input[name="protocol-pick"]:checked');
   const protocolId = checked?.value ?? '';
   if (protocolId !== '') body.protocol = protocolId;
   const res = await api<SessionResponse>('/api/session', body);
   state.sessionId = res.sessionId;
   state.sessionProtocol = res.protocol ?? null;
   // A fresh sitting starts with no machine phase meta (ticket 159, slice 3).
   state.phaseMeta = null;
   state.quotedFragment = res.quotedFragment ?? null;
   state.snippetRef = res.snippetRef ?? null;
   state.lineageQuestion = res.snippetQuestion ?? null;
   state.lineageContext = res.context ?? null;
   state.openerSource = res.source ?? null;
   // The clock counts down from the declared minutes; the deadline is set
   // once, here, so re-rendering the exchange screen does not reset it.
   state.sessionDeadline = Date.now() + mode.minutes * 60_000;
   // Pulse prompt present (ticket 105): hold the question, show pulse first
   if (res.pulsePrompt) {
    state.pulsePrompt = res.pulsePrompt;
    state.pendingQuestion = res.question;
    state.question = null;
   } else {
    state.pulsePrompt = null;
    state.pendingQuestion = null;
    state.question = res.question;
   }
   wait.done();
   renderExchange();
  } catch (e) {
   wait.failed(e);
   submit.disabled = false;
   shuffleLink.disabled = false;
  }
 }

 // The Randomizer, as a sentence rather than a button row (the document rule
 // in docs/interface-references.md): the control is the two words that name
 // what happens, sitting at the point of attention just under "begin".
 const shuffleRow = el('div', { class: 'mode-aside' });
 const shuffleLink = el('button', { class: 'nav-link' }, 'shuffle a deck');
 shuffleRow.append(document.createTextNode('or '), shuffleLink, document.createTextNode('.'));

 submit.addEventListener('click', () => void begin(false));
 shuffleLink.addEventListener('click', () => void begin(true));

 topicInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit.click();
 });

 // Stop all jobs: the quiet switch for the background clerk — no new docket
 // run, no drain chain, no import re-trigger until resume or a restart. It
 // sits beside fresh start because fresh start refuses while a run is in
 // flight; stopping first is how you quiet the server to get one.
 const jobsRow = el('div', { class: 'mode-aside stop-jobs-row' });
 const stopLink = el('button', { class: 'nav-link' }, 'stop all jobs');
 jobsRow.append(stopLink);
 stopLink.addEventListener('click', () => {
  void (async () => {
   stopLink.disabled = true;
   try {
    const res = await api<{ ok: boolean; inFlight: boolean }>('/api/jobs/stop', {});
    jobsRow.replaceChildren(
     el(
      'span',
      { class: 'fresh-start-note' },
      res.inFlight
       ? 'jobs stopped — the run in flight finishes, then nothing new starts. '
       : 'jobs stopped — nothing new starts. ',
     ),
    );
    const resumeLink = el('button', { class: 'nav-link' }, 'resume jobs');
    resumeLink.addEventListener('click', () => {
     void (async () => {
      resumeLink.disabled = true;
      try {
       await api('/api/jobs/resume', {});
       stopLink.disabled = false;
       jobsRow.replaceChildren(stopLink);
      } catch (err) {
       resumeLink.disabled = false;
       showError(err instanceof Error ? err.message : String(err));
      }
     })();
    });
    jobsRow.append(resumeLink);
   } catch (err) {
    stopLink.disabled = false;
    showError(err instanceof Error ? err.message : String(err));
   }
  })();
 });

 // Fresh start: the whole personal archive moves aside, nothing deleted.
 // Host-only — the server refuses non-loopback callers — and armed only by
 // typing the phrase, so a stray tap can never move a vault. In the
 // document rule's idiom the control is the words that name what happens,
 // sitting quietly at the bottom of the screen.
 const freshRow = el('div', { class: 'mode-aside fresh-start-row' });
 const freshLink = el('button', { class: 'nav-link' }, 'start fresh…');
 freshRow.append(freshLink);
 freshLink.addEventListener('click', () => {
  freshRow.innerHTML = '';
  const note = el(
   'div',
   { class: 'fresh-start-note' },
   'Moves the vault and every personal record into archives/ — nothing is deleted, instruments stay. The server exits; you start it again for a fresh vault.',
  );
  const phrase = el('input', {
   class: 'topic-input',
   type: 'text',
   placeholder: 'type "fresh start" to confirm',
  });
  const go = el('button', { class: 'nav-link' }, 'archive & start fresh');
  const cancelLink = el('button', { class: 'nav-link' }, 'cancel');
  const slot = el('div', { class: 'error-slot' });
  cancelLink.addEventListener('click', () => renderMode(showSetupHint));
  go.addEventListener('click', () => {
   void (async () => {
    go.disabled = true;
    slot.textContent = '';
    try {
     const res = await api<{ ok: boolean; archiveDir: string; moved: string[] }>(
      '/api/fresh-start',
      { confirm: phrase.value.trim() },
     );
     clear();
     const done = el('div', { class: 'screen active mode-form' });
     done.append(
      el('h2', { class: 'home-heading' }, 'fresh start'),
      el(
       'div',
       { class: 'fresh-start-note' },
       `${res.moved.length} records archived to ${res.archiveDir}. ` +
        'The server has exited — start it again, reload this page, and set a new password.',
      ),
     );
     surface.append(done);
    } catch (err) {
     go.disabled = false;
     slot.textContent = err instanceof Error ? err.message : String(err);
    }
   })();
  });
  freshRow.append(note, phrase, go, cancelLink, slot);
 });

 div.append(beginHeading, minutesRow, energyRow, targetRow, topicInput, navRow, submit, shuffleRow, errorSlot, jobsRow, freshRow);

 // One-time ask on vaults set up before the profile existed: the wiki
 // writes about the person, and given a name it stops calling them "the
 // user". Skippable; skip is remembered in this browser.
 if (localStorage.getItem('profile-asked') === null) {
  void (async () => {
   try {
    const existing = await api<{ name?: string; pronouns?: string }>('/api/profile', undefined, { method: 'GET' });
    if (existing.name || existing.pronouns) return;
    const box = el('div', { class: 'mode-row', style: 'flex-direction: column; align-items: stretch; gap: 0.4rem; margin-top: 1rem' });
    const ask = el('p', { style: 'color: var(--dim); font-size: 0.9rem; margin: 0' }, 'what should the wiki call you?');
    const nameInput = el('input', { class: 'topic-input', type: 'text', placeholder: 'your name' });
    const pronounsInput = el('input', { class: 'topic-input', type: 'text', placeholder: 'your pronouns (e.g. they/them)' });
    const row = el('div', { style: 'display: flex; gap: 0.5rem' });
    const save = el('button', { class: 'submit-btn' }, 'save');
    const skip = el('button', { class: 'nav-link' }, 'skip');
    save.addEventListener('click', async () => {
     try {
      await api('/api/profile', { name: nameInput.value.trim(), pronouns: pronounsInput.value.trim() });
      localStorage.setItem('profile-asked', 'yes');
      box.remove();
     } catch { /* leave the box; the next click retries */ }
    });
    skip.addEventListener('click', () => {
     localStorage.setItem('profile-asked', 'yes');
     box.remove();
    });
    row.append(save, skip);
    box.append(ask, nameInput, pronounsInput, row);
    div.append(box);
   } catch { /* not signed in yet, or no server — never block the home screen */ }
  })();
 }
 surface.append(div);
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

 wireDictation({
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

/* ── Exchange screen ── */

let exchangeTurnCount = 0;
/** The session clock's interval, stopped when the screen it hangs on leaves. */
let clockTimer: ReturnType<typeof setInterval> | null = null;

// ── STT recording ──

let _micStream: MediaStream | null = null;
let _audioCtx: AudioContext | null = null;
let _workletNode: AudioWorkletNode | null = null;
let _samples: Float32Array[] = [];
/** One recording at a time, shared across every writing surface: the mic
 * stream is module state, so a surface re-paint or a navigation never
 * strands a live recording behind a stale closure. */
let dictationActive = false;
let dictationBusy = false;

async function startRecording(): Promise<void> {
 _samples = [];
 _audioCtx = new AudioContext({ sampleRate: 16000 });
 _micStream = await navigator.mediaDevices.getUserMedia({
  audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
 });

 // Inline AudioWorklet processor — downsamples to mono Float32
 const workletCode = `
    class RecorderProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (input && input.length > 0) {
          const ch = input[0];
          if (ch) {
            const copy = new Float32Array(ch.length);
            copy.set(ch);
            this.port.postMessage(copy, [copy.buffer]);
          }
        }
        return true;
      }
    }
    registerProcessor('recorder-processor', RecorderProcessor);
  `;
 const blob = new Blob([workletCode], { type: 'application/javascript' });
 const url = URL.createObjectURL(blob);
 await _audioCtx.audioWorklet.addModule(url);
 URL.revokeObjectURL(url);

 _workletNode = new AudioWorkletNode(_audioCtx, 'recorder-processor');
 _workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
  _samples.push(e.data);
 };

 const source = _audioCtx.createMediaStreamSource(_micStream);
 source.connect(_workletNode);
}

async function stopAndTranscribe(): Promise<string> {
 // Stop media
 _workletNode?.port.close();
 _workletNode?.disconnect();
 _workletNode = null;
 _micStream?.getTracks().forEach((t) => t.stop());
 _micStream = null;
 await _audioCtx?.close();
 _audioCtx = null;

 if (_samples.length === 0) return '';

 // Concatenate all chunks
 let totalLen = 0;
 for (const chunk of _samples) totalLen += chunk.length;
 const combined = new Float32Array(totalLen);
 let offset = 0;
 for (const chunk of _samples) {
  combined.set(chunk, offset);
  offset += chunk.length;
 }
 _samples = [];

 // POST raw Float32 to server
 const res = await fetch('/api/transcribe?rate=16000', {
  method: 'POST',
  body: combined.buffer,
 });
 if (!res.ok) {
  if (res.status === 401) { navTo('login'); throw new Error('Unauthorized'); }
  const errText = await res.text();
  throw new Error(`transcribe failed: ${res.status} ${errText}`);
 }
 const data = await res.json() as { text: string };
 return data.text;
}

/* ── Shared dictation wiring ── */

/**
 * How long a spacebar hold must last before it counts as a long press.
 * A tap releases well before this; the OS key-repeat delay is typically
 * longer, so a held key never types repeated spaces either way.
 */
const LONG_PRESS_MS = 400;

/**
 * Wire dictation onto one writing surface: the mic button and a long
 * press on the spacebar both toggle recording, and the transcript lands
 * at the cursor. The spacebar press is intercepted so a hold never types
 * spaces — a release before the deadline inserts the one space the press
 * owed, and a hold past it spends the press on the toggle instead.
 */
function wireDictation(opts: {
 textarea: HTMLTextAreaElement;
 micBtn: HTMLButtonElement;
 micStatus: HTMLSpanElement;
 errorSlot: HTMLElement;
 onSpeech?: () => void;
}) {
 const { textarea, micBtn, micStatus, errorSlot } = opts;

 // A re-painted surface picks up a recording that is already live.
 if (dictationActive) {
  micBtn.classList.add('active');
  micStatus.textContent = 'listening\u2026';
 }

 const insertAtCursor = (text: string) => {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start ?? textarea.value.length);
  const after = textarea.value.slice(end ?? textarea.value.length);
  textarea.value = before + text + after;
  textarea.dispatchEvent(new Event('input'));
  const pos = (start ?? textarea.value.length) + text.length;
  textarea.setSelectionRange(pos, pos);
  textarea.focus();
 };

 const toggle = async () => {
  if (dictationBusy) return;
  if (!dictationActive) {
   // Start recording
   try {
    await startRecording();
    dictationActive = true;
    micBtn.classList.add('active');
    micStatus.textContent = 'listening\u2026';
   } catch (e) {
    console.error(e);
    showQuietError(errorSlot, 'the microphone did not open — check permission');
   }
  } else {
   // Stop and transcribe
   dictationActive = false;
   dictationBusy = true;
   micBtn.classList.remove('active');
   micBtn.disabled = true;
   micStatus.textContent = 'transcribing\u2026';
   try {
    const text = await stopAndTranscribe();
    if (text) {
     opts.onSpeech?.();
     insertAtCursor(text);
    }
   } catch (e) {
    console.error(e);
    showQuietError(errorSlot, 'that did not come through — say it again');
   }
   dictationBusy = false;
   micBtn.disabled = false;
   micStatus.textContent = '';
  }
 };

 micBtn.addEventListener('click', () => void toggle());

 // Long-press spacebar: every space keydown is prevented, so holding the
 // key never auto-repeats; the space is inserted by hand on keyup unless
 // the hold outlived LONG_PRESS_MS, which spends the press on the toggle.
 let pressTimer: number | null = null;
 let pressConsumed = false;
 let spaceDown = false;

 textarea.addEventListener('keydown', (e) => {
  if (e.key !== ' ') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // let shortcuts through
  e.preventDefault();
  if (e.repeat) return;
  spaceDown = true;
  pressConsumed = false;
  pressTimer = window.setTimeout(() => {
   pressTimer = null;
   if (!spaceDown) return;
   pressConsumed = true;
   void toggle();
  }, LONG_PRESS_MS);
 });

 const endPress = (insertSpace: boolean) => {
  const consumed = pressConsumed;
  spaceDown = false;
  if (pressTimer !== null) {
   clearTimeout(pressTimer);
   pressTimer = null;
  }
  pressConsumed = false;
  if (insertSpace && !consumed) insertAtCursor(' ');
 };

 textarea.addEventListener('keyup', (e) => {
  if (e.key !== ' ') return;
  endPress(true);
 });

 textarea.addEventListener('blur', () => {
  // A press that leaves the field mid-hold still owes its space.
  endPress(true);
 });

 // Check STT availability and hide the toggle if unavailable.
 (async () => {
  try {
   const status = await api<{ available: boolean }>('/api/stt/status');
   state.sttAvailable = status.available;
  } catch {
   state.sttAvailable = false;
  }
  if (!state.sttAvailable) {
   micBtn.style.display = 'none';
   micStatus.style.display = 'none';
  }
 })();
}

/**
 * The door question a gate-press close leaves behind (012 T9). The gate
 * route returns no text on descent-closed — the server appends this same
 * sentence to its transcript — so the exchange renders it itself. The
 * wording announces the descent closing, never the person stopping (Q-46).
 */

/**
 * The opening pulse (ticket 105): a one-line inner-weather input shown
 * before the first question. Skippable with no record of the skip.
 */
function pulseExchange(container: HTMLElement) {
 const pulsePrompt = state.pulsePrompt!;
 const pendingQuestion = state.pendingQuestion!;

 const pulseBlock = el('div', { class: 'pulse-block' });
 const prompt = el('div', { class: 'pulse-prompt' }, pulsePrompt);
 const input = el('input', {
  class: 'pulse-input',
  type: 'text',
  placeholder: '\u2026',
 });
 const actions = el('div', { class: 'pulse-actions' });
 const sendWord = el('button', { class: 'nav-link', type: 'button' }, 'send');
 const skipWord = el('button', { class: 'nav-link', type: 'button' }, 'skip');
 actions.append(sendWord, skipWord);
 pulseBlock.append(prompt, input, actions);
 container.append(pulseBlock);

 // Focus the input on render
 requestAnimationFrame(() => input.focus());

 async function submit() {
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  sendWord.disabled = true;
  skipWord.disabled = true;
  try {
   await api(`/api/session/${state.sessionId}/pulse`, { text, prompt: pulsePrompt });
  } catch {
   // Pulse is never load-bearing; a failure just shows the opener.
  }
  // Proceed to the normal exchange
  state.pulsePrompt = null;
  state.question = pendingQuestion;
  state.pendingQuestion = null;
  renderExchange();
 }

async function skip() {
  state.pulsePrompt = null;
  state.question = pendingQuestion;
  state.pendingQuestion = null;
  // Fire the pulse call with empty text so the server appends the
  // pending opener to the transcript (ticket 135). Non-blocking.
  try {
   await api(`/api/session/${state.sessionId}/pulse`, { text: '', prompt: '' });
  } catch { /* skip is never load-bearing */ }
  renderExchange();
}

 sendWord.addEventListener('click', submit);
 skipWord.addEventListener('click', skip);
 input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
 });
}
const DOOR_QUESTION = "Anything else we didn't touch?";

function renderExchange() {
 clear();
 state.screen = 'exchange';
 renderShell();
 // The session clock hangs in the shell: the declared minutes, counting
 // down. It is a quiet span, never a control — at zero it says so and stops.
 if (state.sessionDeadline !== null) {
  const deadline = state.sessionDeadline;
  const nav = main.querySelector<HTMLElement>('.topnav');
  if (nav) {
   const clock = el('span', { class: 'session-clock' });
   nav.append(clock);
   const tick = () => {
    const left = deadline - Date.now();
    if (left <= 0) {
     clock.textContent = "time's up \u2014 harvest when ready";
     if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
     }
     return;
    }
    const total = Math.floor(left / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    clock.textContent = `${mm}:${ss} left`;
   };
   tick();
   clockTimer = setInterval(tick, 1000);
  }
 }
 exchangeTurnCount = 0;
 state.turnHadSpeech = false;
 // A fresh exchange screen starts with no descent and no offer (012 T9);
 // re-rendering must not inherit either from a previous screen.
 state.sounding = null;
 state.soundingOffer = null;

 const div = el('div', { class: 'screen active' });

 // ── Opening pulse (ticket 105): a one-line inner-weather input ──
 // Shown when the server includes a pulsePrompt; skipped with no record.
 if (state.pulsePrompt) {
  pulseExchange(div);
  surface.append(div);
  return;
 }


 const header = el('div', { class: 'exchange-header' });
 const openerLineage = lineageBlock(
  el,
  state.lineageQuestion ?? undefined,
  state.lineageContext ?? undefined,
 );
 if (openerLineage) header.append(openerLineage);
 // The Randomizer's provenance (Q-18): one muted margin word when the opener
 // was dealt rather than composed — the deck draw or the resurfaced past.
 // It lives and dies with the opener, exactly like the resurfacing lineage.
 const dealtLine = state.openerSource !== null
  ? el('div', { class: 'lineage-provenance' }, el('div', { class: 'lineage-context' }, sourceWord(state.openerSource)))
  : null;
 if (dealtLine) header.append(dealtLine);
 const questionBlock = el('div', { class: 'question-block' }, state.question!);

  if (state.sessionProtocol) {
   // The dimmed label above the question block renders the def TITLE
   // (ticket 157); the once-cached fetch updates it in place when it
   // lands, and a failed fetch leaves the registry id as the fallback.
   const protocolLabel = el('div', { class: 'exchange-protocol' }, protocolTitle(state.sessionProtocol));
   void ensureProtocolMeta().then(() => {
    if (!state.sessionProtocol) return;
    protocolLabel.textContent = protocolTitle(state.sessionProtocol);
   });
   header.append(protocolLabel);
  }
 // The machine phase line (ticket 159, slice 3), in the DRM probe-meta
 // grammar — quiet, 0.75rem, muted. Rendered only while a machine is
 // active; the empty line is invisible, so the question block is never
 // disturbed.
 const phaseMetaLine = el('div', { class: 'exchange-phase-meta' });
 if (state.phaseMeta) {
  phaseMetaLine.textContent = `${state.phaseMeta.label} \u2014 phase ${state.phaseMeta.step} of ${state.phaseMeta.of}`;
 }
 header.append(phaseMetaLine);
 header.append(questionBlock);
 // The triad chip surface (ticket 159, slice 7): the three names as tappable
 // chips under the question, rendered only while the active phase declares
 // the 'triads' renderer and the meta carries the names. Any other meta —
 // an unknown renderer included — leaves the row empty and the generic
 // question block stands: prose is always the floor, never a crash.
 const triadRow = el('div', { class: 'triad-row' });
 const triadChips = el('div', { class: 'triad-chips' });
 const triadHint = el('span', { class: 'triad-hint' });
 triadRow.append(triadChips, triadHint);
 header.append(triadRow);
 let selectedTriad: string[] = [];
 function paintTriadChips() {
  for (const chip of triadChips.querySelectorAll<HTMLButtonElement>('.triad-chip')) {
   const name = chip.textContent ?? '';
   chip.classList.toggle('selected', selectedTriad.includes(name));
  }
  triadHint.textContent = selectedTriad.length === 2
   ? 'tap to change \u2014 the pair rides your answer'
   : 'tap two who are alike';
 }
 function renderTriadSurface(meta: PhaseMetaLike | null) {
  selectedTriad = [];
  triadChips.innerHTML = '';
  triadHint.textContent = '';
  const surface = triadSurface(meta);
  if (surface === null) return;
  for (const name of surface.names) {
   const chip = el('button', { class: 'triad-chip', type: 'button' }, name);
   chip.addEventListener('click', () => {
    selectedTriad = toggleTriad(selectedTriad, name);
    paintTriadChips();
   });
   triadChips.append(chip);
  }
  paintTriadChips();
 }
 renderTriadSurface(state.phaseMeta);
 // Q-104: "not mine" margin verb on questions carrying a quotedFragment
 if (state.quotedFragment) {
  const repairRow = el('div', { class: 'repair-row' });
  const notMine = el('button', { class: 'repair-not-mine', type: 'button' }, 'not mine');
  repairRow.append(notMine);
  header.append(repairRow);

  // Q-109: Press expands to 'unlink · keep'
  let repairExpanded = false;
  let unlinkBtn: HTMLButtonElement;
  let keepBtn: HTMLButtonElement;

  notMine.addEventListener('click', () => {
   if (repairExpanded) return;
   repairExpanded = true;
   notMine.remove();

   unlinkBtn = el('button', { class: 'repair-unlink', type: 'button' }, 'unlink');
   const sep = el('span', { class: 'repair-sep' }, ' \u00b7 ');
   keepBtn = el('button', { class: 'repair-keep', type: 'button' }, 'keep');
   repairRow.append(unlinkBtn, sep, keepBtn);

   keepBtn.addEventListener('click', () => {
    unlinkBtn.remove();
    sep.remove();
    keepBtn.remove();
    repairRow.append(notMine);
    repairExpanded = false;
   });

   unlinkBtn.addEventListener('click', async () => {
    unlinkBtn.disabled = true;
    keepBtn.disabled = true;
    try {
     // snippetRef rides beside the fragment (Q-109); the server strips the
     // @version itself and answers with a fresh probe replacing this question.
     const turnData = await api<TurnData>(
      `/api/session/${state.sessionId}/repair`,
      {
       snippetRef: state.snippetRef ?? '',
       quotedFragment: state.quotedFragment,
      },
     );
     if (turnData.kind === 'probe') {
      state.question = turnData.text!;
      // The disavowed fragment leaves the screen; the fresh probe is a
      // new question and may carry its own fragment.
      state.quotedFragment = null;
      state.snippetRef = null;
      renderExchange();
     }
    } catch (e) {
     unlinkBtn.disabled = false;
     keepBtn.disabled = false;
    }
   });
  });
 }

 // Juxtaposition snippet display
 const juxDiv = el('div', { class: 'juxtaposition' });
 if (state.juxtaposition) {
  juxDiv.classList.add('active');
  juxDiv.append(
   el('span', { class: 'jux-date' }, state.juxtaposition.snippetDate),
   el('blockquote', { class: 'jux-quote' }, state.juxtaposition.snippetText),
  );
 }
 header.append(juxDiv);

 const transcript = el('div', { class: 'transcript' });

 const answerArea = el('div', { class: 'answer-area' });
 const answerRow = el('div', { class: 'answer-row' });
 const textarea = el('textarea', {
  class: 'answer-textarea',
  placeholder: '\u2026',
  rows: '2',
 });
 const turnTracker = pasteTracker(textarea);
 const micBtn = el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
 const micStatus = el('span', { class: 'mic-status' });
 // A visible send, beside the mic: the Enter path in word form.
 const sendBtn = el('button', { class: 'send-btn', type: 'button' }, 'send \u21b5');

 // The writing grammar allows one hint line: how Enter behaves, in dim ink.
 const answerHint = el('div', { class: 'answer-hint' }, 'Enter sends \u00b7 Shift+Enter for a new line');

// ── The sounding offer (012 T9): one sentence, two words, in the margin ──
// Shown once per sitting, below the question block. Both words are one
// click and spent on the click: declining never asks why and never returns
// (Q-43), accepting enters the descent.

let offerRow: HTMLDivElement | null = null;

function showOffer(offer: { construct: string; allowance: number; sentence: string }) {
 if (offerRow) return; // one offer per sitting — a set offer never repeats
 offerRow = el('div', { class: 'sounding-offer' });
 const sentence = el('span', { class: 'sounding-offer-sentence' }, offer.sentence);
 const acceptWord = el('button', { class: 'sounding-offer-word accept', type: 'button' }, 'accept');
 const declineWord = el('button', { class: 'sounding-offer-word decline', type: 'button' }, 'decline');
 offerRow.append(sentence, acceptWord, declineWord);
 header.append(offerRow);
 acceptWord.addEventListener('click', () => consent(true));
 declineWord.addEventListener('click', () => consent(false));
}

async function consent(accept: boolean) {
 // The word is spent the moment it is clicked (Q-43): the row is gone
 // before the call returns, either way. A decline never comes back.
 const offer = state.soundingOffer;
 if (offerRow) {
  offerRow.remove();
  offerRow = null;
 }
 state.soundingOffer = null;
 if (!accept) {
  try {
   await api<TurnData>(`/api/session/${state.sessionId}/sounding`, { accept });
  } catch (e) {
   // A decline that did not land would be re-offered on the next turn; the
   // person has already spent the word and must not be asked again (Q-43).
   showQuietError(answerArea, 'that did not land \u2014 the offer will come back');
  }
  return;
 }
 setControlsBusy(true);
 const wait = beginWait(answerArea, 'beginning\u2026');
 try {
  const res = await api<TurnData>(
   `/api/session/${state.sessionId}/sounding`,
   { accept },
  );
  wait.done();
  if (res.kind === 'probe') applyProbe(res);
 } catch (e) {
  wait.failed(e);
  setControlsBusy(false);
  // A failed accept leaves the offer on the server's table (T8 puts it
  // back for a second word); restore the row so either word can be taken.
  if (offer) {
   state.soundingOffer = offer;
   showOffer(offer);
  }
 }
}

// ── The gate (012 T9): three words under every rung of a live descent ──
// state.sounding is set on every rung and never cached, so the row is born
// on the first reading and rewritten in place on every rung after that.

// The gate row is the standard control surface on EVERY sitting (ticket
// 159, slice 4): always visible, continue enabled — the person just
// answers, and the words park / another day end the sitting. The skip
// route survives as the quiet nav-link beside the gate (the skip-rate
// metrics stay live). While a descent runs, the same row renders the
// sounding gate (012 T9): the rung reading, continue only at the
// checkpoint, park / another-day under every rung.
const gateRow = el('div', { class: 'gate-row' });
const gateReading = el('span', { class: 'gate-reading' });
const continueWord = el('button', { class: 'gate-word continue', type: 'button' }, 'continue');
const parkWord = el('button', { class: 'gate-word park', type: 'button' }, 'park, depth kept');
const anotherDayWord = el('button', { class: 'gate-word another-day', type: 'button' }, 'another day');
const skipLink = el('button', { class: 'nav-link gate-skip', type: 'button' }, 'skip');
gateRow.append(gateReading, continueWord, parkWord, anotherDayWord, skipLink);
gateRow.classList.add('visible');

// The standard surface's controls; renderGate narrows the set while a
// descent runs, and removeGateRow restores it.
let gateControls: HTMLButtonElement[] = [continueWord, parkWord, anotherDayWord];
let checkpointActive = false;

/** Render the gate row for the current reading, in the checkpoint state or out. */
function renderGate(checkpoint: boolean) {
 const reading = state.sounding;
 if (!reading) return;
 checkpointActive = checkpoint;
 continueWord.hidden = !checkpoint;
 gateControls = checkpoint
  ? [continueWord, parkWord, anotherDayWord]
  : [parkWord, anotherDayWord];
 gateReading.textContent = `continuing \u00b7 rung ${reading.rung} of ${reading.of}`;
 gateRow.classList.toggle('checkpoint', checkpoint);
 gateRow.classList.add('visible');
 if (checkpoint) {
  // The checkpoint is the thing on the screen: the gate moves above the
  // textarea and withholds the next question until a word is pressed.
  answerArea.insertBefore(gateRow, answerRow);
  textarea.disabled = true;
 } else {
  answerArea.append(gateRow);
  textarea.disabled = false;
 }
}

/** Take the gate off the screen and restore the standard surface: visible,
 *  continue enabled, the quiet skip beside it. */
function removeGateRow() {
 gateRow.classList.remove('checkpoint');
 continueWord.hidden = false;
 gateControls = [continueWord, parkWord, anotherDayWord];
 checkpointActive = false;
 gateReading.textContent = '';
 textarea.disabled = false;
 answerArea.append(gateRow);
}

/** Apply the sounding fields of a turn response (012 T9). `sounding` is
 *  present on every rung of a live descent and is never cached; a response
 *  without it means no descent is live, so a stale row must not linger. */
function syncSounding(res: TurnData) {
 if (res.soundingOffer) {
  state.soundingOffer = res.soundingOffer;
  showOffer(res.soundingOffer);
 }
 if (res.sounding) {
  state.sounding = res.sounding;
  renderGate(res.sounding.checkpoint);
 } else {
  // No live descent behind this response: the descent closed on this answer
  // (cap/convergence) or the server no longer holds one.
  state.sounding = null;
  removeGateRow();
 }
}

/** Apply a probe response to the exchange surface (012 T9): the question,
 *  the lineage, the juxtaposition, the transcript, and the sounding state. */
function applyProbe(res: TurnData) {
 state.question = res.text!;
 // The lineage belonged to the resurfaced opener; later questions have none.
 state.lineageQuestion = null;
 state.lineageContext = null;
 state.openerSource = null;
 openerLineage?.remove();
 dealtLine?.remove();
 state.quotedFragment = res.quotedFragment ?? null;
 state.snippetRef = res.snippetRef ?? null;
 state.juxtaposition = res.juxtaposition ?? null;
 // The machine phase meta rides every turn response (ticket 159, slice 4 —
 // every sitting now carries a machine). The typeof check stays defensive:
 // other routes that reuse TurnData (the sounding gate) still send the
 // session phase string, which is not the meta and clears the line.
 state.phaseMeta = typeof res.phase === 'object' && res.phase !== null ? res.phase : null;
 phaseMetaLine.textContent = state.phaseMeta
  ? `${state.phaseMeta.label} \u2014 phase ${state.phaseMeta.step} of ${state.phaseMeta.of}`
  : '';
 // The chip surface follows the ACTIVE phase: a triad question re-renders
 // the three chips (fresh tap state), anything else hides the row.
 renderTriadSurface(state.phaseMeta);

 // Update question + juxtaposition display
 questionBlock.textContent = res.text!;
 juxDiv.innerHTML = '';
 if (state.juxtaposition) {
  juxDiv.classList.add('active');
  juxDiv.append(
   el('span', { class: 'jux-date' }, state.juxtaposition.snippetDate),
   el('blockquote', { class: 'jux-quote' }, state.juxtaposition.snippetText),
  );
 } else {
  juxDiv.classList.remove('active');
 }

 appendTurn('agent', res.text!);
 syncSounding(res);
}

/** The gate route closed the descent (park / another-day / the counter at
 *  the gate). No question text rides the response; the door question is the
 *  known close sentence (Q-46: the descent closes, never the person stops).
 *  A turn-route close rides `descentClosed` — the descent ended on its own
 *  (cap or convergence), the one close the person did not perform — and a
 *  quiet margin word says how (012 T9). */
function closeByGate(closedBy?: SoundingEnd) {
 state.sounding = null;
 removeGateRow();
 state.question = DOOR_QUESTION;
 questionBlock.textContent = DOOR_QUESTION;
 appendTurn('agent', DOOR_QUESTION);
 if (closedBy) {
  header.append(el('div', { class: 'lineage-provenance' }, el('div', { class: 'lineage-context' }, descentCloseWord(closedBy))));
 }
}

async function pressGate(choice: 'continue' | 'park' | 'another-day') {
 setControlsBusy(true);
 const wait = beginWait(
  answerArea,
  choice === 'continue' ? 'continuing\u2026' : 'putting it away\u2026',
 );
 try {
  const res = await api<TurnData>(
   `/api/session/${state.sessionId}/sounding/gate`,
   { choice },
  );
  wait.done();
  if (res.kind === 'probe') {
   applyProbe(res);
   // A gate-route probe is the checkpoint's release: 'continue' was the one
   // real choice at the block, and this response is the rung it unblocked.
   // The response's own sounding still reports checkpoint (the interrupted
   // rung is not recorded until the next answer), so re-locking on it would
   // deadlock the exchange — the block lifts here and only here.
   if (checkpointActive) renderGate(false);
   // The checkpoint handed focus to the gate; the next rung hands it back
   // (focus-management-across-boundaries).
   textarea.focus();
  } else if (res.kind === 'descent-closed') {
   closeByGate();
  }
  setControlsBusy(false);
 } catch (e) {
  wait.failed(e);
  setControlsBusy(false);
 }
}

/** The everyday sitting's gate (ticket 159, slice 4), the standard surface
 *  under every question:
 *  - 'continue' is the default — the next question is one answer away, so
 *    the word only brings the field back (no wire; the person just answers).
 *  - 'park' enters the closing door through the gate route (the machine
 *    side-record lands in slice 5; harvest happens at /end).
 *  - 'another-day' is the old harvest-now wire verbatim (VERB MAPPING):
 *    POST /api/session/:id/end → the harvest runs behind the response and
 *    the review queue is the destination.
 */
async function pressEverydayGate(choice: 'continue' | 'park' | 'another-day') {
 if (choice === 'continue') {
  textarea.focus();
  return;
 }
 setControlsBusy(true);
 const wait = beginWait(
  answerArea,
  choice === 'another-day' ? 'reading back what you said\u2026' : 'putting it away\u2026',
 );
 try {
  if (choice === 'another-day') {
   const res = await api<EndResponse>(
    `/api/session/${state.sessionId}/end`,
   );
   state.pendingReviewSession = res.sessionId;
   wait.done();
   navTo('reviews');
   return;
  }
  // park — depth kept: the gate route enters the closing door; the door
  // question is the known close sentence, rendered like a descent's close.
  // Already on the door, a second park stays put (the route no-ops).
  const res = await api<TurnData>(
   `/api/session/${state.sessionId}/gate`,
   { choice: 'park' },
  );
  wait.done();
  if (res.kind === 'door' && state.question !== DOOR_QUESTION) {
   closeByGate(undefined);
  } else {
   textarea.focus();
  }
  setControlsBusy(false);
 } catch (e) {
  wait.failed(e);
  setControlsBusy(false);
 }
}

/** The gate words: while a descent runs they are the sounding gate
 *  (continue at the checkpoint / park / another-day close the ladder);
 *  otherwise the standard surface — continue nudges the answer field,
 *  park enters the closing door, another day ends and harvests. */
function onGateWord(choice: 'continue' | 'park' | 'another-day') {
 if (state.sounding) {
  pressGate(choice);
  return;
 }
 pressEverydayGate(choice);
}

continueWord.addEventListener('click', () => onGateWord('continue'));
parkWord.addEventListener('click', () => onGateWord('park'));
anotherDayWord.addEventListener('click', () => onGateWord('another-day'));

 answerRow.append(textarea, micBtn, micStatus, sendBtn);
 answerArea.append(answerRow, answerHint, gateRow);

  // The offer carries the DRM title, never the jargon (ticket 157).
  const drmOffer = el('button', { class: 'nav-link exchange-drm-offer' }, `${protocolTitle('drm')} \u2192`);
  void ensureProtocolMeta().then(() => {
   drmOffer.textContent = `${protocolTitle('drm')} \u2192`;
  });
  drmOffer.addEventListener('click', () => navTo('drm'));
  answerArea.append(drmOffer);


 div.append(header, transcript, answerArea);
 surface.append(div);

 // typewriter auto-grow
 textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
 });

 // focus dimming
 textarea.addEventListener('focus', () => {
  document.body.classList.add('answering');
 });
 textarea.addEventListener('blur', () => {
  document.body.classList.remove('answering');
 });

 async function sendTurn() {
  const text = textarea.value.trim();
  if (!text) return;
  const pasted = turnTracker.isPasted(text);
  turnTracker.reset();
  textarea.disabled = true;
  skipLink.disabled = true;
  if (state.sttAvailable) micBtn.disabled = true;
  sendBtn.disabled = true;

  // The answer moves into the transcript now, so it is not on screen twice
  // while the probe is out. A failure puts it back in the field.
  const userTurn = appendTurn('user', text);
  textarea.value = '';
  textarea.style.height = 'auto';

  const body: Record<string, unknown> = {
   text,
   channel: pasted ? 'pasted' : state.turnHadSpeech ? 'spoken' : 'typed',
  };
  if (state.turnHadSpeech) body.spoken = true;
  // The tapped pair rides the answer (ticket 159, slice 7): present only
  // when the chips are live AND exactly two are selected. Fewer than two
  // is a prose-only turn — the answer text stands alone and the server
  // records no pair, exactly as if no chips existed.
  if (triadSurface(state.phaseMeta) !== null && selectedTriad.length === 2) {
   body.pair = [selectedTriad[0]!, selectedTriad[1]!];
  }

  const wait = beginWait(answerArea, 'thinking…');

  try {
   const res = await api<TurnData>(
    `/api/session/${state.sessionId}/turn`,
    body,
   );

   wait.done();
   state.turnHadSpeech = false;

   if (res.kind === 'probe') {
    applyProbe(res);
   } else if (res.kind === 'checkpoint') {
    // The rung was answered and recorded; the descent is blocked until a
    // gate word arrives and no next question exists yet (Q-44). The gate
    // becomes the thing on the screen.
    state.sounding = res.sounding ?? null;
    if (state.sounding) renderGate(true);
   } else if (res.kind === 'descent-closed') {
    closeByGate(res.descentClosed);
   } else {
    // saturated — the sitting is over. The closing acknowledgment
    // (ticket 135) renders as the final agent turn before harvest.
    if (res.closingText) {
     const closingRow = el('div', { class: 'turn-group agent' });
     const bubble = el('div', { class: 'turn-bubble agent' }, res.closingText);
     closingRow.append(bubble);
     const rows = answerArea.querySelectorAll('.turn-group.agent, .turn-group.user');
     const lastRow = rows[rows.length - 1];
     if (lastRow) lastRow.insertAdjacentElement('afterend', closingRow);
     else answerArea.prepend(closingRow);
     closingRow.scrollIntoView({ block: 'center' });
    }
    try {
     const endRes = await api<EndResponse>(
      `/api/session/${state.sessionId}/end`,
     );
     state.pendingReviewSession = endRes.sessionId;
     wait.done();
     navTo('reviews');
    } catch (e) {
     wait.failed(e);
     setControlsBusy(false);
    }
    return;
   }
  } catch (e) {
   // Their words go back to the field, or "try again" means nothing.
   wait.failed(e);
   userTurn.remove();
   exchangeTurnCount--;
   textarea.value = text;
   textarea.dispatchEvent(new Event('input'));
  }

  textarea.disabled = checkpointActive;
  skipLink.disabled = false;
  if (state.sttAvailable) micBtn.disabled = false;
  sendBtn.disabled = checkpointActive;
  textarea.focus();
  textarea.scrollIntoView({ block: 'center', behavior: 'smooth' });
 }

 textarea.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
   e.preventDefault();
   sendTurn();
  }
 });

 sendBtn.addEventListener('click', () => void sendTurn());

 /** Enable or disable everything that would race the call in flight. The
  *  gate words join the set (012 T9) so a double-press cannot park a ladder
  *  twice; the textarea stays disabled at the checkpoint either way. */
 function setControlsBusy(busy: boolean) {
  textarea.disabled = busy || checkpointActive;
  skipLink.disabled = busy;
  if (state.sttAvailable) micBtn.disabled = busy;
  sendBtn.disabled = busy;
  for (const c of gateControls) c.disabled = busy;
 }

 /** Show the replacement question skip and defer both return, or close the exchange. */
 function takeNextQuestion(res: { kind: string; text?: string }) {
  if (res.kind === 'question') {
   state.question = res.text!;
   state.lineageQuestion = null;
   state.lineageContext = null;
   state.openerSource = null;
   openerLineage?.remove();
   dealtLine?.remove();
   state.juxtaposition = null;
   juxDiv.classList.remove('active');
   juxDiv.innerHTML = '';
   questionBlock.textContent = res.text!;
   textarea.value = '';
   textarea.style.height = 'auto';
   textarea.focus();
  } else {
   questionBlock.textContent = '';
   questionBlock.append(
    el('p', { class: 'skip-exhausted' }, 'No more starters \u2014 another day gathers them.'),
   );
   skipLink.disabled = true;
   textarea.disabled = true;
  }
 }

 // ── Skip (the quiet link beside the gate): the skip route unchanged, so
 // the skip-rate metrics stay live (ticket 159, slice 4) ──

 skipLink.addEventListener('click', async () => {
  skipLink.disabled = true;
  const wait = beginWait(answerArea, 'finding another…');
  try {
   const res = await api<{ kind: string; text?: string }>(
    `/api/session/${state.sessionId}/skip`,
   );
   wait.done();
   takeNextQuestion(res);
  } catch (e) {
   wait.failed(e);
   skipLink.disabled = false;
  }
 });

 // ── Mic toggle ──

 wireDictation({
  textarea,
  micBtn,
  micStatus,
  errorSlot: answerArea,
  onSpeech: () => { state.turnHadSpeech = true; },
 });

 requestAnimationFrame(() => {
  textarea.focus();
  textarea.scrollIntoView({ block: 'center' });
 });

 function appendTurn(role: 'agent' | 'user', text: string): HTMLDivElement {
  exchangeTurnCount++;
  const turn = el('div', { class: `turn ${role}` }, text);
  transcript.append(turn);
  turn.scrollIntoView({ block: 'nearest' });
  return turn;
 }
}

/** The machine phase meta the drm routes carry (ticket 159, slice 6): the
 *  same PhaseMetaLike shape as the turn response — the phase id/label/step/
 *  of plus the phase's renderer when it declares one (the day-map during
 *  enumeration, the triad names during people-grid's triads). Absent on an
 *  older server. */
type DrmPhaseMeta = PhaseMetaLike;

/** A parked DRM picked up from the waiting surface: its first probe, shown
 *  by renderDRM directly (the resume route already composed it). */
function renderDRM() {
  clear();
  state.screen = 'drm';
  renderShell();

  const div = el('div', { class: 'screen active drm-screen' });
  // The screen reads as the def title (ticket 157), never the jargon.
  const header = el('h2', { class: 'exchange-heading' }, protocolTitle('drm'));
  void ensureProtocolMeta().then(() => {
   header.textContent = protocolTitle('drm');
  });
  div.append(header);

  // ── Intro ──
  // Yesterday, computed the way the server anchors it (src/drm/state.ts
  // initDRM): the previous calendar day in ISO date form. Display-only —
  // the wire contract is untouched.
  const yesterdayIso = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
  const introBlock = el('div', { class: 'drm-phase drm-intro' });
  const beginBtn = el('button', { class: 'nav-link drm-begin-btn' }, 'begin');
  introBlock.append(
   el('p', { class: 'drm-intro-prompt' },
    'Yesterday was ',
    el('span', { class: 'drm-yesterday' }, yesterdayIso),
    ' \u2014 walk through your day, hour by hour.'),
   beginBtn,
  );

  // ── Enumeration ──
  const enumBlock = el('div', { class: 'drm-phase drm-enum' });
  const nameInput = el('input', {
   class: 'drm-episode-name',
   type: 'text',
   placeholder: 'block name',
  });
  const hourSelect = el('select', { class: 'drm-hour' });
  for (let h = 5; h <= 23; h++) {
   const opt = el('option', { value: String(h) }, `~${h}:00`);
   hourSelect.append(opt);
  }
  const addBtn = el('button', { class: 'drm-add-btn', type: 'button' }, 'add a block');
  const doneBtn = el('button', { class: 'drm-done-btn', type: 'button' }, "that's the day");
  const episodeList = el('div', { class: 'drm-episode-list' });
  const enumRow = el('div', { class: 'drm-enum-row' });
  enumRow.append(nameInput, hourSelect, addBtn, doneBtn);
  enumBlock.append(enumRow, episodeList);

  // ── Probe area — the exchange grammar (ticket 157): dimmed protocol
  // title above the question, question block, dictation, send, beginWait.
  const probeBlock = el('div', { class: 'drm-phase drm-probe' });
  const protocolLabel = el('div', { class: 'exchange-protocol' }, protocolTitle('drm'));
  void ensureProtocolMeta().then(() => {
   protocolLabel.textContent = protocolTitle('drm');
  });
  const probeMeta = el('div', { class: 'drm-probe-meta' });
  const probeQuestion = el('div', { class: 'question-block' });
  const textarea = el('textarea', {
   class: 'answer-textarea',
   placeholder: '\u2026',
   rows: '3',
  });
  const micBtn = el('button', { class: 'mic-toggle', type: 'button', title: 'dictate' }, '\u{1F399}');
  const micStatus = el('span', { class: 'mic-status' });
  const sendBtn = el('button', { class: 'send-btn', type: 'button' }, 'send \u21b5');
  const answerRow = el('div', { class: 'answer-row' });
  answerRow.append(textarea, micBtn, micStatus, sendBtn);
  probeBlock.append(protocolLabel, probeMeta, probeQuestion, answerRow);

  // ── Gate-row (Q-44: always visible, replicate Sounding pattern) ──
  const gateBlock = el('div', { class: 'gate-row drm-gate' });
  const gateReading = el('span', { class: 'gate-reading' });
  const continueWord = el('button', { class: 'gate-word continue', type: 'button' }, 'continue');
  const parkWord = el('button', { class: 'gate-word park', type: 'button' }, 'park, depth kept');
  const anotherDayWord = el('button', { class: 'gate-word another-day', type: 'button' }, 'another day');
  gateBlock.append(gateReading, continueWord, parkWord, anotherDayWord);
  // Gate not visible until probe phase
  gateBlock.classList.remove('visible');
  probeBlock.append(gateBlock);

  div.append(introBlock, enumBlock, probeBlock);
  surface.append(div);

  // ── DRM episode data, held locally ──
  let episodes: { name: string; startHour: number }[] = [];

  // Phases re-render with a quiet transition (ticket 157): only the active
  // phase is in the flow; the newly shown one fades in.
  function showPhase(phase: 'intro' | 'enumerate' | 'probe') {
   const phases: [HTMLElement, 'intro' | 'enumerate' | 'probe'][] = [
    [introBlock, 'intro'],
    [enumBlock, 'enumerate'],
    [probeBlock, 'probe'],
   ];
   for (const [block, name] of phases) {
    const active = name === phase;
    block.classList.toggle('active', active);
    block.classList.remove('fade-in');
    if (active) {
     // Restart the fade on every re-show.
     void block.offsetWidth;
     block.classList.add('fade-in');
    }
   }
  }

  function setBusy(busy: boolean) {
   textarea.disabled = busy;
   sendBtn.disabled = busy;
   micBtn.disabled = busy;
   beginBtn.disabled = busy;
   addBtn.disabled = busy;
   doneBtn.disabled = busy;
   continueWord.disabled = busy;
   parkWord.disabled = busy;
   anotherDayWord.disabled = busy;
  }

  // ── The renderer contract (ticket 159, slice 6) ──
  // The screen dispatches on the ACTIVE phase's renderer: 'drm-day-map'
  // shows the day-map UI (episodes list + add-block row); every other
  // renderer — an unknown one included — falls back to the generic question
  // block, never a crash. Without a phase meta (an older server) the
  // response kind still says where the flow is.
  function showPhaseFor(meta: DrmPhaseMeta | undefined, kind: string) {
   if (meta?.renderer === 'drm-day-map') {
    showPhase('enumerate');
    return;
   }
   if (meta !== undefined) {
    showPhase('probe');
    return;
   }
   showPhase(kind === 'drm-enumerate' ? 'enumerate' : 'probe');
  }

  // ── Intro: begin ──
  beginBtn.addEventListener('click', async () => {
   setBusy(true);
   const wait = beginWait(introBlock, 'starting\u2026', 150);
   try {
    const res = await api<{ kind: string; machinePhase?: DrmPhaseMeta }>(`/api/session/${state.sessionId}/drm/start`);
    wait.done();
    showPhaseFor(res.machinePhase, res.kind);
    nameInput.focus();
   } catch (e) {
    wait.failed(e, 'could not start');
    setBusy(false);
   }
  });

  // ── Enumeration: add a block ──
  function refreshEpisodeList() {
   episodeList.innerHTML = '';
   for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]!;
    const row = el('div', { class: 'drm-episode-item' });
    row.append(
     el('span', { class: 'drm-episode-name-text' }, ep.name),
     el('span', { class: 'drm-episode-meta' }, `~${ep.startHour}:00`),
    );
    episodeList.append(row);
   }
  }

  async function doAddBlock() {
   const name = nameInput.value.trim();
   if (!name) return;
   const startHour = parseInt(hourSelect.value, 10);

   setBusy(true);
   const wait = beginWait(enumBlock, 'adding\u2026', 150);
   try {
    await api(`/api/session/${state.sessionId}/drm/episode`, { name, startHour });
    wait.done();
    episodes.push({ name, startHour });
    refreshEpisodeList();
    nameInput.value = '';
    nameInput.focus();
   } catch (e) {
    wait.failed(e, 'could not add the block');
    setBusy(false);
   }
  }

  addBtn.addEventListener('click', doAddBlock);
  nameInput.addEventListener('keydown', (e) => {
   if (e.key === 'Enter') doAddBlock();
  });

  // ── Enumeration: that's the day ──
  doneBtn.addEventListener('click', async () => {
   if (episodes.length === 0) return;
   setBusy(true);
   const wait = beginWait(enumBlock, 'reading the day back\u2026', 150);
   try {
    const res = await api<{
     kind: string;
     text: string;
     episode: number;
     of: number;
     step: string;
     gate: { episode: number; of: number; label: string };
     machinePhase?: DrmPhaseMeta;
    }>(`/api/session/${state.sessionId}/drm/enumerate-done`);
    wait.done();
    showPhaseFor(res.machinePhase, res.kind);
    probeQuestion.textContent = res.text;
    probeMeta.textContent = `block ${res.episode} of ${res.of} \u00b7 ${res.step}`;
    gateReading.textContent = res.gate.label;
    gateBlock.classList.add('visible');
    textarea.focus();
   } catch (e) {
    wait.failed(e, 'could not start the probes');
    setBusy(false);
   }
  });

  // ── Probe: answer ──
  async function sendAnswer() {
   const text = textarea.value.trim();
   if (!text) return;

   setBusy(true);
   const wait = beginWait(probeBlock, 'thinking\u2026', 150);
   try {
    const res = await api<{
     kind: string;
     text?: string;
     episode?: number;
     of?: number;
     step?: string;
     gate?: { episode: number; of: number; label: string };
     atEnd?: boolean;
    }>(`/api/session/${state.sessionId}/drm/probe`, { text });

    textarea.value = '';

    if (res.kind === 'drm-gate') {
     // At episode gate
     wait.done();
     const atEnd = res.atEnd ?? false;
     continueWord.hidden = false;
     continueWord.textContent = atEnd ? 'finish' : 'continue';
     gateBlock.classList.add('checkpoint');
     gateReading.textContent = res.gate?.label ?? '';
     setBusy(false);
     // The checkpoint withholds the writing surface — the gate is the
     // thing on screen (the exchange grammar).
     textarea.disabled = true;
     sendBtn.disabled = true;
     micBtn.disabled = true;
    } else if (res.kind === 'drm-probe') {
     // More probes
     wait.done();
     probeQuestion.textContent = res.text ?? '';
     probeMeta.textContent = `block ${res.episode} of ${res.of} \u00b7 ${res.step}`;
     gateReading.textContent = res.gate?.label ?? '';
     continueWord.hidden = true;
     gateBlock.classList.remove('checkpoint');
     setBusy(false);
     textarea.focus();
    }
   } catch (e) {
    wait.failed(e, 'could not send');
    setBusy(false);
   }
  }

  sendBtn.addEventListener('click', sendAnswer);
  textarea.addEventListener('keydown', (e) => {
   if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAnswer();
   }
  });

  // ── Gate: continue / park / another-day ──
  async function pressGate(choice: 'continue' | 'park' | 'another-day') {
   setBusy(true);
   const wait = beginWait(
    probeBlock,
    choice === 'continue' ? 'continuing\u2026' : 'putting it away\u2026',
   );
   try {
    const res = await api<{
     kind: string;
     text?: string;
     episode?: number;
     of?: number;
     step?: string;
     gate?: { episode: number; of: number; label: string };
    }>(`/api/session/${state.sessionId}/drm/gate`, { choice });

    if (res.kind === 'drm-closed') {
     // DRM complete — end the session for harvest; the wait holds through
     // the harvest call.
     try {
      const endRes = await api<{ status: string }>(`/api/session/${state.sessionId}/end`);
      wait.done();
      if (endRes.status === 'harvesting') {
       state.pendingReviewSession = state.sessionId;
      }
     } catch {
      // End may fail but session is over
      wait.done();
     }
     navTo('reviews');
     return;
    }

    // Continue to next episode
    if (res.kind === 'drm-probe') {
     wait.done();
     probeQuestion.textContent = res.text ?? '';
     probeMeta.textContent = `block ${res.episode} of ${res.of} \u00b7 ${res.step}`;
     gateReading.textContent = res.gate?.label ?? '';
     continueWord.hidden = true;
     gateBlock.classList.remove('checkpoint');
     setBusy(false);
     textarea.focus();
    }
   } catch (e) {
    wait.failed(e, 'could not process');
    setBusy(false);
   }
  }

  continueWord.addEventListener('click', () => pressGate('continue'));
  parkWord.addEventListener('click', () => pressGate('park'));
  anotherDayWord.addEventListener('click', () => pressGate('another-day'));

  // ── The exchange writing grammar: typewriter auto-grow, dictation ──
  textarea.addEventListener('input', () => {
   textarea.style.height = 'auto';
   textarea.style.height = textarea.scrollHeight + 'px';
  });

  wireDictation({
   textarea,
   micBtn,
   micStatus,
   errorSlot: probeBlock,
  });

  // ── A picked-up parked DRM continues in the probe UI ──
  // The resume route already composed the first probe; the screen shows it
  // directly instead of the intro (ticket 159, slice 6 — the exact phase
  // continues).
  const resumeProbe = takeDrmResumeProbe();
  if (resumeProbe) {
   probeQuestion.textContent = resumeProbe.text;
   probeMeta.textContent = `block ${resumeProbe.episode} of ${resumeProbe.of} \u00b7 ${resumeProbe.step}`;
   gateReading.textContent = resumeProbe.gate.label;
   gateBlock.classList.add('visible');
   showPhase('probe');
   textarea.focus();
  }

  // ── Re-trigger hash for the navigator ──
  if (location.hash !== '#/drm') location.hash = '#/drm';
}

/* ── Harvest screen ── */

/**
 * The queue grammar promises leaving costs nothing: this map is that
 * promise, per session, for this page load.
 */
const harvestDrafts = new Map<string, HarvestDecision[]>();

function renderHarvest() {
 clear();
 state.screen = 'harvest';
 renderShell();
 state.decisions = harvestDrafts.get(state.sessionId!) ?? [];

 const div = el('div', { class: 'screen active' });

 const empty = state.proposals.length === 0;

 const heading = el(
  'div',
  { class: empty ? 'question-block empty-msg' : 'question-block' },
  empty
   ? 'nothing from this sitting stood on its own \u2014 that happens'
   : 'review what you said',
 );
 div.append(heading);

 const list = el('div', { class: 'harvest-list' });
 div.append(list);

 const errorSlot = el('div', { class: 'error-slot' });
 div.append(errorSlot);

 if (empty) {
  const closeBtn = el(
   'button',
   { class: 'submit-btn', style: 'margin-top: 1.5rem' },
   'close',
  );
  closeBtn.addEventListener('click', () => navTo('mode'));
  div.append(closeBtn);
 } else {
  const progress = el('p', { class: 'harvest-progress' }, `${state.decisions.length} of ${state.proposals.length} decided`);

  // Bulk preselection, never a commit: one verb lands on every proposal
  // still waiting; proposals already decided keep their decision, and each
  // card can still be changed before `save decisions`. The re-render is the
  // whole mechanism \u2014 every card seeds its visual from state.decisions.
  const bulkRow = el('div', { class: 'harvest-decide-all' });
  const bulkApprove = el('button', { class: 'nav-link' }, 'select all \u2014 approve');
  const bulkDiscard = el('button', { class: 'nav-link' }, 'select all \u2014 discard');
  bulkRow.append(bulkApprove, bulkDiscard);
  const decideRest = (action: 'approve' | 'discard') => {
   const decided = new Set(state.decisions.map((d) => d.proposal));
   for (let i = 0; i < state.proposals.length; i++) {
    if (!decided.has(i)) state.decisions.push({ proposal: i, action });
   }
   harvestDrafts.set(state.sessionId!, state.decisions);
   renderHarvest();
  };
  bulkApprove.addEventListener('click', () => decideRest('approve'));
  bulkDiscard.addEventListener('click', () => decideRest('discard'));

  const submitRow = el('div', { style: 'margin-top: 1.5rem' });
  const submitBtn = el('button', { class: 'submit-btn' }, 'save decisions');
  submitRow.append(submitBtn);
  // The queue grammar lets a sitting rest: decisions stay in hand, and the
  // review list is where the person left it.
  const backRow = el('div', { class: 'waiting-nav' });
  const finishLater = el('button', { class: 'nav-link' }, '\u2190 finish later');
  finishLater.addEventListener('click', () => {
   harvestDrafts.set(state.sessionId!, state.decisions);
   navTo('reviews');
  });
  backRow.append(finishLater);
  div.append(bulkRow, progress, submitRow, backRow);

  submitBtn.addEventListener('click', async () => {
   if (state.decisions.length < state.proposals.length) {
    errorSlot.innerHTML = '';
    errorSlot.append(
     el('p', { class: 'error-msg' }, 'decide on each proposal first'),
    );
    return;
   }
   submitBtn.disabled = true;
   errorSlot.innerHTML = '';
   const wait = beginWait(errorSlot, 'writing them down…');
   try {
    const result = await api<HarvestResponse>(
     `/api/session/${state.sessionId}/harvest`,
     { decisions: state.decisions },
    );
    state.pendingBuds = result.buds as unknown[];
    wait.done();
    harvestDrafts.delete(state.sessionId!);
    renderDone();
   } catch (e) {
    wait.failed(e);
    submitBtn.disabled = false;
   }
  });
 }

 surface.append(div);

 for (let i = 0; i < state.proposals.length; i++) {
  renderProposal(i, list);
 }
}

function renderProposal(idx: number, container: HTMLElement) {
 const p = state.proposals[idx]!;

 const block = el('div', { class: 'proposal-block' });

 // Show the eliciting question and context window, dimmed — lineage, not corpus
 const prov = lineageBlock(el, p.question, p.context);
 if (prov) block.append(prov);

 const textWrapper = el('div', { class: 'proposal-text' });
 textWrapper.textContent = p.text;

 const reading = el('span', { class: 'proposal-reading' });
 reading.innerHTML = `<strong>${p.facet}</strong> &middot; ${p.stance}<br>${p.reading}`;
 textWrapper.append(reading);

 const actions = el('div', { class: 'proposal-actions' });

 const approveBtn = el('button', { class: 'proposal-action' }, 'approve');
 const trimBtn = el('button', { class: 'proposal-action' }, 'trim');
 const discardBtn = el(
  'button',
  { class: 'proposal-action discard' },
  'discard',
 );
 const restateBtn = el('button', { class: 'proposal-action' }, 'restate');

 actions.append(approveBtn, trimBtn, discardBtn, restateBtn);

 let editorActive = false;
 let editorEl: HTMLTextAreaElement | null = null;
 let constraintEl: HTMLParagraphElement | null = null;
 let confirmEl: HTMLButtonElement | null = null;

 function clearEditor() {
  if (editorEl) {
   editorEl.remove();
   editorEl = null;
  }
  if (constraintEl) {
   constraintEl.remove();
   constraintEl = null;
  }
  if (confirmEl) {
   confirmEl.remove();
   confirmEl = null;
  }
  editorActive = false;
 }

 function applyDecisionVisual(action: HarvestDecision['action']) {
  const all = [approveBtn, trimBtn, discardBtn, restateBtn];
  for (const b of all) b.style.opacity = '0.4';
  const active =
   action === 'approve'
    ? approveBtn
    : action === 'trim'
     ? trimBtn
     : action === 'discard'
      ? discardBtn
      : restateBtn;
  active.style.opacity = '1';
  active.style.fontWeight = '500';
 }

 function setDecision(action: HarvestDecision['action'], text?: string, channel?: CaptureChannel) {
  state.decisions = state.decisions.filter((d) => d.proposal !== idx);
  const d: HarvestDecision = { proposal: idx, action };
  if (text !== undefined) d.text = text;
  if (channel !== undefined) d.channel = channel;
  state.decisions.push(d);
  // The draft map holds the same decisions, so a "finish later" and a
  // re-open of the same sitting agree on what was already decided.
  harvestDrafts.set(state.sessionId!, state.decisions);
  const progress = document.querySelector('.harvest-progress');
  if (progress) progress.textContent = `${state.decisions.length} of ${state.proposals.length} decided`;
  applyDecisionVisual(action);
 }

 approveBtn.addEventListener('click', () => {
  clearEditor();
  setDecision('approve');
 });

 trimBtn.addEventListener('click', () => {
  if (editorActive) {
   clearEditor();
   const has = state.decisions.some((d) => d.proposal === idx);
   if (!has) resetButtons();
   return;
  }
  clearEditor();
  editorActive = true;
  editorEl = el('textarea', { class: 'trim-editor' }, p.text) as HTMLTextAreaElement;
  constraintEl = el(
   'p',
   { class: 'trim-constraint' },
   'a trim keeps one continuous span of your words \u2014 cut, don\'t rewrite',
  );
  confirmEl = el(
   'button',
   { class: 'proposal-action', style: 'margin-top: 0.3rem' },
   'confirm trim',
  );
  block.append(editorEl, constraintEl, confirmEl);
  editorEl.focus();
  editorEl.style.height = 'auto';
  editorEl.style.height = editorEl.scrollHeight + 'px';
  const validTrim = (): boolean => validTrimRule(p.text, editorEl!.value);
  editorEl.addEventListener('input', () => {
   editorEl!.style.height = 'auto';
   editorEl!.style.height = editorEl!.scrollHeight + 'px';
   const ok = validTrim();
   confirmEl!.disabled = !ok;
   editorEl!.classList.toggle('invalid', !ok);
  });
  confirmEl.addEventListener('click', () => {
   const v = editorEl!.value;
   // The live check disables confirm on invalid text; the guard refuses
   // to commit, never overwriting the person's edit.
   if (!validTrim()) return;
   setDecision('trim', v);
   clearEditor();
  });
 });

 discardBtn.addEventListener('click', () => {
  clearEditor();
  setDecision('discard');
 });

 restateBtn.addEventListener('click', () => {
  if (editorActive) {
   clearEditor();
   const has = state.decisions.some((d) => d.proposal === idx);
   if (!has) resetButtons();
   return;
  }
  clearEditor();
  editorActive = true;
  editorEl = el('textarea', {
   class: 'restate-editor',
   placeholder: 'say it in your own words\u2026',
  }) as HTMLTextAreaElement;
  const editorTracker = pasteTracker(editorEl);
  confirmEl = el(
   'button',
   { class: 'confirm-restate' },
   'confirm',
  );
  block.append(editorEl, confirmEl);
  editorEl.focus();
  confirmEl.addEventListener('click', () => {
   const v = editorEl!.value.trim();
   if (!v) return;
   setDecision('restate', v, editorTracker.isPasted(v) ? 'pasted' : 'typed');
   clearEditor();
  });
 });

 function resetButtons() {
  for (const b of [approveBtn, trimBtn, discardBtn, restateBtn]) {
   b.style.opacity = '';
   b.style.fontWeight = '';
  }
 }

 block.append(textWrapper, actions);
 container.append(block);
 // A drafted decision (a "finish later" re-open) renders exactly like a
 // clicked one: the same visual path, taken when the block is built.
 const seeded = state.decisions.find((d) => d.proposal === idx); if (seeded) applyDecisionVisual(seeded.action);
}

/* ── Review queue: finished harvests awaiting a decision ── */

let reviewPollTimer: ReturnType<typeof setInterval> | null = null;

function renderReviews() {
 clear();
 state.screen = 'reviews';
 renderShell();

 // Re-entry must never stack timers; clearing a dead handle is a no-op.
 if (reviewPollTimer !== null) clearInterval(reviewPollTimer);
 reviewPollTimer = null;

 const div = el('div', { class: 'screen active reviews-screen' });

 const heading = el('h2', { class: 'waiting-heading' }, 'harvests awaiting review');
 const list = el('div', { class: 'harvest-queue-list' });
 div.append(heading, list);
 surface.append(div);

 const pending = state.pendingReviewSession;

 (async () => {
  try {
   const data = await api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
   if (state.screen !== 'reviews') return;
   list.innerHTML = '';

   const landed = pending !== null && data.pending.some((e) => e.sessionId === pending);

   // The harvest we just launched has not landed yet: say so quietly and
   // poll for its record, then re-render the list once it exists.
   if (pending !== null && !landed) {
    list.append(
     el(
      'p',
      { class: 'harvest-running' },
      'harvest running — it will appear here when it is done',
     ),
    );
    const poll = setInterval(async () => {
     if (state.screen !== 'reviews') {
      clearInterval(poll);
      reviewPollTimer = null;
      return;
     }
     try {
      await api<HarvestQueueRecord>(`/api/harvest-queue/${pending}`);
      if (state.screen !== 'reviews') return;
      state.pendingReviewSession = null;
      renderReviews();
     } catch {
      // No record yet: the harvest is still running, OR its parse failed —
      // a failed harvest writes no pending record, so the only signal is the
      // activity feed. Ask the feed (ticket 154): a harvest-failed after
      // this session's harvest-started ends the poll with the sentence.
      try {
       // Today only: the harvest started this sitting, so its events are in
       // today's log, and a years-old log is not re-read every two seconds.
       const since = new Date().toISOString().slice(0, 10);
       const { events } = await api<{ events: ActivityEvent[] }>(`/api/activity?since=${encodeURIComponent(since)}`);
       if (state.screen !== 'reviews') return;
       if (harvestFailedFor(events, pending)) {
        clearInterval(poll);
        reviewPollTimer = null;
        state.pendingReviewSession = null;
        list.innerHTML = '';
        list.append(el('p', { class: 'harvest-failed-note' }, HARVEST_FAILED_SENTENCE));
       }
      } catch {
       // The feed is down too — keep polling; it may still land.
      }
     }
    }, 2000);
    reviewPollTimer = poll;
   }

   // The one decision in the reviewing grammar: opening an entry loads its
   // record and hands the screen to the harvest. Shared by the row click
   // and the single-entry shortcut, so both paths stay identical.
   async function openEntry(sessionId: string): Promise<boolean> {
    try {
     const rec = await api<HarvestQueueRecord>(`/api/harvest-queue/${sessionId}`);
     state.sessionId = rec.sessionId;
     state.proposals = rec.proposals;
     state.pendingReviewSession = null;
     renderHarvest();
     return true;
    } catch (e) {
     console.error(e);
     return false;
    }
   }

   if (data.pending.length === 0 && pending === null) {
    list.append(el('p', { class: 'empty-msg' }, 'nothing awaiting review'));
    return;
   }

   // One waiting harvest and nothing being polled: open it directly instead
   // of painting a one-row list (the verb-grammar rule — a queue with one
   // item is already decided). On failure, fall back to the list.
   const only = data.pending[0];
   if (data.pending.length === 1 && pending === null && only) {
    if (await openEntry(only.sessionId)) return;
   }

   for (const entry of data.pending) {
    const row = el('button', { class: 'harvest-queue-row' });
    const date = el('span', { class: 'harvest-queue-date' }, relativeTime(entry.started));
    const meta = el(
     'span',
     { class: 'harvest-queue-meta' },
     `${originWord(entry.origin)} \u00b7 ${entry.protocol} \u00b7 ${entry.proposalCount} proposal${entry.proposalCount === 1 ? '' : 's'}`,
    );
    row.append(date, meta);
    row.addEventListener('click', async () => {
     row.disabled = true;
     const ok = await openEntry(entry.sessionId);
     if (!ok) {
      row.disabled = false;
      list.append(el('p', { class: 'empty-msg' }, 'that harvest did not load'));
     }
    });
    list.append(row);
   }
  } catch (e) {
   if (state.screen !== 'reviews') return;
   list.innerHTML = '';
   list.append(el('p', { class: 'empty-msg' }, 'could not load the review queue'));
   console.error(e);
  }
 })();
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
  const wait = pieceWait(el, column, 'stacking them\u2026');
  api<PieceEnriched>('/api/piece', { snippets: ids })
   .then((piece) => {
    wait.end();
    setCurrentPieceId(piece.id);
    navTo('piece');
   })
   .catch((e: unknown) => wait.fail(e));
 });

 const wait = pieceWait(el, column, 'reading\u2026');
 (async () => {
  try {
   const [snippetsRes, piecesRes] = await Promise.all([
    api<{ snippets: Snippet[] }>('/api/snippets'),
    api<{ pieces: PieceLite[] }>('/api/pieces'),
   ]);
   wait.end();
   paintMaterial(column, snippetsRes.snippets, piecesRes.pieces, selected, compose, tabs);
  } catch (e) {
   wait.fail(e);
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
   else renderMode(true);
   return;
  }

  // Auth file exists — check if we have a valid session
  try {
   await api<QueueData>('/api/queue');
   startLiveRefresh();
   // The hash names a screen; empty or unknown takes the default boot.
   const fromHash = screenFromHash();
   if (fromHash) navTo(fromHash); else renderMode(false);
  } catch {
   renderLogin();
  }
 } finally {
  wait.done();
 }
})();
