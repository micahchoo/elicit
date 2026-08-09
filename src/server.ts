import { Hono, type Context } from 'hono';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { loadEnvFile } from './env.js';
import matter from 'gray-matter';
import { join, extname } from 'node:path';
import { ulid } from 'ulid';
import { createVault } from './vault/vault.js';

import { suggestTargetForVault } from './elicitor/target-default.js';
import { CUTS_RESPONSE_FORMAT, SYSTEM_PROMPT as HARVEST_SYSTEM_PROMPT } from './harvester/harvester.js';
import { readProfile, writeProfile, personaLine, type Profile } from './profile.js';
import { setMintPersonaLine } from './clerk/mint.js';
import { createQueueStore, isUserDeclaredWeight, MAX_OPEN_QUESTIONS } from './queue/queue.js';
import { openQuestionEntry } from './queue/open-question.js';
import { buildIndex } from './index/lexical.js';
import {
 buildSemanticIndex,
 fileSnippetVectorStore,
 type SemanticIndex,
} from './index/semantic.js';
import { readCadence, cadenceSentence } from './log/cadence.js';
import { createAnnotationStore, type AnnotationStore } from './clerk/annotation-store.js';
import { setDraftRejectSink } from './clerk/composed.js';
import { buildTerritoryResponse } from './territory.js';
import { createGazetteerStore, type GazetteerStore } from './clerk/gazetteer-store.js';
import { extractEntities, entityId } from './clerk/gazetteer.js';
import { createPieceStore } from './piece/store.js';
import { createPieceRoutes } from './piece/routes.js';
import { createCoachRoutes } from './coach/routes.js';
import { createClerk } from './clerk/docket-init.js';
import { createWikiRoutes } from './wiki/routes.js';
import { PARKED_SOURCE as PARKED_SOUNDING_SOURCE, readLadder } from './sounding/park.js';
import { PARKED_DRM_SOURCE } from './drm/park.js';
import { readSweepDeferral } from './wiki/store.js';
import { THRESHOLDS } from './wiki/thresholds.js';
import { localEmbedder, type Embed } from './wiki/embedding.js';
import { makeFakeComplete } from './fake-responder.js';
import { appendEvent, onAppend, readEvents, type ActivityEvent } from './log/activity.js';
import type { EventKind } from './log/kinds.js';
import { readTranscripts, readTranscriptBody } from './vault/transcripts.js';
import { createSttClient, type SttClient } from './stt/client.js';
import { resolveModelDir } from './stt/model.js';
import { createFileAuth, createSessionAuth, remoteAddrOf, requireLoopback, sessionResponse, type AuthStore } from './auth/auth.js';
import { archiveFreshStart } from './reset/fresh-start.js';
import { loadProtocolDefinitions } from './protocols/registry.js';
import { machinePhaseMeta } from './protocols/machine.js';
import { createSessionRoutes, createSessionState, startBackgroundHarvest, startUnpromptedSitting, type SessionCtx } from './session/routes.js';
import { createWaitingRoutes } from './session/waiting.js';
import { readMachineState, PARKED_SOURCE as PARKED_MACHINE_SOURCE } from './protocols/park.js';
import { createV2App } from './v2/router.js';
import { checkedChannel, requireText } from './guards.js';
import { createCoachStore } from './coach/store.js';
import type {
 Vault,
 Complete,
 QueueStore,
 LexicalIndex,
 QueueEntry,
 Snippet,
 Turn,
 Prosody,
} from './types.js';
import { CAPTURE_CHANNELS, isCaptureChannel } from './types.js';

import { createImportStore, createRegionStore } from './import/pipeline.js';
import { createImportRoutes } from './import/routes.js';
export interface ServerDeps {
 vault: Vault;
 /** Foreground model: probes, red-lights, live composition. A person waits on it (Q-48). */
 complete: Complete;
 /**
  * Background model: harvest extraction, docket minting, consolidation.
  * Absent means one model does both jobs — the fake responder and the tests
  * work that way. The stamp is required next to the Complete so a clerk
  * artifact can never carry the elicitor's model name (Q-34).
  */
 clerk?: {
  complete: Complete;
  modelName: string;
  /**
   * The same clerk endpoint with the cuts JSON schema pinned at generation
   * (ticket 078). Harvest-only: the wiki mint jobs speak the op-list shape,
   * so the constrained variant must never serve them. Absent falls back to
   * `complete` — the fake responder and the tests keep the unconstrained path.
   */
  harvestComplete?: Complete;
 };
 /**
  * The embedder behind the third clash channel (Q-17). Injected for the same
  * reason `complete` is: it is the only other thing in this process that
  * reaches an endpoint, and a test must never do that. Absent means the
  * channel is not built — two channels still run, and the Clerk works with
  * the embedding server switched off because it does today.
  */
 embed?: { embed: Embed; model: string };
 queue: QueueStore;
 index: LexicalIndex;
 /**
  * The semantic resonance channel (Q-17, ticket 068). Built beside the lexical
  * index at boot and primed in the background; absent means the channel is off
  * and the hybrid degrades to the trigram index — the ordinary cold state,
  * the same shape as `embed` for the Clerk.
  */
 semanticIndex?: SemanticIndex;
 vaultRoot: string;
 authStore: AuthStore;
 /** Optional STT client for voice input. Lazily created as module singleton if absent. */
 sttClient?: SttClient;
 /** Model id stamped on elicitor-authored artifacts (Q-34). */
 modelName?: string;
 /**
  * Called after each background docket run settles, success or failure. The
  * docket runs off the response path (ticket 047), so this is the only seam
  * an embedder has to know that a run finished.
  */
 onDocketSettled?: () => void;
 /**
  * The resolved-referent annotation store (ticket 074). Absent means the
  * /api/snippets route enriches nothing and the docket runs no annotation
  * job — exactly the pre-ticket behavior, which the tests keep.
  */
 annotations?: AnnotationStore;
 /**
  * The gazetteer entity index store (ticket 100). Absent means the
  * docket runs no extraction or frontier sweep — exactly the pre-ticket
  * behavior, which the tests keep.
  */
 gazetteerStore?: GazetteerStore;
}

// ── MIME map for static serving ──

const MIME: Record<string, string> = {
 '.html': 'text/html; charset=utf-8',
 '.css': 'text/css; charset=utf-8',
 '.js': 'application/javascript; charset=utf-8',
 '.json': 'application/json',
 '.png': 'image/png',
 '.svg': 'image/svg+xml',
 '.ico': 'image/x-icon',
};

