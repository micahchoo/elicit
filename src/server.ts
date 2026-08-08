import { Hono, type Context } from 'hono';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { loadEnvFile } from './env.js';
import matter from 'gray-matter';
import { join, extname, basename } from 'node:path';
import { ulid } from 'ulid';
import { createVault } from './vault/vault.js';
import { readAllRepairs } from './repair/store.js';
import { repairedSnippetIds } from './repair/consult.js';

import { suggestTargetForVault } from './elicitor/target-default.js';
import { CUTS_RESPONSE_FORMAT, SYSTEM_PROMPT as HARVEST_SYSTEM_PROMPT } from './harvester/harvester.js';
import { readProfile, writeProfile, personaLine, type Profile } from './profile.js';
import { setMintPersonaLine } from './clerk/mint.js';
import {
 readPendingHarvest,
 listPendingHarvests,
} from './harvester/pending.js';
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
import { proposeArrangements } from './clerk/arrangements.js';
import { buildTerritoryResponse } from './territory.js';
import { createGazetteerStore, type GazetteerStore } from './clerk/gazetteer-store.js';
import { extractEntities, entityId } from './clerk/gazetteer.js';
import { chronological } from './piece/arrange.js';
import { createPieceStore } from './piece/store.js';
import { toMarkdown } from './piece/export.js';
import type { Arrangement, ArrangementEntry, Gap, Piece } from './piece/contract.js';
import type { Authorship, DatingRule, ImportDecision } from './import/contract.js';
import { IMPORT_ACTIONS } from './import/contract.js';
import { createClerk } from './clerk/docket-init.js';
import { PARKED_SOURCE as PARKED_SOUNDING_SOURCE, readLadder } from './sounding/park.js';
import { PARKED_DRM_SOURCE } from './drm/park.js';
import {
 readSweepDeferral,
 readSweepDeferrals,
} from './wiki/store.js';
import { THRESHOLDS } from './wiki/thresholds.js';
import { localEmbedder, type Embed } from './wiki/embedding.js';
import { coreness } from './wiki/status.js';
import { facetHeading, lintNote } from './queue/source-label.js';
import { FACETS } from './queue/facet-balance.js';
import type { Claim, ClaimGraph, LogFn } from './wiki/contract.js';
import { makeFakeComplete } from './fake-responder.js';
import { appendEvent, onAppend, readEvents, type ActivityEvent } from './log/activity.js';
import { streamSSE } from 'hono/streaming';
import type { EventKind } from './log/kinds.js';
import { readTranscripts, readTranscript as readVaultTranscript } from './vault/transcripts.js';
import { surfaced } from './log/surfaced.js';
import { createSttClient, type SttClient } from './stt/client.js';
import { resolveModelDir } from './stt/model.js';
import { createFileAuth, createSessionAuth, isLoopback, type AuthStore } from './auth/auth.js';
import { archiveFreshStart } from './reset/fresh-start.js';
import { loadProtocolDefinitions } from './protocols/registry.js';
import { machinePhaseMeta } from './protocols/machine.js';
import { createSessionRoutes, startBackgroundHarvest, startUnpromptedSitting, type SessionCtx } from './session/routes.js';
import { readMachineState, PARKED_SOURCE as PARKED_MACHINE_SOURCE } from './protocols/park.js';
import { anniversaryDraw } from './randomizer/randomizer.js';
import { datedSnippets, readSittingDates } from './randomizer/strata.js';
import { RANDOMIZER_THRESHOLDS } from './randomizer/thresholds.js';
import { createV2App } from './v2/router.js';
import { sweepTripwire } from './loop/tripwire.js';
import { createCoachStore, readSittingTags, loadCoachFacts } from './coach/store.js';
 import { evaluateOffer, licenseState, clusterClaimsByTheme, type CoachFacts } from './coach/license.js';
import { waitingLines, coachOfferSentence, buildCoachPage } from './coach/page.js';
import { runCoachAdvice } from './coach/advise.js';
import { mintReflections } from './coach/reflection.js';
import type { AdviceNote } from './coach/contract.js';
import type {
 Vault,
 Complete,
 CaptureChannel,
 Facet,
 SessionState,
 CutProposal,
 QueueStore,
 LexicalIndex,
 QueueEntry,
 Snippet,
 Turn,
 Prosody,
} from './types.js';

import {
 appendReachDecline,
 bodyHash,
 classifyDroppedRun,
 compilePattern,
 createImportStore,
 createRegionStore,
 pipelineCommit,
 pipelineReach,
 pipelineScan,
 pipelineSurvey,
 type CommitResult,
 type ScanPipelineResult,
 type Survey,
} from './import/pipeline.js';
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
let pendingProsody: { text: string; prosody: Prosody } | null = null;

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


/** Extract the remote address from the Hono env (injected by the Node adapter). */
function getRemoteAddr(env: unknown): string | undefined {
 if (env && typeof env === 'object' && 'remoteAddr' in env) {
  const v = (env as Record<string, unknown>).remoteAddr;
  return typeof v === 'string' ? v : undefined;
 }
 return undefined;
}

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



/** The channels a client may declare for a turn's arrival (ticket 048). */
const CAPTURE_CHANNELS: readonly CaptureChannel[] = ['typed', 'spoken', 'pasted'];

/** Narrowing guard for a capture channel value sent by the client. */
function isCaptureChannel(v: unknown): v is CaptureChannel {
 return (CAPTURE_CHANNELS as readonly unknown[]).includes(v);
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
 // The vault read owner does the frontmatter parse; turnCount/chars are
 // per-file counters this surface needs that readTranscripts does not model,
 // so only those two are re-read.
 const results: { session: string; started: string; turnCount: number; chars: number }[] = [];
 for (const t of readTranscripts(root)) {
  let turnCount = 0;
  let chars = 0;
  try {
   const d = matter(readFileSync(join(root, 'transcripts', `${t.session}.md`), 'utf-8')).data as Record<string, unknown>;
   turnCount = typeof d.turnCount === 'number' ? d.turnCount : 0;
   chars = typeof d.chars === 'number' ? d.chars : 0;
  } catch {
   // A transcript readTranscripts parsed will parse again; the counters stay 0.
  }
  results.push({ session: t.session, started: t.started, turnCount, chars });
 }
 return results;
}

