import type {
 CaptureChannel,
 CutProposal,
 GateReading,
 HarvestDecision,
 Mode,
 QuestionForm,
 Snippet,
 SoundingEnd,
 Target,
 QueueEntry,
} from '../src/types.ts';
import type { Claim, Contradiction } from '../src/wiki/contract.ts';
import type { AnnotationRecord } from '../src/clerk/annotation-store.js';
import { formatEvent, relativeTime } from '../src/log/format.js';
import { sourceLabel } from '../src/queue/source-label.js';
import { renderImportEntry } from './import-entry.js';
import { declinePath, offerSentence, reachItNav, type ReachOfferLine } from './reach-line.js';
import { renderCoachPage } from './coach.js';
import { ulid } from 'ulid';

/* ─── API types ─── */

interface SessionResponse {
 sessionId: string;
 question: string;
 /** Present when the Randomizer dealt the opener (Q-18). */
 source?: 'deck' | 'resurfacing';
 /** Display-only lineage of a resurfaced opener (080) — never part of the question. */
 snippetQuestion?: string;
 context?: string;
}

interface TurnData {
 kind: 'probe' | 'saturated' | 'checkpoint' | 'descent-closed' | 'declined';
 text?: string;
 questionForm?: QuestionForm;
 phase?: string;
 juxtaposition?: { snippetText: string; snippetDate: string };
 /** Live descent reading (012 T9): present on every rung, never cached. */
 sounding?: GateReading;
 /** The one-shot offer (012 T9): present at most once per sitting. */
 soundingOffer?: { construct: string; allowance: number; sentence: string };
 /** The descent closed on this answer (012 T9) — cap or convergence, no gate press. */
 descentClosed?: SoundingEnd;
 /** Ladder identity, riding with `descentClosed` (012 T9). */
 soundingId?: string;
 /** The gate word that closed a descent (012 T9) — on descent-closed responses. */
 endedBy?: SoundingEnd;
}

/**
 * The /api/snippets wire view: a Snippet that may carry a resolved-referent
 * annotation (ticket 074) — agent prose riding beside, never inside, the
 * person's words. The shared Snippet type stays annotation-free.
 */
type WikiSnippet = Snippet & { annotation?: AnnotationRecord };

interface EndResponse {
 status: string;
 sessionId: string;
}

interface HarvestQueueEntry {
 sessionId: string;
 at: string;
 started: string;
 protocol: string;
 origin: 'harvest' | 'unprompted';
 proposalCount: number;
}

interface HarvestQueueRecord {
 sessionId: string;
 at: string;
 started: string;
 protocol: string;
 origin: 'harvest' | 'unprompted';
 proposals: CutProposal[];
}

interface HarvestResponse {
 snippets: unknown[];
 buds: unknown[];
}

interface QueueData {
 pending: Array<QueueEntry & { rungsKept?: number }>;
 open: Array<QueueEntry & { rungsKept?: number }>;
}

interface ActivityEvent {
 at: string;
 actor: string;
 kind: string;
 detail: string;
}

/**
 * `GET /api/wiki` — already shaped for reading (src/server.ts). Headings and
 * lint notes arrive as words, claims arrive in the order they are meant to be
 * read, and `lintedAt: null` means the Clerk has not read the wiki yet, which
 * is a different thing from having read it and found nothing.
 */
interface WikiFacetGroup {
 facet: string;
 heading: string;
 claims: Claim[];
}

interface WikiLintNote {
 kind: string;
 /** A claim id, a facet name, or a referent slug. NEVER printed (ticket 038). */
 subject: string;
 note: string;
}

interface WikiResponse {
 facets: WikiFacetGroup[];
 contradictions: Contradiction[];
 lint: WikiLintNote[];
 lintedAt: string | null;
 all: boolean;
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

/* Ticket 048: per-box paste accounting for capture-channel detection.
 * A paste event adds the clipboard length to a running counter; an input
 * event resets it when the box empties, so it only ever counts pasted
 * characters still present. The capture is 'pasted' iff pasted characters
 * are a strict majority of the submitted text. */
function pasteTracker(textarea: HTMLTextAreaElement) {
 let pastedChars = 0;
 textarea.addEventListener('paste', (e: ClipboardEvent) => {
  pastedChars += (e.clipboardData?.getData('text') ?? '').length;
 });
 textarea.addEventListener('input', () => {
  if (textarea.value.length === 0) pastedChars = 0;
 });
 return {
  isPasted(text: string): boolean {
   return pastedChars * 2 > text.length;
  },
  reset(): void {
   pastedChars = 0;
  },
 };
}

/* ─── State ─── */

type Screen = 'mode' | 'home' | 'exchange' | 'harvest' | 'done' | 'waiting' | 'login' | 'setup' | 'unprompted' | 'wiki' | 'reviews' | 'inbox' | 'import' | 'material' | 'library' | 'piece' | 'coach';

interface AppState {
 screen: Screen;
 sessionId: string | null;
 question: string | null;
 proposals: CutProposal[];
 decisions: HarvestDecision[];
 turnPhase: string | null;
 juxtaposition: { snippetText: string; snippetDate: string } | null;
 /** Lineage of a resurfaced opener (080): shown dimmed above the question, cleared on the next turn. */
 lineageQuestion: string | null;
 lineageContext: string | null;
 sttAvailable: boolean;
 dictating: boolean;
 turnHadSpeech: boolean;
 /** Minutes declared for the sitting; the session clock counts down from it. */
 sessionMinutes: number | null;
 /** Epoch ms when the sitting's countdown runs out; set when the sitting begins. */
 sessionDeadline: number | null;
 /** Session whose harvest is running behind the /end response (084). */
 pendingReviewSession: string | null;
 /** Live descent reading (012 T9): set on every rung, null when no descent is open. */
 sounding: GateReading | null;
 /** The one-shot offer (012 T9): set once, cleared by either word. */
 soundingOffer: { construct: string; allowance: number; sentence: string } | null;
/** The Coach page's slug (090 T11): set by navTo('coach', { slug }). */
 coachSlug: string | null;
}
const state: AppState = {
 screen: 'mode',
 sessionId: null,
 question: null,
 proposals: [],
 decisions: [],
 turnPhase: null,
 juxtaposition: null,
 lineageQuestion: null,
 lineageContext: null,
 sttAvailable: false,
 dictating: false,
 turnHadSpeech: false,
 sessionMinutes: null,
 sessionDeadline: null,
 pendingReviewSession: null,
 sounding: null,
 soundingOffer: null,
 coachSlug: null,
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
  case 'waiting': renderWaiting(); break;
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
  case 'wiki': renderWiki(false); break;
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
  case 'piece': renderPiece(); break;
 }
}

/**
 * Every routable name. The hash is honored only for these.
 */
const SCREENS: readonly Screen[] = [
 'mode', 'home', 'exchange', 'harvest', 'done', 'waiting', 'login',
 'setup', 'unprompted', 'wiki', 'reviews', 'inbox', 'import',
 'material', 'library', 'piece', 'coach',
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


/**
 * A failed call. `handled` means api() already put the explanation on screen,
 * so the caller's waiting affordance leaves without adding a second line.
 */
class ApiError extends Error {
 readonly status: number;
 readonly handled: boolean;
 constructor(message: string, status: number, handled = false) {
  super(message);
  this.status = status;
  this.handled = handled;
 }
}

/**
 * Read routes, by prefix. `/api/wiki` is matched exactly (with its query
 * string) rather than by prefix, because `/api/wiki/claim/:id/read` sits under
 * the same path and is the one write the wiki surface makes.
 */
const GET_PREFIXES = ['/api/queue', '/api/activity', '/api/stt/status', '/api/cadence', '/api/snippets', '/api/harvest-queue', '/api/pieces'];

function isReadPath(path: string): boolean {
 if (GET_PREFIXES.some((p) => path.startsWith(p))) return true;
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

async function api<T>(path: string, body?: unknown): Promise<T> {
 const method = isReadPath(path) ? 'GET' : 'POST';
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
 return res.json() as T;
}

async function apiRaw(path: string): Promise<Response> {
 const res = await fetch(path, { method: 'GET' });
 if (!res.ok) {
  if (res.status === 401) { navTo('login'); throw new ApiError('unauthorized', 401, true); }
  throw new ApiError(`${res.status}`, res.status);
 }
 return res;
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
 releaseReadWatch();
 releaseCorrectingMode();
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

 div.append(backLink, heading, hint, input, confirm, submit, errorSlot);
 surface.append(div);
 input.focus();
}

/* ── Mode screen ── */

function renderMode(showSetupHint?: boolean) {
 clear();
 state.screen = 'mode';
 renderShell();
 state.turnPhase = null;
 state.juxtaposition = null;

 const div = el('div', { class: 'screen active mode-form' });

 // Region one — begin: the sitting controls, under one heading.
 const beginHeading = el('h2', { class: 'home-heading' }, 'start a sitting');

 const minutesRow = el('div', { class: 'mode-row' });
 const minLabel = el('label', {}, 'how long?');
 const minSelect = el('select', { class: 'mode-select' });
 for (const m of [10, 25, 45]) {
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

   const res = await api<SessionResponse>(
    '/api/session',
    shuffle ? { mode, shuffle: true } : { mode },
   );
   state.sessionId = res.sessionId;
   state.question = res.question;
   state.lineageQuestion = res.snippetQuestion ?? null;
   state.lineageContext = res.context ?? null;
   // The clock counts down from the declared minutes; the deadline is set
   // once, here, so re-rendering the exchange screen does not reset it.
   state.sessionMinutes = mode.minutes;
   state.sessionDeadline = Date.now() + mode.minutes * 60_000;
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

 div.append(beginHeading, minutesRow, energyRow, targetRow, topicInput, navRow, submit, shuffleRow, errorSlot);
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

 const doneBtn = el('button', { class: 'harvest-now' }, 'done');
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
    { text, channel: pasted ? 'pasted' : 'typed' },
   );
   state.sessionId = res.sessionId;
   state.pendingReviewSession = res.sessionId;
   wait.done();
   navTo('reviews');
  } catch (e) {
   wait.failed(e);
   doneBtn.disabled = false;
   page.disabled = false;
  }
 });

 div.append(backRow, page, doneBtn, errorSlot);
 surface.append(div);

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

