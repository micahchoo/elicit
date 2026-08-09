/**
 * The piece cluster (Wave C1 extraction): every /api/piece route — the
 * pass-1 compose (POST /api/piece), the chooser list (GET /api/pieces),
 * the piece read (GET /api/piece/:id), reorder, remove, prose, gap,
 * gap/accept, set-down/pick-up, export, arrangements and choose — plus the
 * render helpers (startedOfSession, enrichEntry, enrichArrangement,
 * enrichPiece, insertionIndex), moved wholesale out of src/server.ts.
 * Wire shapes, route paths, log kinds, and error statuses are
 * byte-identical to the pre-extraction server; this module exists to give
 * the biggest remaining route cluster a home of its own.
 *
 * The handlers close over exactly the bindings PieceDeps names: the piece
 * store server.ts owns, the vault/queue/root trio, the read-handles the
 * server keeps (readVersion, listSessions), the threshold register
 * (THRESHOLDS — piece.gapsPerCandidate, 010 T10), the open-question seed
 * builder, the session-flow opener + context, the log seam (serverEmit)
 * and the clerk's model handles.
 */

import type { Context, Hono } from 'hono';
import { ulid } from 'ulid';
import { appendEvent, type ActivityEvent } from '../log/activity.js';
import type { Arrangement, ArrangementEntry, Gap, Piece, PieceStore } from '../piece/contract.js';
import { chronological } from '../piece/arrange.js';
import { toMarkdown } from '../piece/export.js';
import { requireText } from '../guards.js';
import { proposeArrangements } from '../clerk/arrangements.js';
import type { Complete, QueueDraft, QueueStore, Snippet, Vault } from '../types.js';
import type { OpenQuestionSeed } from '../queue/open-question.js';
import type { SessionCtx, ServerEmitFn } from '../session/routes.js';

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
 /** The queue store — the gap-declared and gap-fill mints (Q-39). */
 queue: QueueStore;
 vaultRoot: string;
 /** The server's readVersion — pins resolve through it (Q-5). */
 readVersion: (root: string, snippetId: string, version: number) => string | null;
 /** The server's listSessions — the sitting `started` lookup (Q-59). */
 listSessions: (root: string) => { session: string; started: string; turnCount: number; chars: number }[];
 /** The threshold register — piece.gapsPerCandidate (010 T10). */
 THRESHOLDS: typeof import('../wiki/thresholds.js').THRESHOLDS;
 /** The open-question seed builder — the only mint path in this slice (Q-39, Q-60). */
 openQuestionEntry: (seed: OpenQuestionSeed) => QueueDraft;
 /** The one-turn unprompted sitting opener (S17) — composition is its own sitting (Q-50). */
 startUnpromptedSitting: typeof import('../session/routes.js').startUnpromptedSitting;
 /** The live session-flow context the unprompted opener needs. */
 sessionCtx: SessionCtx;
 /** The server's activity-log seam. */
 serverEmit: ServerEmitFn;
 /** The clerk's Complete — arrangements generation (Q-48). */
 clerkComplete: Complete;
 /** The clerk's model name — the arrangement stamp (Q-34).
 * May be absent (the boot wiring's `deps.clerk?.modelName ?? deps.modelName` can yield
 * undefined); proposeArrangements omits the stamp in that case.
 */
 clerkModelName: string | undefined;
}

/**
 * Register the piece cluster: the ~14 /api/piece routes and their render
 * helpers, extracted wholesale from src/server.ts (Wave C1). Called exactly
 * once at app build, at the cluster's old registration position, so the
 * Hono route table is unchanged entry-for-entry.
 */
