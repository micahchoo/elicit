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
import type { Complete, CutProposal, Vault } from '../src/types.js';
import { statSync } from 'node:fs';
import { createClaimStore } from '../src/wiki/store.js';
import type { QueueStore } from '../src/types.js';
import type { ClaimStore } from '../src/wiki/contract.js';
import {
 ANSWER_READING,
 ANSWER_TEXT,
 BODY_ONE,
 BODY_TWO,
 PROSE_ONE,
 PROSE_ONE_B,
 PROSE_THIRD,
 PROSE_TWO,
 QUESTION_ONE,
 QUESTION_TWO,
 READING_ONE,
 READING_ONE_B,
 READING_THIRD,
 READING_TWO,
 SITTING_ONE,
 SITTING_TWO,
 FABRICATED_QUOTE,
 clerkRouter,
 type Router,
 type RouterOptions,
} from './fixtures/clerk-flow.js';

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

/**
 * Counts settled background docket runs and lets a test wait for one.
 * The docket runs off the response path (ticket 047), so a test that wants to
 * see its effects has to ask for them.
 */
function docketBarrier() {
 let settled = 0;
 const waiting: (() => void)[] = [];
 return {
  onDocketSettled(): void {
   settled++;
   for (const w of waiting.splice(0)) w();
  },
  get count(): number {
   return settled;
  },
  async waitFor(n: number): Promise<void> {
   while (settled < n) await new Promise<void>((r) => waiting.push(r));
  },
 };
}

/**
 * A scripted Complete that can be held shut. After `close()` every call blocks
 * until `release()` — which is how a test freezes a docket run mid-flight and
 * looks at what the server does meanwhile. Runs past the script answer '{}'.
 */
function gatedComplete(responses: string[]) {
 let i = 0;
 let gate: Promise<void> | null = null;
 let open: (() => void) | null = null;
 const complete: Complete = async () => {
  if (gate) await gate;
  return responses[i++] ?? '{}';
 };
 return {
  complete,
  close(): void {
   gate = new Promise<void>((r) => {
    open = r;
   });
  },
  release(): void {
   open?.();
   gate = null;
   open = null;
  },
 };
}

/** One turn of the event loop plus a margin — enough for a setImmediate to fire. */
function tick(): Promise<void> {
 return new Promise<void>((r) => setTimeout(r, 20));
}

/** Call the app directly from loopback, no listening socket in the way. */
async function call(app: Hono, path: string, body?: unknown): Promise<Response> {
 const init: RequestInit =
  body === undefined
   ? { method: 'GET' }
   : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
   };
 return app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
}

/**
 * The harvest runs behind the response and lands in the review queue on disk
 * (ticket 084). Polling is the only wait available: the record appears from a
 * background setImmediate in the server process, which fake timers cannot
 * advance, so this deliberately polls the real clock.
 */
async function waitForProposals(
 request: (path: string) => Promise<Response>,
 sessionId: string,
 timeoutMs = 5000,
): Promise<CutProposal[]> {
 const deadline = Date.now() + timeoutMs;
 for (; ;) {
  const res = await request(`/api/harvest-queue/${sessionId}`);
  if (res.status === 200) {
   const body = (await res.json()) as { proposals: CutProposal[] };
   return body.proposals;
  }
  if (Date.now() > deadline) throw new Error(`harvest for ${sessionId} never landed`);
  await new Promise<void>((r) => setTimeout(r, 25));
 }
}

/** How many events of one kind the vault's activity log holds. */
function kindCount(vaultDir: string, kind: string): number {
 return readEvents(vaultDir).filter((e) => e.kind === kind).length;
}

// ── Scripted session data ──

const userText1 = "I've been thinking about my career direction.";
const userText2 = "I want to work on things that matter but I'm not sure what that looks like.";

/**
 * Scripted session data.
 * Each userTurn calls complete twice (redLights + probe), so probes
 * are interleaved with '{}' dummies. End calls complete once per user turn —
 * harvest extracts one chunk at a time (ticket 034).
 */
