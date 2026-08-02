import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

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
});
