import { runDocket } from '../src/clerk/docket.js';
import { composeOpener, composeStillTrue } from '../src/clerk/composed.js';
import { appendEvent, readEvents, type ActivityEvent } from '../src/log/activity.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';

// ── Helpers ──

/** Start a Hono app on a random port via node:http. */
function startServer(app: Hono): Promise<{ server: Server; port: number }> {
 return new Promise<{ server: Server; port: number }>((resolve, reject) => {
  const adapter = async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
   try {
    const hostRaw = nodeReq.headers.host;
    const host = Array.isArray(hostRaw) ? (hostRaw[0] ?? 'localhost') : (hostRaw ?? 'localhost');
    const url = `http://${host}${nodeReq.url}`;

    let body: Uint8Array | null = null;
    if (nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD') {
     const chunks: Buffer[] = [];
     for await (const chunk of nodeReq) {
      chunks.push(chunk);
     }
     if (chunks.length > 0) {
      body = new Uint8Array(Buffer.concat(chunks));
     }
    }

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

    const webReq = new Request(url, {
     method: nodeReq.method ?? 'GET',
     headers,
     body: body as BodyInit | null,
    });

    const webRes = await app.fetch(webReq, { remoteAddr: nodeReq.socket?.remoteAddress });

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

  const server = createServer(adapter);
  server.listen(0, '127.0.0.1', () => {
   const addr = server.address();
   if (addr && typeof addr === 'object') {
    resolve({ server, port: addr.port });
   } else {
    reject(new Error('Could not get server address'));
   }
  });
  server.on('error', reject);
 });
}

// ── Scripted session data ──

const userText1 = "I've been thinking about my career direction.";
const userText2 = "I want to work on things that matter but I'm not sure what that looks like.";

/**
 * Scripted session data.
 * Each userTurn calls complete twice (redLights + probe), so probes
 * are interleaved with '{}' dummies. End calls complete once for JSON cuts.
 */
const scriptedResponses = [
 '{}',
 'What do you mean by "career direction"?',
 '{}',
 'What would "things that matter" look like concretely?',
 JSON.stringify({
  cuts: [
   {
    text: userText1,
    sourceTurn: 0,
    facet: 'intention',
    stance: 'avowal',
    reading: 'Career direction is an active and acknowledged concern',
    standalone: true,
   },
   {
    text: 'I want to work on things that matter',
    sourceTurn: 1,
    facet: 'value',
    stance: 'commitment',
    reading: 'Values meaningful work as a priority',
    standalone: true,
   },
   {
    text: "I'm not sure what that looks like",
    sourceTurn: 1,
    facet: 'construct',
    stance: 'uncertainty-marked',
    reading: 'Uncertain about the concrete form of meaningful work',
    standalone: true,
   },
  ],
 }),
 '{}',
 'What does "my answer here" mean for what you value?',
 JSON.stringify({ cuts: [] }),
 // Padding: post-harvest docket composeOpener calls (may retry = 2 per snippet)
 'padding',
 'padding',
 'padding',
 'padding',
 'padding',
 'padding',
];

// ── Tests ──

describe('HTTP API e2e', () => {
 let server: Server;
 let baseUrl: string;
 let vaultDir: string;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-e2e-'));
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const indexData = vault.rebuildIndex();
  const index = buildIndex(Object.values(indexData.snippets));
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  const app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
  const result = await startServer(app);
  server = result.server;
  baseUrl = `http://127.0.0.1:${result.port}`;
 });

 afterAll(() => {
  server.close();
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('full scripted session via HTTP API', async () => {
  // ── Step 1: Create session ──
  const sessionRes = await fetch(`${baseUrl}/api/session`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ mode: { minutes: 30, energy: 'medium' } }),
  });
  expect(sessionRes.status).toBe(200);
  const { sessionId, question } = (await sessionRes.json()) as {
   sessionId: string;
   question: string;
  };
  expect(sessionId).toBeTypeOf('string');
  expect(question).toBeTypeOf('string');
  expect(question.length).toBeGreaterThan(0);

  // ── Step 2: Two turns ──
  const turn1Res = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ text: userText1 }),
  });
  expect(turn1Res.status).toBe(200);
  const turn1 = (await turn1Res.json()) as {
   kind: string;
   text?: string;
  };
  expect(turn1.kind).toBe('probe');
  expect(turn1.text).toBe(scriptedResponses[1]);

  const turn2Res = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ text: userText2 }),
  });
  expect(turn2Res.status).toBe(200);
  const turn2 = (await turn2Res.json()) as {
   kind: string;
   text?: string;
  };
  expect(turn2.kind).toBe('probe');
  expect(turn2.text).toBe(scriptedResponses[3]);

  // ── Step 3: End → proposals ──
  const endRes = await fetch(`${baseUrl}/api/session/${sessionId}/end`, {
   method: 'POST',
  });
  expect(endRes.status).toBe(200);
  const { proposals } = (await endRes.json()) as {
   proposals: Array<{
    text: string;
    sourceTurn: number;
    facet: string;
    stance: string;
    reading: string;
    questionForm: string;
   }>;
  };
  expect(proposals.length).toBe(3);

  // ── Step 4: Harvest — one approve, one restate, one discard ──
  const harvestRes = await fetch(
   `${baseUrl}/api/session/${sessionId}/harvest`,
   {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
     decisions: [
      { proposal: 0, action: 'approve' },
      {
       proposal: 1,
       action: 'restate',
       text: 'I value meaningful work above status.',
      },
      { proposal: 2, action: 'discard' },
     ],
    }),
   },
  );
  expect(harvestRes.status).toBe(200);
  const { snippets } = (await harvestRes.json()) as {
   snippets: Array<{
    id: string;
    version: number;
    prose: string;
    provenance: { kind: string };
   }>;
  };
  expect(snippets.length).toBe(2); // approve + restate

  // ── Step 5: Verify files on disk ──

  const snippetsDir = join(vaultDir, 'snippets');
  expect(existsSync(snippetsDir)).toBe(true);

  const approvedSnippet = snippets.find(
   (s) => s.provenance.kind === 'harvest',
  );
  const restatedSnippet = snippets.find(
   (s) => s.provenance.kind === 'restatement',
  );
  expect(approvedSnippet).toBeDefined();
  expect(restatedSnippet).toBeDefined();

  // Approved snippet: file exists, prose byte-identical, no facet/stance
  const approvedFile = join(snippetsDir, approvedSnippet!.id, 'v1.md');
  expect(existsSync(approvedFile)).toBe(true);
  const approvedParsed = matter.read(approvedFile);
  expect(approvedParsed.content.trimEnd()).toBe(userText1);
  expect(approvedParsed.data.facet).toBeUndefined();
  expect(approvedParsed.data.stance).toBeUndefined();
  expect(approvedParsed.data.id).toBe(approvedSnippet!.id);
  expect(approvedParsed.data.version).toBe(1);
  expect(approvedParsed.data.provenance.kind).toBe('harvest');

  // Restated snippet: file exists, prose is the restated text
  const restatedFile = join(snippetsDir, restatedSnippet!.id, 'v1.md');
  expect(existsSync(restatedFile)).toBe(true);
  const restatedParsed = matter.read(restatedFile);
  expect(restatedParsed.content.trimEnd()).toBe('I value meaningful work above status.');
  expect(restatedParsed.data.id).toBe(restatedSnippet!.id);
  expect(restatedParsed.data.version).toBe(1);
  expect(restatedParsed.data.provenance.kind).toBe('restatement');
  expect(restatedParsed.data.facet).toBeUndefined();
  expect(restatedParsed.data.stance).toBeUndefined();

  // Reading exists for approved snippet, cites snippet@1
  const readingsDir = join(vaultDir, 'wiki', 'readings');
  expect(existsSync(readingsDir)).toBe(true);

  const readingFilesList = readdirSync(readingsDir);
  expect(readingFilesList.length).toBe(1);

  const readingPath = join(readingsDir, readingFilesList[0]!);
  const readingParsed = matter.read(readingPath);
  expect(readingParsed.data.cites).toEqual([`${approvedSnippet!.id}@1`]);

  // No buds on disk (all cuts were standalone)
  const budsDir = join(vaultDir, 'buds');
  if (existsSync(budsDir)) {
   const budFiles = readdirSync(budsDir);
   const mdBuds = budFiles.filter((f) => f.endsWith('.md'));
   expect(mdBuds.length).toBe(0);
  }

  // Transcript exists with both user turns
  const transcriptFile = join(vaultDir, 'transcripts', `${sessionId}.md`);
  expect(existsSync(transcriptFile)).toBe(true);
  const transcriptContent = readFileSync(transcriptFile, 'utf-8');
  expect(transcriptContent).toContain('## user');
  expect(transcriptContent).toContain(userText1);
  expect(transcriptContent).toContain(userText2);
  expect(transcriptContent).toContain('## agent');

  // Transcript frontmatter carries mode
  const transcriptParsed = matter.read(transcriptFile);
  expect(transcriptParsed.data.mode).toEqual({
   minutes: 30,
   energy: 'medium',
   target: 'self',
  });
  expect(transcriptParsed.data.protocol).toBe('self');

  // ── Step 6: GET /api/snippets lists them ──
  const listRes = await fetch(`${baseUrl}/api/snippets`);
  expect(listRes.status).toBe(200);
  const { snippets: listedSnippets } = (await listRes.json()) as {
   snippets: Array<{ id: string }>;
  };
  const listedIds = listedSnippets.map((s) => s.id);
  expect(listedIds).toContain(approvedSnippet!.id);
  expect(listedIds).toContain(restatedSnippet!.id);
 });

 it('session skip flow works over HTTP', async () => {
  // 1. Create session
  const s1 = await fetch(`${baseUrl}/api/session`, {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ mode: { minutes: 25, energy: 'medium' } }),
  });
  expect(s1.status).toBe(200);
  const { sessionId, question } = (await s1.json()) as {
   sessionId: string;
   question: string;
  };
  expect(sessionId).toBeTruthy();
  expect(question).toBeTruthy();

  // 2. Skip the opener — get a new question
  const s2 = await fetch(`${baseUrl}/api/session/${sessionId}/skip`, {
   method: 'POST',
  });
  expect(s2.status).toBe(200);
  const skipResult = (await s2.json()) as {
   kind: string;
   text?: string;
  };
  expect(skipResult.kind).toBe('question');
  expect(skipResult.text).toBeTruthy();
  expect(skipResult.text).not.toBe(question);

  // 3. Answer the replacement question
  const s3 = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ text: 'My answer here' }),
  });
  expect(s3.status).toBe(200);
  const turnResult = (await s3.json()) as { kind: string };
  // Should be probe or saturated depending on scripted responses
  expect(['probe', 'saturated']).toContain(turnResult.kind);

  // 4. End the session
  const s4 = await fetch(`${baseUrl}/api/session/${sessionId}/end`, {
   method: 'POST',
  });
  expect(s4.status).toBe(200);
  const endResult = (await s4.json()) as { proposals: unknown[] };
  expect(Array.isArray(endResult.proposals)).toBe(true);

  // 5. Verify transcript on disk has the skip marker
  const transcriptPath = join(vaultDir, 'transcripts', `${sessionId}.md`);
  expect(existsSync(transcriptPath)).toBe(true);
  const raw = readFileSync(transcriptPath, 'utf-8');
  // The skipped turn and replacement should be in the transcript
  // (skipped is an in-memory marker, not on disk — so we just check presence)
  expect(raw).toContain(question); // original question still in transcript
  expect(raw).toContain(skipResult.text!); // replacement in transcript
 });
});

