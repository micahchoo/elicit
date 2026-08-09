/**
 * The shell: the persistent top nav, the inbox count, and the clear that
 * every full-screen surface leaves behind — the WebDepsShell implementation
 * (web/deps.ts), co-located with its declaration (wave C).
 *
 * Injection, not import (the seam, web/deps.ts): main, el, api, the scroll
 * surface, the current screen, the wiki's releaseWiki and the exchange's
 * session clock all arrive via initShell at boot — the territory pattern.
 * renderShell/clear throw before painting if never wired, so a forgotten
 * init is loud.
 */
import type { HarvestQueueEntry, WebDepsCore } from './deps.js';
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
 /** The wiki's page-level machinery (read-watch observer, correcting-mode
 *  key handler), released by clear() on every navigation so no listener
 *  outlives the page it was attached to. */
 releaseWiki: (document: Document) => void;
 /** The session clock's interval, stopped when the screen it hangs on leaves. */
 sessionClock: () => ReturnType<typeof setInterval> | null;
 setSessionClock: (timer: ReturnType<typeof setInterval> | null) => void;
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
export function renderShell(): void {
 const deps = wired();
 let nav = deps.main.querySelector<HTMLElement>('.topnav');
 if (!nav) {
  nav = deps.el('nav', { class: 'topnav' });
  nav.append(deps.el('a', { class: 'wordmark', href: '#/home' }, 'elicit'));
  const links: [Screen, string][] = [
   ['home', 'home'],
   ['wiki', 'wiki'],
   ['library', 'library'],
   ['waiting', 'open questions'],
   ['import', 'import'],
   ['inbox', 'inbox'],
  ];
  for (const [screen, word] of links) {
   const link = deps.el('a', { class: 'nav-link', href: `#/${screen}` }, word);
   link.dataset.screen = screen;
   nav.append(link);
  }
  deps.main.prepend(nav);
 }
 const here = navWordOf(deps.screen());
 for (const link of nav.querySelectorAll<HTMLAnchorElement>('a')) {
  link.classList.toggle('here', here !== '' && link.dataset.screen === here);
 }
 refreshInboxBadge();
}

/** The inbox count: a small number when harvests wait, nothing when none. */
function refreshInboxBadge(): void {
 const deps = wired();
 (async () => {
  try {
   const data = await deps.api<{ pending: HarvestQueueEntry[] }>('/api/harvest-queue');
   const inbox = deps.main.querySelector<HTMLAnchorElement>('.topnav a[data-screen="inbox"]');
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
   inbox.append(deps.el('span', { class: 'topnav-count' }, String(data.pending.length)));
  } catch {
   // The badge is a nicety; a failed read just means no count.
  }
 })();
}

export function clear() {
 const deps = wired();
 // The wiki's page-level machinery (read-watch observer, correcting-mode
 // key handler) is released here, on every navigation, so no listener
 // outlives the page it was attached to.
 deps.releaseWiki(deps.document);
 deps.surface.innerHTML = '';
 // The session clock hangs in the shell; it leaves with the exchange screen.
 deps.main.querySelector<HTMLElement>('.session-clock')?.remove();
 const clockTimer = deps.sessionClock();
 if (clockTimer !== null) {
  clearInterval(clockTimer);
  deps.setSessionClock(null);
 }
}