// ── STT client (lazy module singleton) ──

let _sttClient: SttClient | null = null;
let _sttUnavailable = false;

function getSttClient(deps: ServerDeps): SttClient | null {
 if (_sttClient) return _sttClient;
 if (_sttUnavailable) return null;
 if (deps.sttClient) {
  _sttClient = deps.sttClient;
  return _sttClient;
 }
 try {
  resolveModelDir(); // throws if unavailable
 } catch {
  _sttUnavailable = true;
  return null;
 }
 _sttClient = createSttClient();
 return _sttClient;
}

// ── Password gate ──

/**
 * Session tokens for password-gated access (S14): the token map, cookie and
 * middleware moved to src/auth/auth.ts; this module-scope instance is the
 * server's — one map per process, exactly as the inline map was.
 */
const sessionAuth = createSessionAuth();

// ── Helpers ──


/** Emit an activity event at the server seam. */
function serverEmit(
 root: string,
 actor: ActivityEvent['actor'],
 kind: EventKind,
 detail: string,
 refs?: string[],
): void {
 appendEvent(root, { at: new Date().toISOString(), actor, kind, detail, ...(refs ? { refs } : {}) });
}



/**
 * Whether this request is a PURE read (ticket 129, the core API spec).
 *
 * The census found six read-shaped routes that write: /api/wiki stamps
 * surfaced, /api/queue expires the open-pool tail, /api/import/survey writes
 * the snapshot, and /api/coach/waiting and /api/reach log an offer
 * evaluation. Under `/v2` those writes move to explicit verbs and to the
 * docket, so the /v2 view dispatch marks its internal request with this
 * header and each of those handlers skips its write.
 *
 * INTERNAL: only `src/v2/router.ts` sets it, and only on a projection
 * dispatch. The SPA never sends it, so what the person meets is unchanged.
 */
function isPureRead(c: Context): boolean {
 return c.req.header('x-elicit-pure') === '1';
}

/** Scan transcript files for session metadata (used by docket). */
function listSessions(root: string): { session: string; started: string; turnCount: number; chars: number }[] {
 // The vault read owner parses the frontmatter once; turnCount/chars ride on
 // TranscriptMeta now, so the per-file re-parse is gone. Counters are
 // byte-identical: absent stays 0, exactly what the old fallback produced.
 return readTranscripts(root).map((t) => ({
  session: t.session,
  started: t.started,
  turnCount: t.turnCount ?? 0,
  chars: t.chars ?? 0,
 }));
}

/** Body text of one session's transcript, without frontmatter. */
function readTranscript(root: string, session: string): string {
 return readTranscriptBody(root, session);
}


/**
 * One snippet version's prose, by path. Older versions stay on disk (Q-5).
 *
 * `rebuildIndex()` reads only the newest `v<N>.md` per snippet and returns
 * one Snippet per id, so it cannot answer a pin to an old version — and the
 * pinned-version invariant is the highest-value line in the slice (Q-5,
 * Q-39). This reads the file the pin names, by a path it already knows.
 * `.trimEnd()` matches what `rebuildIndex` does, so a pin at the current
 * version resolves byte-identically through either path.
 */
function readVersion(root: string, snippetId: string, version: number): string | null {
 try {
  return matter.read(join(root, 'snippets', snippetId, `v${version}.md`)).content.trimEnd();
 } catch { return null; }
}


/**
 * Prosody for the spoken turn that just landed (ticket 108). Computed in the
 * transcribe route, consumed by the turn route when the dictated text
 * matches, then cleared — lineage-only, nothing selects on it (Q-11).
 */
function computeProsody(
 result: { tokens: string[]; timestamps: number[]; durations: number[] },
 decodeDurationMs: number,
 audioDurationMs: number,
): Prosody {
 const tokenCount = result.tokens.length;
 if (tokenCount === 0) {
  return { decodeDurationMs: Math.round(decodeDurationMs), audioDurationMs: Math.round(audioDurationMs), tokenCount: 0, tokensPerSec: 0, pauseCount: 0 };
 }
 const firstTs = result.timestamps[0]!;
 const lastTs = result.timestamps[tokenCount - 1]!;
 const lastDur = result.durations[tokenCount - 1]!;
 const speechDurationSec = lastTs + lastDur - firstTs;
 const tokensPerSec = speechDurationSec > 0 ? tokenCount / speechDurationSec : 0;
 let pauseCount = 0;
 for (let i = 1; i < tokenCount; i++) {
  const prevEnd = result.timestamps[i - 1]! + result.durations[i - 1]!;
  const gap = result.timestamps[i]! - prevEnd;
  if (gap >= 0.5) pauseCount++;
 }
 return {
  decodeDurationMs: Math.round(decodeDurationMs),
  audioDurationMs: Math.round(audioDurationMs),
  tokenCount,
  tokensPerSec: Math.round(tokensPerSec * 100) / 100,
  pauseCount,
 };
}

// ── Create app ──