const scriptedResponses = [
 '{}',
 'What do you mean by "career direction"?',
 '{}',
 'What would "things that matter" look like concretely?',
 // Harvest chunk for user turn 0
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
  ],
 }),
 // Harvest chunk for user turn 1
 JSON.stringify({
  cuts: [
   {
    text: 'I want to work on things that matter',
    sourceTurn: 0,
    facet: 'value',
    stance: 'commitment',
    reading: 'Values meaningful work as a priority',
    standalone: true,
   },
   {
    text: "I'm not sure what that looks like",
    sourceTurn: 0,
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
 const barrier = docketBarrier();

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-e2e-'));
  const vault = createVault(vaultDir);
  const complete = makeScriptedComplete(scriptedResponses);
  const queue = createQueueStore(vaultDir);
  const indexData = vault.rebuildIndex();
  const index = buildIndex(Object.values(indexData.snippets));
  const authStore = createFileAuth(join(vaultDir, '.auth.json'));
  const app = await createApp({ vault, complete, queue, index, vaultRoot: vaultDir, authStore, onDocketSettled: barrier.onDocketSettled });
  // The boot docket no longer blocks createApp, so wait for it here: the
  // scripted responses below are consumed in a fixed order.
  await barrier.waitFor(1);
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

  // ── Step 3: End → proposals land in the review queue ──
  const endRes = await fetch(`${baseUrl}/api/session/${sessionId}/end`, {
   method: 'POST',
  });
  expect(endRes.status).toBe(200);
  const endBody = (await endRes.json()) as { status: string; sessionId: string };
  expect(endBody.status).toBe('harvesting');
  expect(endBody.sessionId).toBe(sessionId);

  const proposals = await waitForProposals((p) => fetch(`${baseUrl}${p}`), sessionId);
  expect(proposals.length).toBe(3);

  // ── Step 4: Harvest — one approve, one restate, one discard ──
  const settledBefore = barrier.count;
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

  // The harvest answered without waiting for the docket. Let that run finish
  // before the next test draws on the same scripted responses.
  await barrier.waitFor(settledBefore + 1);

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
  expect(transcriptParsed.data.protocol).toBe('reflective');

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

  // 2. Answer the greeting so the opener is appended to transcript (ticket 135)
  const s1a = await fetch(`${baseUrl}/api/session/${sessionId}/pulse`, {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ text: 'ready', prompt: '' }),
  });
  expect(s1a.status).toBe(200);

  // 3. Skip the opener — get a new question
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

  // 4. Answer the replacement question
  const s3 = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ text: 'My answer here' }),
  });
  expect(s3.status).toBe(200);
  const turnResult = (await s3.json()) as { kind: string };
  expect(['probe', 'saturated']).toContain(turnResult.kind);

  // 5. End the session
  const s4 = await fetch(`${baseUrl}/api/session/${sessionId}/end`, {
   method: 'POST',
  });
  expect(s4.status).toBe(200);
  const endResult = (await s4.json()) as { status: string; sessionId: string };
  expect(endResult.status).toBe('harvesting');
  expect(endResult.sessionId).toBe(sessionId);
  await waitForProposals((p) => fetch(`${baseUrl}${p}`), sessionId);

  // 6. Verify transcript has the original question and replacement

  const transcriptPath = join(vaultDir, 'transcripts', `${sessionId}.md`);
  expect(existsSync(transcriptPath)).toBe(true);
  const raw = readFileSync(transcriptPath, 'utf-8');
  expect(raw).toContain(question); // original question still in transcript
  expect(raw).toContain(skipResult.text!); // replacement in transcript
 });

 it('no transcript ends on an agent turn; none opens with two consecutive agent turns (ticket 135)', async () => {
  const s1 = await fetch(`${baseUrl}/api/session`, {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ mode: { minutes: 15, energy: 'medium' } }),
  });
  expect(s1.status).toBe(200);
  const { sessionId } = (await s1.json()) as { sessionId: string };

  // Answer the greeting so the opener fires (ticket 135)
  await fetch(`${baseUrl}/api/session/${sessionId}/pulse`, {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ text: 'here', prompt: '' }),
  });

  // Answer the opener to get a probe (2 LLM calls: redLights + generic)
  const t1 = await fetch(`${baseUrl}/api/session/${sessionId}/turn`, {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({ text: 'Just thinking about things.' }),
  });
  expect(t1.status).toBe(200);

  // End the session mid-exchange — last transcript turn is the agent probe
  await fetch(`${baseUrl}/api/session/${sessionId}/end`, { method: 'POST' });

  // Verify transcript invariants
  const transcriptPath = join(vaultDir, 'transcripts', `${sessionId}.md`);
  const raw = readFileSync(transcriptPath, 'utf-8');
  const sections = raw.match(/^## (\w+)/gm);
  expect(sections).not.toBeNull();

  // Invariant 1: transcript must not end on ## agent
  expect(sections![sections!.length - 1]).not.toBe('## agent');

  // Invariant 2: no two consecutive ## agent sections at the start
  const firstTwo = sections!.slice(0, 2);
  const startsWithTwoAgents = firstTwo.length === 2 && firstTwo[0] === '## agent' && firstTwo[1] === '## agent';
  expect(startsWithTwoAgents).toBe(false);
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
 // End: propose — one call per user turn (ticket 034). Ten user turns: the
 // opener answer, six sequential answers, then the door and bookmark answers.
 JSON.stringify({
  cuts: [
   { text: fullUserAnswer1, sourceTurn: 0, facet: 'intention', stance: 'avowal', reading: 'Career direction is an active concern', standalone: true },
  ],
 }),
 JSON.stringify({
  cuts: [
   { text: fullUserSequential[0], sourceTurn: 0, facet: 'value', stance: 'commitment', reading: 'Values helping people directly', standalone: true },
  ],
 }),
 ...Array.from({ length: 8 }, () => JSON.stringify({ cuts: [] })),
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
 const barrier = docketBarrier();

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
   onDocketSettled: barrier.onDocketSettled,
  });
  await barrier.waitFor(1); // the boot docket, which no longer blocks createApp
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


  // Answer the greeting so the opener is appended to transcript (ticket 135)
  const pa = await fetch(`${baseUrl}/api/session/${sessionId}/pulse`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ text: 'ready', prompt: '' }),
  });
  expect(pa.status).toBe(200);
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
  const endBody = (await endRes.json()) as { status: string };
  expect(endBody.status).toBe('harvesting');
  const proposals = await waitForProposals((p) => fetch(`${baseUrl}${p}`), sessionId);
  expect(proposals.length).toBe(2);

  const settledBefore = barrier.count;
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
  await barrier.waitFor(settledBefore + 1);

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
   transcribe: async () => ({ text, tokens: [] as string[], timestamps: [] as number[], durations: [] as number[] }),
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

// ── The docket runs behind the response, never in front of it (ticket 047) ──

const careerProse = "I've been thinking about my career direction.";

/** One cut of the prose above — the shortest path from text to a saved snippet. */
const oneCut = JSON.stringify({
 cuts: [
  {
   text: careerProse,
   sourceTurn: 0,
   facet: 'intention',
   stance: 'avowal',
   reading: 'Career direction is an active concern',
   standalone: true,
  },
 ],
});

/** A composed opener that quotes the snippet and sets the quote off, so it passes the gate. */
const openerQuestion = 'You wrote about "my career direction." Has anything shifted since then?';

const someMode = { minutes: 10, energy: 'medium', target: 'self' };