/**
 * The door question a gate-press close leaves behind (012 T9). The gate
 * route returns no text on descent-closed — the server appends this same
 * sentence to its transcript — so the exchange renders it itself. The
 * wording announces the descent closing, never the person stopping (Q-46).
 */
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
 state.dictating = false;
 // A fresh exchange screen starts with no descent and no offer (012 T9);
 // re-rendering must not inherit either from a previous screen.
 state.sounding = null;
 state.soundingOffer = null;

 const div = el('div', { class: 'screen active' });

 const header = el('div', { class: 'exchange-header' });
 const openerLineage = lineageBlock(
  state.lineageQuestion ?? undefined,
  state.lineageContext ?? undefined,
 );
 if (openerLineage) header.append(openerLineage);
 const questionBlock = el('div', { class: 'question-block' }, state.question!);
 header.append(questionBlock);

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
 const harvestBtn = el('button', { class: 'harvest-now' }, 'harvest now');
 const skipBtn = el('button', { class: 'harvest-now' }, 'skip');
 const laterBtn = el('button', { class: 'harvest-now' }, 'later');

 // Margin follow-up: what the question needs before it can be answered.
 const deferRow = el('div', { class: 'defer-row' });
 const deferPrompt = el('span', { class: 'defer-prompt' }, 'when I have more');
 const timeWord = el('button', { class: 'defer-need' }, 'time');
 const energyWord = el('button', { class: 'defer-need' }, 'energy');
 const plainWord = el('button', { class: 'defer-need' }, 'just later');
 deferRow.append(deferPrompt, timeWord, energyWord, plainWord);

 // The writing grammar allows one hint line: how Enter behaves, in dim ink.
 const answerHint = el('div', { class: 'answer-hint' }, 'Enter sends \u00b7 Shift+Enter for a new line');
 // Leaving is not harvesting: the transcript already lives server-side, so
 // this word only navigates — it must never call /api/session/:id/end.
 const leaveWord = el('button', { class: 'nav-link exchange-leave' }, 'leave \u2014 your words keep');
 leaveWord.addEventListener('click', () => navTo('mode'));

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

const gateRow = el('div', { class: 'gate-row' });
const gateReading = el('span', { class: 'gate-reading' });
const continueWord = el('button', { class: 'gate-word continue', type: 'button' }, 'continue');
const parkWord = el('button', { class: 'gate-word park', type: 'button' }, 'park, depth kept');
const anotherDayWord = el('button', { class: 'gate-word another-day', type: 'button' }, 'another day');
continueWord.hidden = true; // 'continue' is a control only at the checkpoint
gateRow.append(gateReading, continueWord, parkWord, anotherDayWord);

let gateControls: HTMLButtonElement[] = [];
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

