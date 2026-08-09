/**
 * The waiting-surface cluster (Wave D1 extraction): harvest-queue ×2,
 * unprompted, sweep-backlog and the /api/events SSE feed
 * (with its payload projection), plus the sittingsFromLedger helper, moved
 * wholesale out of src/server.ts. Wire shapes, route paths, log kinds, and
 * error statuses are byte-identical to the pre-extraction server.
 *
 * The handlers close over exactly the bindings WaitingDeps names. The
 * unprompted maps are the SAME Set/Map createSessionState built (Wave C3
 * F14) — the boot passes them by reference, so the coach cluster and the
 * session-flow routes see every write. The one-turn sitting opener and the
 * fire-and-return harvest come from src/session/routes.ts, the shared
 * skeleton of every capture flow (S17, ticket 084).
 */
import type { Hono } from 'hono';
import { ulid } from 'ulid';
import { streamSSE } from 'hono/streaming';
import { onAppend, type ActivityEvent } from '../log/activity.js';
import { checkedChannel, requireText } from '../guards.js';
import { readPendingHarvest, listPendingHarvests } from '../harvester/pending.js';
import { readSweepDeferral, readSweepDeferrals } from '../wiki/store.js';
import { readTranscriptBody } from '../vault/transcripts.js';
import { startBackgroundHarvest, startUnpromptedSitting, type ServerEmitFn, type SessionCtx } from './routes.js';
import type { CaptureChannel, Vault } from '../types.js';

/**
 * The bindings the waiting-surface handlers close over. The unprompted
 * maps are the SAME objects the session-flow and coach clusters mutate —
 * the boot passes them by reference, exactly as the pre-extraction server
 * did. `sweepWorkRemaining` is the Clerk's live counter (the deferral
 * ledger read sits beside it in the sweep-backlog route).
 */
interface WaitingDeps {
 /** The vault. Kept for the server's wiring shape (createApp passes it); the
  * anniversary route that read it was cut with the zero-output sweeps
  * (ruling 2026-08-09) — a structural leftover until server.ts drops it. */
 vault: Vault;
 vaultRoot: string;
 /** The server's activity-log seam. */
 serverEmit: ServerEmitFn;
 /** The live session-flow context the unprompted opener and harvest need. */
 sessionCtx: SessionCtx;
 /** Sessions whose material arrived unprompted — BY REFERENCE (Wave C3 F14). */
 unpromptedSessions: Set<string>;
 /** The capture channel per unprompted session — BY REFERENCE (ticket 048). */
 unpromptedChannels: Map<string, CaptureChannel | undefined>;
 /** The Clerk's live sweep-backlog counter (ticket 139). */
 sweepWorkRemaining: () => { pending: number; fresh: number; clipped: boolean };
}

/**
 * Register the waiting-surface cluster: the six routes and their helpers,
 * extracted wholesale from src/server.ts (Wave D1). Called exactly once at
 * app build, at the cluster's old registration position, so the Hono route
 * table is unchanged entry-for-entry.
 */
export function createWaitingRoutes(app: Hono, deps: WaitingDeps): void {
 const { vaultRoot, serverEmit, sessionCtx, unpromptedSessions, unpromptedChannels, sweepWorkRemaining } = deps;

// GET /api/harvest-queue → {pending} (ticket 084)
// The review surface: every finished harvest awaiting a decision, newest
// first. Offer-only — deciding still happens through POST /harvest.
app.get('/api/harvest-queue', (c) => {
 const pending = listPendingHarvests(vaultRoot).map((r) => ({
  sessionId: r.sessionId,
  at: r.at,
  started: r.started,
  protocol: r.protocol,
  origin: r.origin,
  proposalCount: r.proposals.length,
  // Wave 2 S1: records written before the buds field existed read as
  // absent — mapped to 0, never to a guessed count.
  budCount: r.buds?.length ?? 0,
  // Batch C2 (§12.1): how many proposals repeat an older passage — the
  // review row's "keep both?" count. Absent reads as none.
  repeatsCount: r.repeats?.length ?? 0,
 }));
 return c.json({ pending });
});

// GET /api/harvest-queue/:sessionId → the full pending record (ticket 084)
// The id is a plain token, gated before any file read so a crafted id
// cannot walk out of the pending directory.
app.get('/api/harvest-queue/:sessionId', (c) => {
 const sessionId = c.req.param('sessionId');
 if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
  return c.json({ error: 'not found' }, 404);
 }
 const record = readPendingHarvest(vaultRoot, sessionId);
 if (!record) return c.json({ error: 'not found' }, 404);
 // The full record plus the mapped count — absent buds read as 0 (Wave 2 S1).
 // transcriptBody carries the sitting's body text for the in-place review
 // surface; '' when the transcript is missing or unparseable (Wave 3 S4).
 return c.json({
  ...record,
  budCount: record.buds?.length ?? 0,
  // Batch C2 (§12.1): the receipt's per-passage sentence reads this.
  repeatsCount: record.repeats?.length ?? 0,
  transcriptBody: readTranscriptBody(vaultRoot, sessionId),
 });
});

