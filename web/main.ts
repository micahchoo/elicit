import type {
 CutProposal,
 GateReading,
 HarvestDecision,
} from '../src/types.ts';
import { type OpenerSource } from './provenance.js';
import { renderImportEntry } from './import-entry.js';
import { renderImportReview } from './import-review.js';
import { renderCoachPage } from './coach.js';
import { initPanelLine } from './panel-line.js';
import { renderWiki, releaseWiki } from './wiki.js';
import { renderPiece, initMaterial, renderMaterial } from './piece.js';
import { renderReviewGrammar, type ReviewGrammarDeps } from './review-grammar.js';
import { renderReviews, sittingReviewItem, type SittingReviewRecord } from './reviews.js';
import { renderToday, type TodayDeps } from './today.js';
import { applySessionResponse, clearFirstLaunch, isDrmWalk, isFirstLaunch, setDrmWalk, setFirstLaunch } from './deps.js';
import type { NavOpts, QueueData, SessionResponse, SessionState } from './deps.js';
import { initTerritory } from './territory.js';
import { initProtocolMeta } from './protocol-meta.js';
import { type PhaseMetaLike } from './triad-surface.js';

import { wireDictation, type DictationDeps } from './dictation.js';
import { renderRoom, type RoomDeps } from './room.js';

import { initClient, api } from './client.js';
import { initShell, renderShell, clear } from './shell.js';
import { initWait, beginWait, showQuietError } from './wait.js';
import { initLive, startLiveRefresh } from './live.js';
import { initAuth, renderLogin, renderSetup } from './auth.js';

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
initClient({ fetch: (p, i) => fetch(p, i), navTo: (s) => navTo(s as Screen), showError });
initWait({ el });
// The protocol titles (ticket 157) fetch through the same seam: the today
// row, the exchange label and the DRM offer all render the once-cached map.
initProtocolMeta({ api });

/* ─── State ─── */

export type Screen = 'today' | 'review' | 'about-you' | 'your-words' | 'room' | 'harvest' | 'import' | 'import-review' | 'piece' | 'coach' | 'login' | 'setup';

interface AppState {
 screen: Screen;
 /** Whether a sitting has ever been recorded (canon §5.1): set from the
 *  boot cadence fetch; the room's close paths recompute it when the first
 *  sitting ends. False hides the today word and routes #/today to the
 *  room — Today does not exist until the first sitting has earned it. */
 hasSittings: boolean;
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
 /** The opened review record (wave 3): the sitting the unified grammar draws. */
 reviewRecord: SittingReviewRecord | null;
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
 /** The first-launch auto-open's failure sentence (canon §6 rule 5) —
  *  shown once on the blank page, cleared when read. */
 openFailure: string | null;
}
const state: AppState = {
 screen: 'today',
 hasSittings: false,
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
 reviewRecord: null,
 sounding: null,
 soundingOffer: null,
 coachSlug: null,
 pulsePrompt: null,
 pendingQuestion: null,
 sessionProtocol: null,
 quotedFragment: null,
 snippetRef: null,
 phaseMeta: null,
 /** The first-launch auto-open's failure sentence (canon: silence is
  *  never the error state) — shown once on the blank page, cleared. */
 openFailure: null,
};

const main = $('main')!;
/** The scroll surface under the shell; `clear()` empties only this. */
const surface = el('div', { id: 'surface' });
main.append(surface);

/** The unified review grammar's seam object, built once: the harvest route
 * renders through it, and the review screen re-enters it with the same
 * verbs — openEntry stashes the opened record and the grammar draws the
 * sitting item built from it. */
const grammarDeps: ReviewGrammarDeps = {
 main: surface, el,
 navTo: (s: string) => navTo(s as Screen),
 text: (s: string) => document.createTextNode(s),
 document,
 storage: window.localStorage,
};

const dictationDeps: DictationDeps = {
 api,
 showQuietError,
 sttAvailable: () => state.sttAvailable,
 setSttAvailable: (v: boolean) => { state.sttAvailable = v; },
 window,
};

/** The writable session-state handle bound to the real AppState — every
 *  sitting field a surface reads has a getter, every field it mutates has
 *  a setter; the router and the other screens see every write. One
 *  factory for the two surfaces that hold the handle (exchange, today). */
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

/** The room seam object, built once: renderRoom's deps — the shell seam,
 * the writable session-state handle bound to the real AppState, the
 * shared dictation wiring, the quiet-error line, the two harvest-state
 * clears the blank furniture makes, and the room flags (the day-walk
 * discriminator, the first-launch promise, and the today-existence
 * recompute). The router and the other screens see every write through
 * the same handle. */