export async function createApp(deps: ServerDeps): Promise<Hono> {
 // The index every handler reads. It starts as the one handed in, so a fresh
 // process answers from what the vault already holds, and it is replaced only
 // by a completed DocketReport — the report stays the single index source.
 let currentIndex = deps.index;
 // The semantic channel the turn endpoint searches beside the lexical one.
 // Absent is the cold state: resonateHybrid degrades to the trigram index.
 const semanticIndex = deps.semanticIndex;
 const snippetMap = new Map(Object.values(deps.vault.rebuildIndex().snippets).map((s) => [s.id, s]));
/** The spoken-turn prosody carrier (ticket 108), PER createApp: the module scope leaked the last transcription across app instances in the same process (tests build many). */
let pendingProsody: { text: string; prosody: Prosody } | null = null;

/**
 * The ONE server seam createClerk calls when a docket run completes (Wave
 * C1): the report's index becomes the one every handler reads, and the
 * snippet map is refilled from the vault exactly as the run left it — the
 * same two writes runDocketNow's completion used to make inline.
 */
const setIndex = (lexical: LexicalIndex, snippets: Record<string, Snippet>): void => {
 currentIndex = lexical;
 for (const s of Object.values(snippets)) snippetMap.set(s.id, s);
};

 // Everything with nobody waiting on it goes to the clerk model (Q-48). One
 // Complete serving both roles is the degenerate case, not a fallback:
 // nothing here ever swaps models at runtime, because the stamp would lie.
 const clerkComplete = deps.clerk?.complete ?? deps.complete;
 const clerkModelName = deps.clerk?.modelName ?? deps.modelName;

 // Who the vault is about (src/profile.ts). Loaded once, updated by
 // POST /api/profile; the mint prompt reads it through its module setter.
 let profile: Profile = readProfile(deps.vaultRoot);
 setMintPersonaLine(personaLine(profile));
 /** The harvest system prompt with the persona line, or undefined = stock. */
 const harvestPromptNow = (): string | undefined => {
  const line = personaLine(profile);
  return line ? `${HARVEST_SYSTEM_PROMPT}\n\n${line}` : undefined;
 };

 // Draft rejections reach the Activity Log as counts (site + reason
 // category, never drafted text) — the eval that measured gemma failing the
 // emit gate twice per descent had only a terminal scrollback to read.
 setDraftRejectSink((site, reason) => {
  appendEvent(deps.vaultRoot, {
   at: new Date().toISOString(),
   actor: 'elicitor',
   kind: 'question-rejected',
   detail: `site=${site} reason=${reason}`,
  });
 });
 // Harvest cuts ride the grammar-constrained variant when the deps carry one
 // (ticket 078); everything else the clerk does stays unconstrained.
 const harvestComplete = deps.clerk?.harvestComplete ?? clerkComplete;

// The staging store the docket's extraction job reads: unreviewed files
// live here until the run before the person sits down (T6).
const importStore = createImportStore(deps.vaultRoot);

// The region store the seeding routes read and write (014): a declaration
// lives on disk at vault/imports/regions/<slug>.md, and every reader
// recomputes from it (Q-3), so a restart between declaration and review
// loses nothing. POST /api/import/region is the only writer.
const regionStore = createRegionStore(deps.vaultRoot);

// The PieceStore the piece routes write through (T6) — one binding shared
// with T10's docket thunks. Every write passes the five guards.
const pieces = createPieceStore(deps.vaultRoot, { snippets: () => deps.vault.rebuildIndex().snippets });

 // ── The Clerk, built once (Wave C1) ──
 //
 // The wiki machinery and the docket moved to src/clerk/docket-init.ts:
 // createClerk owns the claim store, the registry, the clash channels,
 // the docket jobs' thunks and the tripwire semantics (jobsStopped,
 // pendingTrigger, single-flight). What stays here is the ONE seam —
 // setIndex, which a finished DocketReport calls to replace currentIndex
 // and refill the snippet map — and the handles the routes reach the
 // docket through. The stop/resume/import/fresh-start/boot call sites
 // read the accessors live (clerk.jobsStopped, clerk.docketRunning,
 // clerk.lastLint) rather than destructuring, which would snapshot them.
const clerk = createClerk({
 vault: deps.vault,
 queue: deps.queue,
 complete: clerkComplete,
 modelName: clerkModelName,
 vaultRoot: deps.vaultRoot,
 ...(deps.embed ? { embed: deps.embed } : {}),
 ...(deps.annotations ? { annotations: deps.annotations } : {}),
 ...(deps.gazetteerStore ? { gazetteerStore: deps.gazetteerStore } : {}),
 ...(deps.onDocketSettled ? { onDocketSettled: deps.onDocketSettled } : {}),
 harvestComplete,
 importStore,
 regionStore,
 pieces,
 profile: () => profile,
 coachStore: () => coachStore,
 serverEmit,
 listSessions,
 readTranscript,
 setIndex,
});

 const app = new Hono();
 const { authStore } = deps;

 // ── Setup-required gate for non-API routes (must precede static serving) ──
 app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next();
  if (!authStore.exists()) {
   if (!requireLoopback(c)) {
    return c.html(
     '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Elicit — setup required</title><style>body{font-family:system-ui,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1rem;color:#333;line-height:1.6}h1{font-weight:400;font-size:1.25rem}p{color:#666}</style></head><body><h1>finish setup from the host machine</h1><p>Open a browser on the computer running Elicit to set a password. LAN access is blocked until the gate is configured.</p></body></html>',
    );
   }
  }
  return next();
 });

 // ── Public API routes (no auth required) ──

 // GET /api/auth/status → {needsSetup}
 app.get('/api/auth/status', (c) => {
  return c.json({ needsSetup: !authStore.exists() });
 });

 // GET /api/stt/status → {available}
 app.get('/api/stt/status', (_c) => {
  try {
   resolveModelDir();
   return _c.json({ available: true });
  } catch {
   return _c.json({ available: false });
  }
 });

 // POST /api/setup {password} — loopback-only, creates auth file + issues session
 app.post('/api/setup', async (c) => {
  if (!requireLoopback(c)) {
   return c.json({ error: 'setup must be done from the host machine' }, 403);
  }
  const body = await c.req.json<{ password: string }>();
  if (!body.password || typeof body.password !== 'string' || body.password.length < 1) {
   return c.json({ error: 'password required' }, 400);
  }
  authStore.setup(body.password);
  const { cookie } = sessionAuth.issue();
  return sessionResponse(cookie);
 });

 // POST /api/login {password} → {ok: true} + session cookie
 app.post('/api/login', async (c) => {
  const body = await c.req.json<{ password: string }>();
  if (!body.password) {
   return c.json({ error: 'password required' }, 400);
  }
  if (!authStore.verify(body.password)) {
   return c.json({ error: 'invalid password' }, 401);
  }
  const { cookie } = sessionAuth.issue();
  return sessionResponse(cookie);
 });

 // ── Auth middleware for remaining API routes ──
 app.use('/api/*', sessionAuth.middleware({
  authFileExists: () => authStore.exists(),
  remoteAddr: remoteAddrOf,
 }));

 // ── Idempotency for headless callers (145 remainder) ──
 //
 // A script whose request times out retries it — and without a dedupe key
 // the server happily runs the same turn or opens the same sitting twice.
 // Opt-in: a mutating request carrying an `Idempotency-Key` header runs
 // once; any repeat of the key (including one arriving WHILE the first is
 // still in flight — the timeout-retry case, so the PROMISE is shared, not
 // just the result) gets a copy of the first response. In-memory, half an
 // hour, capped: single-person local server, and a restart also ends the
 // retrying script's session. The browser never sends the header.
 const idempotencyCache = new Map<string, { at: number; response: Promise<{ status: number; contentType: string | null; text: string }> }>();
 const IDEMPOTENCY_TTL_MS = 30 * 60_000;
 const IDEMPOTENCY_CAP = 1000;
 const idempotencyMiddleware = async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
  const key = c.req.header('idempotency-key');
  if (!key || c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const now = Date.now();
  for (const [k, v] of idempotencyCache) {
   if (now - v.at > IDEMPOTENCY_TTL_MS) idempotencyCache.delete(k);
  }
  // Scope by route so one key accidentally reused across routes never
  // replays the wrong response.
  const scoped = `${c.req.method} ${new URL(c.req.url).pathname} ${key}`;
  const hit = idempotencyCache.get(scoped);
  if (hit) {
   const stored = await hit.response;
   return new Response(stored.text, {
    status: stored.status,
    headers: {
     ...(stored.contentType ? { 'content-type': stored.contentType } : {}),
     'idempotency-replayed': 'true',
    },
   });
  }
  if (idempotencyCache.size >= IDEMPOTENCY_CAP) {
   const oldest = idempotencyCache.keys().next().value;
   if (oldest !== undefined) idempotencyCache.delete(oldest);
  }
  let settle!: (v: { status: number; contentType: string | null; text: string }) => void;
  let fail!: (e: unknown) => void;
  const shared = new Promise<{ status: number; contentType: string | null; text: string }>((res, rej) => { settle = res; fail = rej; });
  // A rejected shared promise is awaited only by concurrent duplicates;
  // swallow so a handler throw cannot become an unhandled rejection here.
  shared.catch(() => {});
  idempotencyCache.set(scoped, { at: now, response: shared });
  try {
   await next();
   const res = c.res.clone();
   settle({ status: res.status, contentType: res.headers.get('content-type'), text: await res.text() });
  } catch (err) {
   // A failed first attempt must not pin the key — the retry should RUN.
   idempotencyCache.delete(scoped);
   fail(err);
   throw err;
  }
 };
 app.use('/api/*', idempotencyMiddleware);
 app.use('/v2/*', idempotencyMiddleware);

 // ── Who the vault is about ──
 //
 // GET /api/profile → {name?, pronouns?}
 // POST /api/profile {name?, pronouns?} → the stored profile
 // Configuration typed into a form, never elicited words — it lives beside
 // the vault, not in it (Q-1), and readings/claims written after a change
 // use the new phrasing; nothing already written is rewritten.
 app.get('/api/profile', (c) => c.json(profile));
 app.post('/api/profile', async (c) => {
  const body = await c.req.json<{ name?: unknown; pronouns?: unknown }>().catch(() => null);
  if (body === null) return c.json({ error: 'a JSON body is required' }, 400);
  if (body.name !== undefined && typeof body.name !== 'string') {
   return c.json({ error: 'name must be a string' }, 400);
  }
  if (body.pronouns !== undefined && typeof body.pronouns !== 'string') {
   return c.json({ error: 'pronouns must be a string' }, 400);
  }
  profile = writeProfile(deps.vaultRoot, {
   ...(typeof body.name === 'string' ? { name: body.name } : {}),
   ...(typeof body.pronouns === 'string' ? { pronouns: body.pronouns } : {}),
  });
  setMintPersonaLine(personaLine(profile));
  serverEmit(deps.vaultRoot, 'elicitor', 'profile-updated', `name=${profile.name !== undefined} pronouns=${profile.pronouns !== undefined}`);
  return c.json(profile);
 });

 // POST /api/fresh-start {confirm: 'fresh start'} → {ok, archiveDir, moved}
 // Loopback-only, like /api/setup: a fresh start re-runs first-boot setup,
 // which is host-only by design. Every person-derived record is MOVED —
 // never deleted — into ./archives/<stamp>/ (the 2026-08-03 pristine reset's
 // layout), instruments stay, and the process exits so the next boot
 // rebuilds an empty vault and asks for a new password. Refused while a
 // docket run is in flight: a mid-run rename would pull files out from
 // under the clerk.
 app.post('/api/fresh-start', async (c) => {
  if (!requireLoopback(c)) {
   return c.json({ error: 'fresh start must be done from the host machine' }, 403);
  }
  const body = await c.req
   .json<{ confirm?: string }>()
   .catch(() => ({}) as { confirm?: string });
  if (body.confirm !== 'fresh start') {
   return c.json({ error: 'type the phrase "fresh start" to confirm' }, 400);
  }
  if (clerk.docketRunning) {
   return c.json({ error: 'a background run is in flight — try again in a moment' }, 409);
  }
  let report;
  try {
   report = archiveFreshStart({ cwd: process.cwd(), vaultRoot: deps.vaultRoot, now: new Date() });
  } catch (err) {
   return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
  console.error(`\n  fresh start: ${report.moved.length} records archived → ${report.archiveDir}`);
  console.error('  exiting — run npm start again for a fresh vault\n');
  // The response flushes first; the delay is generous because the exit is
  // not racing anything — the archive is already on disk.
  setTimeout(() => process.exit(0), 750);
  return c.json({ ok: true, archiveDir: report.archiveDir, moved: report.moved });
 });

 // GET /api/target-suggestion → {target, recent, declaredRequired}
 // What the Mode screen should pre-fill when the user has not chosen. The
 // Target still has to be declared (Q-19); this only stops the pre-fill from
 // pointing inward every time.
 app.get('/api/target-suggestion', (c) => {
  const { target, recent } = suggestTargetForVault(deps.vaultRoot);
  return c.json({ target, recent, declaredRequired: true });
 });

 // GET /api/protocols → { protocols: [{ id, name, title, blurb?, rotation }] }
// The mode-screen protocol row's contract (tickets 153/157): protocols are
// an open set loaded from markdown defs, so the client renders whatever the
// server returns — never a hardcoded list. `id` is the registry key POST
// /api/session accepts as {protocol}; `title`/`blurb` are the surface words
// (title falls back to the name for a def without one); `rotation: false`
// marks instruments the server never picks on its own (drm, people-grid —
// Q-85) — shown as explicit-only picks beside the default "let it choose"
// row.
app.get('/api/protocols', (c) => {
 const protocols = [...loadProtocolDefinitions().values()]
  .map((d) => ({
   id: d.name,
   name: d.name,
   title: d.title,
   ...(d.blurb !== undefined ? { blurb: d.blurb } : {}),
   rotation: d.rotation !== false,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));
 return c.json({ protocols });
});

// ── Session-flow routes (extracted into src/session/routes.ts) ──
// The handlers close over SessionCtx; the docket-replaced objects arrive as
// live read-handles (currentIndex/snippetMap getters read the let-bindings
// this function owns, so a completed run is visible to every route).
const { maps: sessionMaps, ctx: sessionCtx } = createSessionState({
 vault: deps.vault,
 queue: deps.queue,
 vaultRoot: deps.vaultRoot,
 complete: deps.complete,
 gazetteerStore: deps.gazetteerStore,
 clerkComplete,
 harvestComplete,
 semanticIndex,
 currentIndex: () => currentIndex,
 snippetMap: () => snippetMap,
 harvestPromptNow,
 pendingProsody: {
  current: () => pendingProsody,
  clear: () => { pendingProsody = null; },
 },
 serverEmit,
 startDocket: clerk.startDocket,
 listSessions,
 isCaptureChannel,
});
// The unprompted map references stay for the coach and waiting-surface
// clusters (src/session/waiting.ts), which mutate the SAME maps — Wave C3 F14.
const { unpromptedSessions, unpromptedChannels } = sessionMaps;
createSessionRoutes(app, sessionCtx);

// The waiting-surface cluster (anniversary, harvest-queue ×2, unprompted,
// sweep-backlog, events) lives in src/session/waiting.ts (Wave D1).
createWaitingRoutes(app, {
 vault: deps.vault,
 vaultRoot: deps.vaultRoot,
 serverEmit,
 sessionCtx,
 unpromptedSessions,
 unpromptedChannels,
 sweepWorkRemaining: clerk.sweepWorkRemaining,
});

// The T9 review cluster (scan, next, decisions, exclude, survey, region
// and the reach pair) lives in src/import/routes.ts (Wave D1).
createImportRoutes(app, {
 importStore,
 regionStore,
 vault: deps.vault,
 queue: deps.queue,
 vaultRoot: deps.vaultRoot,
 serverEmit,
 isPureRead,
 startDocket: clerk.startDocket,
});

 // GET /api/queue → {pending, open}
 app.get('/api/queue', (c) => {
  const all = deps.queue.list();
  const pending = all.filter((e) => e.status === 'pending');
  const open = all.filter(
   (e) => e.status === 'pending' && (e.horizon === 'days' || e.horizon === 'session'),
  );
  // QR-6 flood bound: the pile is readable when the open array is capped
  // (Q-56 — caps ship live). The person's own questions first, then newest
  // first; the stale tail beyond the cap is expired rather than hidden, so
  // the queue on disk and the queue the person sees never disagree.
  open.sort((a, b) => {
   const aUd = isUserDeclaredWeight(a) ? 0 : 1;
   const bUd = isUserDeclaredWeight(b) ? 0 : 1;
   if (aUd !== bUd) return aUd - bUd;
   return b.created.localeCompare(a.created);
  });
  // TODO(ticket 132): a pure read expires nothing — the docket sweep owns
  // the open-pool tail under the core API spec. Until that sweep lands, a
  // vault read only through /v2 keeps a tail past the cap on disk while the
  // capped list below still hides it.
  if (open.length > MAX_OPEN_QUESTIONS && !isPureRead(c)) {
   deps.queue.expireTailBeyond(MAX_OPEN_QUESTIONS);
  }
  const capped = open.slice(0, MAX_OPEN_QUESTIONS);
  // Parked-sounding pointers carry the rung count so the waiting surface can
  // say how many rungs are kept (T12 recorded deviation — the plan's UI
  // contract has no other wire source inside the ownership map); parked
  // machine pointers carry the phase the machine sits in (ticket 159, slice
  // 5). Every other entry passes through untouched.
  const enrich = (e: QueueEntry) =>
   e.source === 'parked-sounding'
    ? { ...e, rungsKept: readLadder(deps.vaultRoot, e.soundingId ?? '')?.rungs.length ?? 0 }
    : e.source === 'parked-machine'
     ? (() => {
      const parked = readMachineState(deps.vaultRoot, e.machineId ?? '');
      return {
       ...e,
       machinePhase: machinePhaseMeta(parked === null ? undefined : parked) ?? null,
      };
     })()
    : e;
 return c.json({ pending: pending.map(enrich), open: capped.map(enrich) });
});

// ── The open-questions pane's own verbs (ticket 151) ──
// The waiting surface's three acts. QueueStore owns the transitions
// (markAnswered / park / unpark); each act speaks through the Activity Log
// (Q-23) and never carries the question's words — only the act does.

// POST /api/queue/:id/answer {text, channel} → {ok: true}
// Answering in writing: the answer becomes a one-turn sitting (the queue
// question rides as the eliciting probe, so the harvest can read the
// lineage), harvests behind this response, and the review cards land in
// the pending queue — "the harvest reads it now".
app.post('/api/queue/:id/answer', async (c) => {
 const id = c.req.param('id');
 const entry = deps.queue.get(id);
 if (!entry) return c.json({ error: 'no open question with that id' }, 404);
 const body = await c.req.json<{ text?: unknown; channel?: unknown }>().catch(() => null);
 if (!body) return c.json({ error: 'text is required' }, 400);
 const text = requireText(c, body.text);
 if (text instanceof Response) return text;
 const channel = checkedChannel(c, body.channel);
 if (channel instanceof Response) return channel;
 const sessionId = ulid();
 const at = new Date().toISOString();
 const agentTurn: Turn = { role: 'agent', text: entry.question, at };
 const { turn: userTurn } = startUnpromptedSitting(sessionCtx, {
  sessionId,
  text,
  protocol: 'queue-answer',
  at,
  leadTurns: [agentTurn],
 });
 deps.queue.markAnswered(id);
 startBackgroundHarvest(sessionCtx, {
  sessionId,
  turns: [agentTurn, userTurn],
  protocol: 'queue-answer',
  started: at,
  origin: 'harvest',
  ...(channel !== undefined ? { turnChannels: [channel] } : {}),
 });
 // Length, never content (Q-23: the JSONL is the audit trail).
 serverEmit(deps.vaultRoot, 'elicitor', 'question-answered-direct', `session=${sessionId} chars=${text.length}`);
 return c.json({ ok: true });
});

// POST /api/queue/:id/park → {ok: true}
// The person's own act (QueueStore contract: 'pending' → 'parked'). The
// store's park is a no-op on a missing or non-pending entry, so the route
// answers 404 for the missing case; a non-pending entry is a stale view of
// the surface and parks nothing.
app.post('/api/queue/:id/park', (c) => {
 const id = c.req.param('id');
 const entry = deps.queue.get(id);
 if (!entry) return c.json({ error: 'no open question with that id' }, 404);
 deps.queue.park(id);
 serverEmit(deps.vaultRoot, 'elicitor', 'question-parked', `entry=${id}`);
 return c.json({ ok: true });
});

// POST /api/queue/:id/unpark → {ok: true}
// Put a parked question back ('parked' → 'pending', created refreshed — the
// expiry clock restarts server-side, QueueStore contract).
app.post('/api/queue/:id/unpark', (c) => {
 const id = c.req.param('id');
 const entry = deps.queue.get(id);
 if (!entry) return c.json({ error: 'no parked question with that id' }, 404);
 deps.queue.unpark(id);
 serverEmit(deps.vaultRoot, 'elicitor', 'question-unparked', `entry=${id}`);
 return c.json({ ok: true });
});

// ── The jobs switch (ticket 151) ──
// The docket drain switch docket.ts describes (src/clerk/docket.ts:701):
// stopped gates NEW runs and cuts a run in flight short at its next job
// boundary. The state is visible on the waiting surface — never silence
// (ticket 154's rule, applied to this control from the start).
app.post('/api/jobs/stop', (c) => {
 clerk.jobsStopped = true;
 serverEmit(deps.vaultRoot, 'elicitor', 'jobs-stopped', `inFlight=${clerk.docketRunning}`);
 return c.json({ ok: true, inFlight: clerk.docketRunning });
});

app.post('/api/jobs/resume', (c) => {
 clerk.jobsStopped = false;
 serverEmit(deps.vaultRoot, 'elicitor', 'jobs-resumed', '');
 // Ticket 156: resume means "start catching up" — clear the switch, then
 // schedule the drain so a stopped-and-lagging server picks the backlog
 // back up on its own. A drain over an empty backlog is a quick no-op run;
 // the chain is bounded by the backlog emptying (ticket 075).
 clerk.scheduleDrain();
 return c.json({ ok: true });
});

// GET /api/cadence → the record, as a sentence (ticket 056)
 //
 // Zero outbound contact stays (Q-22); this is a line the person may read on
 // a surface they chose to open, never a signal that reaches out. The wording
 // lives server-side so it is testable — see `src/log/cadence.ts` for why
 // every phrase in it is the phrase it is (Q-24: dormancy is signal, not debt).
 app.get('/api/cadence', (c) => {
  const cadence = readCadence(deps.vaultRoot);
  return c.json({ cadence, sentence: cadenceSentence(cadence) });
 });

 // GET /api/activity[?since=ISO] → SSE stream or JSON snapshot
 app.get('/api/activity', (c) => {
  const since = c.req.query('since') ?? undefined;

  // Return JSON if client doesn't accept text/event-stream
  const accept = c.req.header('accept') ?? '';
  if (!accept.includes('text/event-stream')) {
   return c.json({ events: readEvents(deps.vaultRoot, since) });
  }

  // SSE stream: the live log's onAppend subscription (the same spine
  // /api/events rides) replaces the old 2s poll, so an event reaches the
  // reader the moment it appends. The payloads are byte-identical to the
  // poll's — raw events as `event: activity\ndata: <json>\n\n`, the shape
  // the waiting surface's reader parses (Wave C3 F5). Subscribe BEFORE
  // reading the log so an append in between is captured, then drop the
  // overlap when the past batch flushes (same `at`).
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
   start(controller) {
    const buffered: ActivityEvent[] = [];
    let pastFlushed = false;
    const enqueue = (ev: ActivityEvent): void => {
     if (closed) return;
     controller.enqueue(
      encoder.encode(`event: activity\ndata: ${JSON.stringify(ev)}\n\n`),
     );
    };
    const off = onAppend(deps.vaultRoot, (e) => {
     if (closed) return;
     if (!pastFlushed) buffered.push(e);
     else enqueue(e);
    });
    // Send past events
    const events = readEvents(deps.vaultRoot, since);
    for (const ev of events) {
     if (closed) return;
     enqueue(ev);
    }
    // Send initial heartbeat — the reader's "historical batch flushed" mark.
    controller.enqueue(encoder.encode(': heartbeat\n\n'));
    // Flush what appended while the past batch was being sent, skipping
    // anything the batch already carried.
    pastFlushed = true;
    const pastAt = new Set(events.map((e) => e.at));
    for (const ev of buffered) {
     if (closed) return;
     if (!pastAt.has(ev.at)) enqueue(ev);
    }

    // Clean up on close
    const cleanup = () => {
     closed = true;
     off();
    };
    c.req.raw.signal.addEventListener('abort', cleanup);
   },
  });

  return new Response(stream, {
   headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
   },
  });
 });

 // The resolved-referent annotation store, when the server carries one
 // (ticket 074). Absent preserves the pre-ticket /api/snippets exactly.
 const annotations = deps.annotations;

 // GET /api/snippets
 app.get('/api/snippets', (c) => {
  const index = deps.vault.rebuildIndex();
  const all = Object.values(index.snippets);
  // Ticket 074: the resolved-referent annotation is agent prose SEPARATE
  // from the snippet, so it rides the response only when the store is
  // injected and only for snippets the model has annotated. Silence and
  // absence both omit the key — the renderer shows nothing for them.
  const snippets = annotations
   ? all.map((s) => {
    const rec = annotations.get(s.id);
    return rec !== null && rec.kind === 'annotation' ? { ...s, annotation: rec } : s;
   })
   : all;
  return c.json({ snippets });
 });