/** Take the gate off the screen and restore the ordinary controls. */
function removeGateRow() {
 gateRow.classList.remove('visible');
 gateRow.classList.remove('checkpoint');
 continueWord.hidden = true;
 gateControls = [];
 checkpointActive = false;
 textarea.disabled = false;
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
 openerLineage?.remove();
 state.turnPhase = res.phase ?? null;
 state.juxtaposition = res.juxtaposition ?? null;

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
 *  known close sentence (Q-46: the descent closes, never the person stops). */
function closeByGate() {
 state.sounding = null;
 removeGateRow();
 state.question = DOOR_QUESTION;
 questionBlock.textContent = DOOR_QUESTION;
 appendTurn('agent', DOOR_QUESTION);
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

continueWord.addEventListener('click', () => pressGate('continue'));
parkWord.addEventListener('click', () => pressGate('park'));
anotherDayWord.addEventListener('click', () => pressGate('another-day'));

 answerRow.append(textarea, micBtn, micStatus, sendBtn);
 answerArea.append(answerRow, harvestBtn, skipBtn, laterBtn, deferRow, answerHint, leaveWord, gateRow);
 // The end-of-sitting words group into one row, right-aligned under a
 // hairline; appending moves them without touching the append above.
 const actionRow = el('div', { class: 'action-row' });
 actionRow.append(harvestBtn, skipBtn, laterBtn, leaveWord);
 answerArea.append(actionRow);


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
  harvestBtn.disabled = true;
  skipBtn.disabled = true;
  laterBtn.disabled = true;
  deferRow.classList.remove('active');
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
    closeByGate();
   } else {
    // saturated — the sitting is over. The harvest runs behind the response
    // and lands in the review queue (084), where the existing review cards
    // pick it up — no stale empty card.
    try {
     const res = await api<EndResponse>(
      `/api/session/${state.sessionId}/end`,
     );
     state.pendingReviewSession = res.sessionId;
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
  harvestBtn.disabled = false;
  skipBtn.disabled = false;
  laterBtn.disabled = false;
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
  harvestBtn.disabled = busy;
  skipBtn.disabled = busy;
  laterBtn.disabled = busy;
  if (state.sttAvailable) micBtn.disabled = busy;
  sendBtn.disabled = busy;
  for (const c of gateControls) c.disabled = busy;
 }

 harvestBtn.addEventListener('click', async () => {
  setControlsBusy(true);
  // Near-instant now: the harvest runs behind the response and lands in the
  // review queue (084), whose cards await the person's decisions.
  const wait = beginWait(answerArea, 'reading back what you said…');
  try {
   const res = await api<EndResponse>(
    `/api/session/${state.sessionId}/end`,
   );
   state.pendingReviewSession = res.sessionId;
   wait.done();
   navTo('reviews');
  } catch (e) {
   wait.failed(e);
   setControlsBusy(false);
  }
 });

 /** Show the replacement question skip and defer both return, or close the exchange. */
 function takeNextQuestion(res: { kind: string; text?: string }) {
  if (res.kind === 'question') {
   state.question = res.text!;
   state.lineageQuestion = null;
   state.lineageContext = null;
   openerLineage?.remove();
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
    el('p', { class: 'skip-exhausted' }, 'No more starters. Consider harvesting.'),
   );
   skipBtn.disabled = true;
   laterBtn.disabled = true;
   harvestBtn.disabled = true;
   textarea.disabled = true;
  }
 }

 skipBtn.addEventListener('click', async () => {
  skipBtn.disabled = true;
  const wait = beginWait(answerArea, 'finding another…');
  try {
   const res = await api<{ kind: string; text?: string }>(
    `/api/session/${state.sessionId}/skip`,
   );
   wait.done();
   takeNextQuestion(res);
  } catch (e) {
   wait.failed(e);
   skipBtn.disabled = false;
  }
 });

 // ── Defer: the question goes back to the queue with what it needs ──

 laterBtn.addEventListener('click', () => {
  deferRow.classList.toggle('active');
 });

 async function defer(need?: 'time' | 'energy') {
  laterBtn.disabled = true;
  skipBtn.disabled = true;
  const wait = beginWait(answerArea, 'putting it back…');
  try {
   const res = await api<{ kind: string; text?: string }>(
    `/api/session/${state.sessionId}/defer`,
    need ? { need } : undefined,
   );
   wait.done();
   deferRow.classList.remove('active');
   takeNextQuestion(res);
  } catch (e) {
   wait.failed(e);
   laterBtn.disabled = false;
   skipBtn.disabled = false;
  }
 }

 timeWord.addEventListener('click', () => defer('time'));
 energyWord.addEventListener('click', () => defer('energy'));
 plainWord.addEventListener('click', () => defer());

 // ── Mic toggle ──

 let micActive = false;
 let micBusy = false;

 micBtn.addEventListener('click', async () => {
  if (micBusy) return;
  if (!micActive) {
   // Start recording
   try {
    await startRecording();
    micActive = true;
    micBtn.classList.add('active');
    micStatus.textContent = 'listening\u2026';
    state.dictating = true;
   } catch (e) {
    console.error(e);
    showQuietError(answerArea, 'the microphone did not open — check permission');
   }
  } else {
   // Stop and transcribe
   micActive = false;
   micBusy = true;
   micBtn.classList.remove('active');
   micBtn.disabled = true;
   micStatus.textContent = 'transcribing\u2026';
   try {
    const text = await stopAndTranscribe();
    if (text) {
     state.turnHadSpeech = true;
     // Append at cursor or end
     const start = textarea.selectionStart;
     const end = textarea.selectionEnd;
     const before = textarea.value.slice(0, start ?? textarea.value.length);
     const after = textarea.value.slice(end ?? textarea.value.length);
     textarea.value = before + text + after;
     textarea.dispatchEvent(new Event('input'));
     textarea.focus();
    }
   } catch (e) {
    console.error(e);
    showQuietError(answerArea, 'that did not come through — say it again');
   }
   micBusy = false;
   micBtn.disabled = false;
   micStatus.textContent = '';
   state.dictating = false;
  }
 });

 // Check STT availability and hide toggle if unavailable
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
  div.append(progress, submitRow, backRow);

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
    await api<HarvestResponse>(
     `/api/session/${state.sessionId}/harvest`,
     { decisions: state.decisions },
    );
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

/**
 * The eliciting question and context window that produced this ink, dimmed —
 * lineage, not corpus. Shared by the harvest review card and the wiki quotes.
 * Returns null when neither is present — absent lineage never renders a box.
 */
function lineageBlock(question: string | undefined, context: string | undefined): HTMLElement | null {
 if (!question && !context) return null;
 const prov = el('div', { class: 'lineage-provenance' });
 if (question) {
  const q = el('div', { class: 'lineage-question' });
  q.textContent = '\u2191 ' + question;  // up-arrow: "this asked"
  prov.append(q);
 }
 if (context) {
  const ctx = el('div', { class: 'lineage-context' });
  // Show context then the cut's boundary marked with a hairline
  ctx.textContent = context + ' \u2500';  // em-dash marks boundary
  prov.append(ctx);
 }
 return prov;
}

function renderProposal(idx: number, container: HTMLElement) {
 const p = state.proposals[idx]!;

 const block = el('div', { class: 'proposal-block' });

 // Show the eliciting question and context window, dimmed — lineage, not corpus
 const prov = lineageBlock(p.question, p.context);
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
  const validTrim = (): boolean => {
   const v = editorEl!.value;
   return v.trim() !== '' && (p.text.includes(v) || v === p.text);
  };
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
      // Not there yet — keep polling.
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
     `${entry.protocol} \u00b7 ${entry.proposalCount} proposal${entry.proposalCount === 1 ? '' : 's'}`,
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
 surface.append(div);
}

/* ── Parked descents surface ── */

// The waiting page: what is open, what is parked, and the activity stream.
// Home keeps only the sitting controls.

function renderWaiting() {
 clear();
 state.screen = 'waiting';
 renderShell();

 const div = el('div', { class: 'screen active waiting-surface' });

 // The Reach offer (014 T14): one dimmed line, nothing on silence. The
 // cadence line's idiom exactly — the record, offered, and nothing acts on
 // it (Q-37, Q-62): `offer: null` renders nothing at all, `not now` costs
 // one click and records a decline, and `reach it` lands the map on the
 // region the offer named. One line, one region, never a list (Q-24).
 const reachLine = el('p', { class: 'reach-offer' }, '');
 div.append(reachLine);
 api<{ offer: ReachOfferLine | null; root: string | null }>('/api/reach')
  .then((r) => {
   if (r.offer === null) return; // silence renders nothing
   reachLine.textContent = offerSentence(r.offer) ?? '';
   const reachIt = el('button', { class: 'reach-action', type: 'button' }, 'reach it');
   const notNow = el('button', { class: 'reach-action', type: 'button' }, 'not now');
   reachIt.addEventListener('click', () => {
    const nav = reachItNav(r.offer!.path);
    navTo(nav.screen, { focus: nav.focus, ...(r.root !== null ? { folder: r.root } : {}) });
   });
   notNow.addEventListener('click', async () => {
    try {
     await api(declinePath(), { path: r.offer!.path });
    } catch {
     // The offer stays; a failed record must not put a second line anywhere.
    }
    reachLine.replaceChildren(); // gone for this render — :empty hides it
   });
   reachLine.append(' ', reachIt, ' · ', notNow);
  })
  .catch(() => {
   /* the offer is not load-bearing; a failed read shows nothing */
  });

// The Coach surface (090 T11): at most one dimmed offer line, and one
// quiet line per coached Direction with something new (Q-37, Q-76).
// `offer: null` and an empty lines list render nothing at all; the offer's
// accept word posts /direction — the ONLY door (Q-73) — then lands on the
// page; its decline word records the decline, and silence does nothing.
const coachLine = el('div', { class: 'coach-waiting' }, '');
div.append(coachLine);
api<{ offer: { slug: string; name: string; sentence: string } | null; lines: { slug: string; sentence: string }[] }>('/api/coach/waiting')
 .then((r) => {
  if (r.offer !== null) {
   const offer = el('p', { class: 'coach-offer-line' }, r.offer.sentence);
   const accept = el('button', { class: 'coach-word', type: 'button' }, 'take up');
   const decline = el('button', { class: 'coach-word', type: 'button' }, 'not this');
   accept.addEventListener('click', () => {
    api<{ direction: { slug: string } }>('/api/coach/direction', { name: r.offer!.name })
     .then(() => navTo('coach', { slug: r.offer!.slug }))
     .catch(() => { /* a failed declaration shows nothing */ });
   });
   decline.addEventListener('click', () => {
    api(`/api/coach/direction/${r.offer!.slug}/decline-offer`).catch(() => { /* record, not load-bearing */ });
    offer.replaceChildren(); // gone for this render — :empty hides it
   });
   offer.append(' ', accept, ' · ', decline);
   coachLine.append(offer);
  }
  for (const line of r.lines) {
   const p = el('p', { class: 'coach-quiet-line' }, line.sentence);
   const open = el('button', { class: 'coach-word', type: 'button' }, 'open');
   open.addEventListener('click', () => navTo('coach', { slug: line.slug }));
   p.append(' ', open);
   coachLine.append(p);
  }
 })
 .catch(() => { /* the offer is not load-bearing; a failed read shows nothing */ });

// Parked section — parked-sounding pointers waiting to be picked up (012 T12).
 // Dormancy is signal, never debt (Q-24): each row shows the last rung's
 // question and how many rungs are kept, with no age colouring and nothing
 // that reads as owed work. The section stays hidden when nothing is parked.
 const parkedSection = el('div', { class: 'waiting-section parked-section' });
 const parkedHeading = el('h2', { class: 'waiting-heading' }, 'parked');
 const parkedList = el('div', { class: 'parked-list' });
 parkedSection.append(parkedHeading, parkedList);

// Region two — waits: what is open, under the sitting controls.
const waitsSection = el('div', { class: 'home-section waits-section' });
const waitsHeading = el('h2', { class: 'home-heading' }, 'waits for you');

// Cadence — one sentence, at the top, above the lists (ticket 056).
// The document rule: a line of text on a page, not a widget. It carries no
// control, no colour and no comparison; a long gap reads exactly like a
// short one, because dormancy is signal and never debt (Q-24). The wording
// is composed server-side so it is testable — see src/log/cadence.ts.
const cadenceLine = el('p', { class: 'cadence-line' }, '');
api<{ sentence: string }>('/api/cadence')
 .then((r) => { cadenceLine.textContent = r.sentence; })
 .catch(() => { /* the record is not load-bearing; a failed read shows nothing */ });

// The review queue, as a sentence below the cadence (the verb-grammar
// rule): what waits is said, with one control word at the point of
// attention. The `:empty` rule keeps it off the page until a harvest
// actually waits.
const reviewsLine = el('p', { class: 'waiting-reviews-line' });

// Expedition section — entries with horizon 'days' waiting to go out
const expSection = el('div', { class: 'waiting-section expedition-section' });
const expHeading = el('h2', { class: 'waiting-heading' }, 'out in the world');
const expList = el('div', { class: 'expedition-list' });
expSection.append(expHeading, expList);

// Queue section — entries with horizon 'session' waiting to be drawn
const queueSection = el('div', { class: 'waiting-section' });
const queueHeading = el('h2', { class: 'waiting-heading' }, 'open questions');
const queueList = el('div', { class: 'queue-list' });
queueSection.append(queueHeading, queueList);


waitsSection.append(waitsHeading, cadenceLine, reviewsLine, expSection, queueSection);

// Region three — activity: the stream, folded to its newest lines.
const activitySection = el('div', { class: 'home-section activity-section' });
const activityHeading = el('h2', { class: 'home-heading' }, 'activity');
const activityList = el('div', { class: 'activity-list' });
const moreWord = el('button', { class: 'nav-link activity-more', type: 'button' }, 'more');
moreWord.hidden = true;
moreWord.addEventListener('click', () => {
 for (const l of activityList.querySelectorAll<HTMLElement>('.activity-line')) l.hidden = false;
 moreWord.hidden = true;
});
activitySection.append(activityHeading, activityList, moreWord);

// No initial events yet — show a quiet empty message until the SSE
// snapshot arrives (removed below when real events show up).
let emptyMsg: HTMLParagraphElement | null = el('p', { class: 'empty-msg' }, 'nothing yet');
activityList.append(emptyMsg);

function syncEmptyActivity() {
 const hasLines = activityList.querySelector('.activity-line') !== null;
 if (hasLines && emptyMsg) {
  emptyMsg.remove();
  emptyMsg = null;
 } else if (activityList.children.length === 0) {
  emptyMsg = el('p', { class: 'empty-msg' }, 'nothing yet');
  activityList.append(emptyMsg);
 }
}

 div.append(waitsSection, parkedSection, activitySection);
 surface.append(div);

// What wants the person, as a sentence with one word in it — the same
// call the old mode page made for its count. A failed read shows nothing.
(async () => {
 try {
  const data = await api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
  if (state.screen !== 'waiting') return;
  if (data.pending.length === 0) return;
  const n = data.pending.length;
  const readWord = el('button', { class: 'nav-link' }, 'read them');
  readWord.addEventListener('click', () => navTo('reviews'));
  reviewsLine.append(
   document.createTextNode(`${n} harvest${n === 1 ? ' waits' : 's wait'} for your review \u2014 `),
   readWord,
   document.createTextNode('.'),
  );
 } catch {
  // The review queue is offer-only; a failed read just means no line.
 }
})();

// Age helper: compact relative-time display (e.g. "2d ago", "just now")
function ageString(created: string): string {
 const ms = Date.now() - new Date(created).getTime();
 const mins = Math.floor(ms / 60000);
 if (mins < 1) return 'just now';
 if (mins < 60) return `${mins}m ago`;
 const hours = Math.floor(mins / 60);
 if (hours < 24) return `${hours}h ago`;
 const days = Math.floor(hours / 24);
 return `${days}d ago`;
}

// Load the lists
(async () => {
 const wait = beginWait(queueList, 'looking…', 400);
 try {
  const data = await api<QueueData>('/api/queue');
  wait.done();
  queueList.innerHTML = '';
  expList.innerHTML = '';

  const expeditions = data.open.filter((e) => e.horizon === 'days');
  const pending = data.open.filter((e) => e.horizon !== 'days' && e.source !== 'parked-sounding');

  if (expeditions.length > 0) {
   for (const entry of expeditions) {
    const row = el('div', { class: 'expedition-entry' });
    const question = el('span', { class: 'expedition-question' }, entry.question);
    const age = el('span', { class: 'expedition-age' }, ageString(entry.created));
    row.append(question, age);
    expList.append(row);
   }
  }

  if (pending.length === 0) {
   queueList.append(el('p', { class: 'empty-msg' }, 'nothing waiting'));
  } else {
   for (const entry of pending) {
    const row = el('div', { class: 'queue-entry' });
    const question = el('span', { class: 'queue-question' }, entry.question);
    // Where the question came from, in words. No queue `source` literal
    // reaches the DOM \u2014 `contradiction-remeasure` announcing itself as a
    // re-measure is the verification Q-15 forbids.
    const meta = el('span', { class: 'queue-meta' }, `${sourceLabel(entry.source)} \u00b7 ${entry.horizon}`);
    row.append(question, meta);
    queueList.append(row);
   }
  }
 } catch (e) {
  wait.done();
  queueList.innerHTML = '';
  queueList.append(el('p', { class: 'empty-msg' }, 'could not load what is waiting'));
  console.error(e);
 }
})();

// Connect activity SSE
(async () => {
 try {
  const resp = await fetch('/api/activity', {
   method: 'GET',
   headers: { Accept: 'text/event-stream' },
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
   const { done, value } = await reader.read();
   if (done) break;
   buffer += decoder.decode(value, { stream: true });

   // Parse SSE events
   const lines = buffer.split('\n');
   buffer = lines.pop() ?? '';
   let currentData = '';
   for (const line of lines) {
    if (line.startsWith('data: ')) {
     currentData = line.slice(6);
    } else if (line.startsWith(': heartbeat')) {
     // Historical batch flushed — settle the empty state.
     syncEmptyActivity();
    } else if (line === '' && currentData) {
     try {
      const ev: ActivityEvent = JSON.parse(currentData);
      const lineEl = el('div', { class: 'activity-line' });
      const actor = el('span', { class: 'activity-actor' }, ev.actor);
      const detail = el('span', { class: 'activity-detail' }, formatEvent(ev));
      lineEl.append(actor, ' ', detail);
      const age = relativeTime(ev.at);
      if (age) lineEl.append(' ', el('span', { class: 'activity-age' }, age));
      activityList.prepend(lineEl);
      syncEmptyActivity();
      // Keep the newest eight lines; fold the rest behind the more word.
      const shown = activityList.querySelectorAll<HTMLElement>('.activity-line');
      for (const old of Array.from(shown).slice(8)) old.hidden = true;
      moreWord.hidden = shown.length <= 8;
     } catch { /* skip malformed */ }
     currentData = '';
    }
   }
  }
 } catch { /* SSE connection failed silently */ }
})();


 // Load the parked pointers
 (async () => {
  const wait = beginWait(parkedList, 'looking…', 400);
  try {
   const data = await api<QueueData>('/api/queue');
   wait.done();
   parkedList.innerHTML = '';

   const expeditions = data.open.filter((e) => e.horizon === 'days');
   // The parked pointers arrive inside `open` (horizon 'session'); the source
   // filter keeps them out of the questions list so nothing appears twice.
   const parked = data.open.filter((e) => e.source === 'parked-sounding');
   const pending = data.open.filter((e) => e.horizon !== 'days' && e.source !== 'parked-sounding');

   if (parked.length > 0) {
    for (const entry of parked) {
     const row = el('div', { class: 'parked-entry' });
     const question = el('span', { class: 'parked-question' }, entry.question);
     const meta = el('span', { class: 'parked-meta' }, `${entry.rungsKept ?? 0} rungs kept`);
     const pickUp = el('button', { class: 'nav-link', type: 'button' }, 'pick it up');
     row.append(question, meta, pickUp);
     pickUp.addEventListener('click', async () => {
      if (!state.sessionId) {
       // A sitting must be under way to resume into (the plan's upstream
       // contract); the mode screen is where one begins.
       navTo('mode');
       return;
      }
      pickUp.disabled = true;
      const wait = beginWait(row, 'picking it up\u2026');
      try {
       const res = await api<TurnData>(
        `/api/session/${state.sessionId}/sounding/resume`,
        { queueEntryId: entry.id },
       );
       wait.done();
       if (res.kind === 'probe') {
        state.question = res.text!;
        navTo('exchange');
       }
      } catch (e) {
       pickUp.disabled = false;
       wait.failed(e);
      }
     });
     parkedList.append(row);
    }
   } else {
    // Nothing parked: the section stays quiet — no empty heading, no count
    // of how long anything has sat (Q-24).
    parkedSection.hidden = true;
   }
  } catch (e) {
   wait.done();
   parkedList.innerHTML = '';
   parkedList.append(el('p', { class: 'empty-msg' }, 'could not load what is waiting'));
   console.error(e);
  }
 })();

}

/* ── The wiki: a reading surface ──
 *
 * A page of prose, not a list of claim cards (docs/interface-references.md).
 * Three rules govern everything below and each one is load-bearing:
 *
 * 1. **No status word ever reaches the DOM.** `unconfirmed`, `evidenced`,
 *    `user-attested` and `contested` are carried by ink alone. A claim whose
 *    evidence is contested is a fact about evidence, not a verdict on the
 *    person; printing the word turns the page into an accusation (Q-15). The
 *    ink scale runs one way — from the Clerk's own sentence in light ink to
 *    the person's quoted words in the darkest — so darkness reads as "more of
 *    your own words stand under this", and a page entirely in light ink reads
 *    as early evidence rather than as failure (Q-21, Q-27).
 * 2. **Verbs exist, but only in correcting mode** (the verb-grammar rule,
 *    `docs/interface-references.md`): a click on a claim dims the page
 *    around it and brings two margin words. The reading page carries none
 *    at rest — the only two controls are a back link and one sentence at
 *    the foot that widens the reading.
 * 3. **No numbers.** No counts, no confidence, no progress (Q-21, Q-24).
 */

const WIKI_OPENING =
 'What the Clerk has made of your words so far. Every sentence here is the ' +
 'Clerk’s; the quotations beneath are yours. Ink darkens as more of your ' +
 'own words come to stand under a sentence — a page in light ink has only begun.';

const WIKI_EMPTY =
 'There is nothing on this page yet. The Clerk writes a sentence only where ' +
 'your own words can stand under it.';

/* ── The read-log (Q-21) ──
 *
 * DECISION: a read is recorded on DWELL, not on scroll-into-view and not on a
 * focus interaction.
 *
 * The read-log is what later discounts a claim's evidence: a snippet
 * volunteered after the person read the claim it supports carries less weight.
 * So a read recorded that the person did not perform makes their real evidence
 * count for less — over-recording is not the conservative direction, it is the
 * destructive one. Scroll-into-view over-records by construction: a flick past
 * a section logs every claim in it.
 *
 * Focus under-records to nothing. This surface has no verbs by contract, so
 * nothing on it can take focus; a focus rule would ship an instrument that
 * never fires.
 *
 * Dwell is the measurement that matches the event. The claim must hold half
 * the reader's view, without interruption, for long enough to have been read,
 * in a tab that is actually on screen. A fast scroll records nothing; sitting
 * with a sentence records once. Once per claim per page load: the log answers
 * "had they seen this before they wrote that", and a second entry adds no
 * answer.
 */
const READ_DWELL_MS = 2500;
/** Claims already logged this page load. Reset by a full reload, not by navigation. */
const readsRecorded = new Set<string>();

let readWatcher: IntersectionObserver | null = null;
let readTimers: Map<Element, ReturnType<typeof setTimeout>> | null = null;
let readVisibilityHandler: (() => void) | null = null;

function releaseReadWatch() {
 readWatcher?.disconnect();
 readWatcher = null;
 if (readTimers) {
  for (const t of readTimers.values()) clearTimeout(t);
  readTimers = null;
 }
 if (readVisibilityHandler) {
  document.removeEventListener('visibilitychange', readVisibilityHandler);
  readVisibilityHandler = null;
 }
}

function recordRead(id: string) {
 if (readsRecorded.has(id)) return;
 readsRecorded.add(id);
 // Fire and forget. This is a record of a reading, never an edit, and a
 // failed record must not put anything on a page the person is reading.
 api(`/api/wiki/claim/${encodeURIComponent(id)}/read`, { surface: 'wiki' })
  .catch((e: unknown) => { console.error(e); });
}

/** Watch every `[data-claim]` under `root` and log a read after the dwell. */
function watchReads(root: HTMLElement) {
 releaseReadWatch();
 const blocks = root.querySelectorAll<HTMLElement>('[data-claim]');
 if (blocks.length === 0) return;
 if (typeof IntersectionObserver === 'undefined') return;

 const timers = new Map<Element, ReturnType<typeof setTimeout>>();
 readTimers = timers;

 function cancel(target: Element) {
  const t = timers.get(target);
  if (t !== undefined) {
   clearTimeout(t);
   timers.delete(target);
  }
 }

 const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
   const target = entry.target as HTMLElement;
   const id = target.dataset.claim;
   if (!id) continue;

   // Half the block, or half the view for a block taller than the view —
   // a long quotation must not become unreadable-by-definition.
   const viewHeight = entry.rootBounds?.height ?? window.innerHeight;
   const held =
    entry.isIntersecting &&
    (entry.intersectionRatio >= 0.5 ||
     entry.intersectionRect.height >= viewHeight * 0.5);

   if (!held || document.hidden) {
    cancel(target);
    continue;
   }
   if (timers.has(target)) continue;
   timers.set(target, setTimeout(() => {
    timers.delete(target);
    observer.unobserve(target);
    recordRead(id);
   }, READ_DWELL_MS));
  }
 }, { threshold: [0, 0.5, 1] });

 for (const block of blocks) observer.observe(block);
 readWatcher = observer;

 // A claim left on screen behind another window was not read. The observer
 // sees no intersection change when the tab hides, so the tab has to say so.
 readVisibilityHandler = () => {
  if (!document.hidden) return;
  for (const target of [...timers.keys()]) cancel(target);
 };
 document.addEventListener('visibilitychange', readVisibilityHandler);
}

