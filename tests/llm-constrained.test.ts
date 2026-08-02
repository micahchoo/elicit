import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { makeComplete, type ResponseFormat } from '../src/llm.js';
import { CUTS_RESPONSE_FORMAT } from '../src/harvester/harvester.js';
import type { Turn } from '../src/types.js';

/** A loopback chat-completions endpoint plus the bodies it captured. */
export interface CaptureEndpoint {
 baseUrl: string;
 bodies: Record<string, unknown>[];
 close: () => Promise<void>;
}

/**
 * A loopback chat-completions endpoint that captures the request body and
 * answers with a minimal SSE stream. Lets a test assert on what was SENT to
 * the model without touching the real clerk endpoint (ticket 078).
 */
function captureEndpoint(): Promise<CaptureEndpoint> {
 const bodies: Record<string, unknown>[] = [];
 const server: Server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
   raw += chunk.toString();
  });
  req.on('end', () => {
   bodies.push(JSON.parse(raw) as Record<string, unknown>);
   // pi-ai streams (stream: true); answer with one content chunk + finish.
   const chunks = [
    {
     id: 'chatcmpl-capture',
     object: 'chat.completion.chunk',
     created: 0,
     model: 'capture-model',
     choices: [
      {
       index: 0,
       delta: { role: 'assistant', content: '{"cuts": []}' },
       finish_reason: null,
      },
     ],
    },
    {
     id: 'chatcmpl-capture',
     object: 'chat.completion.chunk',
     created: 0,
     model: 'capture-model',
     choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
   ];
   res.writeHead(200, { 'Content-Type': 'text/event-stream' });
   for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
   }
   res.write('data: [DONE]\n\n');
   res.end();
  });
 });

 const promise = new Promise<CaptureEndpoint>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
   const { port } = server.address() as AddressInfo;
   resolve({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    bodies,
    close: () => new Promise<void>((done) => server.close(() => done())),
   });
  });
 });
 return promise;
}

/**
 * A loopback endpoint that accepts a completion request and never answers:
 * headers sent, no chunk, no finish — the runaway-generation analog from
 * ticket 086, where an established socket to a still-generating model ran
 * 84 minutes. Compressed here to the per-request budget.
 */
function hangingEndpoint(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
 const sockets = new Set<Socket>();
 const server: Server = createServer((req, res) => {
  // Drain the request body so backpressure never stalls the client's write;
  // answer nothing. The fetch resolves headers, then waits forever.
  req.on('data', () => { });
  req.on('end', () => { });
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
 });
 server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
 });

 const promise = new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
   const { port } = server.address() as AddressInfo;
   resolve({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () =>
     new Promise<void>((done) => {
      // The client aborts its socket on timeout; destroy anything left so
      // server.close() does not wait on a connection that never ends.
      for (const s of sockets) s.destroy();
      server.close(() => done());
     }),
   });
  });
 });
 return promise;
}

const SAVED_ENV: Record<string, string | undefined> = {};
function saveEnv(keys: string[]): void {
 for (const key of keys) SAVED_ENV[key] = process.env[key];
}
function restoreEnv(keys: string[]): void {
 for (const key of keys) {
  if (SAVED_ENV[key] === undefined) delete process.env[key];
  else process.env[key] = SAVED_ENV[key];
 }
}

describe('constrained harvest output (ticket 078)', () => {
 const envKeys = ['ELICIT_CLERK_BASE_URL', 'ELICIT_CLERK_MODEL'];
 let endpoint: CaptureEndpoint;

 beforeEach(async () => {
  saveEnv(envKeys);
  process.env.ELICIT_CLERK_MODEL = 'capture-model';
  endpoint = await captureEndpoint();
  process.env.ELICIT_CLERK_BASE_URL = endpoint.baseUrl;
 });

 afterEach(async () => {
  restoreEnv(envKeys);
  await endpoint.close();
 });

 const turn: Turn = { role: 'user', text: 'I value autonomy above all else.', at: '2026-08-02T00:00:00.000Z' };

 it('carries the cuts response_format when the option is set', async () => {
  const complete = makeComplete('clerk', { responseFormat: CUTS_RESPONSE_FORMAT });
  const text = await complete('system', [turn]);

  expect(text).toBe('{"cuts": []}');
  expect(endpoint.bodies).toHaveLength(1);
  const body = endpoint.bodies[0]!;
  expect(body.response_format).toEqual(CUTS_RESPONSE_FORMAT);
 });

 it('omits response_format when the option is not set', async () => {
  const complete = makeComplete('clerk');
  const text = await complete('system', [turn]);

  expect(text).toBe('{"cuts": []}');
  expect(endpoint.bodies).toHaveLength(1);
  expect(endpoint.bodies[0]!.response_format).toBeUndefined();
 });

 it('passes a caller-supplied schema through unchanged', async () => {
  const custom: ResponseFormat = {
   type: 'json_schema',
   json_schema: {
    name: 'custom',
    strict: true,
    schema: {
     type: 'object',
     properties: { only: { type: 'string' } },
     required: ['only'],
     additionalProperties: false,
    },
   },
  };
  const complete = makeComplete('clerk', { responseFormat: custom });
  await complete('system', [turn]);

  expect(endpoint.bodies[0]!.response_format).toEqual(custom);
 });

 it('bounds output tokens with max_tokens by default (ticket 086)', async () => {
  const complete = makeComplete('clerk');
  await complete('system', [turn]);

  expect(endpoint.bodies[0]!.max_tokens).toBe(16384);
 });

 it('honors a caller-supplied maxTokens bound', async () => {
  const complete = makeComplete('clerk', { maxTokens: 512 });
  await complete('system', [turn]);

  expect(endpoint.bodies[0]!.max_tokens).toBe(512);
 });
});

describe('per-request completion timeout (ticket 086)', () => {
 const envKeys = ['ELICIT_CLERK_BASE_URL', 'ELICIT_CLERK_MODEL'];
 let endpoint: { baseUrl: string; close: () => Promise<void> };

 beforeEach(async () => {
  saveEnv(envKeys);
  process.env.ELICIT_CLERK_MODEL = 'capture-model';
  endpoint = await hangingEndpoint();
  process.env.ELICIT_CLERK_BASE_URL = endpoint.baseUrl;
 });

 afterEach(async () => {
  restoreEnv(envKeys);
  await endpoint.close();
 });

 const turn: Turn = { role: 'user', text: 'I value autonomy above all else.', at: '2026-08-02T00:00:00.000Z' };

 it('aborts a call that never returns, naming the elapsed budget', async () => {
  const complete = makeComplete('clerk', { timeoutMs: 100 });

  // The full roleFailure message, so the diagnosis is distinguishable from
  // a refused connection (034) and names the budget that elapsed.
  await expect(complete('system', [turn])).rejects.toThrow(
   /clerk model call failed — capture-model at http:\/\/127\.0\.0\.1:\d+\/v1: timed out after 0\.1s/,
  );
 });

 it('returns normally when the endpoint answers inside the budget', async () => {
  const answering = await captureEndpoint();
  try {
   process.env.ELICIT_CLERK_BASE_URL = answering.baseUrl;
   const complete = makeComplete('clerk', { timeoutMs: 5000 });
   const text = await complete('system', [turn]);
   expect(text).toBe('{"cuts": []}');
  } finally {
   await answering.close();
  }
 });
});