// ── Full flow: docket, juxtaposition, budget close, queue ──

const seedProse = "I've been thinking about my career direction.";
const fullUserAnswer1 = "I've been thinking about my career direction lately.";
const fullUserSequential = [
 'The kind of work that feels meaningful to me involves helping people directly.',
 'Last year I volunteered at a shelter and it changed my perspective.',
 'Before that I was mostly focused on career advancement and money.',
 'I think the contrast between those experiences is what clarified things.',
 'At my core I value connection and impact over status.',
 'My mother always said to follow what gives you energy, not what looks good.',
 "If I could tell my younger self one thing, it would be to trust that feeling.",
];

/**
 * Scripted responses for the full-flow test.
 * Order: docket composeOpener, then 7 turns (each: redLights + probe/juxtaposition),
 * then propose. Closing door + bookmark are fixed text (no complete calls).
 */
const fullFlowScripted = [
 // 0: docket composeOpener — raw question text
 'You wrote about "my career direction." Has anything shifted since then?',
 // Turn 1: juxtaposition (resonance on shared phrase) — succeeds, no redLights/probe after
 'You said "I\'ve been thinking about my career direction" before. Now you say "my career direction." Do you see it differently now?',
 // Turn 2: redLights + probe
 '{}', 'What specifically about helping people feels meaningful?',
 // Turn 3: redLights + probe
 '{}', 'Tell me about one specific moment at the shelter that stands out.',
 // Turn 4: redLights + probe
 '{}', 'What was the hardest part of shifting from money to meaning?',
 // Turn 5: redLights + probe
 '{}', 'What does "connection" mean to you — can you give me an example?',
 // Turn 6: redLights + probe
 '{}', 'Has your mother\'s advice ever led you somewhere unexpected?',
 // Turn 7: redLights + probe — after this, questionCount hits 8, turn 8 close triggers (no complete)
 '{}', 'What would you say to someone facing the same choice today?',
 // End: propose
 JSON.stringify({
  cuts: [
   { text: fullUserAnswer1, sourceTurn: 0, facet: 'intention', stance: 'avowal', reading: 'Career direction is an active concern', standalone: true },
   { text: fullUserSequential[0], sourceTurn: 1, facet: 'value', stance: 'commitment', reading: 'Values helping people directly', standalone: true },
  ],
 }),
 // Padding: post-harvest docket composeOpener calls
 'padding a',
 'padding b',
 'padding c',
 'padding d',
];