/* ── Correcting mode (the verb-grammar rule) ──
 *
 * The wiki's dominant verb is reading, so the page at rest carries nothing
 * but prose and two quiet controls. Correcting enters as an explicit mode
 * shift: one claim focused, the page dimmed around it, two margin words
 * inside the claim. Clicking the focused claim again, clicking another
 * claim, or pressing Escape leaves the mode — chrome arrives on entry and
 * leaves on exit, never interleaved at rest.
 */
let correctingPage: HTMLElement | null = null;
let correctingClaim: HTMLElement | null = null;
let correctingKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function releaseCorrectingMode(): void {
 if (correctingPage) correctingPage.classList.remove('correcting');
 if (correctingClaim) correctingClaim.classList.remove('focused');
 correctingPage = null;
 correctingClaim = null;
 if (correctingKeyHandler) {
  document.removeEventListener('keydown', correctingKeyHandler);
  correctingKeyHandler = null;
 }
}

function focusClaim(page: HTMLElement, block: HTMLElement, claimId: string): void {
 releaseCorrectingMode();
 correctingPage = page;
 correctingClaim = block;
 page.classList.add('correcting');
 block.classList.add('focused');

 const verbs = el('div', { class: 'claim-verbs' });
 // The verbs' own clicks must not toggle the mode off through the block
 // handler, so the row swallows them.
 verbs.addEventListener('click', (e) => e.stopPropagation());

 const attest = el('button', { class: 'nav-link' }, 'that’s me exactly');
 attest.addEventListener('click', () => {
  api(`/api/wiki/claim/${encodeURIComponent(claimId)}/attest`)
   .then(() => {
    // No status word: the flag's ink arrives when the Clerk next reads
    // (Q-33), and the line says that and no more.
    verbs.replaceWith(marginNote('noted — your ink joins this sentence when the Clerk next reads'));
   })
   .catch((e: unknown) => console.error(e));
 });

 const challenge = el('button', { class: 'nav-link' }, 'not quite — ask me');
 challenge.addEventListener('click', () => {
  api(`/api/wiki/claim/${encodeURIComponent(claimId)}/challenge`)
   .then(() => {
    verbs.replaceWith(marginNote('a question is on its way to your queue'));
   })
   .catch((e: unknown) => console.error(e));
 });

 verbs.append(attest, challenge);
 block.append(verbs);

 if (!correctingKeyHandler) {
  correctingKeyHandler = (e) => {
   if (e.key === 'Escape') releaseCorrectingMode();
  };
  document.addEventListener('keydown', correctingKeyHandler);
 }
}