// GET /api/territory — the territory map (ticket 152): skeleton and atlas
// nodes joined with their NodeReadings (vault/ktg/coverage and
// vault/atlases/coverage). A pure read: node states derive from the
// reading files' cites (Q-50), nothing is written, nothing is logged. The
// sitting resolver reads the fresh index, so a cite whose snippet is gone
// resolves to no sitting and can never inflate 'touched' into 'evidenced'
// (coverage.ts attribution policy). Response shape documented in
// src/territory.ts.
app.get('/api/territory', (c) => {
 const index = deps.vault.rebuildIndex();
 const sittingOf = (snippetId: string): string | null =>
  index.snippets[snippetId]?.provenance.session ?? null;
 return c.json(buildTerritoryResponse(deps.vaultRoot, sittingOf));
});

// The wiki cluster (the page and the claim verbs) lives in
// src/wiki/routes.ts, with the page render in src/wiki/page.ts (Wave D1).
createWikiRoutes(app, {
 vault: deps.vault,
 queue: deps.queue,
 vaultRoot: deps.vaultRoot,
 clerk,
 coachStore: () => coachStore,
 serverEmit,
 isPureRead,
});
 
 // POST /api/transcribe — raw Float32 PCM body, returns {text}
 app.post('/api/transcribe', async (c) => {
  const client = getSttClient(deps);
  if (!client) {
   return c.json({ error: 'STT model not available' }, 503);
  }

  const rateStr = c.req.query('rate') ?? '16000';
  const sampleRate = parseInt(rateStr, 10);
  if (isNaN(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
   return c.json({ error: 'invalid rate' }, 400);
  }

  const raw = await c.req.arrayBuffer();
  if (raw.byteLength < 4) {
   return c.json({ error: 'empty or too-short audio' }, 400);
  }

  const samples = new Float32Array(raw);
  const start = performance.now();
  const result = await client.transcribe(samples, sampleRate);
  const audioDurationMs = (samples.length / sampleRate) * 1000;
  const duration = Math.round(performance.now() - start);
  const prosody = computeProsody(result, duration, audioDurationMs);
  pendingProsody = { text: result.text, prosody };
  const chars = result.text.length;

 serverEmit(deps.vaultRoot, 'system', 'transcribed', `${duration}ms ${chars}chars`);

 return c.json({ text: result.text });
 });

 createPieceRoutes(app, {
 pieces,
 vault: deps.vault,
 queue: deps.queue,
 vaultRoot: deps.vaultRoot,
 readVersion,
 listSessions,
 THRESHOLDS,
 openQuestionEntry,
 startUnpromptedSitting,
 sessionCtx,
 serverEmit,
 clerkComplete,
 clerkModelName,
});

const coachStore = createCoachStore(deps.vaultRoot);

createCoachRoutes(app, {
 coachStore: () => coachStore,
 vault: deps.vault,
 queue: deps.queue,
 vaultRoot: deps.vaultRoot,
 clerk,
 serverEmit,
 isPureRead,
 isCaptureChannel,
 startUnpromptedSitting,
 startBackgroundHarvest,
 sessionCtx,
 unpromptedSessions,
 unpromptedChannels,
 clerkComplete,
});

// ── The core API (ticket 129) ──
//
// Mounted LAST among the routes and before the static catch-all, because it
// is an adapter: every /v2 operation dispatches against the /api routes
// registered above, so the closure below can only reach a route that already
// exists. The env is forwarded whole, which is what carries remoteAddr into
// the /api auth lock — /v2 has no gate of its own, it inherits one.
 const v2Dispatch = (path: string, init: RequestInit, env: unknown): Promise<Response> =>
  Promise.resolve(app.request(path, init, env as Record<string, unknown>));
 app.route('/v2', createV2App({ dispatch: v2Dispatch }));

// Static fallback: serve web/dist when it exists
 app.get('/*', (c) => {
  const distDir = join(process.cwd(), 'web', 'dist');
  if (!existsSync(distDir)) return c.notFound();

  let reqPath = c.req.path;
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = join(distDir, reqPath);

  // Directory traversal guard
  if (!filePath.startsWith(distDir)) return c.notFound();

  let stats;
  try {
   stats = statSync(filePath);
  } catch {
   return c.notFound();
  }
  if (!stats.isFile()) return c.notFound();

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const content = readFileSync(filePath);

  return new Response(content, {
   status: 200,
   headers: { 'Content-Type': contentType },
  });
 });

 // Boot docket last: the app is wired, so requests that arrive while it runs
 // are served from the index we were handed instead of waiting for a new one.
 clerk.startDocket('boot');

 // Ticket 139 — boot-time backup drain: if the last run left sweep work on
 // disk (deferral ledger) or was cut short mid-run, schedule a drain so the
 // promise "left for the next run" survives a restart. The boot docket's own
 // bookkeeping also schedules a drain when fresh > 0; this is a belt-and-braces
 // backup for the edge case where the boot docket's bookkeeping races or the
 // previous run wrote a deferral line but never scheduled a drain.
 {
  const previous = readSweepDeferral(deps.vaultRoot);
  if (previous && previous.remaining > 0) {
   clerk.scheduleDrain();
  }
 }

 return app;
}

