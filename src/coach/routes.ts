/**
 * The coach cluster (Wave C1 extraction): direction, uncoach, decline-offer,
 * waiting, page, read, adopt, decline-option, quest return/retire and
 * artifact — plus buildCoachFacts and refreshAdviceInBackground — moved
 * wholesale out of src/server.ts. Wire shapes, route paths, log kinds, and
 * error statuses are byte-identical to the pre-extraction server.
 *
 * The handlers close over exactly the bindings CoachDeps names. The
 * coachStore arrives as a GETTER (never a value): createClerk runs before
 * the store exists, so the boot wires `coachStore: () => coachStore` and
 * every use resolves at request time. The isPureRead (x-elicit-pure)
 * handling on /api/coach/waiting is preserved exactly (129).
 */

import type { Hono, Context } from 'hono';
import { ulid } from 'ulid';
import { appendEvent, type ActivityEvent } from '../log/activity.js';
import { checkedChannel, requireText } from '../guards.js';
import type { CaptureChannel, Complete, QueueStore, Vault } from '../types.js';
import type { Claim } from '../wiki/contract.js';
import { loadCoachFacts, type CoachStore } from './store.js';
import { evaluateOffer, licenseState, type CoachFacts } from './license.js';
import { waitingLines, coachOfferSentence, buildCoachPage } from './page.js';
import { runCoachAdvice } from './advise.js';
import { mintReflections } from './reflection.js';
import type { SessionCtx, ServerEmitFn } from '../session/routes.js';

/**
 * The bindings the coach handlers close over. The store getter, maps,
 * vault, queue and read-handles are the SAME objects server.ts owns — the
 * handlers mutate them in place, so every other route sees the writes.
 */
interface CoachDeps {
 /** The coachStore GETTER — late-bound: createClerk runs before the store exists, so the boot passes `() => coachStore` and every use resolves at request time. */
 coachStore: () => CoachStore;
 /** The vault — rebuildIndex feeds buildCoachFacts. */
 vault: Vault;
 /** The queue store — facts read the open entries; quest-return reflections mint through it (Q-75). */
 queue: QueueStore;
 vaultRoot: string;
 /** The clerk handles — buildCoachFacts reads the claim slice through them. */
 clerk: { claimStore: { loadSlice: () => { claims: Claim[] } } };
 /** The server's activity-log seam. */
 serverEmit: ServerEmitFn;
 /** The x-elicit-pure read detector (129): waiting evaluates and records nothing on a pure read. */
 isPureRead: (c: Context) => boolean;
 /** Narrowing guard for a capture channel value sent by the client. */
 isCaptureChannel: (v: unknown) => v is CaptureChannel;
 /** The one-turn unprompted sitting opener (S17) — quest-return and artifact are ordinary capture (Q-75, Q-78). */
 startUnpromptedSitting: typeof import('../session/routes.js').startUnpromptedSitting;
 /** The fire-and-return harvest opener (ticket 084). */
 startBackgroundHarvest: typeof import('../session/routes.js').startBackgroundHarvest;
 /** The live session-flow context the unprompted opener and harvest need. */
 sessionCtx: SessionCtx;
 /** Sessions whose material arrived unprompted — shared with the other capture flows. */
 unpromptedSessions: Set<string>;
 /** The capture channel per unprompted session — shared with the other capture flows (ticket 048). */
 unpromptedChannels: Map<string, CaptureChannel | undefined>;
 /** The clerk's Complete — the background advice mint (T10). */
 clerkComplete: Complete;
}

/**
 * Register the coach cluster: the ~13 /api/coach routes and their helpers,
 * extracted wholesale from src/server.ts (Wave C1). Called exactly once at
 * app build, at the cluster's old registration position, so the Hono route
 * table is unchanged entry-for-entry.
 */