describe('docket off the response path', () => {
 let vaultDir: string;

 beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-047-'));
 });

 afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('answers the harvest while the docket is still running, then catches the index up', async () => {
  const vault = createVault(vaultDir);
  const gate = gatedComplete([oneCut, openerQuestion]);
  const barrier = docketBarrier();
  const app = await createApp({
   vault,
   complete: gate.complete,
   queue: createQueueStore(vaultDir),
   index: buildIndex([]),
   vaultRoot: vaultDir,
   authStore: createFileAuth(join(vaultDir, '.auth.json')),
   onDocketSettled: barrier.onDocketSettled,
  });
  await barrier.waitFor(1); // boot docket over an empty vault

  const entryRes = await call(app, '/api/unprompted', { text: careerProse });
  const entry = (await entryRes.json()) as { status: string; sessionId: string };
  expect(entry.status).toBe('harvesting');
  // The harvest consumes the scripted cut while the gate is still open.
  const proposals = await waitForProposals((p) => call(app, p), entry.sessionId);
  expect(proposals.length).toBe(1);

  // Every model call from here blocks: the docket the harvest starts cannot finish.
  gate.close();

  const settledBefore = barrier.count;
  const harvestRes = await call(app, `/api/session/${entry.sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'approve' }],
  });
  expect(harvestRes.status).toBe(200);
  const { snippets } = (await harvestRes.json()) as { snippets: Array<{ id: string }> };
  expect(snippets.length).toBe(1);

  // The client has its answer and the run it started is still going.
  await tick();
  expect(kindCount(vaultDir, 'run-started')).toBe(2); // boot, then this one
  expect(kindCount(vaultDir, 'docket-run')).toBe(1); // only boot has finished
  expect(barrier.count).toBe(settledBefore);

  gate.release();
  await barrier.waitFor(settledBefore + 1);
  expect(kindCount(vaultDir, 'docket-run')).toBe(2);

  // The held index now carries the harvested snippet: an echo of it comes back
  // as a juxtaposition, which nothing but the index can produce.
  const sessRes = await call(app, '/api/session', { mode: someMode });
  const { sessionId } = (await sessRes.json()) as { sessionId: string };
  const turnRes = await call(app, `/api/session/${sessionId}/turn`, {
   text: 'What about my career direction now?',
  });
  const turn = (await turnRes.json()) as { juxtaposition?: { snippetText: string } };
  expect(turn.juxtaposition?.snippetText).toBe(careerProse);
 });

 it('keeps the held index when a background docket run fails', async () => {
  const real = createVault(vaultDir);
  real.saveSnippet(careerProse, {
   kind: 'harvest',
   session: 'prior-session',
   question: 'What has been on your mind?',
   questionForm: 'deliberative',
  });

  // A vault that stops being readable partway through the run.
  let unreadable = false;
  const vault: Vault = {
   saveSnippet: (prose, provenance) => real.saveSnippet(prose, provenance),
   saveVersion: (id, prose) => real.saveVersion(id, prose),
   saveReading: (r) => real.saveReading(r),
   saveBud: (fragment, failures, session) => real.saveBud(fragment, failures, session),
   startTranscript: (session, meta) => real.startTranscript(session, meta),
   appendTurn: (session, t) => real.appendTurn(session, t),
   rebuildIndex: () => {
    if (unreadable) throw new Error('vault unreadable');
    return real.rebuildIndex();
   },
  };

  const gate = gatedComplete([oneCut]);
  const barrier = docketBarrier();
  const app = await createApp({
   vault,
   complete: gate.complete,
   queue: createQueueStore(vaultDir),
   index: buildIndex(Object.values(real.rebuildIndex().snippets)),
   vaultRoot: vaultDir,
   authStore: createFileAuth(join(vaultDir, '.auth.json')),
   onDocketSettled: barrier.onDocketSettled,
  });
  await barrier.waitFor(1);

  const entryRes = await call(app, '/api/unprompted', { text: careerProse });
  const entry = (await entryRes.json()) as { status: string; sessionId: string };
  expect(entry.status).toBe('harvesting');
  // The record must exist before /harvest, and propose does not read the vault.
  const proposals = await waitForProposals((p) => call(app, p), entry.sessionId);
  expect(proposals.length).toBe(1);

  unreadable = true;
  const settledBefore = barrier.count;
  const harvestRes = await call(app, `/api/session/${entry.sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'approve' }],
  });
  expect(harvestRes.status).toBe(200); // the snippets are saved either way

  await barrier.waitFor(settledBefore + 1);
  const failures = readEvents(vaultDir).filter((e) => e.kind === 'docket-run-failed');
  expect(failures.length).toBe(1);
  expect(failures[0]!.detail).toContain('vault unreadable');

  // The index from before the failed run still answers — not an empty one.
  const sessRes = await call(app, '/api/session', { mode: someMode });
  const { sessionId } = (await sessRes.json()) as { sessionId: string };
  const turnRes = await call(app, `/api/session/${sessionId}/turn`, {
   text: 'What about my career direction now?',
  });
  const turn = (await turnRes.json()) as { juxtaposition?: { snippetText: string } };
  expect(turn.juxtaposition?.snippetText).toBe(careerProse);
 });

 it('serves requests while the boot docket is still running', async () => {
  const vault = createVault(vaultDir);
  const at = new Date().toISOString();
  vault.startTranscript('prior-session', {
   mode: { minutes: 10, energy: 'medium', target: 'self' },
   protocol: 'reflective',
   started: at,
  });
  vault.appendTurn('prior-session', { role: 'user', text: careerProse, at });
  vault.saveSnippet(careerProse, {
   kind: 'harvest',
   session: 'prior-session',
   question: 'What has been on your mind?',
   questionForm: 'deliberative',
  });

  const gate = gatedComplete([openerQuestion]);
  gate.close(); // the boot docket stalls on its first opener
  const barrier = docketBarrier();
  const app = await createApp({
   vault,
   complete: gate.complete,
   queue: createQueueStore(vaultDir),
   index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
   vaultRoot: vaultDir,
   authStore: createFileAuth(join(vaultDir, '.auth.json')),
   onDocketSettled: barrier.onDocketSettled,
  });

  await tick();
  expect(kindCount(vaultDir, 'run-started')).toBe(1);
  expect(barrier.count).toBe(0); // still running

  const queueRes = await call(app, '/api/queue');
  expect(queueRes.status).toBe(200);

  const sessRes = await call(app, '/api/session', { mode: someMode });
  expect(sessRes.status).toBe(200);
  const { question } = (await sessRes.json()) as { question: string };
  expect(question.length).toBeGreaterThan(0);

  const activityRes = await call(app, '/api/activity');
  expect(activityRes.status).toBe(200);
  const { events } = (await activityRes.json()) as { events: ActivityEvent[] };
  expect(events.some((e) => e.kind === 'run-started')).toBe(true);

  gate.release();
  await barrier.waitFor(1);
  expect(kindCount(vaultDir, 'docket-run')).toBe(1);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// The Clerk slice, end to end (T15)
//
// One rule governs everything below: the PRODUCT produces every state this file
// asserts on. The vault is seeded with snippets and readings — material a
// harvest writes — and after that nothing here writes a claim, a candidate, a
// contradiction or a queue entry. The re-measure is drawn by `startSession` and
// answered by `userTurn`, through the HTTP routes, because a test that staged
// `answered` would prove the Clerk can read a state nothing produces.
//
// The fake model is a ROUTER, not a script: it dispatches on the prompt and
// composes its answers out of the payload it was shown. See
// `tests/fixtures/clerk-flow.ts` for why.
// ─────────────────────────────────────────────────────────────────────────────

/** A booted app over one vault, plus the readers a test needs. */
type ClerkApp = {
 app: Hono;
 vault: Vault;
 queue: QueueStore;
 store: ClaimStore;
 router: Router;
 barrier: ReturnType<typeof docketBarrier>;
};

/**
 * Boot the REAL app over a vault directory and wait for its boot docket.
 *
 * Booting a SECOND app over the same directory is how this file takes a second
 * docket run: it is a process restart, so everything the run reads has to have
 * survived on disk. A helper that called `runWikiJobs` directly would skip the
 * wiring that ticket 063 found missing, which is the wiring under test.
 */
async function bootClerk(
 vaultDir: string,
 opts: Omit<RouterOptions, 'store'> = {},
): Promise<ClerkApp> {
 const vault = createVault(vaultDir);
 const queue = createQueueStore(vaultDir);
 const store = createClaimStore(vaultDir);
 const router = clerkRouter({ store, ...opts });
 const barrier = docketBarrier();
 const app = await createApp({
  vault,
  complete: router.complete,
  queue,
  index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
  vaultRoot: vaultDir,
  authStore: createFileAuth(join(vaultDir, '.auth.json')),
  onDocketSettled: barrier.onDocketSettled,
 });
 await barrier.waitFor(1);
 return { app, vault, queue, store, router, barrier };
}

/** One sitting's material, written through the vault the product writes through. */
function seedSitting(
 vault: Vault,
 session: string,
 question: string,
 prose: string,
 readingText: string,
): { snippetId: string; readingId: string } {
 const snippet = vault.saveSnippet(prose, {
  kind: 'harvest',
  session,
  question,
  questionForm: 'deliberative',
 });
// facet 'fact', deliberately not 'construct': a construct-facet reading is a
// half-Construct, and the ticket-027 sweep mints its contrast question into
// the queue — which this scripted router cannot absorb and the sitting would
// draw instead of the re-measure. The pipeline under test (claim → candidate
// → re-measure → confirmation) does not care what facet the seed carries.
const reading = vault.saveReading({
  facet: 'fact',
  stance: 'avowal',
  reading: readingText,
  cites: [`${snippet.id}@1`],
});
 return { snippetId: snippet.id, readingId: reading.id };
}

/** Every file under a directory, as relative paths — the deletion check's input. */
function walk(root: string, prefix = ''): string[] {
 const out: string[] = [];
 for (const name of readdirSync(join(root, prefix))) {
  const rel = prefix ? `${prefix}/${name}` : name;
  if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel));
  else out.push(rel);
 }
 return out.sort();
}

