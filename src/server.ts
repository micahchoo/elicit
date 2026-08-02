import { Hono } from 'hono';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import matter from 'gray-matter';
import { join, extname } from 'node:path';
import { timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { createVault } from './vault/vault.js';
import { startSession, userTurn, skipQuestion } from './elicitor/elicitor.js';
import { propose, decide } from './harvester/harvester.js';
import { createQueueStore } from './queue/queue.js';
import { buildIndex, resonate } from './index/lexical.js';
import { runDocket } from './clerk/docket.js';
import { composeOpener, composeStillTrue } from './clerk/composed.js';
import { appendEvent, readEvents, type ActivityEvent } from './log/activity.js';
import type {
  Vault,
  Complete,
  Mode,
  SessionState,
  Snippet,
  CutProposal,
  HarvestDecision,
  QueueStore,
  LexicalIndex,
  QueueEntry,
} from './types.js';

// ── Types ──

export interface ServerDeps {
  vault: Vault;
  complete: Complete;
  queue: QueueStore;
  index: LexicalIndex;
  vaultRoot: string;
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

const ENV_PASSWORD = process.env.ELICIT_PASSWORD ?? null;

// ── Password gate ──

/** Session tokens for password-gated access. Maps token → expiry ms. */
const loginSessions = new Map<string, number>();
const COOKIE_NAME = 'elicit_session';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Hash a password for constant-time comparison. */
function hashPassword(pw: string): Buffer {
  return createHash('sha256').update(pw).digest();
}

function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

function requireAuth(c: { req: { header: (n: string) => string | undefined }; json: (b: unknown, s: number) => Response }): boolean {
  const pw = ENV_PASSWORD;
  if (!pw) return true; // no password set → open access
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
    const started = parsed.data.started ?? '';
    let turnCount = 0;
    let chars = 0;
    for (const line of (parsed.content ?? '').split('\n')) {
      if (line.startsWith('## user') || line.startsWith('## agent')) turnCount++;
      chars += line.length;
    }
    results.push({ session, started, turnCount, chars });
  }
  return results;
}

// ── Create app ──

export async function createApp(deps: ServerDeps): Promise<Hono> {
  // Boot: run docket to mint openers and build a fresh index
  let currentIndex = deps.index;
  const snippetMap = new Map(Object.values(deps.vault.rebuildIndex().snippets).map((s) => [s.id, s]));

  const bootReport = await runDocket({
    vault: deps.vault,
    queue: deps.queue,
    complete: deps.complete,
    buildIndex: (snippets) => buildIndex(snippets),
    composeOpener,
    composeStillTrue,
    listSessions,
    log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    vaultRoot: deps.vaultRoot,
  });
  currentIndex = bootReport.index;
  // Update snippet map with any new snippets
  for (const s of Object.values(deps.vault.rebuildIndex().snippets)) {
    snippetMap.set(s.id, s);
  }

  serverEmit(deps.vaultRoot, 'clerk', 'docket-run', `minted ${bootReport.minted.length}, expired ${bootReport.expired}`);

  const app = new Hono();
  const sessions = new Map<string, SessionState>();
  const sessionProposals = new Map<string, CutProposal[]>();

  // ── Auth middleware for all API routes ──
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/login') return next();
    if (!requireAuth(c)) {
      return new Response('Unauthorized', { status: 401 });
    }
    return next();
  });

  // POST /api/login {password} → {ok: true} + session cookie
  app.post('/api/login', async (c) => {
    const body = await c.req.json<{ password: string }>();
    if (!body.password) {
      return c.json({ error: 'password required' }, 400);
    }
    const pw = ENV_PASSWORD;
    if (!pw) return c.json({ ok: true });
    const got = hashPassword(body.password);
    const want = hashPassword(pw);
    if (got.length !== want.length) {
      return c.json({ error: 'invalid password' }, 401);
    }
    if (!timingSafeEqual(got, want)) {
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

  // POST /api/session {mode} → {sessionId, question}
  app.post('/api/session', async (c) => {
    const body = await c.req.json<{ mode: Mode }>();
    const mode = body.mode;
    if (!mode || typeof mode.minutes !== 'number' || !mode.energy) {
      return c.json({ error: 'invalid mode' }, 400);
    }
    // Normalize absent target to 'self'
    const normalized: Mode = { ...mode, target: mode.target ?? 'self' };
    const state = startSession(normalized, {
      complete: deps.complete,
      vault: deps.vault,
      queue: deps.queue,
      index: currentIndex,
    });
    sessions.set(state.id, state);
    const opener = state.turns[0]!;

    serverEmit(deps.vaultRoot, 'elicitor', 'session-started', `mode=${normalized.minutes}m/${normalized.energy} target=${normalized.target}`);

    return c.json({ sessionId: state.id, question: opener.text });
  });

  // POST /api/session/:id/turn {text} → probe | saturated
  app.post('/api/session/:id/turn', async (c) => {
    const sessionId = c.req.param('id');
    const state = sessions.get(sessionId);
    if (!state) return c.json({ error: 'session not found' }, 404);

    const body = await c.req.json<{ text: string }>();
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

    const result = await userTurn(state, body.text);

    // Activity event for close phase entry
    if (state.phase === 'closing-door') {
      serverEmit(deps.vaultRoot, 'elicitor', 'close-phase-entered', `session=${sessionId}`);
    }

    if (result.kind === 'saturated') {
      return c.json({ kind: 'saturated' });
    }

    // Activity: question-asked or juxtaposition-offered
    if (juxtaposition) {
      serverEmit(deps.vaultRoot, 'elicitor', 'juxtaposition-offered', `session=${sessionId} snippet=${hits[0]!.snippetId}`);
    } else {
      serverEmit(deps.vaultRoot, 'elicitor', 'question-asked', `session=${sessionId}`);
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

  // POST /api/session/:id/end → {proposals, buds}
  app.post('/api/session/:id/end', async (c) => {
    const sessionId = c.req.param('id');
    const state = sessions.get(sessionId);
    if (!state) return c.json({ error: 'session not found' }, 404);

    const result = await propose(sessionId, state.turns, deps.complete);
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

    const result = decide(sessionId, proposals, body.decisions, deps.vault);

    serverEmit(deps.vaultRoot, 'harvester', 'session-harvested', `kept=${result.snippets.length} budded=${result.buds.length}`, result.snippets.map((s) => s.id));

    // Re-run docket after harvest to refresh index and mint new questions
    const newReport = await runDocket({
      vault: deps.vault,
      queue: deps.queue,
      complete: deps.complete,
      buildIndex: (snippets) => buildIndex(snippets),
      composeOpener,
      composeStillTrue,
      listSessions,
      log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
      vaultRoot: deps.vaultRoot,
    });
    currentIndex = newReport.index;
    for (const s of Object.values(deps.vault.rebuildIndex().snippets)) {
      snippetMap.set(s.id, s);
    }

    serverEmit(deps.vaultRoot, 'clerk', 'docket-run', `minted ${newReport.minted.length}, expired ${newReport.expired}`);

    return c.json({ snippets: result.snippets, buds: result.buds });
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
      const webRes = await app.fetch(webReq);

      const resHeaders: Record<string, string> = {};
      webRes.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });
      nodeRes.writeHead(webRes.status, resHeaders);

      if (webRes.body) {
        const buf = Buffer.from(await webRes.arrayBuffer());
        nodeRes.end(buf);
      } else {
        nodeRes.end();
      }
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

  if (llmMode === 'local') {
    const { makeComplete } = await import('./llm.js');
    complete = makeComplete();
  } else {
    // ELICIT_LLM=fake: wire the scripted Complete from tests/fakes.ts.
    // Dynamic import is legitimate — the module is runtime-selected by env var.
    const { makeScriptedComplete } = await import('../tests/fakes.js');
    // Standalone fake mode returns a fixed probe then empty cuts.
    complete = makeScriptedComplete([
      'Tell me more about that.',
      'What else comes to mind?',
      JSON.stringify({ cuts: [] }),
    ]);
  }
  const queueRoot = process.env.ELICIT_QUEUE_DIR ?? vaultRoot;
  const queue = createQueueStore(queueRoot);
  const indexData = vault.rebuildIndex();
  const index = buildIndex(Object.values(indexData.snippets));

  const bindHost = process.env.ELICIT_HOST ?? '127.0.0.1';
  const app = await createApp({ vault, complete, queue, index, vaultRoot });
  const port = 4517;
  await serveApp(app, port);
  console.error(
    `elicit server on http://${bindHost}:${port} [ELICIT_LLM=${llmMode}]`,
  );
}