describe('full session with docket and juxtaposition', () => {
 let server: Server;
 let baseUrl: string;
 let vaultDir: string;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-full-'));
  const vault = createVault(vaultDir);

  // Seed a prior snippet so docket can compose an opener and resonance can fire
  vault.saveSnippet(seedProse, {
   kind: 'harvest',
   session: 'prior-session',
   question: 'What has been on your mind lately?',
   questionForm: 'deliberative',
  });

  const complete = makeScriptedComplete(fullFlowScripted);
  const queue = createQueueStore(vaultDir);
  const indexData = vault.rebuildIndex();
  const initialIndex = buildIndex(Object.values(indexData.snippets));

  // Run docket to mint composed opener from the seed snippet
  const docketReport = await runDocket({
   vault,
   queue,
   complete,
   buildIndex: (snippets) => buildIndex(snippets),
   composeOpener,
   composeStillTrue,
   listSessions: () => [{ session: 'prior-session', started: '2026-07-15T10:00:00.000Z', turnCount: 3, chars: 150 }],
   log: (e) => appendEvent(vaultDir, e as ActivityEvent),
   vaultRoot: vaultDir,
  });

  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  const app = await createApp({
   vault,
   complete,
   queue,
   index: docketReport.index,
   vaultRoot: vaultDir,
   authStore,
  });
  const result = await startServer(app);
  server = result.server;
  baseUrl = `http://127.0.0.1:${result.port}`;
 });

 afterAll(() => {
  server.close();
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('opens with composed opener, triggers juxtaposition, closes on budget, harvests, and queues bookmark', async () => {
  // ── Step 1: Create session ──
  const sessionRes = await fetch(`${baseUrl}/api/session`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ mode: { minutes: 10, energy: 'medium' } }),
  });
  expect(sessionRes.status).toBe(200);
  const { sessionId, question } = (await sessionRes.json()) as {
   sessionId: string;
   question: string;
  };
  expect(sessionId).toBeTypeOf('string');
  // Opener should be the composed question from the docket (not a bank starter)
  expect(question).toContain('career direction');

  // ── Step 2: Turn 1 — should trigger juxtaposition ──
  const t1 = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ text: fullUserAnswer1 }),
  });
  expect(t1.status).toBe(200);
  const turn1 = (await t1.json()) as {
   kind: string;
   text?: string;
   phase?: string;
   juxtaposition?: { snippetText: string; snippetDate: string };
  };
  expect(turn1.kind).toBe('probe');
  expect(turn1.phase).toBe('open');
  // Juxtaposition should be present — the seed snippet shares "career direction"
  expect(turn1.juxtaposition).toBeDefined();
  expect(turn1.juxtaposition!.snippetText).toBe(seedProse);
  expect(turn1.juxtaposition!.snippetDate).toBeTypeOf('string');

  // ── Step 3: Turns 2-7 — generic probes ──
  for (let i = 0; i < fullUserSequential.length; i++) {
   const res = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: fullUserSequential[i] }),
   });
   expect(res.status).toBe(200);
   const data = (await res.json()) as {
    kind: string;
    text?: string;
    phase?: string;
   };
   // Turn 7 is the last before close; turn 8 triggers close
   if (i === 6) {
    // After turn 7's answer, questionCount hits 8 → close door fires
    // The response should be the closing door question (fixed text, no complete call)
    expect(data.kind).toBe('probe');
    expect(data.phase).toBe('closing-door');
   } else {
    expect(data.kind).toBe('probe');
    expect(data.phase).toBe('open');
   }
  }

  // ── Step 4: Answer close-door question ──
  const cdRes = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ text: 'This opens a path toward more intentional work.' }),
  });
  expect(cdRes.status).toBe(200);
  const cdData = (await cdRes.json()) as { kind: string; phase?: string };
  expect(cdData.kind).toBe('probe');
  expect(cdData.phase).toBe('closing-bookmark');

  // ── Step 5: Answer bookmark question → saturated ──
  const bmRes = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ text: 'I want to explore how to align my daily work with my values.' }),
  });
  expect(bmRes.status).toBe(200);
  const bmData = (await bmRes.json()) as { kind: string };
  expect(bmData.kind).toBe('saturated');

  // ── Step 6: End → harvest ──
  const endRes = await fetch(`${baseUrl}/api/session/${sessionId}/end`, {
   method: 'POST',
  });
  expect(endRes.status).toBe(200);
  const { proposals } = (await endRes.json()) as { proposals: Array<{ text: string }> };
  expect(proposals.length).toBe(2);

  const harvestRes = await fetch(`${baseUrl}/api/session/${sessionId}/harvest`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({
    decisions: [
     { proposal: 0, action: 'approve' as const },
     { proposal: 1, action: 'approve' as const },
    ],
   }),
  });
  expect(harvestRes.status).toBe(200);
  const { snippets } = (await harvestRes.json()) as { snippets: Array<{ id: string }> };
  expect(snippets.length).toBe(2);

  // ── Step 7: GET /api/queue — should have user-declared entry from bookmark ──
  const qRes = await fetch(`${baseUrl}/api/queue`);
  expect(qRes.status).toBe(200);
  const queueData = (await qRes.json()) as {
   pending: Array<{ question: string; source: string }>;
   open: Array<{ question: string; source: string; horizon: string }>;
  };
  const userDeclared = queueData.pending.find((e) => e.source === 'user-declared');
  expect(userDeclared).toBeDefined();
  expect(userDeclared!.question).toBe('I want to explore how to align my daily work with my values.');
 });
});

