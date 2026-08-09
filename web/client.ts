/**
 * The one HTTP layer of the web app (wave C): api(), the read-route rules
 * that compute its method (GET_PREFIXES, isReadPath), and the single
 * response-failure rule — any non-/api/login 401 lands on the login screen
 * with a handled ApiError, and a setup-required 403 says so and stops. The
 * dictation transcribe POST converges here this wave (the F5 debt closure):
 * it rides api() with a rawBody, so the auth rule has one home.
 *
 * Injection, not import (the seam, web/deps.ts): fetch, navTo and showError
 * arrive via initClient at boot — the territory pattern. api throws before
 * fetching if never wired, so a forgotten init is a loud failure.
 */
import { ApiError } from './deps.js';
import type { ApiOpts } from './deps.js';

/** The HTTP layer's deps, injected once at boot (web/deps.ts). */
export interface ClientDeps {
 /** The real fetch — the client's one HTTP verb. */
 fetch: typeof fetch;
 /** The 401 land-on-login hop. */
 navTo: (screen: string) => void;
 /** The dimmed error line under the surface — the setup-required 403 path. */
 showError: (msg: string) => void;
}

let httpDeps: ClientDeps | null = null;

/**
 * Wire the HTTP layer's deps once at boot. api throws before fetching if
 * this was never called, so a forgotten init is loud.
 */
export function initClient(deps: ClientDeps): void {
 httpDeps = deps;
}

/**
 * Read routes, by prefix. `/api/wiki` is matched exactly (with its query
 * string) rather than by prefix, because `/api/wiki/claim/:id/read` sits under
 * the same path and is the one write the wiki surface makes.
 */
export const GET_PREFIXES = ['/api/activity', '/api/stt/status', '/api/cadence', '/api/snippets', '/api/harvest-queue', '/api/pieces', '/api/anniversary', '/api/protocols', '/api/territory', '/api/sweep-backlog'];

export function isReadPath(path: string): boolean {
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

export async function api<T>(path: string, body?: unknown, opts?: ApiOpts): Promise<T> {
 const client = httpDeps;
 if (client === null) {
  throw new Error('client not initialized — call initClient before api');
 }
 const method = opts?.method ?? (isReadPath(path) ? 'GET' : 'POST');
 const init: RequestInit = { method };
 if (body !== undefined) {
  init.headers = { 'content-type': 'application/json' };
  init.body = JSON.stringify(body);
 } else if (opts?.rawBody !== undefined) {
  // A non-JSON body (the STT transcribe POST): sent as-is, no content-type
  // header — byte-identical to the raw fetch it replaces.
  init.body = opts.rawBody;
 }
 const res = await client.fetch(path, init);
 if (!res.ok) {
  // A 401 from /api/login is a wrong password, not an expired session —
  // the login screen must stay put so it can say so.
  if (res.status === 401 && !path.startsWith('/api/login')) {
   client.navTo('login');
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
    client.showError('finish setup from the host machine');
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
