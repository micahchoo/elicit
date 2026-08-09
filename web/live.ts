/**
 * Live refresh (ticket 150): the Activity Log is the change feed. The
 * server pushes one SSE event per log append (Q-23 — every actor writes
 * through that spine, so an append IS "something changed"). Screens that
 * only READ re-render when the log moves; screens holding the person's
 * unsent words or pending decisions (the room, harvest, piece, import,
 * coach) are never re-rendered underneath them.
 *
 * Injection, not import (the seam, web/deps.ts): navTo and the current
 * screen arrive via initLive at boot — the territory pattern. The one
 * EventSource and its debounce timer are module state, so a re-render or
 * a navigation never strands the feed behind a stale closure.
 */
import type { Screen } from './main.js';

/** The live-refresh deps, injected once at boot (web/deps.ts). */
export interface LiveDeps {
 navTo: (screen: Screen) => void;
 /** The screen a hash names — the feed refreshes only read-only screens. */
 screen: () => Screen;
}

let liveDeps: LiveDeps | null = null;

/** Wire the live-refresh deps once at boot. */
export function initLive(deps: LiveDeps): void {
 liveDeps = deps;
}

function wired(): LiveDeps {
 const deps = liveDeps;
 if (deps === null) {
  throw new Error('live not initialized — call initLive before startLiveRefresh');
 }
 return deps;
}

// Read-only surfaces re-render when the log moves. The today surface
// refreshes through its own in-place activity reader (redesign defect 3)
// and the room holds the person's unsent words (the answer field), so
// neither is ever a live-refresh target — the set has no room entries
// (wave 4) and never will.
const LIVE_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
 'review', 'about-you', 'your-words',
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
export function startLiveRefresh() {
 const deps = wired();
 if (liveSource) return;
 liveSource = new EventSource('/api/events');
 // A burst of material appends (a docket run's mints) collapses into one
 // refresh, trailing the burst by a second.
 liveSource.onmessage = (ev: MessageEvent<string>) => {
  if (!LIVE_SCREENS.has(deps.screen())) return;
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
   if (LIVE_SCREENS.has(deps.screen())) deps.navTo(deps.screen());
  }, 1000);
 };
 // EventSource reconnects by itself; nothing to do on error.
}