// ── Auth e2e: password gate ──

describe('auth gate', () => {
 let vaultDir: string;

 beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-auth-e2e-'));
 });

 afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 async function makeApp(): Promise<Hono> {
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const indexData = vault.rebuildIndex();
  const index = buildIndex(Object.values(indexData.snippets));
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  return createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
 }

 function loopbackEnv() {
  return { remoteAddr: '127.0.0.1' };
 }

 function remoteEnv() {
  return { remoteAddr: '192.168.1.100' };
 }

 it('no auth file + loopback → ungated (API returns 200)', async () => {
  const app = await makeApp();
  const req = new Request('http://localhost/api/queue');
  const res = await app.fetch(req, loopbackEnv());
  expect(res.status).toBe(200);
 });

 it('no auth file + non-loopback → API returns 403 setup required', async () => {
  const app = await makeApp();
  const req = new Request('http://localhost/api/queue');
  const res = await app.fetch(req, remoteEnv());
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('setup required');
 });

 it('no auth file + non-loopback → static routes return setup-required HTML', async () => {
  const app = await makeApp();
  const req = new Request('http://localhost/');
  const res = await app.fetch(req, remoteEnv());
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('finish setup from the host machine');
 });

 it('POST /api/setup from non-loopback → rejected', async () => {
  const app = await makeApp();
  const req = new Request('http://localhost/api/setup', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: 'secret' }),
  });
  const res = await app.fetch(req, remoteEnv());
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('setup must be done from the host machine');
 });

 it('POST /api/setup from loopback → creates auth file and issues session cookie', async () => {
  const app = await makeApp();
  const req = new Request('http://localhost/api/setup', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: 'secret' }),
  });
  const res = await app.fetch(req, loopbackEnv());
  expect(res.status).toBe(200);
  const body = await res.json() as { ok: boolean };
  expect(body.ok).toBe(true);
  // Session cookie set
  const setCookie = res.headers.get('Set-Cookie');
  expect(setCookie).toBeTruthy();
  expect(setCookie).toContain('elicit_session=');
  // Auth file created
  expect(existsSync(join(vaultDir, '.auth.json'))).toBe(true);
 });

 it('auth file exists → API returns 401 without cookie', async () => {
  // Set up auth first
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');

  const app = await makeApp();
  const req = new Request('http://localhost/api/queue');
  const res = await app.fetch(req, loopbackEnv());
  expect(res.status).toBe(401);
 });

 it('auth file exists → login with correct password gets cookie, then API succeeds', async () => {
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');

  const app = await makeApp();

  // Login
  const loginReq = new Request('http://localhost/api/login', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: 'secret' }),
  });
  const loginRes = await app.fetch(loginReq, loopbackEnv());
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get('Set-Cookie')!;
  expect(setCookie).toContain('elicit_session=');

  // Extract cookie value
  const match = /elicit_session=([^;]+)/.exec(setCookie);
  expect(match).toBeTruthy();
  const cookieVal = match![1]!;

  // Access API with cookie
  const apiReq = new Request('http://localhost/api/queue', {
   headers: { Cookie: `elicit_session=${cookieVal}` },
  });
  const apiRes = await app.fetch(apiReq, loopbackEnv());
  expect(apiRes.status).toBe(200);
 });

 it('auth file exists → login with wrong password rejected', async () => {
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');

  const app = await makeApp();
  const loginReq = new Request('http://localhost/api/login', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: 'wrong' }),
  });
  const loginRes = await app.fetch(loginReq, loopbackEnv());
  expect(loginRes.status).toBe(401);
 });

 it('GET /api/auth/status without auth file → {needsSetup: true}', async () => {
  const app = await makeApp();
  const req = new Request('http://localhost/api/auth/status');
  const res = await app.fetch(req, loopbackEnv());
  expect(res.status).toBe(200);
  const body = await res.json() as { needsSetup: boolean };
  expect(body.needsSetup).toBe(true);
 });

 it('GET /api/auth/status with auth file → {needsSetup: false}', async () => {
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');

  const app = await makeApp();
  const req = new Request('http://localhost/api/auth/status');
  const res = await app.fetch(req, loopbackEnv());
  expect(res.status).toBe(200);
  const body = await res.json() as { needsSetup: boolean };
  expect(body.needsSetup).toBe(false);
 });
});

