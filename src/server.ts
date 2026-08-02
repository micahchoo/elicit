import { Hono } from 'hono';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import matter from 'gray-matter';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { createVault } from './vault/vault.js';
import { startSession, userTurn, skipQuestion } from './elicitor/elicitor.js';
import { suggestTargetForVault } from './elicitor/target-default.js';
import { propose, decide, type HarvestDiagnostics } from './harvester/harvester.js';
import { createQueueStore } from './queue/queue.js';
import { buildIndex, resonate } from './index/lexical.js';
import { readCadence, cadenceSentence } from './log/cadence.js';
import { runDocket } from './clerk/docket.js';
import { nextConsolidation, saveSummary, loadSummaries } from './memory/cover.js';
import { composeOpener, composeStillTrue, composeExpedition } from './clerk/composed.js';
import { makeFakeComplete } from './fake-responder.js';
import { appendEvent, readEvents, type ActivityEvent } from './log/activity.js';
import { createSttClient, type SttClient } from './stt/client.js';
import { resolveModelDir } from './stt/model.js';
import { createFileAuth, isLoopback, type AuthStore } from './auth/auth.js';
import { loadProtocolDefinitions, selectProtocolForTarget } from './protocols/registry.js';
import { createRandomizer, type RandomizerDraw } from './randomizer/randomizer.js';
import type {
  Vault,
  Complete,
  Mode,
  SessionState,
  CutProposal,
  HarvestDecision,
  QueueStore,
  LexicalIndex,
  QueueEntry,
  Turn,
  Target,
} from './types.js';
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
  clerk?: { complete: Complete; modelName: string };
  queue: QueueStore;
  index: LexicalIndex;
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

/** Session tokens for password-gated access. Maps token → expiry ms. */
const loginSessions = new Map<string, number>();
const COOKIE_NAME = 'elicit_session';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

function checkSession(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const cookie = c.req.header('cookie') ?? '';
  const match = /elicit_session=([^;]+)/.exec(cookie);
  if (!match) return false;
  const token = match[1]!;
  const expiry = loginSessions.get(token);
  if (!expiry || expiry < Date.now()) {
    loginSessions.delete(token);
    return false;
  }
  return true;
}

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
  kind: string,
  detail: string,
  refs?: string[],
): void {
  appendEvent(root, { at: new Date().toISOString(), actor, kind, detail, ...(refs ? { refs } : {}) });
}

/**
 * The `harvest-proposed` detail line — counts and flags only, never user text.
 * `parsed=false` distinguishes a collapsed extraction from a genuinely thin
 * sitting; before ticket 034 both logged as `proposals=0`.
 */
function harvestDetail(result: {
  proposals: unknown[];
  buds: unknown[];
  diagnostics: HarvestDiagnostics;
}): string {
  const d = result.diagnostics;
  return [
    `proposals=${result.proposals.length}`,
    `buds=${result.buds.length}`,
    `parsed=${d.parsed}`,
    `parseMode=${d.parseMode}`,
    `chunks=${d.chunksParsed}/${d.chunks}`,
    `chunkErrors=${d.chunkErrors}`,
    `rawChars=${d.rawChars}`,
    `fabricationDrops=${d.fabricationDrops}`,
    `sourceTurnCorrections=${d.sourceTurnCorrections}`,
  ].join(' ');
}
// ── Defer: turning a declared need into Mode needs ──

/** The sitting lengths the Mode screen offers. A deferred question asks for the next one up. */
const MINUTE_LADDER = [10, 25, 45];

/** The next sitting length above the current one — capped at the longest the Mode screen offers. */
function moreMinutesThan(minutes: number): number {
  return MINUTE_LADDER.find((m) => m > minutes) ?? MINUTE_LADDER[MINUTE_LADDER.length - 1]!;
}

/** The next energy level above the current one — capped at 'high'. */
function moreEnergyThan(energy: Mode['energy']): Mode['energy'] {
  if (energy === 'low') return 'medium';
  return 'high';
}

/** Scan transcript files for session metadata (used by docket). */
function listSessions(root: string): { session: string; started: string; turnCount: number; chars: number }[] {
  const dir = join(root, 'transcripts');
  if (!existsSync(dir)) return [];
  const results: { session: string; started: string; turnCount: number; chars: number }[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const raw = readFileSync(join(dir, f), 'utf-8');
    const parsed = matter(raw);
    const session = parsed.data.session ?? f.replace('.md', '');
    const data = parsed.data;
    results.push({
      session,
      started: data.started ?? '',
      turnCount: typeof data.turnCount === 'number' ? data.turnCount : 0,
      chars: typeof data.chars === 'number' ? data.chars : 0,
    });
  }
  return results;
}