export function createCoachRoutes(app: Hono, deps: CoachDeps): void {
 const {
  coachStore,
  clerk,
  serverEmit,
  isPureRead,
  startUnpromptedSitting,
  startBackgroundHarvest,
  sessionCtx,
  unpromptedSessions,
  unpromptedChannels,
  clerkComplete,
 } = deps;

// ── Coach (ticket 090) ──
// Coached state and the waiting offer. Nothing here acts on its own
// judgment: the person declares, un-coaches and declines (Q-73, Q-43); the
// offer is one dimmed line evaluated on every waiting read and logged on
// every call (Q-62). Every coach record is markdown under vault/coach/ and
// every decision is recomputed from disk (Q-3).

/** One CoachFacts snapshot — the coach slice owns its read-model now. */
function buildCoachFacts(): CoachFacts {
 const snippets = Object.values(deps.vault.rebuildIndex().snippets);
 const snippetSessions = new Map<string, string>();
 for (const s of snippets) snippetSessions.set(s.id, s.provenance.session);
 return loadCoachFacts({
  vaultRoot: deps.vaultRoot,
  coach: coachStore(),
  snippets,
  claims: clerk.claimStore.loadSlice().claims,
  queueEntries: deps.queue.list(),
  sessions: snippetSessions,
 });
}

// POST /api/coach/direction { name } — the ONLY door (Q-73): accepting the
// offer calls this same route. The person's declaration, nothing else.
app.post('/api/coach/direction', async (c) => {
 const body = await c.req.json<{ name?: unknown }>();
 if (typeof body?.name !== 'string' || body.name.trim().length === 0) {
  return c.json({ error: 'name is required' }, 400);
 }
 const direction = coachStore().declareCoached(body.name.trim());
 serverEmit(deps.vaultRoot, 'elicitor', 'direction-coached', `slug=${direction.slug}`);
 return c.json({ direction });
});

// POST /api/coach/direction/:slug/uncoach — the lens off, archives nothing (Q-73).
app.post('/api/coach/direction/:slug/uncoach', (c) => {
 const slug = c.req.param('slug');
 const record = coachStore().uncoach(slug);
 if (!record) return c.json({ error: 'unknown direction' }, 404);
 serverEmit(deps.vaultRoot, 'elicitor', 'direction-uncoached', `slug=${slug}`);
 return c.json({ ok: true });
});

// POST /api/coach/direction/:slug/decline-offer — recorded, never re-asked (Q-43, Q-77).
app.post('/api/coach/direction/:slug/decline-offer', (c) => {
 const slug = c.req.param('slug');
 coachStore().recordOfferDeclined(slug);
 serverEmit(deps.vaultRoot, 'elicitor', 'coach-offer-declined', `slug=${slug}`);
 return c.json({ ok: true });
});

// GET /api/coach/waiting — the live offer evaluation (Q-62): every call is
// logged, offered=null on the empty corpus (090's data note), and silence
// renders nothing.
app.get('/api/coach/waiting', (c) => {
 // A pure read evaluates the offer and records nothing (129): the server
 // logs offer evaluations on its own clock, never on a reader arriving.
 const pure = isPureRead(c);
 const facts = buildCoachFacts();
 const evaluation = evaluateOffer(facts, pure ? () => {} : (e) => appendEvent(deps.vaultRoot, e as ActivityEvent));
 const offered = evaluation.offered;
 if (!pure) serverEmit(
  deps.vaultRoot,
  'elicitor',
  'coach-offer',
  `directions=${evaluation.evaluated.length} qualified=${evaluation.qualified.length} offered=${offered ? offered.slug : 'none'}`,
 );
 return c.json({
  offer: offered ? { slug: offered.slug, name: offered.name, sentence: coachOfferSentence(offered) } : null,
  lines: waitingLines(facts),
 });
});

// The one fire-and-forget advice attempt, shared by /read, /return and
// /artifact (T10): licenseState recomputed from disk, then the mint. The
// mint failing is a log line, never a 5xx — the request already succeeded.
function refreshAdviceInBackground(slug: string): void {
 setImmediate(() => {
  let facts: CoachFacts;
  try {
   facts = buildCoachFacts();
  } catch {
   serverEmit(deps.vaultRoot, 'elicitor', 'advice-withheld', 'reason=call-failed');
   return;
  }
  const licensed = licenseState(facts, slug);
  if (!licensed) return;
  runCoachAdvice({ store: coachStore(), facts, complete: clerkComplete, slug, license: licensed.event })
   .then((outcome) => {
    if (outcome.outcome === 'minted') {
     serverEmit(
      deps.vaultRoot,
      'elicitor',
      'advice-minted',
      `license=${outcome.note.license} options=${outcome.note.options.length} replaced=${outcome.replaced}`,
     );
    } else {
     serverEmit(deps.vaultRoot, 'elicitor', 'advice-withheld', `reason=${outcome.reason}`);
    }
   })
   .catch(() => serverEmit(deps.vaultRoot, 'elicitor', 'advice-withheld', 'reason=call-failed'));
 });
}

// GET /api/coach/:slug — the page, read-only. Reading a page is not an
// agent act: no side effects, no log write. 404 when the lens is off (Q-73).
app.get('/api/coach/:slug', (c) => {
 const slug = c.req.param('slug');
 const facts = buildCoachFacts();
 const page = buildCoachPage(facts, facts.snippets, slug);
 if (!page) return c.json({ error: 'unknown direction' }, 404);
 return c.json(page);
});

// POST /api/coach/:slug/read — the read is an act: mark the note read,
// stamp the visit, then let page-opened license a fresh mint in the
// background (Q-77's cap holds structurally — one unread note, replaced).
app.post('/api/coach/:slug/read', (c) => {
 const slug = c.req.param('slug');
 const direction = coachStore().getDirection(slug);
 if (!direction || !direction.coached) return c.json({ error: 'unknown direction' }, 404);
 // The visit stamp must be strictly later than every prior record on the
 // Direction, or a same-millisecond declare→read would make `lastVisit >
 // coachedAt` compare equal and page-opened would never license (Q-77
 // compares recorded event times, and ms precision is the clock's).
 const prior = [direction.coachedAt, direction.lastVisit].filter((s): s is string => s !== undefined);
 const latest = prior.length > 0 ? prior.reduce((a, b) => (a > b ? a : b)) : '';
 let now = new Date().toISOString();
 if (latest !== '' && now <= latest) now = new Date(Date.parse(latest) + 1).toISOString();
 coachStore().markAdviceRead(slug, now);
 coachStore().recordVisit(slug, now);
 serverEmit(deps.vaultRoot, 'elicitor', 'coach-page-read', `slug=${slug}`);
 refreshAdviceInBackground(slug);
 return c.json({ ok: true });
});

// POST /api/coach/:slug/adopt { optionId } — adoption MINTS the quest
// (Q-74). An option id from a replaced note is 404: nothing mints from an
// evaporated option.
app.post('/api/coach/:slug/adopt', async (c) => {
 const slug = c.req.param('slug');
 const note = coachStore().readAdvice(slug);
 const body = await c.req.json<{ optionId?: unknown }>();
 const optionId = typeof body?.optionId === 'string' ? body.optionId : '';
 const option = note?.options.find((o) => o.id === optionId);
 if (!option) return c.json({ error: 'option not found' }, 404);
 const quest = coachStore().adoptQuest({ direction: slug, act: option.text, cites: option.cites });
 serverEmit(deps.vaultRoot, 'elicitor', 'quest-adopted', `slug=${slug} quest=${quest.id}`);
 return c.json({ quest });
});

// POST /api/coach/:slug/decline-option { optionId } — recorded text,
// never re-offered (Q-77).
app.post('/api/coach/:slug/decline-option', async (c) => {
 const slug = c.req.param('slug');
 const note = coachStore().readAdvice(slug);
 const body = await c.req.json<{ optionId?: unknown }>();
 const optionId = typeof body?.optionId === 'string' ? body.optionId : '';
 const option = note?.options.find((o) => o.id === optionId);
 if (!option) return c.json({ error: 'option not found' }, 404);
 coachStore().addDeclinedOption(slug, option.text);
 serverEmit(deps.vaultRoot, 'elicitor', 'coach-option-declined', `slug=${slug}`);
 return c.json({ ok: true });
});

// POST /api/coach/quest/:id/return { text, channel? } — ORDINARY CAPTURE
// (Q-75): the unprompted template with the quest/direction tag on the
// transcript (T4's caller), protocol 'quest-return', then the reflection
// mint (T6) and the same background advice attempt.
app.post('/api/coach/quest/:id/return', async (c) => {
 const quest = coachStore().getQuest(c.req.param('id'));
 if (!quest) return c.json({ error: 'unknown quest' }, 404);
 const body = await c.req.json<{ text?: unknown; channel?: unknown }>();
 const text = requireText(c, body.text);
 if (text instanceof Response) return text;
 const channel = checkedChannel(c, body.channel);
 if (channel instanceof Response) return channel;
 const sessionId = ulid();
 const { at, turn } = startUnpromptedSitting(sessionCtx, {
  sessionId,
  text,
  protocol: 'quest-return',
  transcript: { quest: quest.id, direction: quest.direction },
 });
 unpromptedSessions.add(sessionId);
 unpromptedChannels.set(sessionId, channel);

 // Length, never content (Q-23: the JSONL is the audit trail).
 serverEmit(deps.vaultRoot, 'elicitor', 'quest-returned', `quest=${quest.id} session=${sessionId} chars=${text.length}`);

 startBackgroundHarvest(sessionCtx, {
  sessionId,
  turns: [turn],
  protocol: 'quest-return',
  started: at,
  origin: 'unprompted',
  ...(channel !== undefined ? { unpromptedChannel: channel } : {}),
 });

 const reflections = mintReflections({
  queue: deps.queue,
  quest,
  session: sessionId,
  returnText: text,
  log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
 });
 if (reflections.minted.length > 0) {
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'reflection-minted',
   `minted=${reflections.minted.length} clipped=${reflections.clipped}`,
  );
 }
 refreshAdviceInBackground(quest.direction);
 return c.json({ status: 'harvesting', sessionId, reflections: reflections.minted.length });
});

