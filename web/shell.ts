/**
 * The shell: the persistent top nav, the room indicator, and the clear that
 * every full-screen surface leaves behind — the WebDepsShell implementation
 * (web/deps.ts), co-located with its declaration (wave C).
 *
 * Injection, not import (the seam, web/deps.ts): main, el, api, the scroll
 * surface, the current screen, the wiki's releaseWiki and the exchange's
 * session clock all arrive via initShell at boot — the territory pattern.
 * renderShell/clear throw before painting if never wired, so a forgotten
 * init is loud.
 */
import type { WebDepsCore } from './deps.js';
import type { Screen } from './main.js';

/** The shell's deps, injected once at boot (web/deps.ts). */
export interface ShellDeps {
 main: HTMLElement;
 el: WebDepsCore['el'];
 api: WebDepsCore['api'];
 /** The scroll surface under the shell; `clear()` empties only this. */
 surface: HTMLElement;
 /** The real document — releaseWiki needs it. */
 document: Document;
/** The screen a hash names — the shell lights its word. */
screen: () => Screen;
/** Whether a sitting has ever been recorded (canon §5.1): false hides the
*  today word — the nav list is built without it. */
hasSittings: () => boolean;
/** Whether a sitting is genuinely open — the room's SESSION state, not its
 *  screen: the blank page (sessionless just-write) must not light the
 *  room indicator. Wired from main.ts's session id. */
sittingOpen: () => boolean;
/** The wiki's page-level machinery (read-watch observer, correcting-mode
*  key handler), released by clear() on every navigation so no listener
*  outlives the page it was attached to. */
releaseWiki: (document: Document) => void;
}

let shellDeps: ShellDeps | null = null;

/** Wire the shell's deps once at boot. */
export function initShell(deps: ShellDeps): void {
 shellDeps = deps;
}

function wired(): ShellDeps {
 const deps = shellDeps;
 if (deps === null) {
  throw new Error('shell not initialized — call initShell before renderShell');
 }
 return deps;
}

/** The nav word a screen lights in the shell; '' lights none. */
function navWordOf(screen: Screen): string {
 switch (screen) {
  case 'today': return 'today';
  case 'review': return 'review';
  case 'about-you': return 'about you';
  case 'your-words': return 'your words';
  default: return '';
 }
}

/** The flag value the standing .topnav was built with. The nav word list
 *  is built once and kept by `clear()`; the ONE membership that changes
 *  is the today word's (canon §5.1) — when the flag flips, the stale nav
 *  is replaced exactly once, then built-once again. */
let navBuiltWithSittings: boolean | null = null;

/** Build the nav from scratch: the words (today only once a sitting has
 *  been recorded) plus the room indicator. */
function buildNav(deps: ShellDeps, hasToday: boolean): HTMLElement {
 const nav = deps.el('nav', { class: 'topnav' });
 // canon §5.1: "Today does not exist until the first sitting has earned
 // it" — the today word joins the list only when the flag is true.
 const links: [Screen, string][] = [
  ...(hasToday ? [['today', 'today'] as [Screen, string]] : []),
  ['review', 'review'],
  ['about-you', 'about you'],
  ['your-words', 'your words'],
 ];
 for (const [screen, word] of links) {
  const link = deps.el('a', { class: 'nav-link', href: `#/${screen}` }, word);
  link.dataset.screen = screen;
  nav.append(link);
 }
 // The room: while a sitting is open, one quiet way back into it.
 const room = deps.el('a', { class: 'room-indicator', href: '#/room' }, 'a sitting is open');
 room.dataset.screen = 'room';
 room.hidden = true;
 nav.append(room);
 return nav;
}

/**
 * The persistent top nav, built once and kept by `clear()`. Every authed
 * screen calls it; each call re-lights the active word and shows the room
 * indicator while a sitting is open. Login and setup render without it.
 */
export function renderShell(): void {
 const deps = wired();
 let nav = deps.main.querySelector<HTMLElement>('.topnav');
 const hasToday = deps.hasSittings();
 if (!nav || navBuiltWithSittings !== hasToday) {
  // Rebuild on a flag flip: the list's membership depends on the flag,
  // so the once-built nav is replaced exactly once when the first
  // sitting ends, and afterwards it is once-built again.
  if (nav) nav.remove();
  nav = buildNav(deps, hasToday);
  navBuiltWithSittings = hasToday;
  deps.main.prepend(nav);
 }
 const screen = deps.screen();
 const here = navWordOf(screen);
 for (const link of nav.querySelectorAll<HTMLAnchorElement>('a.nav-link')) {
  link.classList.toggle('here', here !== '' && link.textContent === here);
 }
 const room = nav.querySelector<HTMLAnchorElement>('.room-indicator');
 if (room) {
  const open = deps.sittingOpen();
  room.hidden = !open;
  room.classList.toggle('here', open);
 }
}

export function clear() {
 const deps = wired();
 // The wiki's page-level machinery (read-watch observer, correcting-mode
 // key handler) is released here, on every navigation, so no listener
 // outlives the page it was attached to.
 deps.releaseWiki(deps.document);
 deps.surface.innerHTML = '';
}