/** Body text of one session's transcript, without frontmatter. */
function readTranscript(root: string, session: string): string {
  const file = join(root, 'transcripts', `${session}.md`);
  if (!existsSync(file)) return '';
  return matter(readFileSync(file, 'utf-8')).content;
}
// ── Create app ──

export async function createApp(deps: ServerDeps): Promise<Hono> {
  // The index every handler reads. It starts as the one handed in, so a fresh
  // process answers from what the vault already holds, and it is replaced only
  // by a completed DocketReport — the report stays the single index source.
  let currentIndex = deps.index;
  const snippetMap = new Map(Object.values(deps.vault.rebuildIndex().snippets).map((s) => [s.id, s]));

  // Everything with nobody waiting on it goes to the clerk model (Q-48). One
  // Complete serving both roles is the degenerate case, not a fallback:
  // nothing here ever swaps models at runtime, because the stamp would lie.
  const clerkComplete = deps.clerk?.complete ?? deps.complete;
  const clerkModelName = deps.clerk?.modelName ?? deps.modelName;

  // ── The docket, off the response path (ticket 047) ──
  // Opener minting is one LLM call per uncited snippet, so a docket run grows
  // with the vault. No request waits for one: handlers write to the vault,
  // answer, and the index catches up when the run finishes.

  /** True while a run is in flight. Two runs never overlap. */
  let docketRunning = false;
  /** A trigger that arrived mid-run, replayed once the run finishes. */
  let pendingTrigger: string | null = null;

  async function runDocketNow(trigger: string): Promise<void> {
    try {
      const report = await runDocket({
        vault: deps.vault,
        queue: deps.queue,
        complete: clerkComplete,
        buildIndex: (snippets) => buildIndex(snippets),
        composeOpener,
        composeStillTrue,
        composeExpedition,
        listSessions,
        nextConsolidation,
        saveSummary,
        loadSummaries,
        readTranscript,
        // Cover summaries are written by the clerk model, so they say so (Q-34).
        ...(clerkModelName ? { modelName: clerkModelName } : {}),
        log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
        vaultRoot: deps.vaultRoot,
      });
      currentIndex = report.index;
      for (const s of Object.values(deps.vault.rebuildIndex().snippets)) {
        snippetMap.set(s.id, s);
      }
      serverEmit(deps.vaultRoot, 'clerk', 'docket-run', `minted ${report.minted.length}, expired ${report.expired}`);
    } catch (err) {
      // Every write the run was meant to follow is already on disk. Only the
      // index is behind, so keep the one that was standing and say why.
      console.error(`docket (${trigger}) failed — held index unchanged:`, String(err));
      serverEmit(deps.vaultRoot, 'clerk', 'docket-run-failed', `trigger=${trigger} ${String(err)}`);
    } finally {
      docketRunning = false;
      const next = pendingTrigger;
      pendingTrigger = null;
      if (next) startDocket(next);
      deps.onDocketSettled?.();
    }
  }

  /** Start a docket run behind whatever called this. Never throws, never waits. */
  function startDocket(trigger: string): void {
    if (docketRunning) {
      // A second trigger starts nothing — runDocket's own lock would make it a
      // no-op anyway, and that no-op returns an empty index. Remember it
      // instead, so snippets harvested mid-run still reach the index.
      pendingTrigger = trigger;
      console.error(`docket (${trigger}) deferred — a run is already in flight`);
      return;
    }
    docketRunning = true;
    // Next tick, not this one: runDocket reads every snippet file in the vault
    // before its first await, and the response (or the listen call) goes first.
    // The catch is the backstop: nothing here is awaited, so a throw that got
    // past runDocketNow would surface as an unhandled rejection.
    setImmediate(() => {
      runDocketNow(trigger).catch((err: unknown) => {
        console.error(`docket (${trigger}) could not report its own failure:`, String(err));
      });
    });
  }

  const app = new Hono();
  const sessions = new Map<string, SessionState>();
  const sessionProposals = new Map<string, CutProposal[]>();
  /** Sessions whose material arrived unprompted — kept snippets carry that origin. */
  const unpromptedSessions = new Set<string>();
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
    const token = newSessionToken();
    loginSessions.set(token, Date.now() + SESSION_TTL);
    const cookie = `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`;
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
    const token = newSessionToken();
    loginSessions.set(token, Date.now() + SESSION_TTL);
    const cookie = `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie,
      },
    });
  });

  // ── Auth middleware for remaining API routes ──
  app.use('/api/*', async (c, next) => {
    if (!authStore.exists()) {
      // No auth file — check loopback
      const remoteAddr = getRemoteAddr(c.env);
      if (isLoopback(remoteAddr)) return next();
      return c.json({ error: 'setup required' }, 403);
    }
    // Auth file exists — require session
    if (!checkSession(c)) {
      return new Response('Unauthorized', { status: 401 });
    }
    return next();
  });

  // GET /api/target-suggestion → {target, recent, declaredRequired}
  // What the Mode screen should pre-fill when the user has not chosen. The
  // Target still has to be declared (Q-19); this only stops the pre-fill from
  // pointing inward every time.
  app.get('/api/target-suggestion', (c) => {
    const { target, recent } = suggestTargetForVault(deps.vaultRoot);
    return c.json({ target, recent, declaredRequired: true });
  });

  // POST /api/session {mode, shuffle?} → {sessionId, question, target, source?}
  app.post('/api/session', async (c) => {
    const body = await c.req.json<{ mode: Mode; shuffle?: boolean }>();
    const mode = body.mode;
    if (!mode || typeof mode.minutes !== 'number' || !mode.energy) {
      return c.json({ error: 'invalid mode' }, 400);
    }
    // Absent target: fall back to what the corpus asks for, not inward by
    // reflex (Q-19, ticket 042). An explicit target always wins.
    const suggestion = suggestTargetForVault(deps.vaultRoot);
    const target: Target = mode.target ?? suggestion.target;
    const normalized: Mode = { ...mode, target };

    // Protocol selection: load defs, count prior sessions, rotate deterministically
    const protocolDefs = loadProtocolDefinitions();
    const sessionCount = listSessions(deps.vaultRoot).length;
    const selectedProtocol = selectProtocolForTarget(target, sessionCount, protocolDefs);

    // The Randomizer (Q-18). Wrapped so the response can say what was dealt:
    // `startSession` returns a SessionState, and no SessionState carries the
    // provenance of a draw — the transcript keeps the question, this keeps
    // the source. NOTE: no apostrophes in comments here. `tests/emitted-kinds`
    // scans this file for `serverEmit` calls with a string tracker that does
    // not skip comments, so an odd number of them hides every kind below.
    const shuffle = createRandomizer({
      root: deps.vaultRoot,
      vault: deps.vault,
      queue: deps.queue,
    });
    const dealt: { draw: RandomizerDraw | null } = { draw: null };
    const randomizer = (invokedBy: 'user' | 'system'): RandomizerDraw | null => {
      dealt.draw = shuffle(invokedBy);
      return dealt.draw;
    };

    const state = startSession(normalized, {
      complete: deps.complete,
      vault: deps.vault,
      queue: deps.queue,
      index: currentIndex,
      protocolName: selectedProtocol.name,
      randomizer,
      ...(body.shuffle ? { shuffleRequested: true } : {}),
    });
    sessions.set(state.id, state);
    const opener = state.turns[0]!;

    serverEmit(deps.vaultRoot, 'elicitor', 'session-started', `mode=${normalized.minutes}m/${normalized.energy} target=${target} declared=${mode.target !== undefined} protocol=${selectedProtocol.name} shuffle=${body.shuffle === true}`);

    const draw = dealt.draw;
    return c.json({
      sessionId: state.id,
      question: opener.text,
      target,
      ...(draw && draw.question === opener.text ? { source: draw.provenance } : {}),
    });
  });

  // POST /api/session/:id/turn {text} → probe | saturated
  app.post('/api/session/:id/turn', async (c) => {
    const sessionId = c.req.param('id');
    const state = sessions.get(sessionId);
    if (!state) return c.json({ error: 'session not found' }, 404);

    const body = await c.req.json<{ text: string; spoken?: boolean }>();
    if (!body.text || typeof body.text !== 'string') {
      return c.json({ error: 'text is required' }, 400);
    }

    // Detect resonance for juxtaposition info (before userTurn consumes the hit)
    const hits = resonate(currentIndex, body.text);
    let juxtaposition: { snippetText: string; snippetDate: string } | undefined;
    if (hits.length > 0) {
      const hit = hits[0]!;
      const snip = snippetMap.get(hit.snippetId);
      if (snip) {
        juxtaposition = {
          snippetText: snip.prose,
          snippetDate: snip.captured.slice(0, 10),
        };
      }
    }

    const result = await userTurn(state, body.text, body.spoken);

    // Activity event for close phase entry
    if (state.phase === 'closing-door') {
      serverEmit(deps.vaultRoot, 'elicitor', 'close-phase-entered', `session=${sessionId}`);
    }

    if (result.kind === 'saturated') {
      return c.json({ kind: 'saturated' });
    }

    // Activity: question-asked or juxtaposition-offered
    if (juxtaposition) {
      serverEmit(deps.vaultRoot, 'elicitor', 'juxtaposition-offered', `session=${sessionId} snippet=${hits[0]!.snippetId} source=juxtaposition`);
    } else {
      serverEmit(deps.vaultRoot, 'elicitor', 'question-asked', `session=${sessionId} source=${result.provenance}`);
    }

    return c.json({
      kind: 'probe',
      text: result.text,
      questionForm: result.questionForm,
      phase: state.phase,
      ...(juxtaposition ? { juxtaposition } : {}),
    });
  });

  // POST /api/session/:id/skip → question | exhausted
  app.post('/api/session/:id/skip', (c) => {
    const sessionId = c.req.param('id');
    const state = sessions.get(sessionId);
    if (!state) return c.json({ error: 'session not found' }, 404);

    const result = skipQuestion(state);
    return c.json(result);
  });

  // POST /api/session/:id/defer {need?} → question | exhausted
  // The question returns to the Queue with the declared Mode needs. Distinct
  // from skip in the log; like skip, it does not consume budget.
  app.post('/api/session/:id/defer', async (c) => {
    const sessionId = c.req.param('id');
    const state = sessions.get(sessionId);
    if (!state) return c.json({ error: 'session not found' }, 404);

    let need: unknown;
    try {
      need = (await c.req.json<{ need?: unknown }>()).need;
    } catch {
      // No body — deferred with no declared need
    }
    if (need !== undefined && need !== 'time' && need !== 'energy') {
      return c.json({ error: `invalid need "${String(need)}" — expected "time" or "energy"` }, 400);
    }

    const deferred = [...state.turns].reverse().find((t) => t.role === 'agent');
    if (!deferred) return c.json({ error: 'no question to defer' }, 400);

    const modeNeeds: QueueEntry['modeNeeds'] | undefined =
      need === 'time'
        ? { minMinutes: moreMinutesThan(state.mode.minutes) }
        : need === 'energy'
          ? { energy: moreEnergyThan(state.mode.energy) }
          : undefined;

    deps.queue.add({
      source: 'user-declared',
      license: 'user',
      question: deferred.text,
      questionForm: deferred.questionForm ?? 'deliberative',
      sharpness: 'weak',
      horizon: 'session',
      ...(modeNeeds ? { modeNeeds } : {}),
    });

    serverEmit(
      deps.vaultRoot,
      'elicitor',
      'question-deferred',
      `session=${sessionId} needs=${need ?? 'none'}`,
    );

    const result = skipQuestion(state);
    return c.json(result);
  });

  // POST /api/session/:id/end → {proposals, buds}
  app.post('/api/session/:id/end', async (c) => {
    const sessionId = c.req.param('id');
    const state = sessions.get(sessionId);
    if (!state) return c.json({ error: 'session not found' }, 404);

    const result = await propose(sessionId, state.turns, clerkComplete);
    serverEmit(deps.vaultRoot, 'harvester', 'harvest-proposed', harvestDetail(result));
    sessionProposals.set(sessionId, result.proposals);
    return c.json({ proposals: result.proposals, buds: result.buds });
  });

  // POST /api/session/:id/harvest {decisions} → {snippets, buds}
  app.post('/api/session/:id/harvest', async (c) => {
    const sessionId = c.req.param('id');
    const proposals = sessionProposals.get(sessionId);
    if (!proposals) {
      return c.json(
        { error: 'no proposals — call /end first' },
        400,
      );
    }

    const body = await c.req.json<{ decisions: HarvestDecision[] }>();
    if (!Array.isArray(body.decisions)) {
      return c.json({ error: 'decisions must be an array' }, 400);
    }

    // Validate decisions (ticket 024)
    const VALID_ACTIONS = ['approve', 'trim', 'restate', 'discard'] as const;
    for (const d of body.decisions) {
      if (!(VALID_ACTIONS as readonly string[]).includes(d.action)) {
        return c.json(
          { error: `invalid action "${String(d.action)}" in decision`, entry: d },
          400,
        );
      }
      if (typeof d.proposal !== 'number' || d.proposal < 0 || d.proposal >= proposals.length) {
        return c.json(
          { error: `invalid proposal index ${d.proposal} (have ${proposals.length} proposals)`, entry: d },
          400,
        );
      }
    }

    const result = decide(
      sessionId,
      proposals,
      body.decisions,
      deps.vault,
      unpromptedSessions.has(sessionId) ? 'unprompted' : 'harvest',
    );

    serverEmit(deps.vaultRoot, 'harvester', 'session-harvested', `kept=${result.snippets.length} budded=${result.buds.length}`, result.snippets.map((s) => s.id));

    // The snippets are on disk, so the answer is ready. The docket that
    // reindexes them and mints their openers runs behind this response.
    startDocket('harvest');

    return c.json({ snippets: result.snippets, buds: result.buds });
  });

  // POST /api/unprompted {text} → {sessionId, proposals, buds}
  // The user wrote or pasted material with no question asked. It becomes a
  // transcript of one user turn, then takes the ordinary propose→decide path:
  // review the cuts, then POST them to /api/session/:id/harvest.
  app.post('/api/unprompted', async (c) => {
    const body = await c.req.json<{ text: string }>();
    if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
      return c.json({ error: 'text is required' }, 400);
    }
    const text = body.text.trim();

    const sessionId = ulid();
    const at = new Date().toISOString();
    const turn: Turn = { role: 'user', text, at };

    deps.vault.startTranscript(sessionId, {
      mode: { minutes: 0, energy: 'medium', target: 'self' },
      protocol: 'unprompted',
      started: at,
    });
    deps.vault.appendTurn(sessionId, turn);
    unpromptedSessions.add(sessionId);

    // Never log the content — only how much of it there was.
    serverEmit(deps.vaultRoot, 'elicitor', 'unprompted-entry', `session=${sessionId} chars=${text.length}`);

    const result = await propose(sessionId, [turn], clerkComplete);
    serverEmit(deps.vaultRoot, 'harvester', 'harvest-proposed', harvestDetail(result));
    sessionProposals.set(sessionId, result.proposals);

    return c.json({ sessionId, proposals: result.proposals, buds: result.buds });
  });

  // GET /api/queue → {pending, open}
  app.get('/api/queue', (c) => {
    const all = deps.queue.list();
    const pending = all.filter((e) => e.status === 'pending');
    const open = all.filter(
      (e) => e.status === 'pending' && (e.horizon === 'days' || e.horizon === 'session'),
    );
    return c.json({ pending, open });
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

  // GET /api/snippets
  app.get('/api/snippets', (c) => {
    const index = deps.vault.rebuildIndex();
    return c.json({ snippets: Object.values(index.snippets) });
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
    const text = await client.transcribe(samples, sampleRate);
    const duration = Math.round(performance.now() - start);
    const chars = text.length;

    serverEmit(deps.vaultRoot, 'system', 'transcribed', `${duration}ms ${chars}chars`);

    return c.json({ text });
  });

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
  startDocket('boot');

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
  const vaultRoot = process.env.ELICIT_VAULT_ROOT ?? './vault';
  const vault = createVault(vaultRoot);

  const llmMode = process.env.ELICIT_LLM ?? 'fake';
  let complete: Complete;
  let clerk: ServerDeps['clerk'];
  /** Elicitor stamp. Undefined under the fake responder — nothing real produced it. */
  let modelName: string | undefined;
  // Two lines the reader can check against the two endpoints (Q-48).
  let roleLines: string[];

  if (llmMode === 'local') {
    const { makeComplete, roleConfig, describeRole } = await import('./llm.js');
    const elicitorCfg = roleConfig('elicitor');
    const clerkCfg = roleConfig('clerk');
    complete = makeComplete('elicitor');
    clerk = { complete: makeComplete('clerk'), modelName: clerkCfg.modelId };
    modelName = elicitorCfg.modelId;
    roleLines = [describeRole(elicitorCfg), describeRole(clerkCfg)];
  } else {
    // One fake answers both roles. Nothing is stamped with a real model name.
    complete = makeFakeComplete();
    roleLines = ['elicitor: fake', 'clerk: fake'];
  }
  const queueRoot = process.env.ELICIT_QUEUE_DIR ?? vaultRoot;
  const queue = createQueueStore(queueRoot);
  const indexData = vault.rebuildIndex();
  const index = buildIndex(Object.values(indexData.snippets));
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
    queue,
    index,
    vaultRoot,
    authStore,
    ...(modelName ? { modelName } : {}),
  });
  await serveApp(app, port);
  console.error(`  ready → http://${bindHost}:${port}`);
  console.error('  the clerk is reading the vault in the background\n');
}
