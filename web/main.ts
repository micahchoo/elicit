import type {
 CutProposal,
 GateReading,
 HarvestDecision,
} from '../src/types.ts';
import { type OpenerSource } from './provenance.js';
import { renderImportEntry } from './import-entry.js';
import { renderCoachPage } from './coach.js';
import { initPanelLine } from './panel-line.js';
import { renderWaiting } from './waiting.js';
import { renderWiki, releaseWiki } from './wiki.js';
import { renderPiece, initMaterial, renderMaterial } from './piece.js';
import { renderHarvest, type HarvestDeps } from './harvest.js';
import { renderReviews } from './reviews.js';
import type { NavOpts, QueueData, SessionState } from './deps.js';
import { initTerritory } from './territory.js';
import { initProtocolMeta } from './protocol-meta.js';
import { type PhaseMetaLike } from './triad-surface.js';

import { renderExchange, type ExchangeDeps } from './exchange.js';
import { wireDictation, type DictationDeps } from './dictation.js';
import { renderDRM, type DrmDeps } from './drm.js';
import { renderMode, type ModeDeps } from './mode.js';

import { initClient, api } from './client.js';
import { initShell, renderShell, clear } from './shell.js';
import { initWait, beginWait, showQuietError } from './wait.js';
import { initLive, startLiveRefresh } from './live.js';
import { initAuth, renderLogin, renderSetup, renderDone } from './auth.js';
import { initUnprompted, renderUnprompted } from './unprompted.js';

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
// The HTTP layer and the waiting machinery wire the same way: api's
// fetch/navTo/showError (web/client.ts — the one home of the 401/403
// rule), and the wait verbs' el (web/wait.ts).
initClient({ fetch, navTo: (s) => navTo(s as Screen), showError });
initWait({ el });
// The protocol titles (ticket 157) fetch through the same seam: the mode
// row, the exchange label and the DRM offer all render the once-cached map.
initProtocolMeta({ api });

/* ─── State ─── */

export type Screen = 'mode' | 'home' | 'exchange' | 'harvest' | 'done' | 'waiting' | 'login' | 'setup' | 'unprompted' | 'wiki' | 'reviews' | 'inbox' | 'import' | 'material' | 'library' | 'piece' | 'coach' | 'drm';

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
 showQuietError,
 sttAvailable: () => state.sttAvailable,
 setSttAvailable: (v: boolean) => { state.sttAvailable = v; },
 window,
};

/** The session clock's interval, stopped when the screen it hangs on leaves. */
let clockTimer: ReturnType<typeof setInterval> | null = null;

/** The writable session-state handle bound to the real AppState — every
 *  sitting field a surface reads has a getter, every field it mutates has
 *  a setter; the router and the other screens see every write. One
 *  factory for the two surfaces that hold the handle (exchange, mode). */
function makeSessionHandle(state: AppState): SessionState {
 return {
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
 };
}

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
 session: makeSessionHandle(state),
 text: (s: string) => document.createTextNode(s),
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
 session: makeSessionHandle(state),
 text: (s: string) => document.createTextNode(s),
 storage: {
  get: (key: string) => localStorage.getItem(key),
  set: (key: string, value: string) => { localStorage.setItem(key, value); },
 },
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

/* ─── The full-screen surfaces' wiring, once at boot ─── */
// The shell, the live refresh, the auth screens and the material screen
// receive their deps through module-local init at boot (the territory
// pattern): the router calls their exported render functions bare, and
// the seam objects above hand the same verbs through WebDepsShell.
initShell({
 main, el, api, surface, document,
 screen: () => state.screen,
 releaseWiki,
 sessionClock: () => clockTimer,
 setSessionClock: (t: ReturnType<typeof setInterval> | null) => { clockTimer = t; },
});
initLive({ navTo: (s) => navTo(s), screen: () => state.screen });
initAuth({
 main, surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait, clear, renderShell,
 setScreen: (s: string) => { state.screen = s as Screen; },
 startLiveRefresh,
 pendingBuds: () => state.pendingBuds,
});
initUnprompted({
 surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait, clear, renderShell,
 setScreen: (s: string) => { state.screen = s as Screen; },
 setSessionId: (id: string | null) => { state.sessionId = id; },
 setQuestion: (q: string | null) => { state.question = q; },
 setProposals: (p: CutProposal[]) => { state.proposals = p; },
 setDecisions: (d: HarvestDecision[]) => { state.decisions = d; },
 setPendingReviewSession: (id: string | null) => { state.pendingReviewSession = id; },
 turnHadSpeech: () => state.turnHadSpeech,
 setTurnHadSpeech: (spoken: boolean) => { state.turnHadSpeech = spoken; },
 wireDictation: (opts) => wireDictation(dictationDeps, opts),
});
initMaterial({
 surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait, clear, renderShell,
 setScreen: (s: string) => { state.screen = s as Screen; },
});

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
   beginWait,
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

function showError(msg: string) {
 const err = el('p', { class: 'error-msg' }, msg);
 surface.append(err);
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