const roomDeps: RoomDeps = {
 main: surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait,
 renderShell, clear,
 showQuietError,
 setScreen: (s: string) => { state.screen = s as Screen; },
 session: makeSessionHandle(state),
 text: (s: string) => document.createTextNode(s),
 document,
 wireDictation: (opts) => wireDictation(dictationDeps, opts),
 setProposals: (p: CutProposal[]) => { state.proposals = p; },
 setDecisions: (d: HarvestDecision[]) => { state.decisions = d; },
 drmWalk: isDrmWalk,
 setDrmWalk,
 firstLaunch: isFirstLaunch,
 clearFirstLaunch,
 // canon §5.1: the today-existence flag tells the blank page whether a
 // back word has anywhere to go (pre-first-sitting there is no today).
 hasSittings: () => state.hasSittings,
 // The first-launch auto-open's failure sentence, taken once.
 takeOpenFailure: () => {
  const message = state.openFailure;
  state.openFailure = null;
  return message;
 },
 // canon §5.1: the today-existence flag recomputes from the server's
 // cadence when a sitting ends — the same close paths that clear
 // firstLaunch. On failure the flag keeps its value (Today stays hidden
 // rather than appearing unearned); the next boot's fetch corrects it.
 // renderShell() makes the flip visible immediately: the shell rebuilds
 // its nav with the today word even if the navigation after the close
 // fails and no render follows.
 recomputeHasSittings: async () => {
  try {
   const r = await api<{ cadence: { total: number } }>('/api/cadence');
   state.hasSittings = r.cadence.total > 0;
  } catch {
   /* keep the current flag */
  }
  renderShell();
 },
};

/** The today seam object, built once: renderToday's deps, with the writable
 *  session-state handle bound to the real AppState the way the room's is
 *  — the router and the other screens see every write — plus the pending-
 *  review hand-off into the review screen. */
const todayDeps: TodayDeps = {
 main: surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 text: (s: string) => document.createTextNode(s),
 document,
 beginWait,
 renderShell, clear,
 setScreen: (s: string) => { state.screen = s as Screen; },
 screen: () => state.screen,
 session: makeSessionHandle(state),
 pendingReview: () => state.pendingReviewSession,
 setPendingReview: (v: string | null) => { state.pendingReviewSession = v; },
 storage: window.localStorage,
 fetch,
};

/* ─── The full-screen surfaces' wiring, once at boot ─── */
// The shell, the live refresh, the auth screens and the your-words screen
// receive their deps through module-local init at boot (the territory
// pattern): the router calls their exported render functions bare, and
// the seam objects above hand the same verbs through WebDepsShell.
initShell({
 main, el, api, surface, document,
 screen: () => state.screen,
 hasSittings: () => state.hasSittings,
 // A sitting is open exactly when the session state says so — the room's
 // sessionless blank page must not light the indicator.
 sittingOpen: () => state.sessionId !== null || isDrmWalk(),
 releaseWiki,
});
initLive({ navTo: (s) => navTo(s), screen: () => state.screen });
initAuth({
 main, surface, el, api,
 navTo: (s: string) => navTo(s as Screen),
 beginWait, clear,
 setScreen: (s: string) => { state.screen = s as Screen; },
 startLiveRefresh,
 // canon §5.1: after setup, the app auto-opens a sitting and lands on the
 // room with the promise line — no lobby. A failed open still lands on the
 // room (the room owns the sessionless state — the blank page), and the
 // flag is set either way so the promise line waits for the first question.
 onSetupDone: () => {
  setFirstLaunch(true);
  startLiveRefresh();
  void (async () => {
   try {
    const res = await api<SessionResponse>('/api/session', {});
    applySessionResponse(roomDeps.session, res);
   } catch {
    // The blank page holds; the promise line is set either way — and the
    // failure is a sentence (canon §6 rule 5), never a silence.
    state.openFailure = 'couldn\u2019t open a sitting just now — try again';
   }
   navTo('room');
  })();
 },
});
initMaterial({
 surface, el, api,
 // The directions tab's doors open the coach page with { slug }; the opts
 // seam is forwarded so the coach case below receives state.coachSlug.
 navTo: (s: string, opts?: NavOpts) => navTo(s as Screen, opts),
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
  case 'today':
   // canon §5.1: Today does not exist until the first sitting has earned
   // it — while the flag is false, #/today and the today screen land in
   // the room (the first-launch home; the room owns the sessionless
   // state). The room's close paths flip the flag when the first sitting
   // ends; afterwards the today word appears and this renders normally.
   if (!state.hasSittings) { navTo('room'); break; }
   renderToday(todayDeps); break;
  case 'room': renderRoom(roomDeps); break;
  case 'harvest':
   // A sitting needs its record; a bare hash cannot fake one.
   if (!state.sessionId || !state.reviewRecord) { navTo('review'); break; }
   clear();
   renderShell();
   renderReviewGrammar(grammarDeps, sittingReviewItem(state.reviewRecord, api));
   break;
  case 'review': renderReviews({
   main: surface, el, api,
   navTo: (s: string) => navTo(s as Screen),
   beginWait,
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   screen: () => state.screen,
   setSessionId: (id: string) => { state.sessionId = id; },
   setReviewRecord: (r: SittingReviewRecord) => { state.reviewRecord = r; },
   pendingReview: () => state.pendingReviewSession,
   setPendingReview: (v: string | null) => { state.pendingReviewSession = v; },
   text: (s: string) => document.createTextNode(s),
   document,
   storage: window.localStorage,
  }); break;
  // The seam widens navTo: the entry module takes `(screen: string)`, this
  // app's screens are the Screen union, and the entry only ever asks for
  // screens the union contains.
  // The opts seam (014 T14): the reach offer's `reach it` lands the map on
  // the region it named, carrying the survey root it was relative to — the
  // parameters are optional, so every other call site is untouched, and they
  // are forwarded only where the map renders.
  case 'import': clear(); renderShell(); renderImportEntry({
   main: surface, el, api, beginWait,
   navTo: (s: string) => navTo(s as Screen),
   // exactOptionalPropertyTypes: absent means absent, never present-undefined.
   ...(opts?.focus !== undefined ? { focus: opts.focus } : {}),
   ...(opts?.folder !== undefined ? { folder: opts.folder } : {}),
   ...(opts?.region !== undefined ? { region: opts.region } : {}),
   text: (s: string) => document.createTextNode(s),
   document,
   selection: () => document.getSelection()?.toString() ?? '',
   storage: window.localStorage,
  }); break;
  case 'import-review': clear(); renderShell(); renderImportReview({
   main: surface, el, api, beginWait,
   navTo: (s: string) => navTo(s as Screen),
   // exactOptionalPropertyTypes: absent means absent, never present-undefined.
   ...(opts?.region !== undefined ? { region: opts.region } : {}),
   text: (s: string) => document.createTextNode(s),
   document,
   selection: () => document.getSelection()?.toString() ?? '',
   storage: window.localStorage,
  }); break;
  case 'about-you': renderWiki({
   main: surface, el, api, navTo: (s: string) => navTo(s as Screen),
   beginWait,
   renderShell, clear,
   setScreen: (s: string) => { state.screen = s as Screen; },
   text: (s: string) => document.createTextNode(s),
   document, window,
  }); break;
  case 'login': renderLogin(); break;
  case 'setup': renderSetup(); break;
  case 'your-words': renderMaterial(); break;
  case 'coach':
   // The page needs a slug to fetch; a bare hash cannot fake one.
   if (state.coachSlug === null) { navTo('today'); break; }
   clear();
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
 }
}

