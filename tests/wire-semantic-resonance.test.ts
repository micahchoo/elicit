import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { createFileAuth } from '../src/auth/auth.js';
import { buildIndex } from '../src/index/lexical.js';
import {
 buildSemanticIndex,
 fileSnippetVectorStore,
 quotablePhrase,
 type SemanticIndex,
} from '../src/index/semantic.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import { createApp } from '../src/server.js';
import { startSession, userTurn } from '../src/elicitor/elicitor.js';
import { makeScriptedComplete } from './fakes.js';
import type { Snippet } from '../src/types.js';
import type { Embed } from '../src/wiki/embedding.js';
import { PAIRS, DISTRACTORS } from './fixtures/paraphrase-pairs.js';
import { MODEL, RECORDED_VECTORS } from './fixtures/semantic-vectors.js';

/**
 * Ticket 068 — the wiring. 053 built the semantic resonance channel and
 * measured it; this file proves the surfaces actually USE it.
 *
 * Every retrieval below runs through the real app (`createApp` +
 * `app.fetch`) or the real elicitor session, on the recorded geometry of the
 * real model — the same fixture `tests/resonance-paraphrase.test.ts`
 * measures. A test asserting a function was called would prove nothing here;
 * these assert the juxtaposition a person would see.
 */

function snip(id: string, prose: string): Snippet {
 return {
  id,
  version: 1,
  captured: '2026-03-14T09:00:00.000Z',
  provenance: {
   kind: 'harvest' as const,
   session: 'wire-068',
   question: 'what did you notice about yourself this week?',
   questionForm: 'deliberative' as const,
  },
  prose,
 };
}

/** The standing corpus: 8 belief pairs plus the eval's 3 distractors. */
const VAULT: Snippet[] = [
 ...PAIRS.map((p, i) => snip(`pair-${i}`, p.stored)),
 ...DISTRACTORS.map((d, i) => snip(`distractor-${i}`, d)),
];

/** The recorded geometry. Refuses an unknown text rather than inventing one. */
function recorded(): Embed & { calls: number } {
 const embed = async (texts: string[]) =>
  texts.map((t) => {
   const v = RECORDED_VECTORS[t];
   if (!v) throw new Error(`no recorded vector for ${JSON.stringify(t)}`);
   embed.calls++;
   return v;
  });
 embed.calls = 0;
 return embed;
}

