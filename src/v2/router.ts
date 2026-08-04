/**
 * The four operations — `open`, `say`, `act`, `view` — mounted at /v2.
 * Ticket 129; contract at `docs/loop-core-api-spec.md`.
 *
 * ## This is an adapter, not a second server
 *
 * Every operation translates to a dispatch against the EXISTING /api routes
 * on the same app. No route logic is reimplemented here, so a rule the old
 * surface enforces is enforced once — and a rule /v2 adds (offsets instead of
 * substrings, a commit that refuses undecided proposals) is added in exactly
 * one place. The dispatch also carries the caller's credentials through the
 * /api auth lock, so /v2 needs no gate of its own: it inherits one.
 *
 * ## `view` is side-effect-free
 *
 * The ruled break from the old routes. Six read-shaped routes write; the
 * dispatches this file makes for a projection carry `x-elicit-pure: 1`, which
 * those handlers read to skip the write. The header is INTERNAL — nothing
 * outside this file sets it, and the SPA's behaviour is unchanged.
 *
 * ## What never crosses
 *
 * `say` carries words that may become evidence; `act` carries data that never
 * can. No string arriving in a `Verb` reaches a Snippet, a Piece or a claim
 * citation — the only strings an act forwards are ids, folder paths, choice
 * words and a declared region's rules, none of which the harvester reads.
 */

import { Hono, type Context } from 'hono';
import type { CaptureChannel, HarvestDecision, QuestionForm } from '../types.js';
import type { ImportDecision } from '../import/contract.js';
import type {
 ActRequest,
 ErrorCode,
 OpenRequest,
 Phase,
 Re,
 ReKind,
 SayIntent,
 SayRequest,
 Scope,
 TurnBody,
 TurnEnvelope,
 V2Deps,
 Verb,
 VerbName,
} from './types.js';

/**
 * The event counter every envelope carries.
 *
 * The spec calls for a monotonic PER-VAULT counter. This is per-PROCESS, and
 * that is the contract for now: the vault has no committed-write counter to
 * read, and inventing a second one on disk would be a second answer to "what
 * happened" (Q-23). One process serves one vault, so the two agree for the
 * life of a server — a restart resets to 0, which a client sees as a rev that
 * moved backwards and must re-read. The record plane (ticket 122) is where
 * the durable counter belongs.
 */
let rev = 0;

/** HTTP status mirrors the code. `refused` has no status of its own — 422 is the nearest honest mirror: the request was well-formed and the constitution said no. */
const STATUS: Record<ErrorCode, 400 | 401 | 404 | 409 | 410 | 422 | 503> = {
 'bad-request': 400,
 unauthorized: 401,
 'not-found': 404,
 gone: 410,
 conflict: 409,
 refused: 422,
 unavailable: 503,
};

const RE_KINDS: readonly ReKind[] = [
 'sitting', 'unprompted', 'parked', 'drm', 'harvest', 'import', 'import-piece',
 'piece', 'wiki', 'claim', 'coach', 'quest', 'queue', 'waiting',
];

const SAY_INTENTS: readonly SayIntent[] = [
 'answer', 'pulse', 'unprompted', 'restate', 'correct', 'return', 'artifact',
 'exclude', 'prose',
];

const SCOPES: readonly Scope[] = [
 'queue', 'wiki', 'wiki-all', 'snippets', 'pieces', 'piece', 'piece-export',
 'harvest-queue', 'harvest', 'import-next', 'import-survey', 'reach',
 'coach-waiting', 'coach', 'cadence', 'anniversary', 'activity', 'auth-status',
 'stt-status',
];

const CHANNELS: readonly CaptureChannel[] = ['typed', 'spoken', 'pasted'];

/** The verbs each context answers. `open` reports the list; `act` rejects anything off it. */
const VERBS_BY_KIND: Record<ReKind, readonly VerbName[]> = {
 sitting: ['skip', 'defer', 'end', 'leave', 'sounding', 'gate'],
 unprompted: [],
 parked: [],
 drm: ['drm-start', 'drm-episode', 'drm-enumerate-done', 'drm-gate'],
 harvest: ['approve', 'trim', 'discard', 'commit'],
 import: ['scan', 'survey', 'declare-region', 'decline-reach'],
 'import-piece': ['import-approve', 'import-trim', 'import-discard', 'import-commit'],
 piece: ['reorder', 'choose', 'arrangements', 'gap', 'gap-accept', 'remove', 'set-down', 'pick-up', 'compose'],
 wiki: [],
 claim: ['read', 'attest', 'challenge'],
 coach: ['coach', 'uncoach', 'decline-offer', 'adopt', 'decline-option', 'coach-read'],
 quest: ['retire'],
 queue: [],
 waiting: ['decline-reach'],
};

/** The say intents each context accepts, in the order the spec lists them. */
const INTENTS_BY_KIND: Record<ReKind, readonly SayIntent[]> = {
 sitting: ['answer', 'pulse'],
 unprompted: ['unprompted'],
 parked: [],
 drm: ['answer'],
 harvest: ['restate'],
 import: [],
 'import-piece': ['exclude'],
 piece: ['prose'],
 wiki: [],
 claim: ['correct'],
 coach: ['artifact'],
 quest: ['return'],
 queue: [],
 waiting: [],
};

