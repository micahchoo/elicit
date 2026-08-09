/**
 * The wiki cluster (Wave D1 extraction): GET /api/wiki (the page render —
 * now the contextualizer's passages view, §11, a pure function in
 * src/wiki/page.ts the route gathers inputs for and stamps over) and the
 * claim verbs read/attest/edit/challenge/direction plus the six margin
 * verbs narrower/unlink/push-down (Batch A, ruling 2026-08-08), moved
 * wholesale out of src/server.ts. Wire shapes, route paths, log kinds, and
 * error statuses are byte-identical to the pre-extraction server.
 *
 * Batch B (the contextualizer, ruling 2026-08-08): the GET response becomes
 * your passages grouped into neighborhoods, each with a context line; the
 * claim apparatus recedes from the SURFACE, never from the vault. The claim
 * routes below stay — /v2 personas and the read-log instrument still speak
 * them, and the trial may return the claim essay. The page's own verbs are
 * the contextualizer's three (fix the context line's facts, unlink an echo,
 * make this a direction) plus the passage read that drives the lens.
 *
 * The GET route below is a READ route. The POST verbs beneath it are the
 * user's (the read-log records a reading; attest and the claim edit are
 * user verbs, Q-33) and the agent's (challenge asks a question). The edit
 * is the ONE route that rewrites a claim's body, and it is a user verb:
 * the op vocabulary has no word for it, and the validator rejects the one
 * UPDATE that tries (Q-29's shapes are the guard, not this comment).
 */
import type { Context, Hono } from 'hono';
import type { ClerkHandles } from '../clerk/docket-init.js';
import type { CoachStore } from '../coach/store.js';
import { readTranscripts } from '../vault/transcripts.js';
import { surfaced } from '../log/surfaced.js';
import { openQuestionEntry } from '../queue/open-question.js';
import type { ServerEmitFn } from '../session/routes.js';
import type { ClaimGraph } from './contract.js';
import { readNeighborhoods } from './neighborhoods.js';
import { readContextLines, readPassageReads, recordPassageRead, writeContextLines } from './store.js';
import type { QueueStore, Vault } from '../types.js';
import { renderWikiPage, type Freshness } from './page.js';

/**
 * The bindings the wiki handlers close over. `clerk` is the ClerkHandles
 * object server.ts owns — `lastLint` is a LIVE accessor on it, so the GET
 * handler reads `clerk.lastLint` at request time and never destructures a
 * snapshot. `coachStore` is a GETTER (never a value): createClerk runs
 * before the store exists, so the boot wires `coachStore: () => coachStore`
 * and every use resolves at request time (the same late binding
 * createClerk's own deps use).
 */
interface WikiDeps {
 /** The vault — rebuildIndex feeds the page; saveSnippet records the edit verbatim. */
 vault: Vault;
 /** The queue store — the challenge verb mints exactly one open question. */
 queue: QueueStore;
 vaultRoot: string;
 /** The Clerk handles — claimStore for the verbs, lastLint read live per request. */
 clerk: ClerkHandles;
 /** The coach store GETTER — the direction verb creates an un-coached Direction through it (Q-110 door 2). */
 coachStore: () => CoachStore;
 /** The server's activity-log seam. */
 serverEmit: ServerEmitFn;
 /** The x-elicit-pure read detector (129): the page stamps nothing under it. */
 isPureRead: (c: Context) => boolean;
}

/**
 * Register the wiki cluster: the page route and the contextualizer's
 * passage verbs, plus the claim verb routes retained for the /v2 personas
 * and the read-log instrument. Called exactly once at app build.
 */