/* ── Typesetting helpers ── */

/**
 * The claim as one sentence with its Range as an em-dash clause inside it
 * (the document rule), rather than as a second line of metadata. A trailing
 * full stop moves to the end so the clause reads as a clause.
 */
function claimSentence(body: string, range: string): string {
 const r = range.trim();
 if (!r) return body;
 const stripped = body.trim().replace(/[.]+$/, '');
 return `${stripped} — ${r}.`;
}

/** A date a person reads, from an ISO stamp. */
function readableDate(iso: string): string {
 const d = new Date(iso);
 if (Number.isNaN(d.getTime())) return '';
 return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A quotation in the person's own ink, dated. The cite IS the quote (Q-27). */
function quoteBlock(
 prose: string,
 iso?: string,
 prov?: { question?: string; context?: string },
 ann?: { expression: string; referent: string },
): HTMLElement {
 const q = el('blockquote', { class: 'claim-quote' }, prose);
 // The lineage that produced these words, dimmed above them — as on the
 // harvest review card. Nothing renders when neither field is present.
 if (prov) {
  const lineage = lineageBlock(prov.question, prov.context);
  if (lineage) q.prepend(lineage);
 }
 const when = iso ? readableDate(iso) : '';
 if (when) q.append(el('span', { class: 'claim-quote-date' }, when));
 // The resolved referent (ticket 074): agent prose in the margin, after
 // the date, never inside the person's words. Only the annotation kind
 // renders — silence means the model judged nothing to resolve.
 if (ann) q.append(marginNote(`“${ann.expression}” → ${ann.referent}`));
 return q;
}

/** A dimmed marginal remark. Never carries an id — `subject` stays unprinted. */
function marginNote(text: string): HTMLElement {
 return el('p', { class: 'wiki-note' }, text);
}

/**
 * Which ink a claim takes. The one place a `ClaimStatus` is read.
 *
 * The names on the right are the INK's names, not the status's. A status word
 * does not reach the DOM even as an attribute value: `contested` sitting in
 * the markup is one view-source away from being the verdict Q-15 forbids, and
 * the ink is what the reader is actually being told about anyway.
 */
function claimInk(cl: Claim): string {
 if (cl.archived === true || cl.supersededBy !== undefined) return 'aside';
 switch (cl.status) {
  case 'user-attested': return 'yours';
  case 'evidenced': return 'standing';
  case 'contested': return 'facing';
  default: return 'opening';
 }
}

/* ── Render ── */

function renderWiki(all = false) {
 clear();
 state.screen = 'wiki';
 renderShell();

 const div = el('div', { class: 'screen active wiki-surface' });

 const shell = el('div', { class: 'wiki-shell' });
 const sidebar = el('nav', { class: 'wiki-sidebar' });
 const page = el('div', { class: 'wiki-page' });
 shell.append(sidebar, page);
 div.append(shell);
 surface.append(div);

 (async () => {
  const wait = beginWait(page, 'reading…', 400);
  try {
   const [wiki, snippets] = await Promise.all([
    api<WikiResponse>(all ? '/api/wiki?all=1' : '/api/wiki'),
    // The quotes. A failure here costs the page its evidence but not its
    // prose, so it degrades rather than throws.
    api<{ snippets: Snippet[] }>('/api/snippets').catch(() => ({ snippets: [] as Snippet[] })),
   ]);
   wait.done();
   paintWiki(page, sidebar, wiki, snippets.snippets);
   watchReads(page);
  } catch (e) {
   wait.failed(e, 'the page did not come through — try again');
  }
 })();
}

function paintWiki(page: HTMLElement, sidebar: HTMLElement, wiki: WikiResponse, snippets: WikiSnippet[]) {
 page.innerHTML = '';

 const byId = new Map<string, WikiSnippet>();
 for (const s of snippets) byId.set(s.id, s);

 // Lint notes, filed by what they are about. `subject` itself never renders.
 const notesByClaim = new Map<string, string[]>();
 const notesByFacet = new Map<string, string[]>();
 const looseNotes: string[] = [];
 const claimIds = new Set<string>();
 for (const group of wiki.facets) for (const cl of group.claims) claimIds.add(cl.id);
 for (const note of wiki.lint) {
  if (claimIds.has(note.subject)) {
   const list = notesByClaim.get(note.subject);
   if (list) list.push(note.note);
   else notesByClaim.set(note.subject, [note.note]);
  } else if (wiki.facets.some((g) => g.facet === note.subject)) {
   const list = notesByFacet.get(note.subject);
   if (list) list.push(note.note);
   else notesByFacet.set(note.subject, [note.note]);
  } else {
   looseNotes.push(note.note);
  }
 }

 const hasClaims = wiki.facets.some((g) => g.claims.length > 0);

 // The headings that render on this page, in page order, for the sidebar.
 const sections: { heading: string; el: HTMLElement }[] = [];

 page.append(el('p', { class: 'wiki-opening' }, hasClaims ? WIKI_OPENING : WIKI_EMPTY));

 // Eval finding #8: "has not been read" and "was read, nothing to remark"
 // are different states and must not render alike.
 page.append(el('p', { class: 'wiki-state' }, clerkStateSentence(wiki)));

 for (const group of wiki.facets) {
  if (group.claims.length === 0) continue;
  const section = el('section', { class: 'wiki-facet' });
  section.append(el('h2', { class: 'wiki-heading' }, group.heading));
  for (const note of notesByFacet.get(group.facet) ?? []) section.append(marginNote(note));

  // Already ordered by coreness within the facet. Not re-sorted here.
  for (const cl of group.claims) {
   const block = el('article', { class: 'wiki-claim' });
   block.dataset.claim = cl.id;
   block.dataset.ink = claimInk(cl);

   block.append(el('p', { class: 'claim-sentence' }, claimSentence(cl.body, cl.range)));
   for (const note of notesByClaim.get(cl.id) ?? []) block.append(marginNote(note));

   for (const cite of cl.cites) {
    // "snippetId@version". The index holds the newest version of each
    // snippet, so the quote and its date are always the same words — this
    // never dates old words with a new day. That a cite has since been
    // written again is the Clerk's remark to make, and it makes it in the
    // margin above when it has read the page.
    const snippetId = cite.split('@')[0] ?? '';
    const s = byId.get(snippetId);
    if (s) block.append(quoteBlock(s.prose, s.captured, s.provenance, s.annotation?.kind === 'annotation' ? s.annotation : undefined));
   }
   // The verb-grammar rule: correcting is an explicit mode shift. A click
   // on the claim dims the page around it and brings two margin words;
   // clicking it again, another claim, or pressing Escape leaves the mode.
   block.addEventListener('click', () => {
    if (correctingClaim === block) {
     releaseCorrectingMode();
    } else {
     focusClaim(page, block, cl.id);
    }
   });
   section.append(block);
  }
  sections.push({ heading: group.heading, el: section });
  page.append(section);
 }

 if (wiki.contradictions.length > 0) {
  const section = el('section', { class: 'wiki-facet' });
  section.append(el('h2', { class: 'wiki-heading' }, 'Two things held at once'));
  for (const x of wiki.contradictions) {
   const exhibit = el('div', { class: 'wiki-exhibit' });
   exhibit.dataset.ink = x.status === 'dissolved' ? 'aside' : 'facing';
   // The body is written as the two poles and then the verified quote,
   // separated by blank lines (src/clerk/wiki-jobs.ts#juxtaposition). Set
   // as an exhibit: facing sentences, then the person's own words.
   for (const chunk of x.body.split(/\n\s*\n/)) {
    const text = chunk.trim();
    if (!text) continue;
    if (text.startsWith('>')) {
     const quoteText = text.replace(/^>\s*/, '').trim();
     // Best-effort lineage: only when the verified quote is exactly a
     // snippet's prose does it carry that snippet's provenance. A partial
     // quote matches nothing and renders without lineage.
     let prov: { question?: string; context?: string } | undefined;
     let ann: { expression: string; referent: string } | undefined;
     for (const s of byId.values()) {
      if (s.prose === quoteText) {
       prov = s.provenance;
       ann = s.annotation?.kind === 'annotation' ? s.annotation : undefined;
       break;
      }
     }
     exhibit.append(quoteBlock(quoteText, undefined, prov, ann));
    } else exhibit.append(el('p', { class: 'exhibit-pole' }, text));
   }
   section.append(exhibit);
  }
  sections.push({ heading: 'Two things held at once', el: section });
  page.append(section);
 }

 const foot = el('div', { class: 'wiki-foot' });
 for (const note of looseNotes) foot.append(marginNote(note));

 // The one control on the page, and it is a sentence: what is on screen, and
 // the words that widen it. Set-aside claims arrive in the lightest ink, and
 // this sentence is where that ink is named.
 const lens = el('p', { class: 'wiki-lens' });
 const toggle = el('button', { class: 'nav-link' },
  wiki.all ? 'read only what stands' : 'read what has been set aside as well');
 toggle.addEventListener('click', () => renderWiki(!wiki.all));
 lens.append(
  document.createTextNode(wiki.all
   ? 'This is the whole record, what has been set aside included. Or '
   : 'This is what stands today. Or '),
  toggle,
  document.createTextNode('.'),
 );
 foot.append(lens);
 page.append(foot);

 // The sidebar is a table of contents for the page: the facet headings it
 // shows, each a link that scrolls its section into view. Only the heading
 // words themselves — no counts, no status words.
 sidebar.innerHTML = '';
for (const s of sections) {
 const link = el('a', { class: 'nav-link' }, s.heading);
 link.addEventListener('click', (ev) => {
  ev.preventDefault();
  s.el.scrollIntoView({ behavior: 'smooth' });
 });
 sidebar.append(link);
}
}

/**
 * Where the Clerk stands with this page. Three states, and the first is NOT
 * the second: a Clerk that has not read the wiki has found nothing because it
 * has not looked, and saying "no remarks" for it would report silence as a
 * clean bill (eval finding #8).
 */
function clerkStateSentence(wiki: WikiResponse): string {
 if (wiki.lintedAt === null) return 'The Clerk has not read this page yet.';
 const when = relativeTime(wiki.lintedAt);
 const read = when ? `The Clerk read this page ${when}` : 'The Clerk has read this page';
 if (wiki.lint.length === 0) return `${read} and left no remarks.`;
 return `${read}. Its remarks sit beside the sentences they are about.`;
}

// ── Piece surface ──

/**
 * Two screens, both pages of text (docs/interface-references.md's document
 * rule): `material`, choosing what a Piece is made of, and `piece`, the
 * Piece itself — the arrangement is the page. Nothing here is both draggable
 * and text-editable: a pinned Snippet version is immutable ink (Q-5) and
 * renders as a paragraph you can pick up, and the one editable thing, the
 * trailing composer, becomes a pin the moment its words are set down.
 */

/** The Piece being read, set by the material screen before navigation. */
let currentPieceId: string | null = null;
/** The entry being dragged; cleared on dragend so a cancelled drag reorders nothing. */
let dragEntryId: string | null = null;

interface PiecePinEntry {
 id: string;
 kind: 'pin';
 snippet: string;
 version: number;
 prose: string | null;
 sittingDate: string | null;
}
interface PieceGapEntry {
 id: string;
 kind: 'gap';
 question: string | null;
 pending: string | null;
 offers: Snippet[];
}
interface PieceMarginalium {
 id: string;
 on: string | null;
 note: string;
 text: string;
 at: string;
 model: string | null;
}
interface PieceArrangement {
 id: string;
 principle: string;
 created: string;
 model: string | null;
 entries: (PiecePinEntry | PieceGapEntry)[];
 marginalia: PieceMarginalium[];
}
interface PieceEnriched {
 id: string;
 created: string;
 current: string;
 setDownAt: string | null;
 setDownBy: string | null;
 arrangements: PieceArrangement[];
}
interface PieceLite {
 id: string;
 created: string;
 current: string;
 setDownAt: string | null;
 setDownBy: string | null;
 arrangement: PieceArrangement | null;
}

/**
 * The waiting affordance for this surface: the same hairline and dimmed line
 * as beginWait, with method names this section can use without tripping the
 * shame-gradient gate (the vocabulary check reads between the section marks).
 */
function pieceWait(container: HTMLElement, label: string): { end(): void; fail(cause: unknown, message?: string): void } {
 for (const stale of container.querySelectorAll(':scope > .wait, :scope > .quiet-error')) {
  stale.remove();
 }
 const block = el('div', { class: 'wait' });
 block.append(
  el('div', { class: 'wait-rule' }, el('span', { class: 'wait-sweep' })),
  el('p', { class: 'wait-label' }, label),
 );
 container.append(block);
 return {
  end() {
   block.remove();
  },
  fail(cause: unknown, message = WAIT_FAILED) {
   block.remove();
   console.error(cause);
   if (cause instanceof ApiError && cause.handled) return;
   showQuietError(container, message);
  },
 };
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
  const wait = pieceWait(column, 'stacking them\u2026');
  api<PieceEnriched>('/api/piece', { snippets: ids })
   .then((piece) => {
    wait.end();
    currentPieceId = piece.id;
    navTo('piece');
   })
   .catch((e: unknown) => wait.fail(e));
 });

 const wait = pieceWait(column, 'reading\u2026');
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
    currentPieceId = p.id;
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