// ── STT endpoints ──

describe('stt status', () => {
 let vaultDir: string;
 let origEnv: string | undefined;

 beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-stt-e2e-'));
  origEnv = process.env['ELICIT_STT_MODEL_DIR'];
 });

 afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
  if (origEnv === undefined) {
   delete process.env['ELICIT_STT_MODEL_DIR'];
  } else {
   process.env['ELICIT_STT_MODEL_DIR'] = origEnv;
  }
 });

 async function makeApp(): Promise<Hono> {
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const indexData = vault.rebuildIndex();
  const index = buildIndex(Object.values(indexData.snippets));
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  return createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore });
 }

 it('GET /api/stt/status → {available: true} when model dir resolves', async () => {
  const modelDir = mkdtempSync(join(tmpdir(), 'elicit-model-'));
  const files = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'];
  for (const f of files) writeFileSync(join(modelDir, f), 'fake');
  process.env['ELICIT_STT_MODEL_DIR'] = modelDir;

  const app = await makeApp();
  const req = new Request('http://localhost/api/stt/status');
  const res = await app.fetch(req);
  expect(res.status).toBe(200);
  const body = await res.json() as { available: boolean };
  expect(body.available).toBe(true);

  rmSync(modelDir, { recursive: true, force: true });
 });

 it('GET /api/stt/status → {available: false} when no model', async () => {
  delete process.env['ELICIT_STT_MODEL_DIR'];
  // Ensure no default cache — override HOME to a temp dir
  const fakeHome = mkdtempSync(join(tmpdir(), 'elicit-nohome-'));
  const origHome = process.env['HOME'];
  process.env['HOME'] = fakeHome;

  try {
   const app = await makeApp();
   const req = new Request('http://localhost/api/stt/status');
   const res = await app.fetch(req);
   expect(res.status).toBe(200);
   const body = await res.json() as { available: boolean };
   expect(body.available).toBe(false);
  } finally {
   process.env['HOME'] = origHome;
   rmSync(fakeHome, { recursive: true, force: true });
  }
 });
});