const dirs: string[] = [];
afterAll(() => {
 for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Boot the real app over a fresh vault holding the standing corpus.
 * `withSemantic` chooses whether the semantic channel is handed in — absent
 * is the cold state, in which the hybrid degrades to the trigram index.
 */
async function bootApp(
 withSemantic: boolean,
): Promise<{ app: Hono; embed: ReturnType<typeof recorded> }> {
 const dir = mkdtempSync(join(tmpdir(), 'elicit-068-'));
 dirs.push(dir);
 const vault = createVault(dir);
 for (const s of VAULT) vault.saveSnippet(s.prose, s.provenance);
 const snippets = Object.values(vault.rebuildIndex().snippets);

 const embed = recorded();
 const semantic: SemanticIndex | undefined = withSemantic
  ? buildSemanticIndex(snippets, {
   embed,
   model: MODEL,
   store: fileSnippetVectorStore(dir),
   log: () => { },
  })
  : undefined;
 if (semantic) await semantic.prime();

 const app = await createApp({
  vault,
  complete: makeFakeComplete(),
  queue: createQueueStore(dir),
  index: buildIndex(snippets),
  ...(semantic ? { semanticIndex: semantic } : {}),
  vaultRoot: dir,
  authStore: createFileAuth(join(dir, '.auth.json')),
 });
 return { app, embed };
}

const ENV = { remoteAddr: '127.0.0.1' };

async function post(app: Hono, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
 const res = await app.fetch(
  new Request(`http://127.0.0.1${path}`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify(body),
  }),
  ENV,
 );
 return { status: res.status, body: await res.json() };
}

/** One full turn: create a sitting, answer with `text`, read the response. */
async function turn(app: Hono, text: string): Promise<{ status: number; body: unknown }> {
 const session = await post(app, '/api/session', {
  mode: { target: 'self' },
 });
 if (typeof session.body !== 'object' || session.body === null || !('sessionId' in session.body)) {
  throw new Error(`session response carried no sessionId: ${JSON.stringify(session.body)}`);
 }
 const id: unknown = session.body.sessionId;
 if (typeof id !== 'string') throw new Error(`sessionId was not a string: ${JSON.stringify(session.body)}`);
 return post(app, `/api/session/${id}/turn`, { text });
}

/**
 * The juxtaposition the turn response surfaces, or undefined when the turn
 * surfaced none. A live endpoint response is untyped JSON; this is the whole
 * checked surface the assertions below read.
 */
function juxtapositionOf(body: unknown): { snippetText: string; snippetDate: string } | undefined {
 if (typeof body !== 'object' || body === null || !('juxtaposition' in body)) return undefined;
 const j = (body as { juxtaposition: unknown }).juxtaposition;
 if (typeof j !== 'object' || j === null || !('snippetText' in j) || !('snippetDate' in j)) {
  return undefined;
 }
 const snippetText: unknown = j.snippetText;
 const snippetDate: unknown = j.snippetDate;
 if (typeof snippetText !== 'string' || typeof snippetDate !== 'string') return undefined;
 return { snippetText, snippetDate };
}

describe('quotablePhrase — the 068 ruling', () => {
 it('is always a verbatim substring of the snippet, at least three words', () => {
  for (const pair of PAIRS) {
   const phrase = quotablePhrase(pair.stored);
   expect(pair.stored, pair.label).toContain(phrase);
   expect(phrase.split(/\s+/).length, pair.label).toBeGreaterThanOrEqual(3);
  }
 });

 it('quotes the first words of a snippet', () => {
  expect(quotablePhrase('I only finish things when someone else is waiting on them')).toBe(
   'I only finish things',
  );
 });
});

describe('the server surfaces semantic resonance (ticket 068)', () => {
 it('a paraphrase with no shared phrase surfaces the snippet — today it surfaced nothing', async () => {
  const { app } = await bootApp(true);
  const { status, body } = await turn(app, PAIRS[1]!.restated);
  expect(status).toBe(200);
  // The vault stamps `captured` at save time, so the date is today's; the
  // surface fact that matters is WHICH snippet the paraphrase surfaced.
  const j = juxtapositionOf(body);
  if (!j) throw new Error('expected a juxtaposition in the turn response');
  expect(j.snippetText).toBe(PAIRS[1]!.stored);
  expect(j.snippetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 });

 it('without the semantic channel the same turn surfaces nothing', async () => {
  const { app } = await bootApp(false);
  const { status, body } = await turn(app, PAIRS[1]!.restated);
  expect(status).toBe(200);
  expect(juxtapositionOf(body)).toBeUndefined();
 });

 it('lexical hits still surface first — today behaviour is unchanged where lexical finds something', async () => {
  const { app } = await bootApp(true);
  // Re-say pair-0 in its original words: the trigram index finds it, so the
  // juxtaposition comes from the lexical arm exactly as before 068.
  const { body } = await turn(
   app,
   'I default to hedging in whichever direction is socially cheaper, honestly.',
  );
  const j = juxtapositionOf(body);
  if (!j) throw new Error('expected a juxtaposition in the turn response');
  expect(j.snippetText).toBe(PAIRS[0]!.stored);
 });
});

describe('the elicitor priority-1 juxtaposition quotes the snippet (068 ruling)', () => {
 it('composes from a semantic hit using the snippet own words, not an invented phrase', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'elicit-068-'));
  dirs.push(dir);
  try {
   const vault = createVault(dir);
   for (const s of VAULT) vault.saveSnippet(s.prose, s.provenance);
   const snippets = Object.values(vault.rebuildIndex().snippets);

   const semantic = buildSemanticIndex(snippets, {
    embed: recorded(),
    model: MODEL,
    store: fileSnippetVectorStore(dir),
    log: () => { },
   });
   await semantic.prime();

   // The 068 ruling in action: the scripted question quotes the snippet's
   // own words, and Q-12 accepts it because those words are verbatim.
   const phrase = quotablePhrase(PAIRS[1]!.stored);
   const composed = `Back then you wrote "${phrase}" — how is that different now?`;
   const session = startSession(
    {},
    {
     complete: makeScriptedComplete([composed]),
     vault,
     queue: createQueueStore(dir),
     index: buildIndex(snippets),
     semantic,
    },
   );

   const result = await userTurn(session, PAIRS[1]!.restated);
   expect(result.kind).toBe('probe');
   if (result.kind === 'probe') {
    expect(result.provenance).toBe('juxtaposition');
    expect(result.text).toBe(composed);
   }
  } finally {
   rmSync(dir, { recursive: true, force: true });
  }
 });
});
