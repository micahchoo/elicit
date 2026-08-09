/**
 * The piece cluster (Wave C1 extraction): every /api/piece route — the
 * pass-1 compose (POST /api/piece), the chooser list (GET /api/pieces),
 * the piece read (GET /api/piece/:id), reorder, remove (take out), prose,
 * gap, gap/accept, set-down/pick-up and export — plus the render helpers
 * (startedOfSession, enrichEntry, enrichPiece, insertionIndex). The
 * ordering subsystem is gone (redesign-2026-08-09 §9): no arrangements, no
 * choose, no `arrangement` parameter on any route body — the entry list IS
 * the composition.
 *
 * The handlers close over exactly the bindings PieceDeps names: the piece
 * store server.ts owns, the vault/queue/root trio, the read-handles the
 * server keeps (readVersion, listSessions), the open-question seed builder,
 * the session-flow opener + context, and the log seam (serverEmit).
 */

import type { Context, Hono } from 'hono';
import { ulid } from 'ulid';
import type { Entry, Gap, Offer, Piece, PieceStore } from '../piece/contract.js';
import { chronological } from '../piece/arrange.js';
import { toCleanMarkdown, toQuestionsMarkdown } from '../piece/export.js';
import { requireText } from '../guards.js';
import type { Complete, QueueDraft, QueueStore, Snippet, Vault } from '../types.js';
import type { OpenQuestionSeed } from '../queue/open-question.js';
import type { SessionCtx, ServerEmitFn } from '../session/routes.js';

/** The threshold register type — THRESHOLDS is a value, so its type is `typeof`. */
type ThresholdsRegister = typeof import('../wiki/thresholds.js').THRESHOLDS;
/** The unprompted opener — a function value, so its type is `typeof`. */
type UnpromptedSittingFn = typeof import('../session/routes.js').startUnpromptedSitting;

/**
 * The bindings the piece handlers close over. The store, vault, queue and
 * read-handles are the SAME objects server.ts owns — the handlers see every
 * write the other routes make, and vice versa.
 */
interface PieceDeps {
 /** The PieceStore the boot binds (one binding shared with the docket thunks). */
 pieces: PieceStore;
 /** The vault — rebuildIndex and saveSnippet. */
 vault: Vault;
 /** The queue store — the gap-declared mint (Q-39). */
 queue: QueueStore;
 vaultRoot: string;
 /** The server's readVersion — pins resolve through it (Q-5). */
 readVersion: (root: string, snippetId: string, version: number) => string | null;
 /** The server's listSessions — the sitting `started` lookup (Q-59). */
 listSessions: (root: string) => { session: string; started: string; turnCount: number; chars: number }[];
 /** The threshold register — kept for the boot wiring; the ordering cap it
  * served (piece.gapsPerCandidate) died with the subsystem (§9). */
 THRESHOLDS: ThresholdsRegister;
 /** The open-question seed builder — the gap-declared mint (Q-39, Q-60). */
 openQuestionEntry: (seed: OpenQuestionSeed) => QueueDraft;
 /** The one-turn unprompted sitting opener (S17) — composition is its own sitting (Q-50). */
 startUnpromptedSitting: UnpromptedSittingFn;
 /** The live session-flow context the unprompted opener needs. */
 sessionCtx: SessionCtx;
 /** The server's activity-log seam. */
 serverEmit: ServerEmitFn;
 /** The clerk's Complete and model name — kept for the boot wiring; the
  * ordering generation that consumed them died with the subsystem (§9). */
 clerkComplete: Complete;
 clerkModelName: string | undefined;
}

/**
 * Register the piece cluster: the ~11 /api/piece routes and their render
 * helpers. Called exactly once at app build, at the cluster's registration
 * position.
 */