/** Move a queue entry's `created` back so `expire(30)` can reach it. */
function backdateEntry(vaultDir: string, id: string, days: number): void {
 const path = join(vaultDir, 'queue', `${id}.md`);
 const parsed = matter.read(path);
 const data = parsed.data as Record<string, unknown>;
 data['created'] = new Date(Date.now() - days * 86_400_000).toISOString();
 writeFileSync(path, matter.stringify('', data), 'utf-8');
}

describe('clerk slice: harvest to claim to contradiction', () => {
 let vaultDir: string;
 let first: ClerkApp;
 let second: ClerkApp;
 let remeasureId: string;
 let remeasureQuestion: string;
 let answerSnippetId: string;
 let filesAfterFirstRun: string[];

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-e2e-'));
  const seed = createVault(vaultDir);
  seedSitting(seed, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  seedSitting(seed, SITTING_TWO, QUESTION_TWO, PROSE_TWO, READING_TWO);
  first = await bootClerk(vaultDir);
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('mints a claim per reading, and pairs two claims minted in the SAME run (067)', () => {
  const claims = first.store.loadSlice().claims;
  expect(claims.map((c) => c.body).sort()).toEqual([BODY_ONE, BODY_TWO].sort());

  // Disk state, not an API response: every invariant Q-21 makes mandatory.
  for (const c of claims) {
   expect(c.range.trim().length).toBeGreaterThan(0);
   expect(c.model.length).toBeGreaterThan(0);
   expect(c.modelAt.length).toBeGreaterThan(0);
   expect(c.cites.length).toBeGreaterThan(0);
   expect(c.status).toBe('unconfirmed'); // Q-28: born unconfirmed, one cite
   for (const cite of c.cites) {
    const [id, version] = cite.split('@');
    expect(existsSync(join(vaultDir, 'snippets', id!, `v${version}.md`))).toBe(true);
   }
  }

  // Ticket 067's acceptance. Both claims were minted by job 1 of this run and
  // pooled by job 3 of the SAME run. A candidate here means the second prime
  // and the post-sweep graph rebuild are both real; without them the pool is
  // one run behind and this is zero.
  const candidates = first.store.listCandidates();
  expect(candidates.length).toBe(1);
  expect(candidates[0]!.status).toBe('pending-remeasure');
  expect(candidates[0]!.attempts).toBe(1);
  expect([...candidates[0]!.pair].sort()).toEqual(claims.map((c) => c.id).sort());

  filesAfterFirstRun = walk(vaultDir);
 });

 it('mints exactly ONE re-measure, and a second run adds no second candidate or entry (B9)', async () => {
  const minted = first.queue.list({ source: 'contradiction-remeasure' });
  expect(minted.length).toBe(1);
  const entry = minted[0]!;
  remeasureId = entry.id;
  remeasureQuestion = entry.question;

  expect(entry.status).toBe('pending');
  expect(entry.quotedFragment).toBeTypeOf('string');
  expect(entry.question).toContain(entry.quotedFragment!);
  // Q-15: it must read as an ordinary question. Neither claim body, and no
  // machine literal, reaches the person.
  expect(entry.question).not.toContain(BODY_ONE);
  expect(entry.question).not.toContain(BODY_TWO);
  expect(entry.question).not.toContain('contradiction-remeasure');
  // Cited to BOTH sides, so the answer is legible as evidence about both.
  expect((entry.cites ?? []).length).toBe(2);

  // A whole second process over the same vault, before any answer arrives.
  second = await bootClerk(vaultDir);
  expect(second.store.listCandidates().length).toBe(1);
  expect(second.queue.list({ source: 'contradiction-remeasure' }).length).toBe(1);
 });

 it('draws and answers the re-measure through the real turn path', async () => {
  const sessionRes = await call(second.app, '/api/session', {
   mode: { minutes: 30, energy: 'medium' },
  });
  expect(sessionRes.status).toBe(200);
  const { sessionId, question } = (await sessionRes.json()) as {
   sessionId: string;
   question: string;
  };
  // The Queue put the question on the table — nothing here chose it.
  expect(question).toBe(remeasureQuestion);

  const turnRes = await call(second.app, `/api/session/${sessionId}/turn`, {
   text: ANSWER_TEXT,
  });
  expect(turnRes.status).toBe(200);

  // `answered` reached DISK because a user turn arrived (ticket 041).
  const answered = second.queue.list({ source: 'contradiction-remeasure' })[0]!;
  expect(answered.id).toBe(remeasureId);
  expect(answered.status).toBe('answered');
  expect(answered.answeredAt).toBeTypeOf('string');

  // `call` sends POST only when a body is given, and `/end` is a POST route.
  const endRes = await call(second.app, `/api/session/${sessionId}/end`, {});
  expect(endRes.status).toBe(200);
  const endBody = (await endRes.json()) as { status: string; sessionId: string };
  expect(endBody.status).toBe('harvesting');
  const proposals = await waitForProposals((p) => call(second.app, p), sessionId);
  expect(proposals.length).toBe(1);

  const settled = second.barrier.count;
  const harvestRes = await call(second.app, `/api/session/${sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'approve' }],
  });
  expect(harvestRes.status).toBe(200);
  const { snippets } = (await harvestRes.json()) as { snippets: Array<{ id: string }> };
  expect(snippets.length).toBe(1);
  answerSnippetId = snippets[0]!.id;

  // The docket behind the harvest response is the run that confirms.
  await second.barrier.waitFor(settled + 1);
 });

 it('opens a Contradiction on the third sitting and contests both claims (Q-53, Q-30)', () => {
  const graph = second.store.loadSlice();
  expect(graph.contradictions.length).toBe(1);
  const clash = graph.contradictions[0]!;

  expect(clash.status).toBe('open');
  expect(clash.remeasureQueueId).toBe(remeasureId);
  // Q-46: the evidence is the person's own words, from the answer they gave to
  // the question that was asked — not from the corpus that raised the suspicion.
  expect(clash.evidence.snippetRef.startsWith(answerSnippetId)).toBe(true);
  expect(ANSWER_TEXT).toContain(clash.evidence.quote);
  expect(clash.model.length).toBeGreaterThan(0);

  // Mechanical, never model-written (Q-29).
  for (const c of graph.claims) expect(c.status).toBe('contested');

  const candidate = second.store.listCandidates()[0]!;
  expect(candidate.status).toBe('confirmed');
  expect(candidate.attempts).toBe(1);
 });

 it('serves the whole wiki behind the route, and records a read', async () => {
  const res = await call(second.app, '/api/wiki');
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
   facets: Array<{ facet: string; heading: string; claims: Array<{ id: string; body: string }> }>;
   contradictions: unknown[];
   lint: unknown[];
   lintedAt: string | null;
  };
  const shown = body.facets.flatMap((f) => f.claims);
  expect(shown.map((c) => c.body).sort()).toEqual([BODY_ONE, BODY_TWO].sort());
  expect(body.contradictions.length).toBe(1);
  // "Looked and found nothing" must not render as "never looked".
  expect(body.lintedAt).not.toBeNull();

  const claimId = shown[0]!.id;
  const readRes = await call(second.app, `/api/wiki/claim/${claimId}/read`, { surface: 'wiki' });
  expect(readRes.status).toBe(200);
  const onDisk = second.store.readClaim(claimId)!;
  expect(onDisk.readLog.length).toBe(1);
  expect(onDisk.readLog[0]!.surface).toBe('wiki');
 });

 it('writes the wiki jobs’ events into the Activity Log file (ticket 063)', () => {
  // Read the FILE back. A spy on `log` is what let this wiring ship missing:
  // every wiki event went into whatever a caller passed, and in production
  // there was no caller.
  const logDir = join(vaultDir, 'log');
  const raw = readdirSync(logDir)
   .map((f) => readFileSync(join(logDir, f), 'utf-8'))
   .join('');
  const lines = raw
   .split('\n')
   .filter((l) => l.trim().length > 0)
   .map((l) => JSON.parse(l) as ActivityEvent);
  const kinds = new Set(lines.map((e) => e.kind));

  // Three different emitters inside src/wiki/, all reaching the same file.
  expect(kinds.has('clash-checked')).toBe(true); // src/wiki/clash.ts
  expect(kinds.has('referent-minted')).toBe(true); // src/wiki/registry.ts
  expect(kinds.has('claim-status-changed')).toBe(true); // src/wiki/ops.ts
  // And the live-session counterpart, emitted on every turn including zero.
  expect(kinds.has('resonance-checked')).toBe(true);

  const contested = lines.filter(
   (e) => e.kind === 'claim-status-changed' && e.detail.includes('to=contested'),
  );
  expect(contested.length).toBe(2);
 });

 it('deletes nothing anywhere in the flow', () => {
  const now = new Set(walk(vaultDir));
  for (const file of filesAfterFirstRun) expect(now.has(file)).toBe(true);
 });
});

describe('clerk slice: a re-measure counts only from a different sitting (Q-53)', () => {
 let vaultDir: string;
 let app1: ClerkApp;
 let app2: ClerkApp;
 let app3: ClerkApp;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-q53-'));
  const seed = createVault(vaultDir);
  seedSitting(seed, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  seedSitting(seed, SITTING_TWO, QUESTION_TWO, PROSE_TWO, READING_TWO);
  app1 = await bootClerk(vaultDir);

  // Answer the re-measure through the real turn path, then DISCARD the cut, so
  // the entry reaches `answered` with no reading behind it. The reading that
  // follows is then the only thing job 5 can look at.
  const sessionRes = await call(app1.app, '/api/session', {
   mode: { minutes: 30, energy: 'medium' },
  });
  const { sessionId } = (await sessionRes.json()) as { sessionId: string };
  await call(app1.app, `/api/session/${sessionId}/turn`, { text: ANSWER_TEXT });
  await call(app1.app, `/api/session/${sessionId}/end`, {});
  await waitForProposals((p) => call(app1.app, p), sessionId);
  const settled = app1.barrier.count;
  await call(app1.app, `/api/session/${sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'discard' }],
  });
  await app1.barrier.waitFor(settled + 1);
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('refuses to confirm from inside a pole’s own sitting', async () => {
  expect(app1.store.listCandidates()[0]!.status).toBe('pending-remeasure');
  expect(app1.store.loadSlice().contradictions.length).toBe(0);

  // A reading that arrives AFTER the question was asked, but from sitting one —
  // the sitting one of the two claims already rests on.
  seedSitting(app1.vault, SITTING_ONE, QUESTION_ONE, PROSE_ONE_B, READING_ONE_B);
  app2 = await bootClerk(vaultDir);

  expect(app2.store.loadSlice().contradictions.length).toBe(0);
  expect(app2.store.listCandidates()[0]!.status).toBe('pending-remeasure');
  // Refused BEFORE the model was asked: `confirmingReadings` found nothing
  // admissible, so no confirmation call was made at all.
  expect(app2.router.count('confirmation')).toBe(0);
 });

 it('confirms from a sitting that is neither claim’s', async () => {
  seedSitting(app2.vault, 'sitting-gamma', 'What did the week hold?', PROSE_THIRD, READING_THIRD);
  app3 = await bootClerk(vaultDir);

  expect(app3.router.count('confirmation')).toBe(1);
  const graph = app3.store.loadSlice();
  expect(graph.contradictions.length).toBe(1);
  expect(graph.contradictions[0]!.status).toBe('open');
  expect(PROSE_THIRD).toContain(graph.contradictions[0]!.evidence.quote);
 });
});

/** The readings that sharpen the first claim rather than being kept (Q-50). */
const SHARPENING = [READING_ONE_B, READING_THIRD];

describe('clerk slice: two cites from one sitting are not independent (Q-50)', () => {
 let vaultDir: string;
 let app: ClerkApp;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-q50-'));
  const seed = createVault(vaultDir);
  seedSitting(seed, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  app = await bootClerk(vaultDir, { sharpens: SHARPENING });
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('stays unconfirmed on a SECOND cite from the same sitting', async () => {
  const before = app.store.loadSlice().claims;
  expect(before.length).toBe(1);
  expect(before[0]!.cites.length).toBe(1);
  expect(before[0]!.status).toBe('unconfirmed');

  // A second snippet, a second reading, a second cite — all in sitting one.
  seedSitting(app.vault, SITTING_ONE, QUESTION_ONE, PROSE_ONE_B, READING_ONE_B);
  const next = await bootClerk(vaultDir, { sharpens: SHARPENING });

  const claim = next.store.loadSlice().claims[0]!;
  expect(claim.cites.length).toBe(2);
  // This is the line most likely to read as a bug: two cites, still
  // unconfirmed. Q-50 is what `evidenced` means — a claim survived being
  // approached again on a DIFFERENT DAY, not twice in one conversation.
  expect(claim.status).toBe('unconfirmed');
  app = next;
 });

 it('becomes evidenced on a cite from a second sitting', async () => {
  seedSitting(app.vault, 'sitting-gamma', 'What did the week hold?', PROSE_THIRD, READING_THIRD);
  const next = await bootClerk(vaultDir, { sharpens: SHARPENING });

  const claim = next.store.loadSlice().claims[0]!;
  expect(claim.cites.length).toBe(3);
  expect(claim.status).toBe('evidenced');
 });
});

describe('clerk slice: an expired re-measure earns exactly one more attempt (Q-53)', () => {
 let vaultDir: string;
 let app: ClerkApp;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-attempts-'));
  const seed = createVault(vaultDir);
  seedSitting(seed, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  seedSitting(seed, SITTING_TWO, QUESTION_TWO, PROSE_TWO, READING_TWO);
  app = await bootClerk(vaultDir);
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('re-proposes the pair once after an expiry, then retires it', async () => {
  const firstEntry = app.queue.list({ source: 'contradiction-remeasure' })[0]!;
  expect(app.store.listCandidates()[0]!.attempts).toBe(1);

  // A month passes and nobody opened the app. Silence is not a verdict.
  backdateEntry(vaultDir, firstEntry.id, 40);
  app = await bootClerk(vaultDir);

  const dissolved = app.store.listCandidates();
  expect(dissolved.length).toBe(1);
  expect(dissolved[0]!.status).toBe('dissolved');
  expect(dissolved[0]!.outcome).toBe('remeasure-expired');
  // The counter survived the round trip through the candidate file.
  expect(dissolved[0]!.attempts).toBe(1);

  // The next run re-proposes it — exactly once — and the new record is born
  // knowing it is a second attempt.
  app = await bootClerk(vaultDir);
  const afterRepropose = app.store.listCandidates();
  expect(afterRepropose.length).toBe(2);
  const second = afterRepropose.find((c) => c.status === 'pending-remeasure')!;
  expect(second.attempts).toBe(2);
  const entries = app.queue.list({ source: 'contradiction-remeasure' });
  expect(entries.length).toBe(2);

  // Expire the second one too.
  const secondEntry = entries.find((e) => e.id !== firstEntry.id)!;
  backdateEntry(vaultDir, secondEntry.id, 40);
  app = await bootClerk(vaultDir);
  expect(app.store.listCandidates().filter((c) => c.status === 'dissolved').length).toBe(2);

  // And now it is retired: no third record, no third question, forever.
  app = await bootClerk(vaultDir);
  expect(app.store.listCandidates().length).toBe(2);
  expect(app.queue.list({ source: 'contradiction-remeasure' }).length).toBe(2);
 });
});

describe('clerk slice: every model call failing still completes the run', () => {
 let vaultDir: string;
 let app: ClerkApp;
 let seeded: string[];

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-dead-'));
  const seed = createVault(vaultDir);
  seedSitting(seed, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  seedSitting(seed, SITTING_TWO, QUESTION_TWO, PROSE_TWO, READING_TWO);
  seeded = walk(vaultDir);
  app = await bootClerk(vaultDir, { failEverything: true });
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('finishes every job, writes the ledger, and loses no file', async () => {
  const logDir = join(vaultDir, 'log');
  const kinds = new Set(
   readdirSync(logDir)
    .flatMap((f) => readFileSync(join(logDir, f), 'utf-8').split('\n'))
    .filter((l) => l.trim().length > 0)
    .map((l) => (JSON.parse(l) as ActivityEvent).kind),
  );

  // Job 1 failed on both readings, per reading, and said so.
  expect(kinds.has('mint-call-failed')).toBe(true);
  // Jobs after it still ran: the pool looked, and the docket finished.
  expect(kinds.has('clash-checked')).toBe(true);
  expect(kinds.has('index-rebuilt')).toBe(true);
  expect(kinds.has('expired')).toBe(true);
  expect(kinds.has('docket-run')).toBe(true);
  expect(kinds.has('docket-run-failed')).toBe(false);

  // Nothing was written that a failed call could have half-written…
  expect(app.store.loadSlice().claims.length).toBe(0);
  expect(app.store.listCandidates().length).toBe(0);
  // …and the attempts ARE on the ledger, so the back-off rule has its input.
  const ledger = readFileSync(join(vaultDir, 'wiki', 'sweep-log.jsonl'), 'utf-8');
  expect(ledger.split('\n').filter((l) => l.includes('"REJECTED"')).length).toBe(2);

  // The app still answers.
  const res = await call(app.app, '/api/wiki');
  expect(res.status).toBe(200);

  const now = new Set(walk(vaultDir));
  for (const file of seeded) expect(now.has(file)).toBe(true);
 });
});

/**
 * CHARACTERIZATION: the presweep confirmation pass opens the Contradiction
 * before the sweep can strand the re-measure (ticket 070).
 *
 * Before the fix, job 1 (sweep) absorbed the re-measure answer's cite into a
 * pole claim via UPDATE, and job 5 (confirmation) then computed the
 * held-sittings set from the POST-SWEEP claims — which included the answer's
 * own sitting. Q-53 correctly refused every reading, and the candidate was
 * stranded permanently at `pending-remeasure`.
 *
 * The fix adds a pre-sweep confirmation pass (jobPresweepConfirmation) that
 * judges any `pending-remeasure` candidate whose queue entry is `answered`
 * BEFORE the sweep, against a graph where the cite is not yet on any pole.
 * The answer's sitting is therefore admissible, Q-53 passes, and the
 * Contradiction opens. jobConfirmation (job 5) still runs after the sweep as
 * a safety net; it skips any candidate this pass already judged.
 */
describe('clerk slice: presweep confirmation opens the Contradiction before the sweep can strand it (ticket 070, CHARACTERIZATION)', () => {
 let vaultDir: string;
 let app: ClerkApp;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-strand-'));
  const seed = createVault(vaultDir);
  seedSitting(seed, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  seedSitting(seed, SITTING_TWO, QUESTION_TWO, PROSE_TWO, READING_TWO);
  // The only difference from the main flow: the answer's reading sharpens a
  // pole instead of being kept.
  app = await bootClerk(vaultDir, { sharpens: [ANSWER_READING] });

  const sessionRes = await call(app.app, '/api/session', {
   mode: { minutes: 30, energy: 'medium' },
  });
  const { sessionId } = (await sessionRes.json()) as { sessionId: string };
  await call(app.app, `/api/session/${sessionId}/turn`, { text: ANSWER_TEXT });
  await call(app.app, `/api/session/${sessionId}/end`, {});
  await waitForProposals((p) => call(app.app, p), sessionId);
  const settled = app.barrier.count;
  await call(app.app, `/api/session/${sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'approve' }],
  });
  await app.barrier.waitFor(settled + 1);
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('opens a Contradiction from the pre-sweep pass, and the candidate is confirmed', async () => {
  // The answer's cite was still absorbed by the sweep — that part is fine.
  const claims = app.store.loadSlice().claims;
  const sharpened = claims.find((c) => c.body === BODY_ONE)!;
  expect(sharpened.cites.length).toBe(2);

  // The presweep pass judged the confirmation before the sweep ran.
  expect(app.router.count('confirmation')).toBe(1);
  expect(app.store.loadSlice().contradictions.length).toBe(1);

  // Another run sees the confirmed candidate, not a stranded one.
  const next = await bootClerk(vaultDir, { sharpens: [ANSWER_READING] });
  expect(next.store.listCandidates().length).toBe(1);
  expect(next.store.listCandidates()[0]!.status).toBe('confirmed');
  expect(next.store.loadSlice().contradictions.length).toBe(1);
 });
});

/**
 * Ticket 067's fix, at the only place it is observable.
 *
 * Ticket 118 graduated `clash.embeddingCosine` live (5,154 shadow records,
 * 2,845 cross-sitting pairs on the real vault). The channel now returns live
 * pairs instead of shadow records. The prime-before-pool invariant (067) still
 * holds: a pair of claims born in the SAME run appears in the live clash pool.
 *
 * The embedder is a fake that gives every body one vector, so the cosine is 1
 * and the threshold is not what is under test — the cache is.
 */
describe('clerk slice: the embedding channel sees claims minted this run (067)', () => {
 let vaultDir: string;

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('pools a pair both minted in the run that pooled them', async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-embed-'));
  const vault = createVault(vaultDir);
  seedSitting(vault, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  seedSitting(vault, SITTING_TWO, QUESTION_TWO, PROSE_TWO, READING_TWO);

  const embedded: string[][] = [];
  const embed = async (texts: string[]): Promise<number[][]> => {
   embedded.push(texts);
   return texts.map(() => [1, 0, 0]);
  };

  const queue = createQueueStore(vaultDir);
  const store = createClaimStore(vaultDir);
  const router = clerkRouter({ store });
  const barrier = docketBarrier();
  await createApp({
   vault,
   complete: router.complete,
   queue,
   index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
   vaultRoot: vaultDir,
   authStore: createFileAuth(join(vaultDir, '.auth.json')),
   embed: { embed, model: 'fake-embedder' },
   onDocketSettled: barrier.onDocketSettled,
  });
  await barrier.waitFor(1);

  const claims = store.loadSlice().claims;
  expect(claims.length).toBe(2);

  // The pre-run prime saw an empty wiki. Everything embedded was embedded by
  // job 1.5, after the sweep, and only what the sweep touched.
  expect(embedded.length).toBe(1);
  expect(embedded[0]!.length).toBe(2);

  // Ticket 118: graduated live — no shadow records from this channel.
  const shadow = readEvents(vaultDir).filter(
   (e) => e.kind === 'shadow-decision' && e.detail.includes('clash.embeddingCosine'),
  );
  expect(shadow).toEqual([]);

  // The live channel contributed the pair to the pool.
  const checked = readEvents(vaultDir).find((e) => e.kind === 'clash-checked')!;
  expect(checked.detail).toContain('embedding:1');
 });
});

/**
 * Q-46, at the seam it protects: a Contradiction that cannot name the person's
 * words does not open.
 *
 * The model here does the thing a model does — it confirms fluently, with a
 * quote that reads exactly like the person and appears in nothing they wrote.
 * Three structural checks stand between that and a claim going `contested`, and
 * this is the run that asks whether they are wired up rather than merely
 * written. Everything else in this file quotes verbatim, so without this case
 * the checks could be deleted and the whole suite would stay green — which is
 * how the check would rot.
 */
describe('clerk slice: a fabricated confirming quote opens nothing (Q-46)', () => {
 let vaultDir: string;
 let app: ClerkApp;

 beforeAll(async () => {
  vaultDir = mkdtempSync(join(tmpdir(), 'elicit-clerk-fabricated-'));
  const seed = createVault(vaultDir);
  seedSitting(seed, SITTING_ONE, QUESTION_ONE, PROSE_ONE, READING_ONE);
  seedSitting(seed, SITTING_TWO, QUESTION_TWO, PROSE_TWO, READING_TWO);
  app = await bootClerk(vaultDir, { fabricateQuote: true });

  const sessionRes = await call(app.app, '/api/session', {
   mode: { minutes: 30, energy: 'medium' },
  });
  const { sessionId } = (await sessionRes.json()) as { sessionId: string };
  await call(app.app, `/api/session/${sessionId}/turn`, { text: ANSWER_TEXT });
  await call(app.app, `/api/session/${sessionId}/end`, {});
  await waitForProposals((p) => call(app.app, p), sessionId);
  const settled = app.barrier.count;
  await call(app.app, `/api/session/${sessionId}/harvest`, {
   decisions: [{ proposal: 0, action: 'approve' }],
  });
  await app.barrier.waitFor(settled + 1);
 });

 afterAll(() => {
  rmSync(vaultDir, { recursive: true, force: true });
 });

 it('refuses the confirmation and records WHY, apart from an honest no', () => {
  // The model was asked, and it said yes.
  expect(app.router.count('confirmation')).toBe(1);
  expect(ANSWER_TEXT).not.toContain(FABRICATED_QUOTE);

  // Nothing opened, and no claim was contested on it.
  const graph = app.store.loadSlice();
  expect(graph.contradictions.length).toBe(0);
  for (const c of graph.claims) expect(c.status).not.toBe('contested');

  // The pair is retired with the reason of record that separates "the model
  // could not produce the evidence" from "the person said no" — the ratio T16
  // reads to find out what the self-reported boolean was worth.
  const candidate = app.store.listCandidates()[0]!;
  expect(candidate.status).toBe('dissolved');
  expect(candidate.outcome).toBe('unverified-confirmation');
 });
});
