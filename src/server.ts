import { Hono } from 'hono';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createVault } from './vault/vault.js';
import { startSession, userTurn, skipQuestion } from './elicitor/elicitor.js';
import { propose, decide } from './harvester/harvester.js';
import { createQueueStore } from './queue/queue.js';
import { buildIndex } from './index/lexical.js';
import type {
  Vault,
  Complete,
  Mode,
  SessionState,
  CutProposal,
  HarvestDecision,
  QueueStore,
  LexicalIndex,
} from './types.js';

// ── Types ──

export interface ServerDeps {
  vault: Vault;
  complete: Complete;
  queue: QueueStore;
  index: LexicalIndex;
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

// ── Create app ──

export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  const sessions = new Map<string, SessionState>();
  const sessionProposals = new Map<string, CutProposal[]>();

  // POST /api/session {mode} → {sessionId, question}
  app.post('/api/session', async (c) => {
    const body = await c.req.json<{ mode: Mode }>();
    const mode = body.mode;
    if (!mode || typeof mode.minutes !== 'number' || !mode.energy) {
      return c.json({ error: 'invalid mode' }, 400);
    }
    const state = startSession(mode, deps);
    sessions.set(state.id, state);
    const opener = state.turns[0]!;
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

    const result = await userTurn(state, body.text);

    if (result.kind === 'saturated') {
      return c.json({ kind: 'saturated' });
    }
    return c.json({
      kind: 'probe',
      text: result.text,
      questionForm: result.questionForm,
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
    return c.json({ snippets: result.snippets, buds: result.buds });
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
  host: string = '127.0.0.1',
): Promise<Server> {
  return new Promise<Server>((resolve) => {
    const server = createServer(nodeAdapter(app));
    server.listen(port, host, () => resolve(server));
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

  const app = createApp({ vault, complete, queue, index });
  const port = 4517;
  await serveApp(app, port);
  console.error(
    `elicit server on http://127.0.0.1:${port} [ELICIT_LLM=${llmMode}]`,
  );
}
