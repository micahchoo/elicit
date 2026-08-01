import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createApp } from '../src/server.js';

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

/** Three responses: two probes for the elicitor, one JSON cuts for the harvester. */
const scriptedResponses = [
  'What do you mean by "career direction"?',
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
    const app = createApp({ vault, complete });
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
    expect(turn1.text).toBe(scriptedResponses[0]);

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
    expect(turn2.text).toBe(scriptedResponses[1]);

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
    });
    expect(transcriptParsed.data.protocol).toBe('reflective-interview');

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
});