/** The intent a context implies when the caller names none. */
const DEFAULT_INTENT: Partial<Record<ReKind, SayIntent>> = {
 sitting: 'answer',
 drm: 'answer',
 unprompted: 'unprompted',
 harvest: 'restate',
 claim: 'correct',
 quest: 'return',
 coach: 'artifact',
 'import-piece': 'exclude',
 piece: 'prose',
};

const TURN_KINDS: readonly string[] = [
 'probe', 'saturated', 'checkpoint', 'descent-closed', 'drm-probe', 'drm-gate', 'drm-closed',
];

/**
 * The verbs whose 4xx is a canon guard rather than a malformed request:
 * a region rule that cannot date anything, a gap-accept without provenance,
 * an import commit against a body that changed on disk.
 */
const GUARD_VERBS: readonly VerbName[] = ['declare-region', 'gap-accept', 'import-commit', 'commit'];

/** A refusal on its way to the wire. Thrown inside a handler, caught at the route. */
class Fault extends Error {
 readonly code: ErrorCode;
 constructor(code: ErrorCode, message: string) {
  super(message);
  this.code = code;
 }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const obj = (v: unknown): Record<string, unknown> | undefined =>
 v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** The `error` string old routes answer with, when there is one. */
function messageOf(parsed: unknown): string | undefined {
 const o = obj(parsed);
 return o === undefined ? undefined : str(o.error);
}

/**
 * The old surface's status, in the new vocabulary. `guard` marks the call
 * sites whose 4xx means "the constitution said no" — everywhere else a 4xx
 * means the request itself was wrong, and a persona must be able to tell
 * those apart.
 */
function faultFor(status: number, parsed: unknown, guard: boolean): Fault {
 const message = messageOf(parsed) ?? `the route answered ${status}`;
 if (status === 401 || status === 403) return new Fault('unauthorized', message);
 // A dead pointer is not a missing one: the ladder file is gone, the id was real.
 if (status === 404) return new Fault(/no longer on disk/.test(message) ? 'gone' : 'not-found', message);
 if (status === 409) return new Fault(guard ? 'refused' : 'conflict', message);
 if (status === 400) return new Fault(guard ? 'refused' : 'bad-request', message);
 return new Fault('unavailable', message);
}

/**
 * One old response, translated. Anything the spec names a turn becomes one;
 * everything else becomes a projection or a display sentence, so nothing the
 * old surface says is dropped on the floor.
 */
function translate(raw: Record<string, unknown>): { turn?: TurnBody; view?: unknown; notices?: string[] } {
 const kind = str(raw.kind) ?? '';
 if (kind === 'exhausted') {
  return { notices: ['there is nothing else to ask in this sitting'] };
 }
 if (kind === 'declined') {
  return { notices: ['the offer is closed — it is not asked again this sitting'] };
 }
 if (kind === 'drm-enumerate') {
  return {
   view: { yesterday: raw.yesterday, phase: raw.phase },
   notices: ['name the episodes of that day, one at a time'],
  };
 }
 if (kind === 'drm-episode-added') {
  return { view: { episodes: raw.count } };
 }
 if (raw.status === 'harvesting') {
  return {
   view: { sessionId: raw.sessionId },
   notices: ['the harvest is running behind this answer — its cards land in the review queue'],
  };
 }
 // `skip` answers `question` where every other route answers `probe`; the
 // difference is the old surface's, not the person's.
 const name = kind === 'question' ? 'probe' : kind;
 if (!TURN_KINDS.includes(name)) return { view: raw };

 const juxtaposition = obj(raw.juxtaposition);
 const sounding = obj(raw.sounding);
 const soundingOffer = obj(raw.soundingOffer);
 const episode = num(raw.episode);
 const of = num(raw.of);
 const questionForm = str(raw.questionForm) as QuestionForm | undefined;
 const phase = str(raw.phase) as Phase | undefined;
 const turn: TurnBody = {
  kind: name as TurnBody['kind'],
  ...(str(raw.text) !== undefined ? { text: str(raw.text)! } : {}),
  ...(questionForm !== undefined ? { questionForm } : {}),
  ...(phase !== undefined ? { phase } : {}),
  ...(juxtaposition !== undefined
   ? { juxtaposition: { snippetText: str(juxtaposition.snippetText) ?? '', snippetDate: str(juxtaposition.snippetDate) ?? '' } }
   : {}),
  ...(sounding !== undefined
   ? { sounding: { rung: num(sounding.rung) ?? 0, of: num(sounding.of) ?? 0, checkpoint: sounding.checkpoint === true } }
   : {}),
  ...(soundingOffer !== undefined
   ? {
    soundingOffer: {
     construct: str(soundingOffer.construct) ?? '',
     allowance: num(soundingOffer.allowance) ?? 0,
     sentence: str(soundingOffer.sentence) ?? '',
    },
   }
   : {}),
  // The turn route calls the close `descentClosed`; the gate route calls it
  // `endedBy`. One name reaches the wire.
  ...(str(raw.endedBy) !== undefined
   ? { endedBy: str(raw.endedBy)! }
   : str(raw.descentClosed) !== undefined
    ? { endedBy: str(raw.descentClosed)! }
    : {}),
  ...(str(raw.soundingId) !== undefined ? { soundingId: str(raw.soundingId)! } : {}),
  ...(episode !== undefined && of !== undefined
   ? {
    drm: {
     episode,
     of,
     ...(str(raw.step) !== undefined ? { step: str(raw.step)! } : {}),
     ...(raw.gate !== undefined ? { gate: raw.gate } : {}),
    },
   }
   : {}),
 };
 return { turn };
}

/**
 * The /v2 sub-app. `createApp` mounts it at /v2 after every /api route is
 * registered — the dispatch closure it is handed can only reach routes that
 * already exist.
 */
export function createV2App(deps: V2Deps): Hono {
 const app = new Hono();

 /**
  * Harvest decisions accumulated per sitting until `commit`. The old route
  * takes the whole array at once and refuses nothing partial, so the
  * per-proposal verbs the spec defines have to gather somewhere; here, keyed
  * by session, is the smallest place that keeps the old route untouched.
  * Lost on restart, exactly like the SPA's draft decisions — the pending
  * harvest record on disk is what survives, and a review starts again from it.
  */
 const harvestDecisions = new Map<string, HarvestDecision[]>();
 /** The same accumulation for an import piece's cuts, keyed by body hash. */
 const importDecisions = new Map<string, ImportDecision[]>();
 /**
  * The pulse prompt each sitting was opened with. `say {intent:'pulse'}`
  * needs the prompt beside the answer — the old route writes both as turns —
  * and a persona should not have to carry the server's own wording back.
  */
 const pulsePrompts = new Map<string, string>();

 /** The caller's credentials, forwarded to the internal dispatch. */
 function credentials(c: Context): Record<string, string> {
  const headers: Record<string, string> = {};
  const cookie = c.req.header('cookie');
  const authorization = c.req.header('authorization');
  if (cookie !== undefined) headers.cookie = cookie;
  if (authorization !== undefined) headers.authorization = authorization;
  // The spec's Bearer token IS the session token the instance plane holds.
  // The old gate reads only the cookie, so the adapter re-dresses the bearer
  // as one rather than teaching auth.ts a second credential.
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
  if (bearer !== null && !/elicit_session=/.test(cookie ?? '')) {
   headers.cookie = [cookie, `elicit_session=${bearer[1]!}`].filter((p) => p !== undefined && p !== '').join('; ');
  }
  return headers;
 }

 async function hit(
  c: Context,
  method: string,
  path: string,
  opts?: { body?: unknown; pure?: boolean; accept?: string },
 ): Promise<Response> {
  const headers = credentials(c);
  const init: RequestInit = { method };
  if (opts?.body !== undefined) {
   headers['content-type'] = 'application/json';
   init.body = JSON.stringify(opts.body);
  }
  if (opts?.pure === true) headers['x-elicit-pure'] = '1';
  if (opts?.accept !== undefined) headers.accept = opts.accept;
  init.headers = headers;
  return deps.dispatch(path, init, c.env);
 }

 /** A dispatched response as JSON, or the mapped refusal. */
 async function bodyOf(res: Response, guard = false): Promise<Record<string, unknown>> {
  const text = await res.text();
  let parsed: unknown = null;
  try {
   parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
   parsed = null;
  }
  if (!res.ok) throw faultFor(res.status, parsed, guard);
  return obj(parsed) ?? { value: parsed };
 }

 /** One dispatch, read as an envelope's turn/view/notices. */
 async function step(
  c: Context,
  method: string,
  path: string,
  opts?: { body?: unknown; guard?: boolean },
 ): Promise<{ turn?: TurnBody; view?: unknown; notices?: string[] }> {
  const res = await hit(c, method, path, opts?.body !== undefined ? { body: opts.body } : {});
  return translate(await bodyOf(res, opts?.guard === true));
 }

 function envelope(re: Re, parts: { turn?: TurnBody; view?: unknown; notices?: string[] }): TurnEnvelope {
  return {
   re,
   rev,
   ...(parts.turn !== undefined ? { turn: parts.turn } : {}),
   ...(parts.view !== undefined ? { view: parts.view } : {}),
   ...(parts.notices !== undefined && parts.notices.length > 0 ? { notices: parts.notices } : {}),
  };
 }

 function parseRe(raw: unknown): Re {
  const o = obj(raw);
  if (o === undefined) throw new Fault('bad-request', 're is required');
  const kind = str(o.kind);
  if (kind === undefined || !(RE_KINDS as readonly string[]).includes(kind)) {
   throw new Fault('bad-request', `unknown re kind "${String(o.kind)}"`);
  }
  return o as Re;
 }

 function need(value: string | undefined, what: string): string {
  if (value === undefined || value.trim() === '') throw new Fault('bad-request', `${what} is required`);
  return value;
 }

 /** Refuse a stale write. `rev` is optional everywhere — single-user local. */
 function checkRev(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
   throw new Fault('bad-request', 'rev must be an integer');
  }
  if (raw !== rev) throw new Fault('conflict', `rev ${raw} is stale — this vault is at ${rev}`);
 }