export function createPieceRoutes(app: Hono, deps: PieceDeps): void {
 const {
  pieces,
  readVersion,
  listSessions,
  THRESHOLDS,
  openQuestionEntry,
  startUnpromptedSitting,
  sessionCtx,
  serverEmit,
  clerkComplete,
  clerkModelName,
 } = deps;

/** The piece lookup guard every /api/piece/:id route runs: the same 404 the inline copies did (sessionOf style, Wave E). */
function pieceOf(c: Context, pieceId: string): Piece | Response {
 const piece = pieces.get(pieceId);
 if (!piece) return c.json({ error: 'piece not found' }, 404);
 return piece;
}

/** The arrangement lookup guard the body-naming routes run: the same 400 the inline copies did (Wave E). */
function arrangementOf(c: Context, piece: Piece, arrangementId: string): Arrangement | Response {
 const a = piece.arrangements.find((x) => x.id === arrangementId);
 if (!a) return c.json({ error: 'unknown arrangement' }, 400);
 return a;
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
 function enrichEntry(entry: ArrangementEntry, snippets: Record<string, Snippet>): unknown {
  if (entry.kind === 'pin') {
   return {
    ...entry,
    prose: readVersion(deps.vaultRoot, entry.snippet, entry.version),
    sittingDate: startedOfSession(snippets[entry.snippet]?.provenance.session ?? ''),
   };
  }
  return {
   ...entry,
   question: entry.question ?? null,
   pending: entry.pending ?? null,
   // The exact join T1 threaded: every Snippet whose provenance names THIS
   // gap's id. No scoring, no ranking — the client never searches (Q-39).
   offers: Object.values(snippets).filter((s) => s.provenance.gap === entry.id),
  };
 }

 function enrichArrangement(a: Arrangement): unknown {
  const snippets = deps.vault.rebuildIndex().snippets;
  return {
   id: a.id,
   principle: a.principle,
   created: a.created,
   model: a.model ?? null,
   entries: a.entries.map((e) => enrichEntry(e, snippets)),
   marginalia: a.marginalia.map((m) => ({ ...m, model: m.model ?? null })),
  };
 }

 /** setDownAt/setDownBy are null in JSON when absent — never a missing key. */
 function enrichPiece(p: Piece): unknown {
  return {
   id: p.id,
   created: p.created,
   current: p.current,
   setDownAt: p.setDownAt ?? null,
   setDownBy: p.setDownBy ?? null,
   arrangements: p.arrangements.map(enrichArrangement),
  };
 }

 /** The index to insert at: after the named entry, or the end. -1 when the anchor is unknown. */
 const insertionIndex = (entries: ArrangementEntry[], after?: string): number => {
  if (after === undefined) return entries.length;
  const at = entries.findIndex((e) => e.id === after);
  return at === -1 ? -1 : at + 1;
 };

 // POST /api/piece { snippets: string[] } — the pass-1 start: every chosen
 // snippet pinned in sitting order (chronological, Q-59).
 app.post('/api/piece', async (c) => {
  const body = await c.req.json<{ snippets: string[] }>();
  if (!Array.isArray(body.snippets)) return c.json({ error: 'snippets are required' }, 400);
  const snippets = deps.vault.rebuildIndex().snippets;
  const chosen = body.snippets
   .map((id) => snippets[id])
   .filter((s): s is Snippet => s !== undefined);
  if (chosen.length !== body.snippets.length) {
   return c.json({ error: 'unknown snippet id' }, 400);
  }
  const pins = chronological(chosen, startedOfSession);
  const piece = pieces.create(pins);
  serverEmit(deps.vaultRoot, 'clerk', 'piece-started', `snippets=${pins.length}`);
  return c.json(enrichPiece(piece));
 });

 // GET /api/pieces — every piece with its current arrangement, for the chooser.
 app.get('/api/pieces', (c) => {
  const list = pieces.list().map((p) => {
   const current = p.arrangements.find((a) => a.id === p.current) ?? p.arrangements[0];
   return {
    id: p.id,
    created: p.created,
    current: p.current,
    setDownAt: p.setDownAt ?? null,
    setDownBy: p.setDownBy ?? null,
    arrangement: current === undefined ? null : enrichArrangement(current),
   };
  });
  return c.json({ pieces: list });
 });

 // GET /api/piece/:id — one piece: entries in order, each pin resolved to
 // its PINNED version's prose and its sitting date, plus Marginalia.
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
  const body = await c.req.json<{ arrangement: string; entries: string[] }>();
  const a = arrangementOf(c, piece, body.arrangement);
  if (a instanceof Response) return a;
  if (!Array.isArray(body.entries)) return c.json({ error: 'entries are required' }, 400);
  const onDisk = a.entries.map((e) => e.id).sort();
  const proposed = [...body.entries].sort();
  if (onDisk.length !== proposed.length || onDisk.some((id, i) => id !== proposed[i])) {
   return c.json({ error: "reorder must be a permutation of the arrangement's entries" }, 400);
  }
  const byId = new Map(a.entries.map((e) => [e.id, e]));
  const entries = body.entries.map((id) => byId.get(id)!);
  const updated = pieces.putArrangement(pieceId, { ...a, entries });
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/remove — the arrangement without one entry. A removed
 // gap's question is LEFT in the Queue to expire on the normal rule (Q-41):
 // there is no retract verb anywhere in this design and this slice does not
 // invent one.
 app.post('/api/piece/:id/remove', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ arrangement: string; entry: string }>();
  const a = arrangementOf(c, piece, body.arrangement);
  if (a instanceof Response) return a;
  if (!a.entries.some((e) => e.id === body.entry)) {
   return c.json({ error: 'no such entry' }, 400);
  }
  const updated = pieces.putArrangement(pieceId, {
   ...a,
   entries: a.entries.filter((e) => e.id !== body.entry),
  });
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/prose — the Q-40 path. The person's words become a
 // composition Snippet in their own sitting (Q-50), pinned at v1. No model,
 // no proposal, no substring check — one paragraph in, one Snippet out.
 app.post('/api/piece/:id/prose', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ arrangement: string; text: string; after?: string }>();
  const text = requireText(c, body.text);
  if (text instanceof Response) return text;
  const a = arrangementOf(c, piece, body.arrangement);
  if (a instanceof Response) return a;
  const at = insertionIndex(a.entries, body.after);
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

  const pin: ArrangementEntry = { id: ulid(), kind: 'pin', snippet: s.id, version: 1 };
  const entries: ArrangementEntry[] = [
   ...a.entries.slice(0, at),
   pin,
   ...a.entries.slice(at),
  ];
  const updated = pieces.putArrangement(pieceId, { ...a, entries });

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
  const body = await c.req.json<{ arrangement: string; gap: string; after?: string; question?: string }>();
  const a = arrangementOf(c, piece, body.arrangement);
  if (a instanceof Response) return a;
  if (typeof body.gap !== 'string' || body.gap.length === 0) {
   return c.json({ error: 'gap id is required' }, 400);
  }
  // Idempotency FIRST: the same request arriving twice is the same gap —
  // mint nothing, insert nothing, return the Piece unchanged (200).
  if (a.entries.some((e) => e.id === body.gap)) {
   return c.json(enrichPiece(piece));
  }
  const at = insertionIndex(a.entries, body.after);
  if (at === -1) return c.json({ error: 'no such entry' }, 400);

  const gapEntry: Gap = { id: body.gap, kind: 'gap' };
  let entries: ArrangementEntry[];
  if (piece.setDownAt !== undefined) {
   // Set down: the Gap exists, the Arrangement is editable, and nothing is
   // minted (Q-41).
   entries = [...a.entries.slice(0, at), gapEntry, ...a.entries.slice(at)];
   const updated = pieces.putArrangement(pieceId, { ...a, entries });
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
  const entry = deps.queue.add({
   ...openQuestionEntry({ source: 'gap-declared', license: 'arrangement-gap', question, questionForm: 'deliberative' }),
   gap: body.gap,
  });
  const minted: Gap = { id: body.gap, kind: 'gap', question: entry.id };
  entries = [...a.entries.slice(0, at), minted, ...a.entries.slice(at)];
  const updated = pieces.putArrangement(pieceId, { ...a, entries });
  serverEmit(deps.vaultRoot, 'clerk', 'gap-inserted', `piece=${pieceId} gap=${body.gap}`);
  serverEmit(deps.vaultRoot, 'clerk', 'gap-question-minted', `chars=${question.length}`);
  return c.json(enrichPiece(updated));
 });

 // POST /api/piece/:id/gap/accept — how a Gap clears (Q-39). The body names
 // a snippet; the route verifies that snippet's provenance names THIS gap
 // (the link the person's own answer created) and rewrites the Arrangement
 // with a Pin in the gap's position. Never auto-placed: nothing places
 // without this POST, and the POST is the person's.
 app.post('/api/piece/:id/gap/accept', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const body = await c.req.json<{ arrangement: string; gap: string; snippet: string; version: number }>();
  const a = arrangementOf(c, piece, body.arrangement);
  if (a instanceof Response) return a;
  const at = a.entries.findIndex((e) => e.id === body.gap);
  if (at === -1) return c.json({ error: 'no such gap' }, 400);
  if (a.entries[at]!.kind !== 'gap') return c.json({ error: 'not a gap' }, 400);

  const snippet = deps.vault.rebuildIndex().snippets[body.snippet];
  if (!snippet) return c.json({ error: 'unknown snippet' }, 400);
  // The route can only complete a link the person's own answer created.
  if (snippet.provenance.gap !== body.gap) {
   return c.json({ error: 'snippet did not answer this gap' }, 400);
  }
  if (readVersion(deps.vaultRoot, body.snippet, body.version) === null) {
   return c.json({ error: 'version does not resolve' }, 400);
  }

  const pin: ArrangementEntry = { id: ulid(), kind: 'pin', snippet: body.snippet, version: body.version };
  const entries: ArrangementEntry[] = [...a.entries.slice(0, at), pin, ...a.entries.slice(at + 1)];
  const updated = pieces.putArrangement(pieceId, { ...a, entries });
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

 // GET /api/piece/:id/export — the person's sentences, in order, and
 // nothing else (Q-1). Pins resolve through readVersion, so a stale pin
 // exports the OLD words on purpose (Q-5); an unresolvable pin fails the
 // export rather than silently missing a paragraph.
 app.get('/api/piece/:id/export', (c) => {
  const pieceId = c.req.param('id');
  const piece = pieceOf(c, pieceId);
  if (piece instanceof Response) return piece;
  const current = piece.arrangements.find((a) => a.id === piece.current) ?? piece.arrangements[0];
  if (!current) return c.json({ error: 'piece has no arrangement' }, 404);
  const markdown = toMarkdown(current, (snippet, version) =>
   readVersion(deps.vaultRoot, snippet, version),
  );
  const pins = current.entries.filter((e) => e.kind === 'pin').length;
  serverEmit(deps.vaultRoot, 'clerk', 'piece-exported', `paragraphs=${pins}`);
  return new Response(markdown, {
   status: 200,
   headers: {
    'Content-Type': 'text/markdown',
    'Content-Disposition': `attachment; filename="piece-${pieceId}.md"`,
   },
  });
 });

// ── The candidate arrangements (T12): one margin word, and a choice ──
//
// Two routes close pass 2's loop. POST /arrangements asks the clerk model
// for other orders of the SAME pins (Q-38, Q-48) and puts every survivor
// on disk; zero survivors is a valid outcome and the person keeps the
// chronology they already had. POST /choose makes one candidate current
// and, unless the piece is set down (Q-41), mints one queue question per
// model-marked gap that does not already carry one. Proposing mints
// nothing: the minting IS the choosing (Q-39).

// POST /api/piece/:id/arrangements — the acceptance-time generation
// (Q-38). Slow by design; the waiting surface says so before the request
// goes out.
app.post('/api/piece/:id/arrangements', async (c) => {
 const pieceId = c.req.param('id');
 const piece = pieceOf(c, pieceId);
 if (piece instanceof Response) return piece;
 const base = piece.arrangements.find((a) => a.id === piece.current);
 if (!base) return c.json({ error: 'piece has no arrangement' }, 404);
 const snippets = deps.vault.rebuildIndex().snippets;
 // Q-56: the bound comes from the register — piece.gapsPerCandidate
 // (010 T10) — and arrives through this parameter; the register is the
 // single source of the number, and the route passes its value.
 const gapsCap = THRESHOLDS['piece.gapsPerCandidate'].value;
 const { candidates } = await proposeArrangements(
  base,
  snippets,
  clerkComplete,
  { gapsPerCandidate: typeof gapsCap === 'number' ? gapsCap : 3 },
  (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
  clerkModelName,
 );
 // The module already logged arrangements-proposed and arrangement-rejected
 // through the sink; nothing more is emitted here.
 for (const candidate of candidates) {
  pieces.addArrangement(pieceId, candidate);
 }
 return c.json(enrichPiece(pieces.get(pieceId) ?? piece));
});

// POST /api/piece/:id/choose { arrangement } — the person takes a
// candidate: it becomes current, and the model-marked gaps it carries are
// minted, one question each (Q-39), unless the piece is set down (Q-41).
// The other candidates stay on disk; nothing is deleted (Q-38).
app.post('/api/piece/:id/choose', async (c) => {
 const pieceId = c.req.param('id');
 const piece = pieceOf(c, pieceId);
 if (piece instanceof Response) return piece;
 const body = await c.req.json<{ arrangement: string }>();
 const chosen = arrangementOf(c, piece, body.arrangement);
 if (chosen instanceof Response) return chosen;
 // setCurrent FIRST: the arrangement must exist on disk, and setCurrent
 // throws otherwise. A set-down piece may still be re-read this way; only
 // the minting is suppressed (Q-41).
 const setDown = piece.setDownAt !== undefined;
 try {
  pieces.setCurrent(pieceId, chosen.id);
 } catch {
  return c.json({ error: 'unknown arrangement' }, 400);
 }
 serverEmit(deps.vaultRoot, 'clerk', 'arrangement-chosen', `principle=${chosen.principle}`);
 if (!setDown) {
  // Model-marked gaps without a question id mint EXACTLY ONE queue entry
  // each. The question text is the model's composition, already verified
  // to quote an adjacent snippet (T11), so the weight is ordinary: the
  // person did not declare it (isUserDeclaredWeight is false).
  const toMint = chosen.entries.filter(
   (e): e is Gap & { pending: string } =>
    e.kind === 'gap' && e.pending !== undefined && e.question === undefined,
  );
  if (toMint.length > 0) {
   let next = chosen;
   for (const gap of toMint) {
    const entry = deps.queue.add({
     ...openQuestionEntry({ source: 'gap-fill', license: 'arrangement-gap', question: gap.pending, questionForm: 'deliberative' }),
     gap: gap.id,
    });
    next = {
     ...next,
     entries: next.entries.map((e) =>
      e.kind === 'gap' && e.id === gap.id ? { ...e, question: entry.id } : e,
     ),
    };
    serverEmit(deps.vaultRoot, 'clerk', 'gap-question-minted', `chars=${gap.pending.length}`);
   }
   // Write the question ids back onto the chosen arrangement. The guards
   // pass: the pin set is unchanged and the gap gains a declared field.
   pieces.putArrangement(pieceId, next);
  }
 }
 return c.json(enrichPiece(pieces.get(pieceId) ?? piece));
});
}