/** Body text of one session's transcript, without frontmatter. */
function readTranscript(root: string, session: string): string {
 if (readVaultTranscript(root, session) === null) return '';
 return matter(readFileSync(join(root, 'transcripts', `${session}.md`), 'utf-8')).content;
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
// ── Marks for the review surface (T9) ──

/**
 * One region of a source body that preparation dropped, and why — the
 * reader sees *why* a paragraph carries no cuts. `at`/`length` are offsets
 * into the source body, so the surface can mark the words in place.
 */
type DroppedRegion = { at: number; length: number; why: 'quoted' | 'cited' | 'not-prose' };

/**
 * The regions of a source body that preparation dropped. A line survives
 * iff its trailing-whitespace-stripped text is empty (blank lines are
 * separators, never marks) or appears in the prepared prose; consecutive
 * non-surviving lines form one mark. Each run is named by the shared
 * classifier in body.ts — the same vocabulary `clean` deletes by.
 */
function droppedRegions(body: string, prepared: string): DroppedRegion[] {
 const preparedLines = new Set(prepared.split('\n').map((l) => l.trimEnd()));
 const survives = (line: string): boolean => {
  const t = line.trimEnd();
  return t === '' || preparedLines.has(t);
 };
 const marks: DroppedRegion[] = [];
 let runStart = -1;
 let runEnd = 0;
 let at = 0;
 const mark = (): DroppedRegion => ({
  at: runStart,
  length: runEnd - runStart,
  why: classifyDroppedRun(body.slice(runStart, runEnd).split('\n')),
 });
 for (const line of body.split('\n')) {
  if (survives(line)) {
   if (runStart !== -1) marks.push(mark());
   runStart = -1;
  } else if (runStart === -1) {
   runStart = at;
   runEnd = at + line.length;
  } else {
   runEnd = at + line.length;
  }
  at += line.length + 1;
 }
 if (runStart !== -1) marks.push(mark());
 return marks;
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
 const sessions = new Map<string, SessionState>();
/**
 * The offer in flight per sitting (plan Task 8): the licensing answer that
 * earned it and the construct it named. Same lifetime class as `sessions` —
 * the plan leaves this carrier unnamed; it carries the construct as well so
 * the consent route can enter the descent with the same word the offer used,
 * even if more turns landed between the offer and the answer.
 */
 const soundingOffers = new Map<string, { text: string; construct: string }>();
 const sessionProposals = new Map<string, CutProposal[]>();
 /** Sessions whose material arrived unprompted — kept snippets carry that origin. */
 const unpromptedSessions = new Set<string>();
 /**
  * The capture channel for each unprompted session — no SessionState exists
  * for those, so the channel rides here until harvest reads it (ticket 048).
  */
 const unpromptedChannels = new Map<string, CaptureChannel | undefined>();
 const { authStore } = deps;

 // ── Setup-required gate for non-API routes (must precede static serving) ──
 app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next();
  if (!authStore.exists()) {
   const remoteAddr = getRemoteAddr(c.env);
   if (!isLoopback(remoteAddr)) {
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
  const remoteAddr = getRemoteAddr(c.env);
  if (!isLoopback(remoteAddr)) {
   return c.json({ error: 'setup must be done from the host machine' }, 403);
  }
  const body = await c.req.json<{ password: string }>();
  if (!body.password || typeof body.password !== 'string' || body.password.length < 1) {
   return c.json({ error: 'password required' }, 400);
  }
  authStore.setup(body.password);
  const { cookie } = sessionAuth.issue();
  return new Response(JSON.stringify({ ok: true }), {
   status: 200,
   headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': cookie,
   },
  });
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
  return new Response(JSON.stringify({ ok: true }), {
   status: 200,
   headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': cookie,
   },
  });
 });

 // ── Auth middleware for remaining API routes ──
 app.use('/api/*', sessionAuth.middleware({
  authFileExists: () => authStore.exists(),
  remoteAddr: getRemoteAddr,
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
  const remoteAddr = getRemoteAddr(c.env);
  if (!isLoopback(remoteAddr)) {
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
const sessionCtx: SessionCtx = {
 sessions,
 soundingOffers,
 sessionProposals,
 unpromptedSessions,
 unpromptedChannels,
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
};
createSessionRoutes(app, sessionCtx);

// GET /api/anniversary — the on-this-day card for the Waiting Surface (ticket 107).
// Returns a draw when a snippet's wroteAt month+day matches today; null otherwise.

// An offer under Q-62: the surface requests it, the user declines with one tap.
app.get('/api/anniversary', (c) => {
  const now = new Date();
  const snips = datedSnippets(
    deps.vault.rebuildIndex(),
    readSittingDates(deps.vaultRoot),
    now,
    RANDOMIZER_THRESHOLDS,
  );
  const result = anniversaryDraw(snips, Math.random, now);
  if (!result) {
    serverEmit(deps.vaultRoot, 'elicitor', 'anniversary-evaluated', 'candidates=0');
    return c.json(null);
  }
  serverEmit(deps.vaultRoot, 'elicitor', 'anniversary-drawn', `snippet=${result.ref}`);
  return c.json(result.draw);
});


 // GET /api/harvest-queue → {pending} (ticket 084)
 // The review surface: every finished harvest awaiting a decision, newest
 // first. Offer-only — deciding still happens through POST /harvest.
 app.get('/api/harvest-queue', (c) => {
  const pending = listPendingHarvests(deps.vaultRoot).map((r) => ({
   sessionId: r.sessionId,
   at: r.at,
   started: r.started,
   protocol: r.protocol,
   origin: r.origin,
   proposalCount: r.proposals.length,
  }));
  return c.json({ pending });
 });

 // GET /api/harvest-queue/:sessionId → the full pending record (ticket 084)
 // The id is a plain token, gated before any file read so a crafted id
 // cannot walk out of the pending directory.
 app.get('/api/harvest-queue/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
   return c.json({ error: 'not found' }, 404);
  }
  const record = readPendingHarvest(deps.vaultRoot, sessionId);
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json(record);
 });

 // POST /api/unprompted {text} → harvesting (ticket 084)
 // The user wrote or pasted material with no question asked. It becomes a
 // transcript of one user turn, then harvests behind this response; the
 // review cards for its cuts land in the pending queue.
 app.post('/api/unprompted', async (c) => {
  const body = await c.req.json<{ text: string; channel?: CaptureChannel }>();
  if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
   return c.json({ error: 'text is required' }, 400);
  }
  if (body.channel !== undefined && !isCaptureChannel(body.channel)) {
   return c.json({ error: `invalid channel "${String(body.channel)}"` }, 400);
  }
  const text = body.text.trim();

  const sessionId = ulid();
  const { at, turn } = startUnpromptedSitting(sessionCtx, {
   sessionId,
   text,
   protocol: 'unprompted',
  });
  unpromptedSessions.add(sessionId);
  unpromptedChannels.set(sessionId, body.channel);

  // Never log the content — only how much of it there was.
  serverEmit(deps.vaultRoot, 'elicitor', 'unprompted-entry', `session=${sessionId} chars=${text.length}`);

  startBackgroundHarvest(sessionCtx, {
   sessionId,
   turns: [turn],
   protocol: 'unprompted',
   started: at,
   origin: 'unprompted',
   ...(body.channel !== undefined ? { unpromptedChannel: body.channel } : {}),
  });
  return c.json({ status: 'harvesting', sessionId });
 });

 // GET /api/sweep-backlog → { pendingReadings, freshReadings, sittings } (ticket 139, 156)
 // The waiting surface reads this to show "the wiki is N readings behind"
 // and which sittings wait. Cheap: reads the sweep deferral ledger and the
 // claim store's swept set.
 app.get('/api/sweep-backlog', (c) => {
  const previous = readSweepDeferral(deps.vaultRoot);
  const { pending, fresh } = clerk.sweepWorkRemaining();
  return c.json({
   pendingReadings: pending,
   freshReadings: fresh,
   lastRecorded: previous?.remaining ?? 0,
   at: previous?.at ?? null,
   sittings: sittingsFromLedger(readSweepDeferrals(deps.vaultRoot)),
  });
 });

 /**
  * The deferral ledger, grouped by calendar day (ticket 156). Each line is
  * one sitting that left sweep work; the day key is the ISO timestamp's date
  * portion — the same `YYYY-MM-DD` shard the Activity Log shards on — and the
  * readings sum the lines of that day. Most recent day first.
  */
 function sittingsFromLedger(lines: { at: string; remaining: number }[]): { date: string; readings: number }[] {
  const byDay = new Map<string, number>();
  for (const line of lines) {
   const day = line.at.slice(0, 10);
   byDay.set(day, (byDay.get(day) ?? 0) + line.remaining);
  }
  return [...byDay.entries()]
   .map(([date, readings]) => ({ date, readings }))
   .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
 }

 // GET /api/events → SSE liveness feed (ticket 150). Every Activity Log
 // append (Q-23 — the one audit spine every actor writes through) is
 // pushed as one event, so open screens refresh instead of waiting for a
 /**
 * The SSE wire event: kind+at+detail only, never payloads (the
 * harvest-detail contract). A named helper so the serialization's
 * `kind: e.kind` never reads as an activity-log emit to the
 * emitted-kinds sweep — this is a wire projection, not an event.
 */
const ssePayload = (e: ActivityEvent): string => {
 return JSON.stringify({ kind: e.kind, at: e.at, detail: e.detail });
};

// manual reload. Read-only; carries kind+at, never payloads — a screen
 // refetches through its own routes. Q-22 intact: this reaches only a
 // browser tab the person already has open; nothing walks out.
 app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
   let open = true;
   const off = onAppend(deps.vaultRoot, (e) => {
    if (!open) return;
    // `detail` rides along for the client's no-change dedupe: an idle docket
    // cycle re-emits byte-identical detail strings ("minted 0 openers",
    // "swept=0 applied=0 …"), and a repeated identical event is by
    // definition a heartbeat. Details are counts/ids only, never user text
    // (the harvest-detail contract), and the same client can already read
    // the full log through GET /api/activity — nothing new is exposed.
    stream
     .writeSSE({ data: ssePayload(e) })
     .catch(() => { open = false; });
   });
   stream.onAbort(() => { open = false; off(); });
   // Keep-alive comments hold proxies and browsers on the line.
   // (env-tunable so tests are not held hostage by a 25s sleep)
   const keepalive = Number(process.env.ELICIT_SSE_KEEPALIVE_MS ?? 25_000);
   while (open) {
    await stream.sleep(keepalive);
    try {
     await stream.writeSSE({ event: 'ping', data: '' });
    } catch {
     open = false;
    }
   }
   off();
  }),
 );

 // ── The four T9 routes: scan a folder, hand the next piece to read, take
 // decisions on it, or take the reason for refusing it whole. No fifth route
 // writes without a review behind it. The folder path is read from the
 // request and off local disk by design (Q-57), so the /api/* auth lock is
 // the control — there is no traversal check to write.

 // POST /api/import/scan {folder, region?} → {pending, skipped, adopted, refused}
 // The folder becomes staging records, and nothing else: extraction runs in
 // the docket behind this response (T6) and the corpus is written only by a
 // review decision. When a `region` slug is present, the region's declared
 // dating rule drives the scan and its slug bounds the admission (014 T12);
 // absent, this behaves exactly as 058 built it — the 19 adopted posts and
 // any plain folder scan stay reachable.
 app.post('/api/import/scan', async (c) => {
  const body = await c.req.json<{ folder?: string; region?: string }>();
  const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
  if (folder.length === 0) {
   return c.json({ error: 'folder is required' }, 400);
  }
  const regionSlug = typeof body.region === 'string' ? body.region.trim() : '';
  const regionRecord = regionSlug.length === 0 ? null : regionStore.get(regionSlug);
  if (regionSlug.length > 0 && regionRecord === null) {
   return c.json({ error: `unknown region ${regionSlug}` }, 400);
  }
  // The pipeline owns the sequence — adoption FIRST and with this folder
  // (T8), then the region's rule dates the scan (Anchor, 014 T3), then
  // admit. A bad folder path throws — answer 400 with what it said.
  let result: ScanPipelineResult;
  try {
   result = pipelineScan({
    store: importStore,
    vaultRoot: deps.vaultRoot,
    folder,
    region: regionRecord,
    log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
   });
  } catch (err) {
   return c.json({ error: String(err) }, 400);
  }
  clerk.startDocket('import');
  const { adopted, scanned, admitted } = result;
  return c.json({
   pending: admitted.added.length,
   skipped: admitted.skipped.length,
   adopted: adopted.accepted + adopted.excluded,
   refused: [...scanned.refused, ...admitted.refused].map((r) => ({ file: basename(r.sourcePath), reason: r.reason })),
  });
 });

 // GET /api/import/next → the oldest extracted piece, whole, or `waiting`.
 // Registered for GET and POST: the web client's api() helper POSTs any path
 // outside its GET_PREFIXES list and the review surface calls through it.
 // Read-only under both methods — nothing here reads a body or writes.
 const importNext = async (c: Context): Promise<Response> => {
  // The bounded queue (014 T6/T12): `?region=` keeps the review inside the
  // region the person chose. Absent, the route behaves exactly as 058 built
  // it — the 19 adopted posts, which carry no region, stay reachable.
  const region = c.req.query('region') ?? undefined;
  const record = importStore.nextExtracted(region);
  if (record === null) {
   return c.json({ item: null, waiting: 'no pieces are ready to read yet' });
  }
  // Re-read the source and re-hash: a file that changed since extraction
  // would show cuts that cannot commit — the new body is a NEW item
  // (Q-59), so the review answers waiting instead of showing a ghost.
  let body: string;
  try {
   body = matter(readFileSync(record.sourcePath, 'utf-8')).content;
  } catch {
   return c.json({ item: null, waiting: 'a piece changed on disk since it was read — scan the folder again' });
  }
  if (bodyHash(body) !== record.hash) {
   return c.json({ item: null, waiting: 'a piece changed on disk since it was read — scan the folder again' });
  }
  // The piece renders whole, with the regions preparation dropped marked
  // and named, so the reader sees why a paragraph carries no cuts.
  return c.json({
   item: {
    hash: record.hash,
    file: basename(record.sourcePath),
    ...(record.title !== undefined ? { title: record.title } : {}),
    date: record.date,
    source: body,
    cuts: record.cuts ?? [],
    marks: droppedRegions(body, importStore.prepared(record.hash)),
    remaining: Math.max(0, importStore.list('extracted', region).length - 1),
   },
  });
 };
 app.get('/api/import/next', importNext);
 app.post('/api/import/next', importNext);

 // POST /api/import/:hash/decisions {decisions} → {sessionId, snippets}
 // One decision per proposed cut, validated like the harvest route's
 // (ticket 024). Everything else is the commit gate: a stale or
 // unverifiable item is refused whole and nothing is written.
 app.post('/api/import/:hash/decisions', async (c) => {
  const hash = c.req.param('hash');
  const body = await c.req.json<{ decisions?: ImportDecision[] }>();
  if (!Array.isArray(body.decisions)) {
   return c.json({ error: 'decisions must be an array' }, 400);
  }
  const record = importStore.get(hash);
  if (record === null) return c.json({ error: 'not found' }, 404);
  if (record.status !== 'extracted') {
   return c.json({ error: 'this piece has not been extracted yet', reason: 'not-extracted' }, 409);
  }
  const cuts = record.cuts ?? [];
  for (const d of body.decisions) {
   if (!(IMPORT_ACTIONS as readonly string[]).includes(d.action)) {
    return c.json(
     { error: `invalid action "${String(d.action)}" in decision`, entry: d },
     400,
    );
   }
   if (typeof d.cut !== 'number' || !Number.isInteger(d.cut) || d.cut < 0 || d.cut >= cuts.length) {
    return c.json(
     { error: `invalid cut index ${String(d.cut)} (have ${cuts.length} cuts)`, entry: d },
     400,
    );
   }
  }
  // The pipeline owns the sequence — the commit, and only on a CLEAN
  // commit the repair pass over the snippets just written (014 T10),
  // never before.
  const result = pipelineCommit(
   {
    vault: deps.vault,
    store: importStore,
    queue: deps.queue,
    vaultRoot: deps.vaultRoot,
    readSource: (p) => readFileSync(p, 'utf-8'),
    log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    // The authorship seam (014 T9): the region's declared authorship is
    // stamped on every snippet of the sitting. It was inert until this line.
    regionFor: (p) => regionStore.regionFor(p),
   },
   hash,
   body.decisions,
  );
  if (result.ok) {
   return c.json({ sessionId: result.sessionId, snippets: result.snippets });
  }
  return c.json({ error: result.detail, reason: result.reason }, 409);
 });

 // POST /api/import/:hash/exclude {reason} → {ok: true}
 // Refuse the piece whole. The reason lives on the record (Q-51), never in
 // the log line — the log names the file and the act, not the words.
 app.post('/api/import/:hash/exclude', async (c) => {
  const hash = c.req.param('hash');
  const body = await c.req.json<{ reason?: string }>();
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length === 0) {
   return c.json({ error: 'reason is required' }, 400);
  }
  const record = importStore.get(hash);
  if (record === null) return c.json({ error: 'not found' }, 404);
  if (record.status !== 'extracted') {
   return c.json({ error: 'this piece has not been extracted yet', reason: 'not-extracted' }, 409);
  }
  importStore.put({ ...record, status: 'excluded', excludeReason: reason }, importStore.prepared(hash));
  serverEmit(deps.vaultRoot, 'elicitor', 'import-excluded', 'path=' + record.sourcePath);
  return c.json({ ok: true });
 });

 // ── Seeding routes (014 T12) ──

 // GET/POST /api/import/survey?folder=… → { survey }
 // The coarse, model-free map of a folder: per-node counts of files /
 // harvested / refused / unread, computed from the import store, snapshotted
 // to vault/imports/survey.json (a rebuildable cache — Q-3 — the one file in
 // imports/ that may be deleted without loss).
 // Registered for GET and POST: the web client's api() helper POSTs any path
 // outside its read list, and the survey map (014 T13) calls through it.
 // Read-only under both methods — nothing here reads a body or writes corpus.
 const importSurvey = async (c: Context): Promise<Response> => {
  const folder = c.req.query('folder') ?? '';
  if (folder.length === 0) {
   return c.json({ error: 'folder is required' }, 400);
  }
  let survey: Survey;
  try {
   survey = pipelineSurvey({
    store: importStore,
    vaultRoot: deps.vaultRoot,
    folder,
    // A pure read computes the map and keeps nothing (129): under /v2 the
    // snapshot is written by act {v:'survey'}, which is why that verb exists.
    snapshot: !isPureRead(c),
   });
  } catch (err) {
   return c.json({ error: String(err) }, 400);
  }
  return c.json({ survey });
 };
 app.get('/api/import/survey', importSurvey);
 app.post('/api/import/survey', importSurvey);

 // POST /api/import/region {root, dating, authorship} → {slug}
 // The ONLY writer of a region record, and it validates before it writes
 // (Q-67): a pattern that cannot produce a day is 400 and nothing is written
 // — a region that cannot date anything must not exist — and an authorship
 // outside the three declared values is 400 with no server-side default, a
 // default being a silent assertion about who wrote the person's notes.
 app.post('/api/import/region', async (c) => {
  const body = await c.req.json<{ root?: string; dating?: unknown; authorship?: unknown }>();
  const root = typeof body.root === 'string' ? body.root.trim() : '';
  if (root.length === 0) {
   return c.json({ error: 'root is required' }, 400);
  }
  const d = body.dating as { kind?: unknown; key?: unknown; pattern?: unknown } | null | undefined;
  if (d === null || typeof d !== 'object' || (d.kind !== 'frontmatter' && d.kind !== 'filename')) {
   return c.json({ error: 'dating must be a frontmatter or filename rule' }, 400);
  }
  const dating: DatingRule =
   d.kind === 'filename'
    ? { kind: 'filename', pattern: typeof d.pattern === 'string' ? d.pattern : '' }
    : { kind: 'frontmatter', key: typeof d.key === 'string' ? d.key : '' };
  if (dating.kind === 'filename' && compilePattern(dating.pattern) === null) {
   return c.json({ error: 'the pattern cannot produce a day' }, 400);
  }
  if (dating.kind === 'frontmatter' && dating.key.length === 0) {
   return c.json({ error: 'a frontmatter rule needs a key' }, 400);
  }
  const AUTHORS: readonly Authorship[] = ['authored', 'other', 'machine-assisted'];
  if (typeof body.authorship !== 'string' || !(AUTHORS as readonly string[]).includes(body.authorship)) {
   return c.json({ error: 'authorship must be one of authored, other, machine-assisted' }, 400);
  }
  const record = regionStore.declare({
   root,
   dating,
   authorship: body.authorship as Authorship,
  });
  return c.json({ slug: record.slug });
 });

 // GET /api/reach → { offer: ReachOffer | null, root: string | null }
 // Read-only and cheap: reads the survey snapshot and the pending queue,
 // never the folder — a route that re-walked 5,000 files on every waiting-
 // surface render is a route the person would feel. Offer-only (Q-62):
 // silence does nothing, and every evaluation is logged. `root` is the
 // survey root the offer's path is relative to — the waiting surface needs
 // it to open the map AT the offered region (014 T14); null when never
 // surveyed.
 app.get('/api/reach', (c) => {
  // A pure read offers and records nothing (129) — same rule as the coach
  // offer: the evaluation record belongs to the server clock, not to a read.
  const log: LogFn = isPureRead(c) ? () => {} : (e) => appendEvent(deps.vaultRoot, e as ActivityEvent);
  // The pipeline owns the meeting — the survey snapshot and the live
  // pending queue become exactly one offer (Q-62), never the folder.
  const { offer, root } = pipelineReach({ vaultRoot: deps.vaultRoot, queue: deps.queue, log });
  return c.json({ offer, root });
 });

 // POST /api/reach/decline {path} → {ok: true}
 // One click, one recorded decline: the region falls behind every region not
 // declined more recently (Q-22 — recorded signal, never escalated; the
 // offer never asks why and never chases).
 app.post('/api/reach/decline', async (c) => {
  const body = await c.req.json<{ path?: string }>();
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  if (path.length === 0) {
   return c.json({ error: 'path is required' }, 400);
  }
  appendReachDecline(deps.vaultRoot, path);
  return c.json({ ok: true });
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
 const entry = deps.queue.list().find((e) => e.id === id);
 if (!entry) return c.json({ error: 'no open question with that id' }, 404);
 const body = await c.req.json<{ text?: unknown; channel?: unknown }>().catch(() => null);
 if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
  return c.json({ error: 'text is required' }, 400);
 }
 if (body.channel !== undefined && !isCaptureChannel(body.channel)) {
  return c.json({ error: `invalid channel "${String(body.channel)}"` }, 400);
 }
 const text = body.text.trim();
 const channel = isCaptureChannel(body.channel) ? body.channel : undefined;
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
 const entry = deps.queue.list().find((e) => e.id === id);
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
 const entry = deps.queue.list().find((e) => e.id === id);
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
  const events = readEvents(deps.vaultRoot, since);

  // Return JSON if client doesn't accept text/event-stream
  const accept = c.req.header('accept') ?? '';
  if (!accept.includes('text/event-stream')) {
   return c.json({ events });
  }

  // SSE stream
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
   start(controller) {
    // Send past events
    for (const ev of events) {
     if (closed) return;
     controller.enqueue(
      encoder.encode(`event: activity\ndata: ${JSON.stringify(ev)}\n\n`),
     );
    }
    // Send initial heartbeat
    controller.enqueue(encoder.encode(': heartbeat\n\n'));

    // Poll for new events every 2 seconds
    let lastAt = events.length > 0 ? events[events.length - 1]!.at : (since ?? new Date(0).toISOString());
    const interval = setInterval(() => {
     if (closed) {
      clearInterval(interval);
      return;
     }
     const newEvents = readEvents(deps.vaultRoot, lastAt);
     for (const ev of newEvents) {
      if (ev.at > lastAt) {
       controller.enqueue(
        encoder.encode(`event: activity\ndata: ${JSON.stringify(ev)}\n\n`),
       );
       lastAt = ev.at;
      }
     }
    }, 2000);

    // Clean up on close
    const cleanup = () => {
     closed = true;
     clearInterval(interval);
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

// ── The wiki, as a page (Q-21, Q-23, Q-25) ──
 //
 // The GET route below is a READ route. The POST verbs beneath it are the
 // user's (the read-log records a reading; attest and the claim edit are
 // user verbs, Q-33) and the agent's (challenge asks a question). The edit
 // is the ONE route that rewrites a claim's body, and it is a user verb:
 // the op vocabulary has no word for it, and the validator rejects the one
 // UPDATE that tries (Q-29's shapes are the guard, not this comment).
 //
 // The shaping happens HERE, not in the client. Two tickets stand behind that
 // rule: 038 closed because the activity stream leaked identifiers onto a
 // surface a person reads, and 063 found 26 event kinds arriving as two
 // context-free words. A route that hands over raw enums and trusts the
 // renderer is the same mistake with a network hop in the middle. So facets
 // arrive as headings, lint findings arrive as notes, and the claims arrive in
 // the order they are meant to be read.

 /** A claim in the default reading: not archived, not superseded (Q-29). */
 const isLive = (cl: Claim): boolean => cl.archived !== true && cl.supersededBy === undefined;

 // GET /api/wiki[?all=1] → the wiki grouped by facet and ordered for reading
 app.get('/api/wiki', (c) => {
  // Nothing is deleted — an archived or superseded claim is simply not the
  // default reading. `?all=1` is how a reader asks for the whole record.
  const all = c.req.query('all') === '1';
  const contents = deps.vault.rebuildIndex();
  const graph: ClaimGraph = {
   ...clerk.claimStore.loadSlice(),
   snippets: contents.snippets,
   readings: contents.readings,
  };

  // Repair consultation (ticket 137): the claim ids whose cites include a
  // repaired snippet, so the wiki surface can mark them. Computed over the
  // WHOLE graph — a repaired cite taints the claim whether or not the page
  // shows it. The empty set is omitted from the response, never null.
  const allRepairs = readAllRepairs(deps.vaultRoot);
  const repairedIds = repairedSnippetIds(allRepairs);
  const repairClaimIds = new Set<string>();
  if (repairedIds.size > 0) {
   for (const claim of graph.claims) {
    for (const cite of claim.cites) {
     if (repairedIds.has(cite.split('@')[0]!)) {
      repairClaimIds.add(claim.id);
      break;
     }
    }
   }
  }

  // Coreness over the WHOLE graph, archived claims included, and computed
  // once per claim rather than once per comparison. Scoring the whole graph
  // is also what keeps the order a reader sees from moving when `?all=1`
  // widens the page: a claim's neighbourhood does not shrink because the page
  // stopped showing part of it. The number is computed on demand and stored
  // nowhere (Q-21) — this route is its one caller.
  const score = new Map(graph.claims.map((cl) => [cl.id, coreness(cl.id, graph)]));

  const byFacet = new Map<Facet, Claim[]>();
  for (const cl of graph.claims) {
   if (!all && !isLive(cl)) continue;
   const group = byFacet.get(cl.facet);
   if (group) group.push(cl);
   else byFacet.set(cl.facet, [cl]);
  }

  // `FACETS` order, so two readings of one vault are the same page. An empty
  // facet is omitted: a heading over nothing is chrome, and the document rule
  // has no room for it. Ties break on id, because `coreness` is a
  // neighbourhood measure and a whole component scores alike.
  const facets = FACETS.filter((f) => byFacet.has(f)).map((f) => ({
   facet: f,
   heading: facetHeading(f),
   claims: (byFacet.get(f) ?? []).sort(
    (a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1),
   ),
  }));

  // A dissolved Contradiction is not material any more, so it is not part of
  // the default reading either. It is still on disk, and `?all=1` shows it.
  const contradictions = graph.contradictions.filter((x) => all || x.status === 'open');

  // Lint arrives as a note and nothing else. `LintFinding.detail` names claim
  // ids and `snippetId@version` cites, and `kind` is a slug — the route drops
  // both rather than trusting a renderer not to print them (tickets 038, 063).
  const hidden = new Set(graph.claims.filter((cl) => !isLive(cl)).map((cl) => cl.id));
  const lintNotes = (clerk.lastLint?.findings ?? [])
   .filter((f) => all || !hidden.has(f.subject))
   .map((f) => ({ kind: f.kind, subject: f.subject, note: lintNote(f.kind) }));

  // Usage stamps (015): every claim this page serves is surfaced, with the
  // snippets its citations render. One line per claim; ?all=1 serves the
  // whole record and stamps it too. The /api/snippets pool is display
  // support, not display, and never stamps.
  // A pure read stamps nothing (129): under /v2 the stamp is an explicit
  // act {v:'read'} per claim, which is what the dwell observer maps to.
  if (!isPureRead(c)) {
   for (const facet of facets) {
    for (const cl of facet.claims) {
     surfaced(deps.vaultRoot, [cl.id, ...cl.cites], 'wiki');
    }
   }
  }

  return c.json({
   facets,
   contradictions,
   lint: lintNotes,
   ...(repairClaimIds.size > 0 ? { repairClaimIds: [...repairClaimIds] } : {}),
   // Null means the Clerk has not read the wiki yet in this process, which
   // is a different thing from having read it and found nothing.
   lintedAt: clerk.lastLint?.at ?? null,
   all,
  });
 });

 // POST /api/wiki/claim/:id/read {surface?} → records that the claim was read
 //
 // Q-21's looping-effect instrument, and the ONE write on this surface. It is
 // how the system can later tell that a snippet was volunteered AFTER the user
 // read the claim it supports, which is evidence about the evidence and not a
 // judgement about the person.
 app.post('/api/wiki/claim/:id/read', async (c) => {
  const id = c.req.param('id');
  // Checked before the body is read: `recordRead` throws on a missing claim,
  // and a 404 is the honest answer to a surface that asked about one.
  if (!clerk.claimStore.readClaim(id)) return c.json({ error: 'claim not found' }, 404);

  let surface = 'wiki';
  try {
   const body = await c.req.json<{ surface?: unknown }>();
   if (typeof body.surface === 'string' && body.surface.trim() !== '') {
    surface = body.surface.trim();
   }
  } catch {
   // No body, or not JSON. The wiki is the only surface that reads claims
   // today, so the default is the answer rather than an error.
  }

  clerk.claimStore.recordRead(id, new Date().toISOString(), surface);
  return c.json({ ok: true });
 });

 // POST /api/wiki/claim/:id/attest — the user's verb on a claim (Q-33)
 //
 // Sets the one flag only a user verb may set. `status` is not touched here:
 // it is recomputed mechanically from the graph (Q-29), and the recompute
 // maps the flag on its next pass.
 app.post('/api/wiki/claim/:id/attest', async (c) => {
  const id = c.req.param('id');
  const claim = clerk.claimStore.attest(id);
  if (!claim) return c.json({ error: 'unknown claim' }, 404);
  return c.json({ ok: true });
 });

 // POST /api/wiki/claim/:id/edit — the user's correcting verb (Q-33's family)
 //
 // The ONE route that rewrites a claim's body, and it is a user verb: no
 // ClerkOp may reach it. The claim's words become the person's, marked
 // attested (the same state family as attest), and those words are captured
 // VERBATIM as a Snippet the claim then cites (CONTEXT — Propagation): the
 // claim stays falsifiable, and the agent may question it, never rewrite it.
 // The text is trimmed once — the harvest path's trim for user prose — and
 // nothing else is normalized.
 app.post('/api/wiki/claim/:id/edit', async (c) => {
  const id = c.req.param('id');
  if (!clerk.claimStore.readClaim(id)) return c.json({ error: 'unknown claim' }, 404);

  let body: unknown;
  try {
   body = (await c.req.json<{ body?: unknown }>()).body;
  } catch {
   return c.json({ error: 'claim body is required' }, 400);
  }
  if (typeof body !== 'string' || body.trim().length === 0) {
   return c.json({ error: 'claim body is required' }, 400);
  }

  const text = body.trim();
  const s = deps.vault.saveSnippet(text, {
   kind: 'unprompted',
   session: '',
   question: '',
   questionForm: 'deliberative',
  });
  const updated = clerk.claimStore.edit(id, text, `${s.id}@${s.version}`);
  if (!updated) return c.json({ error: 'unknown claim' }, 404);
  return c.json({ ok: true });
 });

 // POST /api/wiki/claim/:id/challenge — a question, never a verdict
 //
 // The agent may ask, never decide (README): a challenge enqueues a question
 // and leaves the claim untouched — no status change, no body edit, nothing.
 app.post('/api/wiki/claim/:id/challenge', async (c) => {
  const id = c.req.param('id');
  const claim = clerk.claimStore.readClaim(id);
  if (!claim) return c.json({ error: 'unknown claim' }, 404);
  deps.queue.add(openQuestionEntry({
   source: 'claim-challenged',
   license: 'user',
   question: `You read "${claim.body}" and it did not sit right — what would you say instead?`,
   questionForm: 'deliberative',
  }));
   return c.json({ ok: true });
 });
 
 // POST /api/wiki/claim/:id/direction — Q-110 door 2: make a Direction from a
 // wiki claim. Creates an un-coached DirectionRecord whose name is the claim's
 // body. Accepting a coach offer later remains the only act that makes it
 // coached (Q-73). Idempotent on name — a second claim with the same body
 // returns the existing record.
 app.post('/api/wiki/claim/:id/direction', async (c) => {
   const id = c.req.param('id');
   const claim = clerk.claimStore.readClaim(id);
   if (!claim) return c.json({ error: 'unknown claim' }, 404);
   const direction = coachStore.createUncoached(claim.body);
   serverEmit(deps.vaultRoot, 'elicitor', 'direction-created',
     `slug=${direction.slug} via=wiki-claim claim=${id}`);
   return c.json({ direction });
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

 // ── The piece routes (T6): compose, gap, set down, export ──
 //
 // Pass 1's verbs, behind the auth gate. Two invariants carry the slice:
 // writing prose in a Piece creates a composition Snippet (Q-40), and
 // inserting a Gap mints exactly ONE queued question (Q-39) — unless the
 // Piece is set down, in which case the Gap is inserted and nothing is
 // minted (Q-41). The enriched piece below is the surface T7 renders and
 // T8 drives; every mutating route returns it directly, unwrapped.

 /** The sitting `started` of one session, or null when no transcript exists (Q-59). */
 const startedOfSession = (session: string): string | null =>
  listSessions(deps.vaultRoot).find((s) => s.session === session)?.started ?? null;

 /** One entry as the surface sees it: pins carry pinned prose and a sitting date; gaps carry their offers. */
 function enrichEntry(entry: ArrangementEntry, snippets: Record<string, Snippet>): unknown {
  if (entry.kind === 'pin') {
   return {
    ...entry,
    prose: readVersion(deps.vaultRoot, entry.snippet, entry.version),
    sittingDate: startedOfSession(snippets[entry.snippet]?.provenance.session ?? ''),
   };
  }
  return {
   ...entry,
   question: entry.question ?? null,
   pending: entry.pending ?? null,
   // The exact join T1 threaded: every Snippet whose provenance names THIS
   // gap's id. No scoring, no ranking — the client never searches (Q-39).
   offers: Object.values(snippets).filter((s) => s.provenance.gap === entry.id),
  };
 }

 function enrichArrangement(a: Arrangement): unknown {
  const snippets = deps.vault.rebuildIndex().snippets;
  return {
   id: a.id,
   principle: a.principle,
   created: a.created,
   model: a.model ?? null,
   entries: a.entries.map((e) => enrichEntry(e, snippets)),
   marginalia: a.marginalia.map((m) => ({ ...m, model: m.model ?? null })),
  };
 }

 /** setDownAt/setDownBy are null in JSON when absent — never a missing key. */
 function enrichPiece(p: Piece): unknown {
  return {
   id: p.id,
   created: p.created,
   current: p.current,
   setDownAt: p.setDownAt ?? null,
   setDownBy: p.setDownBy ?? null,
   arrangements: p.arrangements.map(enrichArrangement),
  };
 }

 /** The index to insert at: after the named entry, or the end. -1 when the anchor is unknown. */
 const insertionIndex = (entries: ArrangementEntry[], after?: string): number => {
  if (after === undefined) return entries.length;
  const at = entries.findIndex((e) => e.id === after);
  return at === -1 ? -1 : at + 1;
 };

 // POST /api/piece { snippets: string[] } — the pass-1 start: every chosen
 // snippet pinned in sitting order (chronological, Q-59).
 app.post('/api/piece', async (c) => {
  const body = await c.req.json<{ snippets: string[] }>();
  if (!Array.isArray(body.snippets)) return c.json({ error: 'snippets are required' }, 400);
  const snippets = deps.vault.rebuildIndex().snippets;
  const chosen = body.snippets
   .map((id) => snippets[id])
   .filter((s): s is Snippet => s !== undefined);
  if (chosen.length !== body.snippets.length) {
   return c.json({ error: 'unknown snippet id' }, 400);
  }
  const pins = chronological(chosen, startedOfSession);
  const piece = pieces.create(pins);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-started', `snippets=${pins.length}`);
  return c.json(enrichPiece(piece));
 });

 // GET /api/pieces — every piece with its current arrangement, for the chooser.
 app.get('/api/pieces', (c) => {
  const list = pieces.list().map((p) => {
   const current = p.arrangements.find((a) => a.id === p.current) ?? p.arrangements[0];
   return {
    id: p.id,
    created: p.created,
    current: p.current,
    setDownAt: p.setDownAt ?? null,
    setDownBy: p.setDownBy ?? null,
    arrangement: current === undefined ? null : enrichArrangement(current),
   };
  });
  return c.json({ pieces: list });
 });

 // GET /api/piece/:id — one piece: entries in order, each pin resolved to
 // its PINNED version's prose and its sitting date, plus Marginalia.
 app.get('/api/piece/:id', (c) => {
  const piece = pieces.get(c.req.param('id'));
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  return c.json(enrichPiece(piece));
 });

 // POST /api/piece/:id/reorder — a permutation of the on-disk entry ids, or
 // 400: a reorder that adds or drops is not a reorder.
 app.post('/api/piece/:id/reorder', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; entries: string[] }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
  if (!Array.isArray(body.entries)) return c.json({ error: 'entries are required' }, 400);
  const onDisk = a.entries.map((e) => e.id).sort();
  const proposed = [...body.entries].sort();
  if (onDisk.length !== proposed.length || onDisk.some((id, i) => id !== proposed[i])) {
   return c.json({ error: "reorder must be a permutation of the arrangement's entries" }, 400);
  }
  const byId = new Map(a.entries.map((e) => [e.id, e]));
  const entries = body.entries.map((id) => byId.get(id)!);
  const updated = pieces.putArrangement(pieceId, { ...a, entries });
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/remove — the arrangement without one entry. A removed
 // gap's question is LEFT in the Queue to expire on the normal rule (Q-41):
 // there is no retract verb anywhere in this design and this slice does not
 // invent one.
 app.post('/api/piece/:id/remove', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; entry: string }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
  if (!a.entries.some((e) => e.id === body.entry)) {
   return c.json({ error: 'no such entry' }, 400);
  }
  const updated = pieces.putArrangement(pieceId, {
   ...a,
   entries: a.entries.filter((e) => e.id !== body.entry),
  });
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/prose — the Q-40 path. The person's words become a
 // composition Snippet in their own sitting (Q-50), pinned at v1. No model,
 // no proposal, no substring check — one paragraph in, one Snippet out.
 app.post('/api/piece/:id/prose', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; text: string; after?: string }>();
  if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
   return c.json({ error: 'text is required' }, 400);
  }
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
  const at = insertionIndex(a.entries, body.after);
  if (at === -1) return c.json({ error: 'no such entry' }, 400);

  const text = body.text.trim();
  const sessionId = ulid();
  // A composition act is its own sitting (Q-50): its cites are independent
  // of the sittings that produced the paragraphs around it.
  startUnpromptedSitting(sessionCtx, {
   sessionId,
   text,
   protocol: 'composition',
  });
  // `question` is the empty string exactly as the unprompted path uses it:
  // nothing asked for these words. NO reading is written — the known hole
  // ticket 081 tracks.
  const s = deps.vault.saveSnippet(text, {
   kind: 'composition',
   session: sessionId,
   question: '',
   questionForm: 'deliberative',
   piece: pieceId,
  });

  const pin: ArrangementEntry = { id: ulid(), kind: 'pin', snippet: s.id, version: 1 };
  const entries: ArrangementEntry[] = [
   ...a.entries.slice(0, at),
   pin,
   ...a.entries.slice(at),
  ];
  const updated = pieces.putArrangement(pieceId, { ...a, entries });

  // Never log the text — only how much of it there was.
  serverEmit(deps.vaultRoot, 'clerk', 'piece-prose-kept', `piece=${pieceId} chars=${text.length}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/gap — the Q-39 path. `gap` is a client-minted ULID
 // and the route is idempotent on it: a retried POST mints nothing.
 app.post('/api/piece/:id/gap', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; gap: string; after?: string; question?: string }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
  if (typeof body.gap !== 'string' || body.gap.length === 0) {
   return c.json({ error: 'gap id is required' }, 400);
  }
  // Idempotency FIRST: the same request arriving twice is the same gap —
  // mint nothing, insert nothing, return the Piece unchanged (200).
  if (a.entries.some((e) => e.id === body.gap)) {
   return c.json(enrichPiece(piece));
  }
  const at = insertionIndex(a.entries, body.after);
  if (at === -1) return c.json({ error: 'no such entry' }, 400);

  const gapEntry: Gap = { id: body.gap, kind: 'gap' };
  let entries: ArrangementEntry[];
  if (piece.setDownAt !== undefined) {
   // Set down: the Gap exists, the Arrangement is editable, and nothing is
   // minted (Q-41).
   entries = [...a.entries.slice(0, at), gapEntry, ...a.entries.slice(at)];
   const updated = pieces.putArrangement(pieceId, { ...a, entries });
   serverEmit(deps.vaultRoot, 'clerk', 'gap-inserted', `piece=${pieceId} gap=${body.gap}`);
   return c.json(enrichPiece(updated));
  }
  if (!body.question || typeof body.question !== 'string' || body.question.trim().length === 0) {
   return c.json({ error: 'question is required' }, 400);
  }
  const question = body.question.trim();
  // Exactly ONE QueueEntry — the only mint path in this slice. No target,
  // no topic, no targetFacet: absent is not a guess (Q-60). The person's
  // own words, so the composed-question quote gate does not apply (Q-12).
  const entry = deps.queue.add({
   ...openQuestionEntry({ source: 'gap-declared', license: 'arrangement-gap', question, questionForm: 'deliberative' }),
   gap: body.gap,
  });
  const minted: Gap = { id: body.gap, kind: 'gap', question: entry.id };
  entries = [...a.entries.slice(0, at), minted, ...a.entries.slice(at)];
  const updated = pieces.putArrangement(pieceId, { ...a, entries });
  serverEmit(deps.vaultRoot, 'clerk', 'gap-inserted', `piece=${pieceId} gap=${body.gap}`);
  serverEmit(deps.vaultRoot, 'clerk', 'gap-question-minted', `chars=${question.length}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/gap/accept — how a Gap clears (Q-39). The body names
 // a snippet; the route verifies that snippet's provenance names THIS gap
 // (the link the person's own answer created) and rewrites the Arrangement
 // with a Pin in the gap's position. Never auto-placed: nothing places
 // without this POST, and the POST is the person's.
 app.post('/api/piece/:id/gap/accept', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; gap: string; snippet: string; version: number }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
  const at = a.entries.findIndex((e) => e.id === body.gap);
  if (at === -1) return c.json({ error: 'no such gap' }, 400);
  if (a.entries[at]!.kind !== 'gap') return c.json({ error: 'not a gap' }, 400);

  const snippet = deps.vault.rebuildIndex().snippets[body.snippet];
  if (!snippet) return c.json({ error: 'unknown snippet' }, 400);
  // The route can only complete a link the person's own answer created.
  if (snippet.provenance.gap !== body.gap) {
   return c.json({ error: 'snippet did not answer this gap' }, 400);
  }
  if (readVersion(deps.vaultRoot, body.snippet, body.version) === null) {
   return c.json({ error: 'version does not resolve' }, 400);
  }

  const pin: ArrangementEntry = { id: ulid(), kind: 'pin', snippet: body.snippet, version: body.version };
  const entries: ArrangementEntry[] = [...a.entries.slice(0, at), pin, ...a.entries.slice(at + 1)];
  const updated = pieces.putArrangement(pieceId, { ...a, entries });
  // The gap's queue entry is already answered by the sitting that produced
  // this snippet — nothing here touches the Queue.
  serverEmit(deps.vaultRoot, 'clerk', 'gap-cleared', `piece=${pieceId} gap=${body.gap} snippet=${body.snippet} version=${body.version}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/set-down and /pick-up — one verb and its undo (Q-41).
 app.post('/api/piece/:id/set-down', (c) => {
  const pieceId = c.req.param('id');
  if (!pieces.get(pieceId)) return c.json({ error: 'piece not found' }, 404);
  const updated = pieces.setDown(pieceId, 'user');
  serverEmit(deps.vaultRoot, 'clerk', 'piece-set-down', `piece=${pieceId}`);
  return c.json(enrichPiece(updated));
 });

 app.post('/api/piece/:id/pick-up', (c) => {
  const pieceId = c.req.param('id');
  if (!pieces.get(pieceId)) return c.json({ error: 'piece not found' }, 404);
  const updated = pieces.pickUp(pieceId);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-picked-up', `piece=${pieceId}`);
  return c.json(enrichPiece(updated));
 });

 // GET /api/piece/:id/export — the person's sentences, in order, and
 // nothing else (Q-1). Pins resolve through readVersion, so a stale pin
 // exports the OLD words on purpose (Q-5); an unresolvable pin fails the
 // export rather than silently missing a paragraph.
 app.get('/api/piece/:id/export', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const current = piece.arrangements.find((a) => a.id === piece.current) ?? piece.arrangements[0];
  if (!current) return c.json({ error: 'piece has no arrangement' }, 404);
  const markdown = toMarkdown(current, (snippet, version) =>
   readVersion(deps.vaultRoot, snippet, version),
  );
  const pins = current.entries.filter((e) => e.kind === 'pin').length;
  serverEmit(deps.vaultRoot, 'clerk', 'piece-exported', `paragraphs=${pins}`);
  return new Response(markdown, {
   status: 200,
   headers: {
    'Content-Type': 'text/markdown',
    'Content-Disposition': `attachment; filename="piece-${pieceId}.md"`,
   },
  });
 });

// ── The candidate arrangements (T12): one margin word, and a choice ──
//
// Two routes close pass 2's loop. POST /arrangements asks the clerk model
// for other orders of the SAME pins (Q-38, Q-48) and puts every survivor
// on disk; zero survivors is a valid outcome and the person keeps the
// chronology they already had. POST /choose makes one candidate current
// and, unless the piece is set down (Q-41), mints one queue question per
// model-marked gap that does not already carry one. Proposing mints
// nothing: the minting IS the choosing (Q-39).

// POST /api/piece/:id/arrangements — the acceptance-time generation
// (Q-38). Slow by design; the waiting surface says so before the request
// goes out.
app.post('/api/piece/:id/arrangements', async (c) => {
 const pieceId = c.req.param('id');
 const piece = pieces.get(pieceId);
 if (!piece) return c.json({ error: 'piece not found' }, 404);
 const base = piece.arrangements.find((a) => a.id === piece.current);
 if (!base) return c.json({ error: 'piece has no arrangement' }, 404);
 const snippets = deps.vault.rebuildIndex().snippets;
 // Q-56: the bound comes from the register — piece.gapsPerCandidate
 // (010 T10) — and arrives through this parameter; the register is the
 // single source of the number, and the route passes its value.
 const gapsCap = THRESHOLDS['piece.gapsPerCandidate'].value;
 const { candidates } = await proposeArrangements(
  base,
  snippets,
  clerkComplete,
  { gapsPerCandidate: typeof gapsCap === 'number' ? gapsCap : 3 },
  (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
  clerkModelName,
 );
 // The module already logged arrangements-proposed and arrangement-rejected
 // through the sink; nothing more is emitted here.
 for (const candidate of candidates) {
  pieces.addArrangement(pieceId, candidate);
 }
 return c.json(enrichPiece(pieces.get(pieceId) ?? piece));
});

// POST /api/piece/:id/choose { arrangement } — the person takes a
// candidate: it becomes current, and the model-marked gaps it carries are
// minted, one question each (Q-39), unless the piece is set down (Q-41).
// The other candidates stay on disk; nothing is deleted (Q-38).
app.post('/api/piece/:id/choose', async (c) => {
 const pieceId = c.req.param('id');
 const piece = pieces.get(pieceId);
 if (!piece) return c.json({ error: 'piece not found' }, 404);
 const body = await c.req.json<{ arrangement: string }>();
 const chosen = piece.arrangements.find((a) => a.id === body.arrangement);
 if (!chosen) return c.json({ error: 'unknown arrangement' }, 400);
 // setCurrent FIRST: the arrangement must exist on disk, and setCurrent
 // throws otherwise. A set-down piece may still be re-read this way; only
 // the minting is suppressed (Q-41).
 const setDown = piece.setDownAt !== undefined;
 try {
  pieces.setCurrent(pieceId, chosen.id);
 } catch {
  return c.json({ error: 'unknown arrangement' }, 400);
 }
 serverEmit(deps.vaultRoot, 'clerk', 'arrangement-chosen', `principle=${chosen.principle}`);
 if (!setDown) {
  // Model-marked gaps without a question id mint EXACTLY ONE queue entry
  // each. The question text is the model's composition, already verified
  // to quote an adjacent snippet (T11), so the weight is ordinary: the
  // person did not declare it (isUserDeclaredWeight is false).
  const toMint = chosen.entries.filter(
   (e): e is Gap & { pending: string } =>
    e.kind === 'gap' && e.pending !== undefined && e.question === undefined,
  );
  if (toMint.length > 0) {
   let next = chosen;
   for (const gap of toMint) {
    const entry = deps.queue.add({
     ...openQuestionEntry({ source: 'gap-fill', license: 'arrangement-gap', question: gap.pending, questionForm: 'deliberative' }),
     gap: gap.id,
    });
    next = {
     ...next,
     entries: next.entries.map((e) =>
      e.kind === 'gap' && e.id === gap.id ? { ...e, question: entry.id } : e,
     ),
    };
    serverEmit(deps.vaultRoot, 'clerk', 'gap-question-minted', `chars=${gap.pending.length}`);
   }
   // Write the question ids back onto the chosen arrangement. The guards
   // pass: the pin set is unchanged and the gap gains a declared field.
   pieces.putArrangement(pieceId, next);
  }
 }
 return c.json(enrichPiece(pieces.get(pieceId) ?? piece));
});

// ── Coach (ticket 090) ──
// Coached state and the waiting offer. Nothing here acts on its own
// judgment: the person declares, un-coaches and declines (Q-73, Q-43); the
// offer is one dimmed line evaluated on every waiting read and logged on
// every call (Q-62). Every coach record is markdown under vault/coach/ and
// every decision is recomputed from disk (Q-3).
const coachStore = createCoachStore(deps.vaultRoot);

/** One CoachFacts snapshot — the coach slice owns its read-model now. */
function buildCoachFacts(): CoachFacts {
 const snippets = Object.values(deps.vault.rebuildIndex().snippets);
 const snippetSessions = new Map<string, string>();
 for (const s of snippets) snippetSessions.set(s.id, s.provenance.session);
 return loadCoachFacts({
  vaultRoot: deps.vaultRoot,
  coach: coachStore,
  snippets,
  claims: clerk.claimStore.loadSlice().claims,
  queueEntries: deps.queue.list(),
  sessions: snippetSessions,
 });
}

// POST /api/coach/direction { name } — the ONLY door (Q-73): accepting the
// offer calls this same route. The person's declaration, nothing else.
app.post('/api/coach/direction', async (c) => {
 const body = await c.req.json<{ name?: unknown }>();
 if (typeof body?.name !== 'string' || body.name.trim().length === 0) {
  return c.json({ error: 'name is required' }, 400);
 }
 const direction = coachStore.declareCoached(body.name.trim());
 serverEmit(deps.vaultRoot, 'elicitor', 'direction-coached', `slug=${direction.slug}`);
 return c.json({ direction });
});

// POST /api/coach/direction/:slug/uncoach — the lens off, archives nothing (Q-73).
app.post('/api/coach/direction/:slug/uncoach', (c) => {
 const slug = c.req.param('slug');
 const record = coachStore.uncoach(slug);
 if (!record) return c.json({ error: 'unknown direction' }, 404);
 serverEmit(deps.vaultRoot, 'elicitor', 'direction-uncoached', `slug=${slug}`);
 return c.json({ ok: true });
});

// POST /api/coach/direction/:slug/decline-offer — recorded, never re-asked (Q-43, Q-77).
app.post('/api/coach/direction/:slug/decline-offer', (c) => {
 const slug = c.req.param('slug');
 coachStore.recordOfferDeclined(slug);
 serverEmit(deps.vaultRoot, 'elicitor', 'coach-offer-declined', `slug=${slug}`);
 return c.json({ ok: true });
});

// GET /api/coach/waiting — the live offer evaluation (Q-62): every call is
// logged, offered=null on the empty corpus (090's data note), and silence
// renders nothing.
app.get('/api/coach/waiting', (c) => {
 // A pure read evaluates the offer and records nothing (129): the server
 // logs offer evaluations on its own clock, never on a reader arriving.
 const pure = isPureRead(c);
 const facts = buildCoachFacts();
 const evaluation = evaluateOffer(facts, pure ? () => {} : (e) => appendEvent(deps.vaultRoot, e as ActivityEvent));
 const offered = evaluation.offered;
 if (!pure) serverEmit(
  deps.vaultRoot,
  'elicitor',
  'coach-offer',
  `directions=${evaluation.evaluated.length} qualified=${evaluation.qualified.length} offered=${offered ? offered.slug : 'none'}`,
 );
 return c.json({
  offer: offered ? { slug: offered.slug, name: offered.name, sentence: coachOfferSentence(offered) } : null,
  lines: waitingLines(facts),
 });
});

// The one fire-and-forget advice attempt, shared by /read, /return and
// /artifact (T10): licenseState recomputed from disk, then the mint. The
// mint failing is a log line, never a 5xx — the request already succeeded.
function refreshAdviceInBackground(slug: string): void {
 setImmediate(() => {
  let facts: CoachFacts;
  try {
   facts = buildCoachFacts();
  } catch {
   serverEmit(deps.vaultRoot, 'elicitor', 'advice-withheld', 'reason=call-failed');
   return;
  }
  const licensed = licenseState(facts, slug);
  if (!licensed) return;
  runCoachAdvice({ store: coachStore, facts, complete: clerkComplete, slug, license: licensed.event })
   .then((outcome) => {
    if (outcome.outcome === 'minted') {
     serverEmit(
      deps.vaultRoot,
      'elicitor',
      'advice-minted',
      `license=${outcome.note.license} options=${outcome.note.options.length} replaced=${outcome.replaced}`,
     );
    } else {
     serverEmit(deps.vaultRoot, 'elicitor', 'advice-withheld', `reason=${outcome.reason}`);
    }
   })
   .catch(() => serverEmit(deps.vaultRoot, 'elicitor', 'advice-withheld', 'reason=call-failed'));
 });
}

// GET /api/coach/:slug — the page, read-only. Reading a page is not an
// agent act: no side effects, no log write. 404 when the lens is off (Q-73).
app.get('/api/coach/:slug', (c) => {
 const slug = c.req.param('slug');
 const facts = buildCoachFacts();
 const page = buildCoachPage(facts, facts.snippets, slug);
 if (!page) return c.json({ error: 'unknown direction' }, 404);
 return c.json(page);
});

// POST /api/coach/:slug/read — the read is an act: mark the note read,
// stamp the visit, then let page-opened license a fresh mint in the
// background (Q-77's cap holds structurally — one unread note, replaced).
app.post('/api/coach/:slug/read', (c) => {
 const slug = c.req.param('slug');
 const direction = coachStore.getDirection(slug);
 if (!direction || !direction.coached) return c.json({ error: 'unknown direction' }, 404);
 // The visit stamp must be strictly later than every prior record on the
 // Direction, or a same-millisecond declare→read would make `lastVisit >
 // coachedAt` compare equal and page-opened would never license (Q-77
 // compares recorded event times, and ms precision is the clock's).
 const prior = [direction.coachedAt, direction.lastVisit].filter((s): s is string => s !== undefined);
 const latest = prior.length > 0 ? prior.reduce((a, b) => (a > b ? a : b)) : '';
 let now = new Date().toISOString();
 if (latest !== '' && now <= latest) now = new Date(Date.parse(latest) + 1).toISOString();
 coachStore.markAdviceRead(slug, now);
 coachStore.recordVisit(slug, now);
 serverEmit(deps.vaultRoot, 'elicitor', 'coach-page-read', `slug=${slug}`);
 refreshAdviceInBackground(slug);
 return c.json({ ok: true });
});

// POST /api/coach/:slug/adopt { optionId } — adoption MINTS the quest
// (Q-74). An option id from a replaced note is 404: nothing mints from an
// evaporated option.
app.post('/api/coach/:slug/adopt', async (c) => {
 const slug = c.req.param('slug');
 const note = coachStore.readAdvice(slug);
 const body = await c.req.json<{ optionId?: unknown }>();
 const optionId = typeof body?.optionId === 'string' ? body.optionId : '';
 const option = note?.options.find((o) => o.id === optionId);
 if (!option) return c.json({ error: 'option not found' }, 404);
 const quest = coachStore.adoptQuest({ direction: slug, act: option.text, cites: option.cites });
 serverEmit(deps.vaultRoot, 'elicitor', 'quest-adopted', `slug=${slug} quest=${quest.id}`);
 return c.json({ quest });
});

// POST /api/coach/:slug/decline-option { optionId } — recorded text,
// never re-offered (Q-77).
app.post('/api/coach/:slug/decline-option', async (c) => {
 const slug = c.req.param('slug');
 const note = coachStore.readAdvice(slug);
 const body = await c.req.json<{ optionId?: unknown }>();
 const optionId = typeof body?.optionId === 'string' ? body.optionId : '';
 const option = note?.options.find((o) => o.id === optionId);
 if (!option) return c.json({ error: 'option not found' }, 404);
 coachStore.addDeclinedOption(slug, option.text);
 serverEmit(deps.vaultRoot, 'elicitor', 'coach-option-declined', `slug=${slug}`);
 return c.json({ ok: true });
});

// POST /api/coach/quest/:id/return { text, channel? } — ORDINARY CAPTURE
// (Q-75): the unprompted template with the quest/direction tag on the
// transcript (T4's caller), protocol 'quest-return', then the reflection
// mint (T6) and the same background advice attempt.
app.post('/api/coach/quest/:id/return', async (c) => {
 const quest = coachStore.getQuest(c.req.param('id'));
 if (!quest) return c.json({ error: 'unknown quest' }, 404);
 const body = await c.req.json<{ text?: unknown; channel?: unknown }>();
 if (typeof body?.text !== 'string' || body.text.trim().length === 0) {
  return c.json({ error: 'text is required' }, 400);
 }
 if (body.channel !== undefined && !isCaptureChannel(body.channel)) {
  return c.json({ error: `invalid channel "${String(body.channel)}"` }, 400);
 }
 const text = body.text.trim();
 const sessionId = ulid();
 const { at, turn } = startUnpromptedSitting(sessionCtx, {
  sessionId,
  text,
  protocol: 'quest-return',
  transcript: { quest: quest.id, direction: quest.direction },
 });
 unpromptedSessions.add(sessionId);
 unpromptedChannels.set(sessionId, body.channel);

 // Length, never content (Q-23: the JSONL is the audit trail).
 serverEmit(deps.vaultRoot, 'elicitor', 'quest-returned', `quest=${quest.id} session=${sessionId} chars=${text.length}`);

 startBackgroundHarvest(sessionCtx, {
  sessionId,
  turns: [turn],
  protocol: 'quest-return',
  started: at,
  origin: 'unprompted',
  ...(body.channel !== undefined ? { unpromptedChannel: body.channel } : {}),
 });

 const reflections = mintReflections({
  queue: deps.queue,
  quest,
  session: sessionId,
  returnText: text,
  log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
 });
 if (reflections.minted.length > 0) {
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'reflection-minted',
   `minted=${reflections.minted.length} clipped=${reflections.clipped}`,
  );
 }
 refreshAdviceInBackground(quest.direction);
 return c.json({ status: 'harvesting', sessionId, reflections: reflections.minted.length });
});

// POST /api/coach/quest/:id/retire — the person's verb, no confirmation,
// no reason (Q-75).
app.post('/api/coach/quest/:id/retire', (c) => {
 const quest = coachStore.retireQuest(c.req.param('id'));
 if (!quest) return c.json({ error: 'unknown quest' }, 404);
 serverEmit(deps.vaultRoot, 'elicitor', 'quest-retired', `quest=${quest.id}`);
 return c.json({ ok: true });
});

// POST /api/coach/:slug/artifact { pointer, name, sentence } — a pointer
// plus the person's own sentence (Q-78). The pointer is lineage-plane and
// NEVER opened; the sentence goes through the ordinary capture path. The
// POINTER never enters a detail line — the Activity JSONL is surfaced.
app.post('/api/coach/:slug/artifact', async (c) => {
 const slug = c.req.param('slug');
 const direction = coachStore.getDirection(slug);
 if (!direction || !direction.coached) return c.json({ error: 'unknown direction' }, 404);
 const body = await c.req.json<{ pointer?: unknown; name?: unknown; sentence?: unknown }>();
 if (
  typeof body?.pointer !== 'string' ||
  body.pointer.trim() === '' ||
  typeof body?.name !== 'string' ||
  body.name.trim() === '' ||
  typeof body?.sentence !== 'string' ||
  body.sentence.trim() === ''
 ) {
  return c.json({ error: 'pointer, name and sentence are required' }, 400);
 }
 const pointer = body.pointer.trim();
 const name = body.name.trim();
 const sentence = body.sentence.trim();

 const sessionId = ulid();
 const { at, turn } = startUnpromptedSitting(sessionCtx, {
  sessionId,
  text: sentence,
  protocol: 'artifact',
  transcript: { direction: slug },
 });
 unpromptedSessions.add(sessionId);
 unpromptedChannels.set(sessionId, undefined);
 startBackgroundHarvest(sessionCtx, {
  sessionId,
  turns: [turn],
  protocol: 'artifact',
  started: at,
  origin: 'unprompted',
 });
 // The declaration stamp must be strictly later than the licence baseline
 // (advice mintedAt, else coachedAt), or a same-millisecond declare→artifact
 // compares equal in licenseState's `>` and the background mint silently
 // skips — the same clock-precision seam /read guards against.
 const baseline = [direction.coachedAt, coachStore.readAdvice(slug)?.mintedAt].filter((s): s is string => s !== undefined);
 const latest = baseline.length > 0 ? baseline.reduce((a, b) => (a > b ? a : b)) : '';
 let declaredAt = new Date().toISOString();
 if (latest !== '' && declaredAt <= latest) declaredAt = new Date(Date.parse(latest) + 1).toISOString();
 coachStore.declareArtifact({ direction: slug, pointer, name, sentenceSession: sessionId, declaredAt });
 serverEmit(deps.vaultRoot, 'elicitor', 'artifact-declared', `direction=${slug} named=true`);
 refreshAdviceInBackground(slug);
 return c.json({ status: 'harvesting', sessionId });
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
