/**
 * The once-fetched protocol metadata (ticket 157): the exchange label, the
 * DRM screen, and the mode picker all render the def TITLE mapped client-side
 * from GET /api/protocols. Fetched once, cached in module state; a failed
 * fetch falls back to the registry key, which still renders. `protocolRows`
 * doubles as the picker's row source, so the picker and the labels can never
 * disagree about the set.
 *
 * Injection, not import (the seam, web/deps.ts): the fetch verb arrives via
 * initProtocolMeta at boot — the territory pattern — never a global fetch.
 */
import type { WebDepsCore } from './deps.js';
import type { ProtocolRow } from './protocol-options.js';

/** GET /api/protocols — the open set the mode row renders (tickets 153/157). */
interface ProtocolsResponse {
 protocols: ProtocolRow[];
}

export const protocolRows: ProtocolRow[] = [];
let protocolMetaPromise: Promise<void> | null = null;
let api: WebDepsCore['api'] | null = null;

/** The fetch verb the metadata cache needs, injected once at boot. */
export interface ProtocolMetaDeps {
 api: WebDepsCore['api'];
}

/**
 * Wire the fetch verb once at boot (web/deps.ts). ensureProtocolMeta throws
 * before fetching if this was never called, so a forgotten init is loud.
 */
export function initProtocolMeta(deps: ProtocolMetaDeps): void {
 api = deps.api;
}

export function ensureProtocolMeta(): Promise<void> {
 const fetchApi = api;
 if (fetchApi === null) {
  throw new Error('protocol meta not initialized — call initProtocolMeta(api) before use');
 }
 if (!protocolMetaPromise) {
  protocolMetaPromise = fetchApi<ProtocolsResponse>('/api/protocols')
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
export function protocolTitle(id: string): string {
 const row = protocolRows.find((p) => p.id === id);
 return row ? (row.title || row.name) : id;
}

/** Render a protocol-titled label that re-titles when the meta arrives
 * (ticket 157): the initial textContent is the title (or the registry key
 * while unknown), and the meta refresh re-renders it in place. The
 * exchange's drm offer rides a suffix (its arrow). */
export function protocolLabel(el: HTMLElement, id: string, suffix = ''): void {
 const text = () => protocolTitle(id) + suffix;
 el.textContent = text();
 void ensureProtocolMeta().then(() => {
  el.textContent = text();
 });
}