describe('stt transcribe', () => {
 let vaultDir: string;

 beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-stt-transcribe-'));
 });

 afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 function fakeClient(text: string) {
  return {
   transcribe: async () => text,
   dispose: () => { },
  };
 }

 it('POST /api/transcribe → {text} from injected client', async () => {
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const index = buildIndex([]);
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');

  // Login to get a session cookie
  const app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore, sttClient: fakeClient('hello world') });
  const loginReq = new Request('http://localhost/api/login', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: 'secret' }),
  });
  const loginRes = await app.fetch(loginReq, { remoteAddr: '127.0.0.1' });
  const setCookie = loginRes.headers.get('Set-Cookie')!;
  const match = /elicit_session=([^;]+)/.exec(setCookie);
  const cookieVal = match![1]!;

  // Build 1s of 16kHz silence (16000 samples)
  const silence = new Float32Array(16000);
  const req = new Request('http://localhost/api/transcribe?rate=16000', {
   method: 'POST',
   headers: { Cookie: `elicit_session=${cookieVal}` },
   body: silence.buffer,
  });
  const res = await app.fetch(req, { remoteAddr: '127.0.0.1' });
  expect(res.status).toBe(200);
  const body = await res.json() as { text: string };
  expect(body.text).toBe('hello world');
 });

 it('POST /api/transcribe emits activity event', async () => {
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const index = buildIndex([]);
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');

  const app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore, sttClient: fakeClient('test') });
  const loginReq = new Request('http://localhost/api/login', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ password: 'secret' }),
  });
  const loginRes = await app.fetch(loginReq, { remoteAddr: '127.0.0.1' });
  const setCookie = loginRes.headers.get('Set-Cookie')!;
  const match = /elicit_session=([^;]+)/.exec(setCookie);
  const cookieVal = match![1]!;

  const silence = new Float32Array(8000);
  const req = new Request('http://localhost/api/transcribe?rate=16000', {
   method: 'POST',
   headers: { Cookie: `elicit_session=${cookieVal}` },
   body: silence.buffer,
  });
  await app.fetch(req, { remoteAddr: '127.0.0.1' });

  // Read activity log
  const events = readEvents(vaultDir);
  const transcribed = events.filter((e) => e.kind === 'transcribed');
  expect(transcribed.length).toBe(1);
  expect(transcribed[0]!.actor).toBe('system');
  expect(transcribed[0]!.detail).toMatch(/\d+ms \d+chars/);
 });

 it('POST /api/transcribe → 401 without cookie when auth gate active', async () => {
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const index = buildIndex([]);
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  authStore.setup('secret');

  const app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore, sttClient: fakeClient('x') });

  const req = new Request('http://localhost/api/transcribe', {
   method: 'POST',
   body: new Float32Array(100).buffer,
  });
  const res = await app.fetch(req, { remoteAddr: '127.0.0.1' });
  expect(res.status).toBe(401);
 });
});