/**
 * Every routable name. The hash is honored only for these.
 */
const SCREENS: readonly Screen[] = [
 'today', 'review', 'about-you', 'your-words', 'room',
 'harvest', 'import', 'import-review', 'piece', 'coach', 'login', 'setup',
];

/** The screen a hash names, or null when it names nothing routable.
 *  Wave 4 hash migration: #/exchange, #/drm and #/unprompted redirect to
 *  #/room — kept as redirects, not deleted, so old bookmarks and the
 *  shell indicator's former href land on the room (the room discriminates
 *  internally); the unknown-hash fallback (today) stays for anything else. */
function screenFromHash(): Screen | null {
 const name = location.hash.replace(/^#\/?/, '');
 if (name === 'exchange' || name === 'drm' || name === 'unprompted') return 'room';
 return (SCREENS as readonly string[]).includes(name) ? (name as Screen) : null;
}

// Hash routing: navTo writes the hash, this listener reads it back. An
// event for the current screen (our own write) is skipped so a navigation
// never re-renders twice. A hash naming nothing routable lands on today.
window.addEventListener('hashchange', () => {
 const screen = screenFromHash();
 if (!screen) { navTo('today'); return; }
 if (screen === state.screen) return;
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
   // canon §5.1: setup flows straight into the room — the setup screen
   // first; its success handler (initAuth's onSetupDone) auto-opens a
   // sitting and lands on #/room with the promise line.
   renderSetup();
   return;
  }

  // Auth file exists — check if we have a valid session
  try {
   // The auth probe and the today-existence fetch run together; the
   // cadence total decides whether Today exists yet (canon §5.1). A
   // cadence failure keeps the flag false — Today stays hidden until the
   // first sitting ends, when the room's close recomputes it.
   const [, cadence] = await Promise.all([
    api<QueueData>('/api/queue'),
    api<{ cadence: { total: number } }>('/api/cadence').catch(() => null),
   ]);
   state.hasSittings = cadence !== null && cadence.cadence.total > 0;
   startLiveRefresh();
   // The hash names a screen; empty or unknown takes the default boot —
   // Today when it exists, otherwise the room (the pre-earned state).
   const fromHash = screenFromHash();
   if (fromHash) navTo(fromHash);
   else if (state.hasSittings) renderToday(todayDeps);
   else navTo('room');
  } catch {
   renderLogin();
  }
 } finally {
  wait.done();
 }
})();