// POST /api/unprompted {text} → harvesting (ticket 084)
// The user wrote or pasted material with no question asked. It becomes a
// transcript of one user turn, then harvests behind this response; the
// review cards for its cuts land in the pending queue.
app.post('/api/unprompted', async (c) => {
 const body = await c.req.json<{ text: string; channel?: CaptureChannel }>();
 const text = requireText(c, body.text);
 if (text instanceof Response) return text;
 const channel = checkedChannel(c, body.channel);
 if (channel instanceof Response) return channel;

 const sessionId = ulid();
 const { at, turn } = startUnpromptedSitting(sessionCtx, {
  sessionId,
  text,
  protocol: 'unprompted',
 });
 unpromptedSessions.add(sessionId);
 unpromptedChannels.set(sessionId, channel);

 // Never log the content — only how much of it there was.
 serverEmit(vaultRoot, 'elicitor', 'unprompted-entry', `session=${sessionId} chars=${text.length}`);

 startBackgroundHarvest(sessionCtx, {
  sessionId,
  turns: [turn],
  protocol: 'unprompted',
  started: at,
  origin: 'unprompted',
  ...(channel !== undefined ? { unpromptedChannel: channel } : {}),
 });
 return c.json({ status: 'harvesting', sessionId });
});

// GET /api/sweep-backlog → { pendingReadings, freshReadings, sittings } (ticket 139, 156)
// The waiting surface reads this to show "the wiki is N readings behind"
// and which sittings wait. Cheap: reads the sweep deferral ledger and the
// claim store's swept set.
app.get('/api/sweep-backlog', (c) => {
 const previous = readSweepDeferral(vaultRoot);
 const { pending, fresh } = sweepWorkRemaining();
 return c.json({
  pendingReadings: pending,
  freshReadings: fresh,
  lastRecorded: previous?.remaining ?? 0,
  at: previous?.at ?? null,
  sittings: sittingsFromLedger(readSweepDeferrals(vaultRoot)),
 });
});

/**
 * The deferral ledger, grouped by calendar day (ticket 156). Each line is
 * one sitting that left sweep work; the day key is the ISO timestamp's date
 * portion — the same `YYYY-MM-DD` shard the Activity Log shards on — and the
 * readings sum the lines of that day. Most recent day first.
 */
function sittingsFromLedger(lines: { at: string; remaining: number }[]): { date: string; readings: number }[] {
 const byDay = new Map<string, number>();
 for (const line of lines) {
  const day = line.at.slice(0, 10);
  byDay.set(day, (byDay.get(day) ?? 0) + line.remaining);
 }
 return [...byDay.entries()]
  .map(([date, readings]) => ({ date, readings }))
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// GET /api/events → SSE liveness feed (ticket 150). Every Activity Log
// append (Q-23 — the one audit spine every actor writes through) is
// pushed as one event, so open screens refresh instead of waiting for a
/**
* The SSE wire event: kind+at+detail only, never payloads (the
* harvest-detail contract). A named helper so the serialization's
* `kind: e.kind` never reads as an activity-log emit to the
* emitted-kinds sweep — this is a wire projection, not an event.
*/
const ssePayload = (e: ActivityEvent): string => {
 return JSON.stringify({ kind: e.kind, at: e.at, detail: e.detail });
};

// manual reload. Read-only; carries kind+at, never payloads — a screen
// refetches through its own routes. Q-22 intact: this reaches only a
// browser tab the person already has open; nothing walks out.
app.get('/api/events', (c) =>
 streamSSE(c, async (stream) => {
  let open = true;
  const off = onAppend(vaultRoot, (e) => {
   if (!open) return;
   // `detail` rides along for the client's no-change dedupe: an idle docket
   // cycle re-emits byte-identical detail strings ("minted 0 openers",
   // "swept=0 applied=0 …"), and a repeated identical event is by
   // definition a heartbeat. Details are counts/ids only, never user text
   // (the harvest-detail contract), and the same client can already read
   // the full log through GET /api/activity — nothing new is exposed.
   stream
    .writeSSE({ data: ssePayload(e) })
    .catch(() => { open = false; });
  });
  stream.onAbort(() => { open = false; off(); });
  // Keep-alive comments hold proxies and browsers on the line.
  // (env-tunable so tests are not held hostage by a 25s sleep)
  const keepalive = Number(process.env.ELICIT_SSE_KEEPALIVE_MS ?? 25_000);
  while (open) {
   await stream.sleep(keepalive);
   try {
    await stream.writeSSE({ event: 'ping', data: '' });
   } catch {
    open = false;
   }
  }
  off();
 }),
);
}
