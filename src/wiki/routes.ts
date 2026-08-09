/**
 * The wiki cluster (Wave D1 extraction): GET /api/wiki (the page render —
 * now a pure function in src/wiki/page.ts the route gathers inputs for and
 * stamps over) and the claim verbs read/attest/edit/challenge/direction,
 * moved wholesale out of src/server.ts. Wire shapes, route paths, log
 * kinds, and error statuses are byte-identical to the pre-extraction
 * server.
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
import { readAllRepairs } from '../repair/store.js';
import { repairedSnippetIds } from '../repair/consult.js';
import { surfaced } from '../log/surfaced.js';
import { openQuestionEntry } from '../queue/open-question.js';
import type { ServerEmitFn } from '../session/routes.js';
import type { ClaimGraph } from './contract.js';
import type { QueueStore, Vault } from '../types.js';
import { renderWikiPage } from './page.js';

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
 * Register the wiki cluster: the page route and the five claim verbs,
 * extracted wholesale from src/server.ts (Wave D1). Called exactly once at
 * app build, at the cluster's old registration position, so the Hono route
 * table is unchanged entry-for-entry.
 */
export function createWikiRoutes(app: Hono, deps: WikiDeps): void {
 const clerk = deps.clerk;
 const { serverEmit, isPureRead } = deps;

 // GET /api/wiki[?all=1] → the wiki grouped by facet and ordered for reading
 app.get('/api/wiki', (c) => {
  // Nothing is deleted — an archived or superseded claim is simply not the
  // default reading. `?all=1` is how a reader asks for the whole record.
  const all = c.req.query('all') === '1';
  const contents = deps.vault.rebuildIndex();
  const graph: ClaimGraph = {
   ...clerk.claimStore.loadSlice(),
   snippets: contents.snippets,
   readings: contents.readings,
  };

  // The lint findings are read LIVE: a docket run may settle between
  // requests, and `clerk.lastLint` is an accessor, never a snapshot.
  const lint = clerk.lastLint;

  // The pure shaping (grouping, ordering, coreness, repair taint, lint
  // notes) lives in src/wiki/page.ts — one function, no I/O.
  const page = renderWikiPage({
   all,
   graph,
   // Repair consultation (ticket 137): the claim ids whose cites include a
   // repaired snippet, so the wiki surface can mark them. Computed over
   // the WHOLE graph by the render — a repaired cite taints the claim
   // whether or not the page shows it.
   repairedIds: repairedSnippetIds(readAllRepairs(deps.vaultRoot)),
   lastLintFindings: lint?.findings ?? [],
   lintedAt: lint?.at ?? null,
  });

  // Usage stamps (015): every claim this page serves is surfaced, with the
  // snippets its citations render. One line per claim; ?all=1 serves the
  // whole record and stamps it too. The /api/snippets pool is display
  // support, not display, and never stamps.
  // A pure read stamps nothing (129): under /v2 the stamp is an explicit
  // act {v:'read'} per claim, which is what the dwell observer maps to.
  if (!isPureRead(c)) {
   for (const facet of page.facets) {
    for (const cl of facet.claims) {
     surfaced(deps.vaultRoot, [cl.id, ...cl.cites], 'wiki');
    }
   }
  }

  return c.json(page);
 });

 // POST /api/wiki/claim/:id/read {surface?} → records that the claim was read
 //
 // Q-21's looping-effect instrument, and the ONE write on this surface. It is
 // how the system can later tell that a snippet was volunteered AFTER the user
 // read the claim it supports, which is evidence about the evidence and not a
 // judgement about the person.
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