/* ── the piece screen: the arrangement is the page ── */

function renderPiece() {
 clear();
 state.screen = 'piece';
 const id = currentPieceId;
 if (id === null) {
  navTo('material');
  return;
 }
 renderShell();
 // An explicit string binding: function declarations below do not inherit
 // the narrowing of `id` (only arrow closures do), so name it once, plainly.
 const pieceId: string = id;
 // The arrangement being viewed: a candidate the person switched to, or the
 // current one. Viewing never chooses (Q-38); `keep this order` does.
 let viewedArrangementId: string | null = null;
 // The trailing seam of the arrangement under the eye, for the toolbar's
 // add-question word; null until the page has painted a seam.
 let seamRef: { seam: HTMLElement; aid: string; after: string | undefined } | null = null;

 const div = el('div', { class: 'screen active piece-surface' });

 const nav = el('div', { class: 'piece-toolbar' });
 const navLeft = el('div', { class: 'piece-toolbar-left' });
 const navCenter = el('div', { class: 'piece-toolbar-center' });
 const navRight = el('div', { class: 'piece-toolbar-right' });
 const backBtn = el('button', { class: 'nav-link' }, '\u2190 library');
 backBtn.addEventListener('click', () => navTo('material'));
 // Pass 2's margin words (Q-38): `other orders?` requests the
 // acceptance-time generation and hides once the piece holds its bound of
 // three; the principle names switch the view between candidates; `keep
 // this order` takes a viewed candidate that is not current. All plain
 // words in the margin, never a row of tabs.
 const otherOrders = el('button', { class: 'nav-link' }, 'other orders?');
 const keepOrder = el('button', { class: 'nav-link' }, 'keep this order');
 const ordersSwitcher = el('span', { class: 'piece-orders' });
 // Margin words, dimmed until the page is focused: set down (or pick up,
 // when the Piece is set down), export, and the seam's add-question word.
 // Q-41's verbs, never a flag.
 const setDown = el('button', { class: 'nav-link' }, 'set down');
 const pickUp = el('button', { class: 'nav-link' }, 'pick up');
 const exportBtn = el('button', { class: 'nav-link' }, 'export');
 const addQuestion = el('button', { class: 'nav-link' }, 'add question');
 addQuestion.addEventListener('click', () => {
  if (seamRef === null) return;
  seamRef.seam.scrollIntoView({ behavior: 'smooth' });
  openGapEditor(seamRef.seam, seamRef.aid, ulid(), seamRef.after);
 });
 navLeft.append(backBtn);
 navCenter.append(otherOrders, ' \u00b7 ', ordersSwitcher, ' \u00b7 ', keepOrder);
 navRight.append(addQuestion, ' \u00b7 ', exportBtn, ' \u00b7 ', setDown, ' \u00b7 ', pickUp);
 nav.append(navLeft, navCenter, navRight);
 div.append(nav);

 const doc = el('div', { class: 'piece-doc' });
 div.append(doc);
 surface.append(div);

 setDown.addEventListener('click', () => {
  api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/set-down`)
   .then(refresh)
   .catch((e: unknown) => console.error(e));
 });
 pickUp.addEventListener('click', () => {
  api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/pick-up`)
   .then(refresh)
   .catch((e: unknown) => console.error(e));
 });
 exportBtn.addEventListener('click', () => {
  void (async () => {
   try {
    const res = await apiRaw(`/api/piece/${encodeURIComponent(pieceId)}/export`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `piece-${pieceId}.md` });
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
   } catch (e) {
    console.error(e);
   }
  })();
 });
 otherOrders.addEventListener('click', () => {
  // The acceptance-time generation is slow by design (Q-38): the waiting
  // line speaks before the request goes out.
  const wait = pieceWait(doc, 'asking for other orders\u2026');
  api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/arrangements`)
   .then((piece) => {
    wait.end();
    paint(piece);
   })
   .catch((e: unknown) => wait.fail(e));
 });
 keepOrder.addEventListener('click', () => {
  const viewedId = viewedArrangementId;
  if (viewedId === null) return;
  api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/choose`, { arrangement: viewedId })
   .then((piece) => {
    paint(piece);
   })
   .catch((e: unknown) => console.error(e));
 });

 async function refresh(): Promise<void> {
  try {
   const piece = await api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}`);
   paint(piece);
  } catch (e) {
   showQuietError(doc, 'the piece did not come through \u2014 try again');
  }
 }

 function paint(piece: PieceEnriched) {
  doc.innerHTML = '';
  // The view: the arrangement the person last asked for, else the current
  // one. A candidate is never chosen by viewing it (Q-38).
  const arrangement =
   piece.arrangements.find((a) => a.id === viewedArrangementId) ??
   piece.arrangements.find((a) => a.id === piece.current) ??
   piece.arrangements[0] ??
   null;
  if (arrangement === null) return;
  viewedArrangementId = arrangement.id;

  const isDown = piece.setDownAt !== null;
  setDown.style.display = isDown ? 'none' : '';
  pickUp.style.display = isDown ? '' : 'none';

  // The margin words, restated for this piece: `other orders?` is the
  // request for candidates and hides once the piece holds its bound of
  // three (Q-38); the principle names switch the view; `keep this order`
  // offers the choice when the viewed arrangement is not current.
  otherOrders.style.display = piece.arrangements.length >= 3 ? 'none' : '';
  ordersSwitcher.innerHTML = '';
  for (let i = 0; i < piece.arrangements.length; i++) {
   const candidate = piece.arrangements[i]!;
   if (i > 0) ordersSwitcher.append(' \u00b7 ');
   const word = el('button', { class: 'nav-link' }, candidate.principle);
   word.addEventListener('click', () => {
    viewedArrangementId = candidate.id;
    void refresh();
   });
   ordersSwitcher.append(word);
  }
  keepOrder.style.display = arrangement.id === piece.current ? 'none' : '';

  const entryIds = arrangement.entries.map((e) => e.id);

  // Viewing a candidate never chooses it (Q-38): the dimmed line says the
  // order under the eye is not the standing one, and names the word that
  // would make it so.
  if (arrangement.id !== piece.current) {
   doc.append(
    el(
     'p',
     { class: 'piece-candidate-line' },
     'viewing a candidate order \u2014 "keep this order" makes it the one that stands',
    ),
   );
  }

  for (const entry of arrangement.entries) {
   if (entry.kind === 'pin') {
    // The paragraph itself is the drag target, with a dimmed handle glyph
    // that appears on hover. A pinned version is immutable, so there is no
    // text editing to fight the drag (Q-5).
    const para = el('p', { class: 'piece-para', draggable: 'true' }, entry.prose ?? '');
    para.dataset.entry = entry.id;
    para.prepend(el('span', { class: 'piece-handle' }, '\u283f'));
    para.addEventListener('dragstart', (ev) => {
     dragEntryId = entry.id;
     if (ev.dataTransfer) {
      ev.dataTransfer.setData('text/plain', entry.id);
      ev.dataTransfer.effectAllowed = 'move';
     }
    });
    para.addEventListener('dragend', () => { dragEntryId = null; });
    para.addEventListener('dragover', (ev) => {
     ev.preventDefault();
     if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    });
    para.addEventListener('drop', (ev) => {
     ev.preventDefault();
     void reorderTo(entry.id, entryIds, arrangement.id);
    });
    doc.append(para);
   } else {
    // A gap is a thin rule across the measure carrying the question it was
    // minted with — a box would be the admin panel returning. A minted gap
    // is a marker, never an editor (Q-39): no pointer, no hover; only the
    // trailing seam opens a line. When the question is withheld (a set-down
    // Piece) the rule says so instead of pretending to ask.
    const gap = el('div', { class: 'piece-gap piece-gap-inert' });
    gap.dataset.entry = entry.id;
    const rule = el('div', { class: 'piece-gap-rule' });
    rule.append(
     el('span', { class: 'piece-gap-question' }, entry.question ?? 'waiting for its question'),
    );
    gap.append(rule);
    // An answered gap carries its offer in the margin: the harvested
    // sentence, dimmed, beside the rule. Nothing renders when the join is
    // empty, and nothing is ever placed without the person's touch (Q-39).
    if (entry.offers.length > 0) {
     for (const offer of entry.offers) {
      const o = el('button', { class: 'piece-offer' }, offer.prose);
      o.addEventListener('click', () => {
       void (async () => {
        try {
         await api(`/api/piece/${encodeURIComponent(pieceId)}/gap/accept`, {
          arrangement: arrangement.id,
          gap: entry.id,
          snippet: offer.id,
          version: offer.version,
         });
        } catch (e) {
         console.error(e);
         showQuietError(doc, WAIT_FAILED);
        }
        await refresh();
       })();
      });
      gap.append(o);
     }
    }
    // A paragraph can land past a gap; the gap is a drop target like any
    // other entry.
    gap.addEventListener('dragover', (ev) => {
     ev.preventDefault();
     if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    });
    gap.addEventListener('drop', (ev) => {
     ev.preventDefault();
     void reorderTo(entry.id, entryIds, arrangement.id);
    });
    doc.append(gap);
   }
  }

  // The trailing seam: one thin rule at the end of the column, the insert
  // point for a new gap. Touching it opens a line; Enter mints the gap with
  // a client-minted id and the entry it follows (the last one). A new gap
  // lands at the end, and the paragraph drag places it anywhere.
  const seam = el('div', { class: 'piece-gap' });
  seamRef = { seam, aid: arrangement.id, after: entryIds.length > 0 ? entryIds[entryIds.length - 1]! : undefined };
  const seamRule = el('div', { class: 'piece-gap-rule' });
  seamRule.append(el('span', { class: 'piece-gap-ask' }, 'ask me?'));
  seam.append(seamRule);
  seamRule.addEventListener('click', () => {
   openGapEditor(seam, arrangement.id, ulid(), entryIds.length > 0 ? entryIds[entryIds.length - 1]! : undefined);
  });
  seam.addEventListener('dragover', (ev) => {
   ev.preventDefault();
   if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  });
  seam.addEventListener('drop', (ev) => {
   ev.preventDefault();
   void reorderToEnd(entryIds, arrangement.id);
  });
  doc.append(seam);

  // Skeleton Marginalia sit in the margin column, dimmed until hovered:
  // the principle sentence first, then each role phrase beside its
  // paragraph, then any stale-pin flag. A stale-pin flag is a note, never
  // a control — there is nothing to click (Q-39).
  const marginalia = el('div', { class: 'piece-marginalia' });
  const notes = [...arrangement.marginalia].sort((a, b) => {
   const rank = (m: PieceMarginalium): number => {
    if (m.note === 'principle') return 0;
    if (m.note === 'role') {
     const at = entryIds.indexOf(m.on ?? '');
     return at === -1 ? 1 + entryIds.length : 2 + at;
    }
    return 2 + entryIds.length;
   };
   return rank(a) - rank(b);
  });
  for (const m of notes) {
   marginalia.append(el('p', { class: 'wiki-note' }, m.text));
  }
  doc.append(marginalia);

  // The trailing composer: one blank line at the end of the column, same
  // serif, same size, no label, no border — a textarea that grows, exactly
  // like .blank-page. It reads as the next paragraph, because that is what
  // it is about to become. It commits on an explicit act, never on leaving.
  const composer = el('textarea', { class: 'piece-composer' }) as HTMLTextAreaElement;
  doc.append(composer);
  const addPara = el('button', { class: 'nav-link piece-composer-add' }, 'add paragraph');
  addPara.hidden = true;
  doc.append(addPara);
  // A dragged paragraph must not land inside the composer: its drop would
  // paste the entry id into the draft. The composer is the one editable
  // thing on the page, and nothing here is both draggable and editable.
  composer.addEventListener('dragover', (ev) => ev.preventDefault());
  composer.addEventListener('input', () => {
   composer.style.height = 'auto';
   composer.style.height = `${composer.scrollHeight}px`;
   addPara.hidden = composer.value.trim() === '';
  });
  addPara.addEventListener('click', () => {
   const text = composer.value.trim();
   if (!text) return;
   composer.disabled = true;
   api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/prose`, { arrangement: arrangement.id, text })
    .then(refresh)
    .catch((e: unknown) => {
     composer.disabled = false;
     console.error(e);
    });
  });
 }

 // A drop reorders locally — the client computes the permutation — and then
 // the POST carries the whole new order; the server refuses anything that
 // is not a permutation, so an add or a drop can never ride a reorder.
 function reorderTo(targetId: string, ids: string[], aid: string) {
  const moving = dragEntryId;
  if (moving === null || moving === targetId) return;
  const from = ids.indexOf(moving);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return;
  const next = [...ids];
  next.splice(from, 1);
  const landing = next.indexOf(targetId);
  next.splice(landing, 0, moving);
  void (async () => {
   try {
    await api(`/api/piece/${encodeURIComponent(pieceId)}/reorder`, { arrangement: aid, entries: next });
   } catch (e) {
    console.error(e);
    showQuietError(doc, WAIT_FAILED);
   }
   await refresh();
  })();
 }

 // Touching a rule opens one line to type the question into; Enter sends it.
 // `gap` is client-minted (a fresh ULID), so a retried POST is the same gap
 // and the route mints at most one question for it (Q-39).
 // Dropping a paragraph on the trailing seam moves it to the end of the
 // document, beside the gap it would be inserted after.
 function reorderToEnd(ids: string[], aid: string) {
  const moving = dragEntryId;
  if (moving === null) return;
  const from = ids.indexOf(moving);
  if (from === -1) return;
  const next = [...ids];
  next.splice(from, 1);
  next.push(moving);
  void (async () => {
   try {
    await api(`/api/piece/${encodeURIComponent(pieceId)}/reorder`, { arrangement: aid, entries: next });
   } catch (e) {
    console.error(e);
    showQuietError(doc, WAIT_FAILED);
   }
   await refresh();
  })();
 }

 function openGapEditor(gap: HTMLElement, aid: string, gapId: string, after: string | undefined) {
  if (gap.querySelector('input') !== null) return;
  const input = el('input', { class: 'piece-gap-input', placeholder: 'ask me?' });
  gap.append(input);
  input.focus();
  let committing = false;
  input.addEventListener('keydown', (ev) => {
   if (ev.key === 'Escape') { input.remove(); return; }
   if (ev.key !== 'Enter') return;
   ev.preventDefault();
   const q = input.value.trim();
   if (!q) { input.remove(); return; }
   committing = true;
   api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}/gap`, {
    arrangement: aid,
    gap: gapId,
    question: q,
    ...(after !== undefined ? { after } : {}),
   })
    .then(refresh)
    .catch((e: unknown) => { committing = false; console.error(e); });
  });
  input.addEventListener('blur', () => { if (!committing && input.value.trim() === '') input.remove(); });
 }

 const wait = pieceWait(doc, 'reading\u2026');
 api<PieceEnriched>(`/api/piece/${encodeURIComponent(pieceId)}`)
  .then((piece) => { wait.end(); paint(piece); })
  .catch((e: unknown) => wait.fail(e));
}

// ── end Piece surface ──

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
   if (fromHash && fromHash !== 'mode' && fromHash !== 'home') navTo(fromHash);
   else renderMode(true);
   return;
  }

  // Auth file exists — check if we have a valid session
  try {
   await api<QueueData>('/api/queue');
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