// ── Node.js HTTP adapter ──

async function readBody(
 nodeReq: IncomingMessage,
): Promise<Buffer | null> {
 if (nodeReq.method === 'GET' || nodeReq.method === 'HEAD') return null;
 const chunks: Buffer[] = [];
 for await (const chunk of nodeReq) {
  chunks.push(chunk);
 }
 return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

async function toWebRequest(
 nodeReq: IncomingMessage,
): Promise<Request> {
 const hostRaw = nodeReq.headers.host;
 const host = Array.isArray(hostRaw)
  ? (hostRaw[0] ?? 'localhost')
  : (hostRaw ?? 'localhost');
 const url = `http://${host}${nodeReq.url}`;

 const body = await readBody(nodeReq);

 const headers = new Headers();
 for (const [key, value] of Object.entries(nodeReq.headers)) {
  if (value !== undefined) {
   if (Array.isArray(value)) {
    for (const v of value) headers.append(key, v);
   } else {
    headers.set(key, value);
   }
  }
 }

 return new Request(url, {
  method: nodeReq.method ?? 'GET',
  headers,
  body: body as BodyInit | null,
 });
}

function nodeAdapter(app: Hono) {
 return async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
  try {
   const webReq = await toWebRequest(nodeReq);
   const webRes = await app.fetch(webReq, { remoteAddr: nodeReq.socket?.remoteAddress });

   const resHeaders: Record<string, string> = {};
   webRes.headers.forEach((v, k) => {
    resHeaders[k] = v;
   });
   nodeRes.writeHead(webRes.status, resHeaders);

   if (!webRes.body) {
    nodeRes.end();
    return;
   }
   // Stream the body chunk-by-chunk — arrayBuffer() would drain an
   // endless body (e.g. SSE) to completion and never resolve.
   const reader = webRes.body.getReader();
   const pump = async () => {
    try {
     while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      nodeRes.write(Buffer.from(value));
     }
     nodeRes.end();
    } catch (err) {
     nodeRes.destroy(err as Error);
    }
   };
   void pump();
  } catch (err) {
   if (!nodeRes.headersSent) {
    nodeRes.writeHead(500);
   }
   nodeRes.end(String(err));
  }
 };
}