 function channelOf(raw: unknown): CaptureChannel | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !(CHANNELS as readonly string[]).includes(raw)) {
   throw new Fault('bad-request', `unknown channel "${String(raw)}"`);
  }
  return raw as CaptureChannel;
 }

 /**
  * A [start, end) span of `source`, as the old routes' exact substring.
  * Offsets that fall outside the text are a canon refusal, not a malformed
  * request: exact-substring is the structural half of Sole Authorship (Q-1),
  * and a span that runs off the end is a persona trying to keep words the
  * proposal does not contain.
  */
 function spanText(source: string, raw: unknown, what: string): string {
  if (!Array.isArray(raw) || raw.length !== 2) {
   throw new Fault('bad-request', 'span must be a [start, end] pair of offsets');
  }
  const start = raw[0];
  const end = raw[1];
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) {
   throw new Fault('bad-request', 'span offsets must be integers');
  }
  if (start < 0 || end > source.length || start >= end) {
   throw new Fault('refused', `the span [${start}, ${end}] falls outside ${what}`);
  }
  return source.slice(start, end);
 }

 /** The proposals waiting on a sitting's review, read without touching them. */
 async function proposalsOf(c: Context, sessionId: string): Promise<{ text: string }[]> {
  const res = await hit(c, 'GET', `/api/harvest-queue/${encodeURIComponent(sessionId)}`, { pure: true });
  const record = await bodyOf(res);
  const proposals = record.proposals;
  if (!Array.isArray(proposals)) {
   throw new Fault('not-found', 'no proposals are waiting on this sitting');
  }
  return proposals as { text: string }[];
 }

 /**
  * The import piece on the table, by hash. The old surface hands out the
  * NEXT extracted piece and has no read-by-hash door, so a hash that is not
  * the head of the queue is `gone` rather than a lie about what is being
  * reviewed.
  */
 async function importItem(c: Context, hash: string): Promise<{ cuts: { text: string }[] }> {
  const res = await hit(c, 'GET', '/api/import/next', { pure: true });
  const out = await bodyOf(res);
  const item = obj(out.item);
  if (item === undefined) {
   throw new Fault('not-found', str(out.waiting) ?? 'no pieces are ready to read yet');
  }
  if (str(item.hash) !== hash) {
   throw new Fault('gone', 'that piece is no longer the one on the table');
  }
  const cuts = Array.isArray(item.cuts) ? (item.cuts as { text: string }[]) : [];
  return { cuts };
 }

 function record<T extends { proposal: number } | { cut: number }>(
  store: Map<string, T[]>,
  key: string,
  decision: T,
  at: number,
 ): T[] {
  const kept = (store.get(key) ?? []).filter((d) => ('proposal' in d ? d.proposal : d.cut) !== at);
  kept.push(decision);
  store.set(key, kept);
  return kept;
 }

 // ── POST /v2/open ──

 app.post('/open', async (c) => {
  const request = await c.req.json<OpenRequest>().catch(() => ({}) as OpenRequest);
  const re = parseRe(request.re);
  const verbs = VERBS_BY_KIND[re.kind];
  const withVerbs = (view: unknown): unknown => ({ verbs, ...(obj(view) ?? { value: view }) });

  switch (re.kind) {
   case 'sitting': {
    if (re.id !== undefined) {
     // An open sitting has no read route — it lives in server memory. The
     // envelope says what may be done to it and nothing it cannot know.
     return c.json(envelope(re, { view: { verbs }, notices: ['the sitting is open — answer with say'] }));
    }
    const mode = request.mode;
    if (mode === undefined) throw new Fault('bad-request', 'mode is required to open a sitting');
    const opened = await bodyOf(await hit(c, 'POST', '/api/session', { body: { mode } }));
    const id = need(str(opened.sessionId), 'the minted sitting id');
    const pulsePrompt = str(opened.pulsePrompt);
    if (pulsePrompt !== undefined) pulsePrompts.set(id, pulsePrompt);
    const turn: TurnBody = {
     kind: 'probe',
     ...(str(opened.question) !== undefined ? { text: str(opened.question)! } : {}),
     ...(pulsePrompt !== undefined ? { pulsePrompt } : {}),
     ...(str(opened.target) !== undefined ? { target: str(opened.target)! } : {}),
     ...(str(opened.source) !== undefined ? { source: str(opened.source)! } : {}),
     ...(str(opened.context) !== undefined ? { context: str(opened.context)! } : {}),
    };
    return c.json(envelope({ kind: 'sitting', id }, { turn }));
   }
   case 'parked': {
    // The old resume routes both need a sitting to resume INTO, and the spec
    // addresses a parked descent by its queue entry alone. So opening one
    // opens the sitting first: the envelope echoes the sitting, because that
    // is what every following say and act addresses.
    const mode = request.mode;
    if (mode === undefined) throw new Fault('bad-request', 'mode is required — a parked descent resumes inside a sitting');
    const opened = await bodyOf(await hit(c, 'POST', '/api/session', { body: { mode } }));
    const id = need(str(opened.sessionId), 'the minted sitting id');
    const body = { queueEntryId: re.queueEntryId };
    const sounding = await hit(c, 'POST', `/api/session/${encodeURIComponent(id)}/sounding/resume`, { body });
    if (sounding.ok) {
     return c.json(envelope({ kind: 'sitting', id }, translate(await bodyOf(sounding))));
    }
    const soundingFault = faultFor(sounding.status, await sounding.json().catch(() => null), false);
    if (soundingFault.code !== 'not-found') throw soundingFault;
    // Not a parked sounding — the same pointer shape carries a parked DRM,
    // which closes the SPA's parked-drm gap (the spec's census finding).
    const drm = await hit(c, 'POST', `/api/session/${encodeURIComponent(id)}/drm/resume`, { body });
    if (!drm.ok) throw faultFor(drm.status, await drm.json().catch(() => null), false);
    return c.json(envelope({ kind: 'sitting', id }, translate(await bodyOf(drm))));
   }
   case 'drm': {
    const path = `/api/session/${encodeURIComponent(re.sittingId)}/drm/start`;
    return c.json(envelope(re, await step(c, 'POST', path)));
   }
   case 'harvest': {
    const res = await hit(c, 'GET', `/api/harvest-queue/${encodeURIComponent(re.sessionId)}`, { pure: true });
    return c.json(envelope(re, { view: withVerbs(await bodyOf(res)) }));
   }
   case 'import': {
    const res = await hit(c, 'GET', '/api/import/next', { pure: true });
    return c.json(envelope(re, { view: withVerbs(await bodyOf(res)) }));
   }
   case 'import-piece': {
    const item = await importItem(c, re.hash);
    return c.json(envelope(re, { view: { verbs, ...item } }));
   }
   case 'piece': {
    if (re.id === undefined) {
     return c.json(envelope(re, { view: { verbs }, notices: ['compose mints a piece from chosen snippets'] }));
    }
    const res = await hit(c, 'GET', `/api/piece/${encodeURIComponent(re.id)}`, { pure: true });
    return c.json(envelope(re, { view: withVerbs(await bodyOf(res)) }));
   }
   case 'wiki': {
    const res = await hit(c, 'GET', '/api/wiki', { pure: true });
    return c.json(envelope(re, { view: withVerbs(await bodyOf(res)) }));
   }
   case 'claim': {
    // No read-one-claim route exists; the page is the surface, so the claim
    // is found in it. `?all=1` so an archived or superseded claim still opens.
    const page = await bodyOf(await hit(c, 'GET', '/api/wiki?all=1', { pure: true }));
    const facets = Array.isArray(page.facets) ? (page.facets as Record<string, unknown>[]) : [];
    for (const facet of facets) {
     const claims = Array.isArray(facet.claims) ? (facet.claims as Record<string, unknown>[]) : [];
     const found = claims.find((cl) => str(cl.id) === re.id);
     if (found !== undefined) return c.json(envelope(re, { view: { verbs, claim: found } }));
    }
    throw new Fault('not-found', 'unknown claim');
   }
   case 'coach': {
    if (re.slug === undefined) {
     return c.json(envelope(re, { view: { verbs }, notices: ['naming a direction is the only door into a coached lens'] }));
    }
    const res = await hit(c, 'GET', `/api/coach/${encodeURIComponent(re.slug)}`, { pure: true });
    return c.json(envelope(re, { view: withVerbs(await bodyOf(res)) }));
   }
   case 'queue': {
    const res = await hit(c, 'GET', '/api/queue', { pure: true });
    return c.json(envelope(re, { view: withVerbs(await bodyOf(res)) }));
   }
   case 'waiting': {
    // The waiting surface is four reads the SPA renders as one page. Every
    // one of them is dispatched pure — opening this page evaluates nothing.
    const [coach, reach, cadence, anniversary] = await Promise.all([
     bodyOf(await hit(c, 'GET', '/api/coach/waiting', { pure: true })),
     bodyOf(await hit(c, 'GET', '/api/reach', { pure: true })),
     bodyOf(await hit(c, 'GET', '/api/cadence', { pure: true })),
     bodyOf(await hit(c, 'GET', '/api/anniversary', { pure: true })),
    ]);
    return c.json(envelope(re, { view: { verbs, coach, reach, cadence, anniversary } }));
   }
   case 'quest':
   case 'unprompted':
   default:
    return c.json(envelope(re, { view: { verbs } }));
  }
 });

 // ── POST /v2/say — the sole prose channel ──

 app.post('/say', async (c) => {
  const request = await c.req.json<SayRequest>().catch(() => ({}) as SayRequest);
  const re = parseRe(request.re);
  checkRev(request.rev);
  const text = str(request.text);
  if (text === undefined) throw new Fault('bad-request', 'text is required');
  const channel = channelOf(request.channel);
  const meta = obj(request.meta) ?? {};

  const named = request.intent;
  if (named !== undefined && (typeof named !== 'string' || !(SAY_INTENTS as readonly string[]).includes(named))) {
   throw new Fault('bad-request', `unknown intent "${String(named)}"`);
  }
  const intent = (named as SayIntent | undefined) ?? DEFAULT_INTENT[re.kind];
  if (intent === undefined || !INTENTS_BY_KIND[re.kind].includes(intent)) {
   throw new Fault('bad-request', `${re.kind} does not take a say with intent "${String(intent ?? 'none')}"`);
  }

  const answer = (parts: { turn?: TurnBody; view?: unknown; notices?: string[] }): Response => {
   rev++;
   return c.json(envelope(re, parts));
  };

  switch (intent) {
   case 'answer': {
    if (re.kind === 'drm') {
     const path = `/api/session/${encodeURIComponent(re.sittingId)}/drm/probe`;
     return answer(await step(c, 'POST', path, { body: { text } }));
    }
    const id = need(re.kind === 'sitting' ? re.id : undefined, 'the sitting id');
    const body = {
     text,
     ...(channel !== undefined ? { channel } : {}),
     ...(channel === 'spoken' ? { spoken: true } : {}),
    };
    return answer(await step(c, 'POST', `/api/session/${encodeURIComponent(id)}/turn`, { body }));
   }
   case 'pulse': {
    const id = need(re.kind === 'sitting' ? re.id : undefined, 'the sitting id');
    // An empty pulse is a skip, and a skip writes nothing — not even the
    // fact of it. Nothing is dispatched and the counter does not move.
    if (text.trim() === '') {
     return c.json(envelope(re, { notices: ['the pulse was skipped — nothing was written'] }));
    }
    const prompt = pulsePrompts.get(id) ?? str(meta.prompt) ?? '';
    const path = `/api/session/${encodeURIComponent(id)}/pulse`;
    return answer(await step(c, 'POST', path, { body: { text, prompt } }));
   }
   case 'unprompted': {
    const body = { text, ...(channel !== undefined ? { channel } : {}) };
    return answer(await step(c, 'POST', '/api/unprompted', { body }));
   }
   case 'restate': {
    const sessionId = re.kind === 'harvest' ? re.sessionId : '';
    const proposals = await proposalsOf(c, sessionId);
    const at = num(meta.proposal);
    if (at === undefined || !Number.isInteger(at) || at < 0 || at >= proposals.length) {
     throw new Fault('bad-request', `meta.proposal must be an index into the ${proposals.length} proposals`);
    }
    const kept = record<HarvestDecision>(harvestDecisions, sessionId, {
     proposal: at,
     action: 'restate',
     text,
     ...(channel !== undefined ? { channel } : {}),
    }, at);
    return answer({ view: { decided: kept.length, of: proposals.length } });
   }
   case 'correct': {
    const id = re.kind === 'claim' ? re.id : '';
    const path = `/api/wiki/claim/${encodeURIComponent(id)}/edit`;
    return answer(await step(c, 'POST', path, { body: { body: text } }));
   }
   case 'return': {
    const id = re.kind === 'quest' ? re.id : '';
    const body = { text, ...(channel !== undefined ? { channel } : {}) };
    return answer(await step(c, 'POST', `/api/coach/quest/${encodeURIComponent(id)}/return`, { body }));
   }
   case 'artifact': {
    const slug = need(re.kind === 'coach' ? re.slug : undefined, 'the direction slug');
    // The pointer is lineage-plane and never opened; the NAME and the
    // sentence are what the person wrote. Both ride meta, because only the
    // sentence is harvestable (Q-78).
    const pointer = need(str(meta.pointer), 'meta.pointer');
    const name = need(str(meta.name), 'meta.name');
    const path = `/api/coach/${encodeURIComponent(slug)}/artifact`;
    return answer(await step(c, 'POST', path, { body: { pointer, name, sentence: text } }));
   }
   case 'exclude': {
    const hash = re.kind === 'import-piece' ? re.hash : '';
    const path = `/api/import/${encodeURIComponent(hash)}/exclude`;
    return answer(await step(c, 'POST', path, { body: { reason: text } }));
   }
   case 'prose': {
    const id = need(re.kind === 'piece' ? re.id : undefined, 'the piece id');
    const arrangement = need(str(meta.arrangement), 'meta.arrangement');
    const after = str(meta.after);
    const body = { arrangement, text, ...(after !== undefined ? { after } : {}) };
    return answer(await step(c, 'POST', `/api/piece/${encodeURIComponent(id)}/prose`, { body }));
   }
  }
 });

 // ── POST /v2/act — every non-prose verb ──

 app.post('/act', async (c) => {
  const request = await c.req.json<ActRequest>().catch(() => ({}) as ActRequest);
  const re = parseRe(request.re);
  checkRev(request.rev);
  const raw = obj(request.verb);
  if (raw === undefined) throw new Fault('bad-request', 'verb is required');
  const name = str(raw.v);
  const allowed = VERBS_BY_KIND[re.kind];
  if (name === undefined || !allowed.includes(name as VerbName)) {
   throw new Fault('bad-request', `unknown verb "${String(raw.v)}" on ${re.kind}`);
  }
  const verb = raw as unknown as Verb;
  const guard = GUARD_VERBS.includes(name as VerbName);

  const answer = (parts: { turn?: TurnBody; view?: unknown; notices?: string[] }): Response => {
   rev++;
   return c.json(envelope(re, parts));
  };
  const sitting = (): string => need(re.kind === 'sitting' ? re.id : undefined, 'the sitting id');
  const piece = (): string => need(re.kind === 'piece' ? re.id : undefined, 'the piece id');
  const slug = (): string => need(re.kind === 'coach' ? re.slug : undefined, 'the direction slug');
  const claim = (): string => (re.kind === 'claim' ? re.id : '');
  const post = async (path: string, body?: unknown): Promise<Response> =>
   answer(await step(c, 'POST', path, { ...(body !== undefined ? { body } : {}), guard }));

  switch (verb.v) {
   // ── sitting ──
   case 'skip':
    return post(`/api/session/${encodeURIComponent(sitting())}/skip`);
   case 'defer':
    return post(
     `/api/session/${encodeURIComponent(sitting())}/defer`,
     verb.need !== undefined ? { need: verb.need } : {},
    );
   case 'end':
    return post(`/api/session/${encodeURIComponent(sitting())}/end`);
   case 'leave': {
    // Today this is a client navigation that deliberately calls nothing.
    // Named here so a headless persona can end an evening without
    // harvesting, exactly as a person can: close nothing, keep the words.
    pulsePrompts.delete(sitting());
    return answer({ notices: ['the sitting is left as it stands — nothing was harvested'] });
   }
   case 'sounding':
    if (typeof verb.accept !== 'boolean') throw new Fault('bad-request', 'accept must be a boolean');
    return post(`/api/session/${encodeURIComponent(sitting())}/sounding`, { accept: verb.accept });
   case 'gate':
    return post(`/api/session/${encodeURIComponent(sitting())}/sounding/gate`, { choice: verb.choice });

   // ── drm ──
   case 'drm-start':
    return post(`/api/session/${encodeURIComponent(re.kind === 'drm' ? re.sittingId : '')}/drm/start`);
   case 'drm-episode':
    return post(`/api/session/${encodeURIComponent(re.kind === 'drm' ? re.sittingId : '')}/drm/episode`, {
     name: verb.name,
     startHour: verb.startHour,
    });
   case 'drm-enumerate-done':
    return post(`/api/session/${encodeURIComponent(re.kind === 'drm' ? re.sittingId : '')}/drm/enumerate-done`);
   case 'drm-gate':
    return post(`/api/session/${encodeURIComponent(re.kind === 'drm' ? re.sittingId : '')}/drm/gate`, {
     choice: verb.choice,
    });

   // ── harvest review ──
   case 'approve':
   case 'trim':
   case 'discard': {
    const sessionId = re.kind === 'harvest' ? re.sessionId : '';
    const proposals = await proposalsOf(c, sessionId);
    const at = verb.proposal;
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= proposals.length) {
     throw new Fault('bad-request', `proposal must be an index into the ${proposals.length} proposals`);
    }
    const decision: HarvestDecision =
     verb.v === 'trim'
      ? { proposal: at, action: 'trim', text: spanText(proposals[at]!.text, verb.span, 'the proposal') }
      : { proposal: at, action: verb.v };
    const kept = record(harvestDecisions, sessionId, decision, at);
    return answer({ view: { decided: kept.length, of: proposals.length } });
   }
   case 'commit': {
    const sessionId = re.kind === 'harvest' ? re.sessionId : '';
    const proposals = await proposalsOf(c, sessionId);
    const decisions = harvestDecisions.get(sessionId) ?? [];
    const decided = new Set(decisions.map((d) => d.proposal));
    const undecided = proposals.map((_, i) => i).filter((i) => !decided.has(i));
    if (undecided.length > 0) {
     throw new Fault(
      'refused',
      `every proposal must be decided before a commit — ${undecided.length} of ${proposals.length} are not`,
     );
    }
    const path = `/api/session/${encodeURIComponent(sessionId)}/harvest`;
    const parts = await step(c, 'POST', path, { body: { decisions }, guard: true });
    harvestDecisions.delete(sessionId);
    return answer(parts);
   }

   // ── wiki ──
   case 'read':
    return post(
     `/api/wiki/claim/${encodeURIComponent(claim())}/read`,
     verb.surface !== undefined ? { surface: verb.surface } : {},
    );
   case 'attest':
    return post(`/api/wiki/claim/${encodeURIComponent(claim())}/attest`);
   case 'challenge':
    return post(`/api/wiki/claim/${encodeURIComponent(claim())}/challenge`);

   // ── piece ──
   case 'compose': {
    if (re.kind === 'piece' && re.id !== undefined) {
     throw new Fault('bad-request', 'compose mints a piece — re must carry no id');
    }
    if (!Array.isArray(verb.snippets)) throw new Fault('bad-request', 'snippets are required');
    const parts = await step(c, 'POST', '/api/piece', { body: { snippets: verb.snippets } });
    const minted = str(obj(parts.view)?.id);
    rev++;
    return c.json(envelope(minted !== undefined ? { kind: 'piece', id: minted } : re, parts));
   }
   case 'reorder':
    return post(`/api/piece/${encodeURIComponent(piece())}/reorder`, {
     arrangement: verb.arrangement,
     entries: verb.entries,
    });
   case 'remove':
    return post(`/api/piece/${encodeURIComponent(piece())}/remove`, {
     arrangement: verb.arrangement,
     entry: verb.entry,
    });
   case 'gap':
    return post(`/api/piece/${encodeURIComponent(piece())}/gap`, {
     arrangement: verb.arrangement,
     gap: verb.gap,
     ...(verb.question !== undefined ? { question: verb.question } : {}),
     ...(verb.after !== undefined ? { after: verb.after } : {}),
    });
   case 'gap-accept':
    return post(`/api/piece/${encodeURIComponent(piece())}/gap/accept`, {
     arrangement: verb.arrangement,
     gap: verb.gap,
     snippet: verb.snippet,
     version: verb.version,
    });
   case 'set-down':
    return post(`/api/piece/${encodeURIComponent(piece())}/set-down`);
   case 'pick-up':
    return post(`/api/piece/${encodeURIComponent(piece())}/pick-up`);
   case 'arrangements':
    return post(`/api/piece/${encodeURIComponent(piece())}/arrangements`);
   case 'choose':
    return post(`/api/piece/${encodeURIComponent(piece())}/choose`, { arrangement: verb.arrangement });

   // ── import ──
   case 'scan':
    return post('/api/import/scan', {
     folder: verb.folder,
     ...(verb.region !== undefined ? { region: verb.region } : {}),
    });
   case 'survey':
    // A survey WRITES the snapshot, so it is an act and dispatches impure —
    // the same folder read under `view` writes nothing.
    return post(`/api/import/survey?folder=${encodeURIComponent(verb.folder)}`, {});
   case 'declare-region':
    return post('/api/import/region', {
     root: verb.root,
     dating: verb.dating,
     authorship: verb.authorship,
    });
   case 'import-approve':
   case 'import-trim':
   case 'import-discard': {
    const hash = re.kind === 'import-piece' ? re.hash : '';
    const { cuts } = await importItem(c, hash);
    const at = verb.cut;
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0 || at >= cuts.length) {
     throw new Fault('bad-request', `cut must be an index into the ${cuts.length} cuts`);
    }
    const decision: ImportDecision =
     verb.v === 'import-trim'
      ? { cut: at, action: 'trim', text: spanText(cuts[at]!.text, verb.span, 'the cut') }
      : { cut: at, action: verb.v === 'import-approve' ? 'approve' : 'discard' };
    const kept = record(importDecisions, hash, decision, at);
    return answer({ view: { decided: kept.length, of: cuts.length } });
   }
   case 'import-commit': {
    const hash = re.kind === 'import-piece' ? re.hash : '';
    const { cuts } = await importItem(c, hash);
    const decisions = importDecisions.get(hash) ?? [];
    const decided = new Set(decisions.map((d) => d.cut));
    const undecided = cuts.map((_, i) => i).filter((i) => !decided.has(i));
    if (undecided.length > 0) {
     throw new Fault(
      'refused',
      `every cut must be decided before a commit — ${undecided.length} of ${cuts.length} are not`,
     );
    }
    const path = `/api/import/${encodeURIComponent(hash)}/decisions`;
    const parts = await step(c, 'POST', path, { body: { decisions }, guard: true });
    importDecisions.delete(hash);
    return answer(parts);
   }

   // ── coach ──
   case 'coach': {
    const parts = await step(c, 'POST', '/api/coach/direction', { body: { name: verb.name } });
    const minted = str(obj(obj(parts.view)?.direction)?.slug);
    rev++;
    return c.json(envelope(minted !== undefined ? { kind: 'coach', slug: minted } : re, parts));
   }
   case 'uncoach':
    return post(`/api/coach/direction/${encodeURIComponent(slug())}/uncoach`);
   case 'decline-offer':
    return post(`/api/coach/direction/${encodeURIComponent(slug())}/decline-offer`);
   case 'adopt':
    return post(`/api/coach/${encodeURIComponent(slug())}/adopt`, { optionId: verb.optionId });
   case 'decline-option':
    return post(`/api/coach/${encodeURIComponent(slug())}/decline-option`, { optionId: verb.optionId });
   case 'coach-read':
    return post(`/api/coach/${encodeURIComponent(slug())}/read`);
   case 'retire':
    return post(`/api/coach/quest/${encodeURIComponent(re.kind === 'quest' ? re.id : '')}/retire`);

   // ── reach ──
   case 'decline-reach':
    return post('/api/reach/decline', { path: verb.path });
  }
 });

 // ── GET /v2/view — shaped projections, PURE ──

 app.get('/view', async (c) => {
  const scope = c.req.query('scope');
  if (scope === undefined || !(SCOPES as readonly string[]).includes(scope)) {
   throw new Fault('bad-request', `unknown scope "${String(scope)}"`);
  }
  const q = (name: string): string | undefined => c.req.query(name);

  // The two scopes that are not JSON pass the old response through whole:
  // an export is the person's markdown, and the activity stream is a stream.
  if (scope === 'piece-export') {
   const id = need(q('id'), 'id');
   const res = await hit(c, 'GET', `/api/piece/${encodeURIComponent(id)}/export`, { pure: true });
   if (!res.ok) throw faultFor(res.status, await res.json().catch(() => null), false);
   return res;
  }
  if (scope === 'activity') {
   const since = q('since');
   const accept = c.req.header('accept') ?? '';
   const path = `/api/activity${since !== undefined ? `?since=${encodeURIComponent(since)}` : ''}`;
   const res = await hit(c, 'GET', path, { pure: true, accept });
   if (!res.ok) throw faultFor(res.status, await res.json().catch(() => null), false);
   return res;
  }

  const path = ((): string => {
   switch (scope) {
    case 'queue': return '/api/queue';
    case 'wiki': return '/api/wiki';
    case 'wiki-all': return '/api/wiki?all=1';
    case 'snippets': return '/api/snippets';
    case 'pieces': return '/api/pieces';
    case 'piece': return `/api/piece/${encodeURIComponent(need(q('id'), 'id'))}`;
    case 'harvest-queue': return '/api/harvest-queue';
    case 'harvest': return `/api/harvest-queue/${encodeURIComponent(need(q('sessionId'), 'sessionId'))}`;
    case 'import-next': {
     const region = q('region');
     return `/api/import/next${region !== undefined ? `?region=${encodeURIComponent(region)}` : ''}`;
    }
    case 'import-survey': return `/api/import/survey?folder=${encodeURIComponent(need(q('folder'), 'folder'))}`;
    case 'reach': return '/api/reach';
    case 'coach-waiting': return '/api/coach/waiting';
    case 'coach': return `/api/coach/${encodeURIComponent(need(q('slug'), 'slug'))}`;
    case 'cadence': return '/api/cadence';
    case 'anniversary': return '/api/anniversary';
    case 'auth-status': return '/api/auth/status';
    default: return '/api/stt/status';
   }
  })();

  const res = await hit(c, 'GET', path, { pure: true });
  return c.json({ scope, rev, view: await bodyOf(res) });
 });

 // Every refusal leaves through one door, in one vocabulary.
 app.onError((err, c) => {
  if (err instanceof Fault) {
   return c.json({ error: { code: err.code, message: err.message } }, STATUS[err.code]);
  }
  return c.json({ error: { code: 'unavailable', message: String(err) } }, 503);
 });

 return app;
}