export function createWikiRoutes(app: Hono, deps: WikiDeps): void {
 const clerk = deps.clerk;
 const { serverEmit, isPureRead } = deps;

 // GET /api/wiki[?all=1] → your passages grouped into neighborhoods (the
 // contextualizer, §11). The claim apparatus is not in the payload — the
 // lens, the context lines and the exhibits are. `?all=1` is accepted for
 // wire compatibility; the passages view is the whole record by
 // construction (nothing on this page is set aside).
 app.get('/api/wiki', (c) => {
  const all = c.req.query('all') === '1';
  const contents = deps.vault.rebuildIndex();
  const passages = Object.values(contents.snippets);
  const graph: ClaimGraph = {
   ...clerk.claimStore.loadSlice(),
   snippets: contents.snippets,
   readings: contents.readings,
  };

  // The lint stamp is read LIVE: a docket run may settle between requests,
  // and `clerk.lastLint` is an accessor, never a snapshot. The FINDINGS
  // themselves are claim-addressed and do not ride the passages view.
  const lint = clerk.lastLint;

  // Freshness (wave 5, §11): the since-last-read lens's read-through facts.
  // readThrough = the latest read across every passage's readLog — and,
  // for a vault that has claim reads from the old essay, across those too
  // (the claim vault is not deleted; its reads still say when the person
  // was last here). The sitting census counts non-import sittings only.
  // Computed HERE because the census reads disk; page.ts stays pure-shape.
  let readThrough: string | null = null;
  for (const cl of graph.claims) {
   for (const entry of cl.readLog) {
    if (readThrough === null || entry.at > readThrough) readThrough = entry.at;
   }
  }
  for (const r of readPassageReads(deps.vaultRoot)) {
   if (readThrough === null || r.at > readThrough) readThrough = r.at;
  }
  const sittingStarted: string[] = [];
  for (const t of readTranscripts(deps.vaultRoot)) {
   if (t.protocol === 'import') continue;
   if (t.started === '') continue;
   if (Number.isNaN(Date.parse(t.started))) continue;
   sittingStarted.push(t.started);
  }
  sittingStarted.sort();
  const freshness: Freshness = {
   readThrough,
   sittingsBehind: readThrough === null ? 0 : sittingStarted.filter((s) => s > readThrough).length,
   lastSittingAt: sittingStarted.length > 0 ? (sittingStarted[sittingStarted.length - 1] ?? null) : null,
  };

  // C1's clustering store, or null when the job has not run yet — the
  // render's lexical fallback covers that case (one exported function).
  const neighborhoodStore = readNeighborhoods(deps.vaultRoot);

  // B2's context lines, keyed by passage id. An empty store means the
  // context job has not run — the client renders the mechanical fallback.
  const contextLines = new Map(readContextLines(deps.vaultRoot).map((l) => [l.passageId, l]));

  // The pure shaping (grouping, ordering, context attachment) lives in
  // src/wiki/page.ts — one function, no I/O.
  const page = renderWikiPage({
   all,
   passages,
   neighborhoods: neighborhoodStore?.clusters ?? null,
   contextLines,
   contradictions: graph.contradictions,
   freshness,
   lintedAt: lint?.at ?? null,
  });

  // Usage stamps (015): every passage this page serves is surfaced, one
  // line per passage. A pure read stamps nothing (129): under /v2 the
  // stamp is an explicit act {v:'read'} per passage.
  if (!isPureRead(c)) {
   for (const passage of passages) {
    surfaced(deps.vaultRoot, [passage.id], 'wiki');
   }
  }

  return c.json(page);
 });

 // POST /api/wiki/passage/:id/read {surface?} → records that the passage was read
 //
 // Q-21's looping-effect instrument, now on the passage the essay actually
 // renders: the dwell watch posts this, and the read-through it builds is
 // what the since-last-read lens recedes against.
 app.post('/api/wiki/passage/:id/read', async (c) => {
  const id = c.req.param('id');
  const index = deps.vault.rebuildIndex();
  if (!index.snippets[id]) return c.json({ error: 'unknown passage' }, 404);

  let surface = 'wiki';
  try {
   const body = await c.req.json<{ surface?: unknown }>();
   if (typeof body.surface === 'string' && body.surface.trim() !== '') {
    surface = body.surface.trim();
   }
  } catch {
   // No body, or not JSON. The wiki is the only surface that reads
   // passages today, so the default is the answer rather than an error.
  }

  recordPassageRead(deps.vaultRoot, id, new Date().toISOString(), surface);
  return c.json({ ok: true });
 });

 // POST /api/wiki/passage/:id/context-fix — the contextualizer's correcting
 // verb (Batch B, §11): "fix the context line's facts".
 //
 // The context line is agent ink, never quotable — but it is the agent's
 // FACTS, and the person may correct them. The verb rewrites the line's
 // text, keeps its echo citations, and stamps `at` (a corrected line is a
 // new line under the lens). The model stamp is dropped: these words are
 // the person's, not a Q-34 model product (the store contract, B2).
 app.post('/api/wiki/passage/:id/context-fix', async (c) => {
  const id = c.req.param('id');
  const index = deps.vault.rebuildIndex();
  if (!index.snippets[id]) return c.json({ error: 'unknown passage' }, 404);

  let text: unknown;
  try {
   text = (await c.req.json<{ text?: unknown }>()).text;
  } catch {
   return c.json({ error: 'the corrected line is required' }, 400);
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
   return c.json({ error: 'the corrected line is required' }, 400);
  }

  const lines = readContextLines(deps.vaultRoot);
  const idx = lines.findIndex((l) => l.passageId === id);
  if (idx === -1) return c.json({ error: 'no context line to fix' }, 400);
  const updated = {
   passageId: id,
   text: text.trim(),
   echoes: lines[idx]!.echoes,
   at: new Date().toISOString(),
  };
  lines[idx] = updated;
  writeContextLines(deps.vaultRoot, lines);
  return c.json({ ok: true });
 });

 // POST /api/wiki/passage/:id/unlink-echo — the contextualizer's detaching
 // verb (Batch B, §11): "unlink an echo that is not one".
 //
 // Detaches ONE cited echo (a passage id) from the context line's echoes
 // and stamps `at` like the other mutations. Refuses when the line does not
 // carry the echo (400) and when there is no line to edit (400). The line's
 // text is untouched — the citation leaves, the words stay.
 app.post('/api/wiki/passage/:id/unlink-echo', async (c) => {
  const id = c.req.param('id');
  const index = deps.vault.rebuildIndex();
  if (!index.snippets[id]) return c.json({ error: 'unknown passage' }, 404);

  let echo: unknown;
  try {
   echo = (await c.req.json<{ echo?: unknown }>()).echo;
  } catch {
   return c.json({ error: 'the echo is required' }, 400);
  }
  if (typeof echo !== 'string' || echo.trim() === '') {
   return c.json({ error: 'the echo is required' }, 400);
  }

  const lines = readContextLines(deps.vaultRoot);
  const idx = lines.findIndex((l) => l.passageId === id);
  if (idx === -1) return c.json({ error: 'no context line to edit' }, 400);
  const line = lines[idx]!;
  if (!line.echoes.includes(echo.trim())) return c.json({ error: 'no such echo' }, 400);
  const updated = {
   ...line,
   echoes: line.echoes.filter((e) => e !== echo.trim()),
   at: new Date().toISOString(),
  };
  lines[idx] = updated;
  writeContextLines(deps.vaultRoot, lines);
  return c.json({ ok: true });
 });

 // POST /api/wiki/passage/:id/direction — Q-110 door 2, passage edition:
 // make a Direction from a passage. Creates an un-coached DirectionRecord
 // whose name is the passage's words. Accepting a coach offer later remains
 // the only act that makes it coached (Q-73). Idempotent on name.
 app.post('/api/wiki/passage/:id/direction', async (c) => {
  const id = c.req.param('id');
  const index = deps.vault.rebuildIndex();
  const passage = index.snippets[id];
  if (!passage) return c.json({ error: 'unknown passage' }, 404);
  const direction = deps.coachStore().createUncoached(passage.prose);
  serverEmit(deps.vaultRoot, 'elicitor', 'direction-created',
   `slug=${direction.slug} via=wiki-passage passage=${id}`);
  return c.json({ direction });
 });

 // GET /api/wiki/claim/:id → one claim, for the /v2 personas
 //
 // The contextualizer page carries no claims (Batch B, §11) — but the
 // claim vault is not deleted, and the /v2 personas still open a claim by
 // id to speak its verbs. This is the read-one seam the page used to be:
 // the claim itself, or 404. No essay rendering happens here.
 app.get('/api/wiki/claim/:id', (c) => {
  const id = c.req.param('id');
  const claim = clerk.claimStore.readClaim(id);
  if (!claim) return c.json({ error: 'unknown claim' }, 404);
  return c.json({ claim });
 });

 // POST /api/wiki/claim/:id/read {surface?} → records that the claim was read
 //
 // Q-21's looping-effect instrument, retained for the /v2 personas and the
 // claim essay's eventual return. The contextualizer page records passage
 // reads instead; the claim vault is not deleted, and neither is its
 // read-log.
 app.post('/api/wiki/claim/:id/read', async (c) => {
  const id = c.req.param('id');
  // Checked before the body is read: `recordRead` throws on a missing claim,
  // and a 404 is the honest answer to a surface that asked about one.
  if (!clerk.claimStore.readClaim(id)) return c.json({ error: 'unknown claim' }, 404);

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

 // POST /api/wiki/claim/:id/narrower — the user's range-narrowing verb
 // (the six margin verbs, ruling 2026-08-08). Edits ONLY the claim's range —
 // the context clause where the claim holds ("at work", "since the move") —
 // and stamps updated like the other mutations. The body, cites and status
 // are untouched; status stays mechanical (Q-29). The range guard is the
 // store's own: a non-empty trimmed string, exactly what writeClaim
 // validates on the way out. (There is no span-of-body check anywhere in the
 // claim model — the range is a context clause, not a quotation.)
 app.post('/api/wiki/claim/:id/narrower', async (c) => {
  const id = c.req.param('id');
  if (!clerk.claimStore.readClaim(id)) return c.json({ error: 'unknown claim' }, 404);

  let range: unknown;
  try {
    range = (await c.req.json<{ range?: unknown }>()).range;
  } catch {
    return c.json({ error: 'range is required' }, 400);
  }
  if (typeof range !== 'string' || range.trim() === '') {
    return c.json({ error: 'range is required' }, 400);
  }

  const updated = clerk.claimStore.narrow(id, range.trim());
  if (!updated) return c.json({ error: 'unknown claim' }, 404);
  return c.json({ ok: true });
 });

 // POST /api/wiki/claim/:id/unlink — the user's cite-detaching verb (the six
 // margin verbs, ruling 2026-08-08). Detaches ONE "snippetId@version" cite
 // from the claim's cites and stamps updated. Refuses when the claim does
 // not carry the cite (400), and refuses to leave a claim citeless (400 —
 // Q-21: a claim with no evidence is an opinion; push it down or rewrite it
 // instead). Status stays mechanical (Q-29).
 app.post('/api/wiki/claim/:id/unlink', async (c) => {
  const id = c.req.param('id');

  let cite: unknown;
  try {
    cite = (await c.req.json<{ cite?: unknown }>()).cite;
  } catch {
    return c.json({ error: 'cite is required' }, 400);
  }
  if (typeof cite !== 'string' || cite.trim() === '') {
    return c.json({ error: 'cite is required' }, 400);
  }

  const result = clerk.claimStore.unlink(id, cite.trim());
  if (!result.ok) {
    const status = result.reason === 'no-claim' ? 404 : 400;
    const error = result.reason === 'no-claim'
      ? 'unknown claim'
      : result.reason === 'no-cite'
        ? 'no such cite'
        : 'this sentence keeps its evidence — push it down or rewrite it instead';
    return c.json({ error }, status);
  }
  return c.json({ ok: true });
 });

 // POST /api/wiki/claim/:id/push-down — the user's retire-as-past verb (the
 // six margin verbs, ruling 2026-08-08).
 //
 // The ruling maps the verb to SUPERSEDE; a user supersede would mint a new
 // claim, and claims REQUIRE a Q-34 model stamp on disk (the store's
 // requireScalars skips stamp-less files as malformed) — fabricating one for
 // the person's act would be a false stamp. So the verb retires the claim
 // with the ARCHIVE mechanism instead (reasoned deviation, recorded in the
 // plan): archived: true with the fixed reason USER_PUSH_DOWN_REASON, the
 // file kept as evidence (Q-29), the essay's aside ink, the status
 // recomputed mechanically. A claim already retired cannot be pushed down
 // again (400).
 app.post('/api/wiki/claim/:id/push-down', async (c) => {
  const id = c.req.param('id');
  const result = clerk.claimStore.pushDown(id);
  if (!result.ok) {
    const status = result.reason === 'no-claim' ? 404 : 400;
    return c.json({
      error: result.reason === 'no-claim' ? 'unknown claim' : 'this sentence is already set aside',
    }, status);
  }
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
  const direction = deps.coachStore().createUncoached(claim.body);
  serverEmit(deps.vaultRoot, 'elicitor', 'direction-created',
   `slug=${direction.slug} via=wiki-claim claim=${id}`);
  return c.json({ direction });
 });
}