/** Start the app on the given host:port. Returns the node:http Server. */
export function serveApp(
 app: Hono,
 port: number,
 host?: string,
): Promise<Server> {
 const bindHost = host ?? process.env.ELICIT_HOST ?? '127.0.0.1';
 return new Promise<Server>((resolve) => {
  const server = createServer(nodeAdapter(app));
  server.listen(port, bindHost, () => resolve(server));
 });
}

// ── Standalone entry ──
// Activated only when this file is run directly (not imported).
// tsx sets process.argv[1] to the resolved .ts path.

const isDirect =
 typeof process.argv[1] === 'string' &&
 (process.argv[1].endsWith('/server.ts') ||
  process.argv[1].endsWith('/server.js') ||
  process.argv[1].endsWith('\\server.ts') ||
  process.argv[1].endsWith('\\server.js'));
if (isDirect) {
 // Machine-specific settings (STT model dir, port, vault root, …) live in
 // a `.env` next to the server; real environment variables win over it.
 loadEnvFile();
 const vaultRoot = process.env.ELICIT_VAULT_ROOT ?? './vault';
 const vault = createVault(vaultRoot);

 const llmMode = process.env.ELICIT_LLM ?? 'fake';
 let complete: Complete;
 let clerk: ServerDeps['clerk'];
 /**
  * The embedder for the third clash channel. Real endpoints only: under the
  * fake responder there is nothing to embed with, and a fabricated vector
  * would be cached, which makes it permanent.
  */
 let embed: ServerDeps['embed'];
 /** Elicitor stamp. Undefined under the fake responder — nothing real produced it. */
 let modelName: string | undefined;
 // Two lines the reader can check against the two endpoints (Q-48).
 let roleLines: string[];

 if (llmMode === 'local') {
  const { makeComplete, roleConfig, describeRole } = await import('./llm.js');
  const elicitorCfg = roleConfig('elicitor');
  const clerkCfg = roleConfig('clerk');
  complete = makeComplete('elicitor');
  clerk = {
   complete: makeComplete('clerk'),
   modelName: clerkCfg.modelId,
   harvestComplete: makeComplete('clerk', { responseFormat: CUTS_RESPONSE_FORMAT }),
  };
  modelName = elicitorCfg.modelId;
  embed = localEmbedder();
  roleLines = [describeRole(elicitorCfg), describeRole(clerkCfg)];
 } else {
  // One fake answers both roles. Nothing is stamped with a real model name.
  complete = makeFakeComplete();
  roleLines = ['elicitor: fake', 'clerk: fake'];
 }
 const queueRoot = process.env.ELICIT_QUEUE_DIR ?? vaultRoot;
 const queue = createQueueStore(queueRoot, {
 // The parked-pointer kinds the draw must never serve, each owned by the
 // module that mints it. 'parked-drm' is the legacy source: slice 6
 // migrated drm parks to 'parked-machine', but old pointers in the store
 // must stay undrawable too.
 parkedPointerKinds: [PARKED_SOUNDING_SOURCE, PARKED_MACHINE_SOURCE, PARKED_DRM_SOURCE],
});
 const indexData = vault.rebuildIndex();
 const index = buildIndex(Object.values(indexData.snippets));
 // The semantic resonance channel (Q-17, ticket 068), beside the lexical
 // index: the same corpus, at the same moment. `prime` prunes the cache to
 // the ids it is given, so the corpus MUST be the whole vault — a subset
 // would delete every other snippet's vector on its first pass. Background,
 // like the boot docket: the first sitting is served by the lexical index
 // while the vectors fill, and a clipped run resumes next boot (PRIME_CAP).
 // Under the fake responder there is no embedder, so there is no channel:
 // a fabricated vector would be cached, which makes it permanent.
 const semanticIndex = embed
  ? buildSemanticIndex(Object.values(indexData.snippets), {
   embed: embed.embed,
   model: embed.model,
   store: fileSnippetVectorStore(vaultRoot),
   log: (e) => appendEvent(vaultRoot, e as ActivityEvent),
  })
  : undefined;
 if (semanticIndex) void semanticIndex.prime();
 const authStore = createFileAuth(join(vaultRoot, '.auth.json'));

 const bindHost = process.env.ELICIT_HOST ?? '127.0.0.1';
 const port = parseInt(process.env.ELICIT_PORT ?? '4517', 10);

 // Say where we are BEFORE the boot docket runs: on a populated vault with a
 // slow local model the docket takes minutes, and a silent terminal reads as
 // a hang. The address is knowable now, so print it now.
 console.error(`\n  elicit → http://${bindHost}:${port}`);
 for (const line of roleLines) console.error(`  ${line}`);
 console.error(`  vault: ${vaultRoot} (ELICIT_LLM=${llmMode})`);
 console.error('  starting…\n');

 const app = await createApp({
  vault,
  complete,
  ...(clerk ? { clerk } : {}),
  ...(embed ? { embed } : {}),
  queue,
  index,
  ...(semanticIndex ? { semanticIndex } : {}),
  vaultRoot,
  authStore,
  // Ticket 074: resolved-referent annotations live OUTSIDE the vault,
  // under the project data dir — the reading plane keeps its agent-prose
  // stores in the vault, and the ticket forbids vault writes.
  annotations: createAnnotationStore(join(process.cwd(), 'data', 'annotations')),
  // Ticket 100: the gazetteer entity index lives OUTSIDE the vault for the
  // same reason — entity readings are agent prose about snippets, never
  // the person's words, and the ticket forbids vault writes for annotations.
  gazetteerStore: createGazetteerStore(join(process.cwd(), 'data', 'gazetteer')),
  ...(modelName ? { modelName } : {}),
 });
 await serveApp(app, port);
 console.error(`  ready → http://${bindHost}:${port}`);
 console.error('  the clerk is reading the vault in the background\n');
}