export function createPieceRoutes(app: Hono, deps: PieceDeps): void {
 const {
  pieces,
  readVersion,
  listSessions,
  openQuestionEntry,
  startUnpromptedSitting,
  sessionCtx,
  serverEmit,
 } = deps;

/** The piece lookup guard every /api/piece/:id route runs: the same 404 the inline copies did (sessionOf style, Wave E). */
function pieceOf(c: Context, pieceId: string): Piece | Response {
 const piece = pieces.get(pieceId);
 if (!piece) return c.json({ error: 'piece not found' }, 404);
 return piece;
}

// ── The piece routes (T6): compose, gap, set down, export ──
 //
 // Pass 1's verbs, behind the auth gate. Two invariants carry the slice:
 // writing prose in a Piece creates a composition Snippet (Q-40), and
 // inserting a Gap mints exactly ONE queued question (Q-39) — unless the
 // Piece is set down, in which case the Gap is inserted and nothing is
 // minted (Q-41). The enriched piece below is the surface T7 renders and
 // T8 drives; every mutating route returns it directly, unwrapped.

 /** The sitting `started` of one session, or null when no transcript exists (Q-59). */
 const startedOfSession = (session: string): string | null =>
  listSessions(deps.vaultRoot).find((s) => s.session === session)?.started ?? null;

 /** One entry as the surface sees it: pins carry pinned prose and a sitting date; gaps carry their offers. */
 function enrichEntry(entry: Entry, snippets: Record<string, Snippet>): unknown {
  if (entry.kind === 'pin') {
   return {
    ...entry,
    prose: readVersion(deps.vaultRoot, entry.snippet, entry.version),
    sittingDate: startedOfSession(snippets[entry.snippet]?.provenance.session ?? ''),
   };
  }
  return {
   ...entry,
   kind: entry.kind ?? null,
   question: entry.question ?? null,
   pending: entry.pending ?? null,
   // The exact join T1 threaded: every Snippet whose provenance names THIS
   // gap's id. No scoring, no ranking — the client never searches (Q-39).
   offers: Object.values(snippets).filter((s) => s.provenance.gap === entry.id),
  };
 }

 /** One offer as the offers region sees it: the passage's prose and its sitting date. */
 function enrichOffer(o: Offer): unknown {
  return {
   ...o,
   prose: readVersion(deps.vaultRoot, o.snippet, o.version),
   sittingDate: startedOfSession(o.sourceSitting),
  };
 }

 /** The optional fields are null in JSON when absent — never a missing key. */
 function enrichPiece(p: Piece): unknown {
  const snippets = deps.vault.rebuildIndex().snippets;
  return {
   id: p.id,
   created: p.created,
   subject: p.subject,
   setDownAt: p.setDownAt ?? null,
   setDownBy: p.setDownBy ?? null,
   discardedAt: p.discardedAt ?? null,
   entries: p.entries.map((e) => enrichEntry(e, snippets)),
   offers: p.offers.map(enrichOffer),
   declined: p.declined,
   dismissedGaps: p.dismissedGaps,
   marginalia: p.marginalia.map((m) => ({ ...m, model: m.model ?? null })),
  };
 }

 /** The index to insert at: after the named entry, or the end. -1 when the anchor is unknown. */
 const insertionIndex = (entries: Entry[], after?: string): number => {
  if (after === undefined) return entries.length;
  const at = entries.findIndex((e) => e.id === after);
  return at === -1 ? -1 : at + 1;
 };

 // POST /api/piece { snippets: string[], subject?: string } — the pass-1
 // start: every chosen snippet pinned in sitting order (chronological,
 // Q-59), under the person's gathering criterion. The subject is optional
 // on the wire (older callers predate it) but always stored.
 app.post('/api/piece', async (c) => {
  const body = await c.req.json<{ snippets: string[]; subject?: string }>();
  if (!Array.isArray(body.snippets)) return c.json({ error: 'snippets are required' }, 400);
  const snippets = deps.vault.rebuildIndex().snippets;
  const chosen = body.snippets
   .map((id) => snippets[id])
   .filter((s): s is Snippet => s !== undefined);
  if (chosen.length !== body.snippets.length) {
   return c.json({ error: 'unknown snippet id' }, 400);
  }
  const pins = chronological(chosen, startedOfSession);
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const piece = pieces.create(pins, subject);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-started', `snippets=${pins.length}`);
  return c.json(enrichPiece(piece));
 });

 // GET /api/pieces — every OPEN composition with its enriched entries, for
 // the chooser and the shelf (setDownAt crosses the wire so the board
 // renders set-down pieces distinctly — bug 12.3). A discarded piece is no
 // longer a composition to choose from (Q-3: the file stays, the door
 // closes).
 app.get('/api/pieces', (c) => {
  const list = pieces
   .list()
   .filter((p) => p.discardedAt === undefined)
   .map((p) => {
   const snippets = deps.vault.rebuildIndex().snippets;
   return {
    id: p.id,
    created: p.created,
    subject: p.subject,
    setDownAt: p.setDownAt ?? null,
    setDownBy: p.setDownBy ?? null,
    discardedAt: p.discardedAt ?? null,
    entries: p.entries.map((e) => enrichEntry(e, snippets)),
   };
  });
  return c.json({ pieces: list });
 });

 // GET /api/piece/:id — one piece: entries in order, each pin resolved to
 // its PINNED version's prose and its sitting date, plus Marginalia, the
 // offers region and the durable denials.
 app.get('/api/piece/:id', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  return c.json(enrichPiece(piece));
 });

 // POST /api/piece/:id/reorder — a permutation of the on-disk entry ids, or
 // 400: a reorder that adds or drops is not a reorder.
 app.post('/api/piece/:id/reorder', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ entries: string[] }>();
  if (!Array.isArray(body.entries)) return c.json({ error: 'entries are required' }, 400);
  const onDisk = piece.entries.map((e) => e.id).sort();
  const proposed = [...body.entries].sort();
  if (onDisk.length !== proposed.length || onDisk.some((id, i) => id !== proposed[i])) {
   return c.json({ error: 'reorder must be a permutation of the piece\'s entries' }, 400);
  }
  const byId = new Map(piece.entries.map((e) => [e.id, e]));
  const entries = body.entries.map((id) => byId.get(id)!);
  const updated = pieces.putEntries(pieceId, entries);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/remove { entry } — `take out`, wired at last (bug
 // 12.2): the piece without one entry. A removed gap's question is LEFT in
 // the Queue to expire on the normal rule (Q-41): there is no retract verb
 // anywhere in this design and this slice does not invent one.
 app.post('/api/piece/:id/remove', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ entry: string }>();
  if (!piece.entries.some((e) => e.id === body.entry)) {
   return c.json({ error: 'no such entry' }, 400);
  }
  const updated = pieces.putEntries(
   pieceId,
   piece.entries.filter((e) => e.id !== body.entry),
  );
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/prose — the Q-40 path. The person's words become a
 // composition Snippet in their own sitting (Q-50), pinned at v1. No model,
 // no proposal, no substring check — one paragraph in, one Snippet out.
 app.post('/api/piece/:id/prose', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ text: string; after?: string }>();
  const text = requireText(c, body.text);
  if (text instanceof Response) return text;
  const at = insertionIndex(piece.entries, body.after);
  if (at === -1) return c.json({ error: 'no such entry' }, 400);

  const sessionId = ulid();
  // A composition act is its own sitting (Q-50): its cites are independent
  // of the sittings that produced the paragraphs around it.
  startUnpromptedSitting(sessionCtx, {
   sessionId,
   text,
   protocol: 'composition',
  });
  // `question` is the empty string exactly as the unprompted path uses it:
  // nothing asked for these words. NO reading is written — the known hole
  // ticket 081 tracks.
  const s = deps.vault.saveSnippet(text, {
   kind: 'composition',
   session: sessionId,
   question: '',
   questionForm: 'deliberative',
   piece: pieceId,
  });

  const pin: Entry = { id: ulid(), kind: 'pin', snippet: s.id, version: 1 };
  const entries: Entry[] = [
   ...piece.entries.slice(0, at),
   pin,
   ...piece.entries.slice(at),
  ];
  const updated = pieces.putEntries(pieceId, entries);

  // Never log the text — only how much of it there was.
  serverEmit(deps.vaultRoot, 'clerk', 'piece-prose-kept', `piece=${pieceId} chars=${text.length}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/gap — the Q-39 path. `gap` is a client-minted ULID
 // and the route is idempotent on it: a retried POST mints nothing.
 app.post('/api/piece/:id/gap', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ gap: string; after?: string; question?: string }>();
  if (typeof body.gap !== 'string' || body.gap.length === 0) {
   return c.json({ error: 'gap id is required' }, 400);
  }
  // Idempotency FIRST: the same request arriving twice is the same gap —
  // mint nothing, insert nothing, return the Piece unchanged (200).
  if (piece.entries.some((e) => e.id === body.gap)) {
   return c.json(enrichPiece(piece));
  }
  const at = insertionIndex(piece.entries, body.after);
  if (at === -1) return c.json({ error: 'no such entry' }, 400);

  const gapEntry: Gap = { id: body.gap, placedBy: 'person' };
  let entries: Entry[];
  if (piece.setDownAt !== undefined) {
   // Set down: the Gap exists, the Piece is editable, and nothing is
   // minted (Q-41).
   entries = [...piece.entries.slice(0, at), gapEntry, ...piece.entries.slice(at)];
   const updated = pieces.putEntries(pieceId, entries);
   serverEmit(deps.vaultRoot, 'clerk', 'gap-inserted', `piece=${pieceId} gap=${body.gap}`);
   return c.json(enrichPiece(updated));
  }
  if (!body.question || typeof body.question !== 'string' || body.question.trim().length === 0) {
   return c.json({ error: 'question is required' }, 400);
  }
  const question = body.question.trim();
  // Exactly ONE QueueEntry — the only mint path in this slice. No target,
  // no topic, no targetFacet: absent is not a guess (Q-60). The person's
  // own words, so the composed-question quote gate does not apply (Q-12).
  // The license names composition and gap — the dedupe key the sweep's
  // composition-gap source also reads (redesign §7).
  const entry = deps.queue.add({
   ...openQuestionEntry({
    source: 'gap-declared',
    license: `composition ${pieceId} gap ${body.gap}`,
    question,
    questionForm: 'deliberative',
   }),
   gap: body.gap,
  });
  const minted: Gap = { id: body.gap, placedBy: 'person', question: entry.id };
  entries = [...piece.entries.slice(0, at), minted, ...piece.entries.slice(at)];
  const updated = pieces.putEntries(pieceId, entries);
  serverEmit(deps.vaultRoot, 'clerk', 'gap-inserted', `piece=${pieceId} gap=${body.gap}`);
  serverEmit(deps.vaultRoot, 'clerk', 'gap-question-minted', `chars=${question.length}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/gap/accept — how a Gap clears (Q-39). The body names
 // a snippet; the route verifies that snippet's provenance names THIS gap
 // (the link the person's own answer created) and rewrites the Piece with a
 // Pin in the gap's position. Never auto-placed: nothing places without
 // this POST, and the POST is the person's.
 app.post('/api/piece/:id/gap/accept', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ gap: string; snippet: string; version: number }>();
  const at = piece.entries.findIndex((e) => e.id === body.gap);
  if (at === -1) return c.json({ error: 'no such gap' }, 400);
  if (piece.entries[at]!.kind === 'pin') return c.json({ error: 'not a gap' }, 400);

  const snippet = deps.vault.rebuildIndex().snippets[body.snippet];
  if (!snippet) return c.json({ error: 'unknown snippet' }, 400);
  // The route can only complete a link the person's own answer created.
  if (snippet.provenance.gap !== body.gap) {
   return c.json({ error: 'snippet did not answer this gap' }, 400);
  }
  if (readVersion(deps.vaultRoot, body.snippet, body.version) === null) {
   return c.json({ error: 'version does not resolve' }, 400);
  }

  const pin: Entry = { id: ulid(), kind: 'pin', snippet: body.snippet, version: body.version };
  const entries: Entry[] = [...piece.entries.slice(0, at), pin, ...piece.entries.slice(at + 1)];
  const updated = pieces.putEntries(pieceId, entries);
  // The gap's queue entry is already answered by the sitting that produced
  // this snippet — nothing here touches the Queue.
  serverEmit(deps.vaultRoot, 'clerk', 'gap-cleared', `piece=${pieceId} gap=${body.gap} snippet=${body.snippet} version=${body.version}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/set-down and /pick-up — one verb and its undo (Q-41).
 app.post('/api/piece/:id/set-down', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const updated = pieces.setDown(pieceId, 'user');
  serverEmit(deps.vaultRoot, 'clerk', 'piece-set-down', `piece=${pieceId}`);
  return c.json(enrichPiece(updated));
 });

 app.post('/api/piece/:id/pick-up', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const updated = pieces.pickUp(pieceId);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-picked-up', `piece=${pieceId}`);
  return c.json(enrichPiece(updated));
 });

 // GET /api/piece/:id/export?ink=clean|questions — Output A's two exports
 // (redesign-2026-08-09 §6): `clean` (default) — the person's sentences, in
 // order, gaps omitted, what ships; `questions` — the same sentences plus
 // every open gap in the margin as a blockquote plus the open offers at the
 // end, the working document. BOTH are zero-LLM — they print holes that
 // already exist. Pins resolve through readVersion, so a stale pin exports
 // the OLD words on purpose (Q-5); an unresolvable pin fails the export
 // rather than silently missing a paragraph; a piece with no pins has no
 // document to export (404, the pass-1 parity). The subject never exports
 // (Q-1).
 app.get('/api/piece/:id/export', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const withQuestions = false;
  const pins = piece.entries.filter((e) => e.kind === 'pin').length;
  if (pins === 0) return c.json({ error: 'piece has no arrangement' }, 404);
  const versions = (snippet: string, version: number) =>
   readVersion(deps.vaultRoot, snippet, version);
  const markdown = withQuestions
   ? toQuestionsMarkdown(piece, versions, deps.queue.list(), piece.offers)
   : toCleanMarkdown(piece.entries, versions);
  serverEmit(
   deps.vaultRoot,
   'clerk',
   withQuestions ? 'piece-exported-questions' : 'piece-exported',
   `paragraphs=${pins}`,
  );
  return new Response(markdown, {
   status: 200,
   headers: {
    'Content-Type': 'text/markdown',
    'Content-Disposition': `attachment; filename="piece-${pieceId}.md"`,
   },
  });
 });

 // GET /api/piece/:id/export/questions — the working document: the same
 // sentences plus every open gap in the margin as a blockquote plus the open
 // offers at the end (redesign-2026-08-09 §6). Path-based, not a query, so
 // the route-contract scanner resolves it (queries are not scanned).
 app.get('/api/piece/:id/export/questions', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const pins = piece.entries.filter((e) => e.kind === 'pin').length;
  if (pins === 0) return c.json({ error: 'piece has no arrangement' }, 404);
  const versions = (snippet: string, version: number) =>
   readVersion(deps.vaultRoot, snippet, version);
  const markdown = toQuestionsMarkdown(piece, versions, deps.queue.list(), piece.offers);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-exported-questions', `paragraphs=${pins}`);
  return new Response(markdown, {
   status: 200,
   headers: {
    'Content-Type': 'text/markdown',
    'Content-Disposition': `attachment; filename="piece-${pieceId}.questions.md"`,
   },
  });
 });

 // POST /api/piece/:id/offers/:offerId/accept — `put it in`: the offered
 // passage becomes a pin, appended (redesign §8). The offer is consumed. A
 // passage already pinned is refused — the same words do not sit twice.
 app.post('/api/piece/:id/offers/:offerId/accept', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const offerId = c.req.param('offerId');
  const offer = piece.offers.find((o) => o.id === offerId);
  if (!offer) return c.json({ error: 'no such offer' }, 404);
  if (piece.entries.some(
   (e) => e.kind === 'pin' && e.snippet === offer.snippet && e.version === offer.version,
  )) {
   return c.json({ error: 'that passage is already in the piece' }, 400);
  }
  const updated = pieces.acceptOffer(pieceId, offerId);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-offer-accepted', `piece=${pieceId} snippet=${offer.snippet} version=${offer.version}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/offers/:offerId/deny — `not this one`: the offer is
 // removed and the passage declined durably — never re-offered (redesign §5).
 app.post('/api/piece/:id/offers/:offerId/deny', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const offerId = c.req.param('offerId');
  const offer = piece.offers.find((o) => o.id === offerId);
  if (!offer) return c.json({ error: 'no such offer' }, 404);
  const updated = pieces.denyOffer(pieceId, offerId);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-offer-declined', `piece=${pieceId} snippet=${offer.snippet}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/gaps/:gapId/ask — `ask this`: the person takes a
 // model-found gap's pending question into the queue, at composition-gap
 // weight (redesign §7 — the model's noticing is a suggestion, below
 // gap-declared). Idempotent: one gap mints at most one question (Q-39).
 // A set-down piece may still be read this way; only the mint is suppressed
 // (Q-41).
 app.post('/api/piece/:id/gaps/:gapId/ask', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const gapId = c.req.param('gapId');
  const at = piece.entries.findIndex((e) => e.id === gapId);
  if (at === -1) return c.json({ error: 'no such gap' }, 404);
  const gap = piece.entries[at]!;
  if (gap.kind === 'pin' || gap.placedBy !== 'model' || gap.pending === undefined) {
   return c.json({ error: 'not a model-found gap with a pending question' }, 400);
  }
  if (gap.question !== undefined || piece.setDownAt !== undefined) {
   return c.json(enrichPiece(piece));
  }
  const entry = deps.queue.add({
   ...openQuestionEntry({
    source: 'composition-gap',
    // D5's contract: the (composition, gap) pair is the join key, and the
    // license is the sweep's fixed stamp — the queue's add() keys on the
    // fields, never on the license text.
    license: 'CC0',
    question: gap.pending,
    questionForm: 'deliberative',
   }),
   gap: gapId,
   composition: pieceId,
  });
  const minted: Gap = { ...gap, question: entry.id };
  const entries: Entry[] = [
   ...piece.entries.slice(0, at),
   minted,
   ...piece.entries.slice(at + 1),
  ];
  const updated = pieces.putEntries(pieceId, entries);
  serverEmit(deps.vaultRoot, 'clerk', 'gap-question-minted', `chars=${gap.pending.length}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/gaps/:gapId/dismiss — `not a gap`: the model gap is
 // removed and its id recorded durably, so the sweep never re-finds the
 // seam (redesign §8). A person-placed hole is not dismissible this way —
 // take it out instead; a pin is not a gap.
 app.post('/api/piece/:id/gaps/:gapId/dismiss', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const gapId = c.req.param('gapId');
  const gap = piece.entries.find((e) => e.id === gapId);
  if (!gap || gap.kind === 'pin') return c.json({ error: 'no such gap' }, 404);
  if (gap.placedBy === 'person') {
   return c.json({ error: 'a hole you placed is taken out, not dismissed' }, 400);
  }
  const updated = pieces.dismissGap(pieceId, gapId);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-gap-dismissed', `piece=${pieceId} gap=${gapId}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/discard — the Q-3 field write: discardedAt is set,
 // the file stays. No state past discarded: a second discard is refused.
 app.post('/api/piece/:id/discard', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  if (piece.discardedAt !== undefined) {
   return c.json({ error: 'the piece is already discarded' }, 400);
  }
  const updated = pieces.discard(pieceId);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-discarded', `piece=${pieceId}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/place — the search-and-place door (redesign §5):
 // any passage, any sitting, at any time, appended as a pin. The same
 // passage is not placed twice.
 app.post('/api/piece/:id/place', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ snippet: string; version: number }>();
  if (typeof body.snippet !== 'string' || typeof body.version !== 'number') {
   return c.json({ error: 'snippet and version are required' }, 400);
  }
  const snippet = deps.vault.rebuildIndex().snippets[body.snippet];
  if (!snippet) return c.json({ error: 'unknown snippet' }, 400);
  if (readVersion(deps.vaultRoot, body.snippet, body.version) === null) {
   return c.json({ error: 'version does not resolve' }, 400);
  }
  if (piece.entries.some(
   (e) => e.kind === 'pin' && e.snippet === body.snippet && e.version === body.version,
  )) {
   return c.json({ error: 'that passage is already in the piece' }, 400);
  }
  const pin: Entry = { id: ulid(), kind: 'pin', snippet: body.snippet, version: body.version };
  const updated = pieces.putEntries(pieceId, [...piece.entries, pin]);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-placed', `piece=${pieceId} snippet=${body.snippet} version=${body.version}`);
  return c.json(enrichPiece(updated));
 });
}