// POST /api/coach/quest/:id/retire — the person's verb, no confirmation,
// no reason (Q-75).
app.post('/api/coach/quest/:id/retire', (c) => {
 const quest = coachStore().retireQuest(c.req.param('id'));
 if (!quest) return c.json({ error: 'unknown quest' }, 404);
 serverEmit(deps.vaultRoot, 'elicitor', 'quest-retired', `quest=${quest.id}`);
 return c.json({ ok: true });
});

// POST /api/coach/:slug/artifact { pointer, name, sentence } — a pointer
// plus the person's own sentence (Q-78). The pointer is lineage-plane and
// NEVER opened; the sentence goes through the ordinary capture path. The
// POINTER never enters a detail line — the Activity JSONL is surfaced.
app.post('/api/coach/:slug/artifact', async (c) => {
 const slug = c.req.param('slug');
 const direction = coachStore().getDirection(slug);
 if (!direction || !direction.coached) return c.json({ error: 'unknown direction' }, 404);
 const body = await c.req.json<{ pointer?: unknown; name?: unknown; sentence?: unknown }>();
 const pointer = requireText(c, body.pointer, 'pointer, name and sentence are required');
 if (pointer instanceof Response) return pointer;
 const name = requireText(c, body.name, 'pointer, name and sentence are required');
 if (name instanceof Response) return name;
 const sentence = requireText(c, body.sentence, 'pointer, name and sentence are required');
 if (sentence instanceof Response) return sentence;

 const sessionId = ulid();
 const { at, turn } = startUnpromptedSitting(sessionCtx, {
  sessionId,
  text: sentence,
  protocol: 'artifact',
  transcript: { direction: slug },
 });
 unpromptedSessions.add(sessionId);
 unpromptedChannels.set(sessionId, undefined);
 startBackgroundHarvest(sessionCtx, {
  sessionId,
  turns: [turn],
  protocol: 'artifact',
  started: at,
  origin: 'unprompted',
 });
 // The declaration stamp must be strictly later than the licence baseline
 // (advice mintedAt, else coachedAt), or a same-millisecond declare→artifact
 // compares equal in licenseState's `>` and the background mint silently
 // skips — the same clock-precision seam /read guards against.
 const baseline = [direction.coachedAt, coachStore().readAdvice(slug)?.mintedAt].filter((s): s is string => s !== undefined);
 const latest = baseline.length > 0 ? baseline.reduce((a, b) => (a > b ? a : b)) : '';
 let declaredAt = new Date().toISOString();
 if (latest !== '' && declaredAt <= latest) declaredAt = new Date(Date.parse(latest) + 1).toISOString();
 coachStore().declareArtifact({ direction: slug, pointer, name, sentenceSession: sessionId, declaredAt });
 serverEmit(deps.vaultRoot, 'elicitor', 'artifact-declared', `direction=${slug} named=true`);
 refreshAdviceInBackground(slug);
 return c.json({ status: 'harvesting', sessionId });
});
}
