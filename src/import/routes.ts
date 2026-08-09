/**
 * The import cluster (Wave D1 extraction): every /api/import route — scan,
 * next (GET+POST), decisions, exclude, survey (GET+POST), region — plus
 * the importNext/importSurvey helpers, moved wholesale out of src/server.ts.
 * Wire shapes, route paths, log kinds, and error statuses are byte-identical
 * to the pre-extraction server.
 *
 * The handlers close over exactly the bindings ImportDeps names: the
 * staging and region stores server.ts owns (also shared with the Clerk's
 * docket thunks), the vault/queue/root trio, the server's emit seam, the
 * x-elicit-pure read detector (129 — survey skips its write under it) and
 * the docket start handle (scan re-triggers extraction).
 * The dropped-line marks are classified by src/import/body.ts — the one
 * copy of the `clean` vocabulary (moved home with the classifier).
 */
import type { Context, Hono } from 'hono';
import matter from 'gray-matter';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { appendEvent, type ActivityEvent } from '../log/activity.js';
import type { ServerEmitFn } from '../session/routes.js';
import type { Authorship, DatingRule, ImportDecision } from './contract.js';
import { AUTHORS, IMPORT_ACTIONS } from './contract.js';
import { validateDecisions } from '../guards.js';
import { droppedRegions } from './body.js';
import {
 bodyHash,
 compilePattern,
 pipelineCommit,
 pipelineScan,
 pipelineSurvey,
 type ScanPipelineResult,
 type Survey,
} from './pipeline.js';
import type { ImportStore } from './store.js';
import type { RegionStore } from './region.js';
import type { QueueStore, Vault } from '../types.js';

/**
 * The bindings the import handlers close over. The stores are the SAME
 * objects server.ts owns — the docket's extraction job writes the staging
 * store between requests, and every handler here sees those writes.
 */
interface ImportDeps {
 /** The staging store the docket's extraction job reads and writes (T6). */
 importStore: ImportStore;
 /** The region store the seeding routes read and write (014). */
 regionStore: RegionStore;
 /** The vault — the decisions route commits through it. */
 vault: Vault;
 /** The queue store — the commit and the reach offer read it. */
 queue: QueueStore;
 vaultRoot: string;
 /** The server's activity-log seam. */
 serverEmit: ServerEmitFn;
 /** The x-elicit-pure read detector (129): survey skips its write under it. */
 isPureRead: (c: Context) => boolean;
 /** The docket start handle — the scan route re-triggers extraction behind the response (T6). */
 startDocket: (trigger: string) => void;
}

/**
 * Register the import cluster: the ~9 /api/import routes, the reach pair
 * and their helpers, extracted wholesale from src/server.ts (Wave D1).
 * Called exactly once at app build, at the cluster's old registration
 * position, so the Hono route table is unchanged entry-for-entry.
 */
export function createImportRoutes(app: Hono, deps: ImportDeps): void {
 const { importStore, regionStore, vaultRoot, serverEmit, isPureRead } = deps;

// ── The four T9 routes: scan a folder, hand the next piece to read, take
// decisions on it, or take the reason for refusing it whole. No fifth route
// writes without a review behind it. The folder path is read from the
// request and off local disk by design (Q-57), so the /api/* auth lock is
// the control — there is no traversal check to write.

// POST /api/import/scan {folder, region?} → {pending, skipped, adopted, refused}
// The folder becomes staging records, and nothing else: extraction runs in
// the docket behind this response (T6) and the corpus is written only by a
// review decision. When a `region` slug is present, the region's declared
// dating rule drives the scan and its slug bounds the admission (014 T12);
// absent, this behaves exactly as 058 built it — the 19 adopted posts and
// any plain folder scan stay reachable.
app.post('/api/import/scan', async (c) => {
 const body = await c.req.json<{ folder?: string; region?: string }>();
 const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
 if (folder.length === 0) {
  return c.json({ error: 'folder is required' }, 400);
 }
 const regionSlug = typeof body.region === 'string' ? body.region.trim() : '';
 const regionRecord = regionSlug.length === 0 ? null : regionStore.get(regionSlug);
 if (regionSlug.length > 0 && regionRecord === null) {
  return c.json({ error: `unknown region ${regionSlug}` }, 400);
 }
 // The pipeline owns the sequence — adoption FIRST and with this folder
 // (T8), then the region's rule dates the scan (Anchor, 014 T3), then
 // admit. A bad folder path throws — answer 400 with what it said.
 let result: ScanPipelineResult;
 try {
  result = pipelineScan({
   store: importStore,
   vaultRoot,
   folder,
   region: regionRecord,
   log: (e) => appendEvent(vaultRoot, e as ActivityEvent),
  });
 } catch (err) {
  return c.json({ error: String(err) }, 400);
 }
 deps.startDocket('import');
 const { adopted, scanned, admitted } = result;
 return c.json({
  pending: admitted.added.length,
  skipped: admitted.skipped.length,
  adopted: adopted.accepted + adopted.excluded,
  refused: [...scanned.refused, ...admitted.refused].map((r) => ({ file: basename(r.sourcePath), reason: r.reason })),
 });
});

// GET /api/import/next → the oldest extracted piece, whole, or `waiting`.
// Registered for GET and POST: the web client's api() helper POSTs any path
// outside its GET_PREFIXES list and the review surface calls through it.
// Read-only under both methods — nothing here reads a body or writes.
const importNext = async (c: Context): Promise<Response> => {
 // The bounded queue (014 T6/T12): `?region=` keeps the review inside the
 // region the person chose. Absent, the route behaves exactly as 058 built
 // it — the 19 adopted posts, which carry no region, stay reachable.
 const region = c.req.query('region') ?? undefined;
 const record = importStore.nextExtracted(region);
 if (record === null) {
  return c.json({ item: null, waiting: 'no pieces are ready to read yet' });
 }
 // Re-read the source and re-hash: a file that changed since extraction
 // would show cuts that cannot commit — the new body is a NEW item
 // (Q-59), so the review answers waiting instead of showing a ghost.
 let body: string;
 try {
  body = matter(readFileSync(record.sourcePath, 'utf-8')).content;
 } catch {
  return c.json({ item: null, waiting: 'a piece changed on disk since it was read — scan the folder again' });
 }
 if (bodyHash(body) !== record.hash) {
  return c.json({ item: null, waiting: 'a piece changed on disk since it was read — scan the folder again' });
 }
 // The piece renders whole, with the regions preparation dropped marked
 // and named, so the reader sees why a paragraph carries no cuts.
 return c.json({
  item: {
   hash: record.hash,
   file: basename(record.sourcePath),
   ...(record.title !== undefined ? { title: record.title } : {}),
   date: record.date,
   source: body,
   cuts: record.cuts ?? [],
   marks: droppedRegions(body, importStore.prepared(record.hash)),
   remaining: Math.max(0, importStore.list('extracted', region).length - 1),
  },
 });
};
app.get('/api/import/next', importNext);
app.post('/api/import/next', importNext);

// POST /api/import/:hash/decisions {decisions} → {sessionId, snippets}
// One decision per proposed cut, validated like the harvest route's
// (ticket 024). Everything else is the commit gate: a stale or
// unverifiable item is refused whole and nothing is written.
app.post('/api/import/:hash/decisions', async (c) => {
 const hash = c.req.param('hash');
 const body = await c.req.json<{ decisions?: ImportDecision[] }>();
 if (!Array.isArray(body.decisions)) {
  return c.json({ error: 'decisions must be an array' }, 400);
 }
 const record = importStore.get(hash);
 if (record === null) return c.json({ error: 'not found' }, 404);
 if (record.status !== 'extracted') {
  return c.json({ error: 'this piece has not been extracted yet', reason: 'not-extracted' }, 409);
 }
 const cuts = record.cuts ?? [];
 // The shared decision validator — the same shape the harvest route's
 // (ticket 024) guard uses (Wave C3 F3).
 const invalid = validateDecisions(IMPORT_ACTIONS, body.decisions, {
  indexField: 'cut',
  count: cuts.length,
 });
 if (invalid) return c.json(invalid, 400);
 // The pipeline owns the sequence — the commit, and only on a CLEAN
 // commit the repair pass over the snippets just written (014 T10),
 // never before.
 const result = pipelineCommit(
  {
   vault: deps.vault,
   store: importStore,
   queue: deps.queue,
   vaultRoot,
   readSource: (p) => readFileSync(p, 'utf-8'),
   log: (e) => appendEvent(vaultRoot, e as ActivityEvent),
   // The authorship seam (014 T9): the region's declared authorship is
   // stamped on every snippet of the sitting. It was inert until this line.
   regionFor: (p) => regionStore.regionFor(p),
  },
  hash,
  body.decisions,
 );
 if (result.ok) {
  return c.json({ sessionId: result.sessionId, snippets: result.snippets });
 }
 return c.json({ error: result.detail, reason: result.reason }, 409);
});

// POST /api/import/:hash/exclude {reason} → {ok: true}
// Refuse the piece whole. The reason lives on the record (Q-51), never in
// the log line — the log names the file and the act, not the words.
app.post('/api/import/:hash/exclude', async (c) => {
 const hash = c.req.param('hash');
 const body = await c.req.json<{ reason?: string }>();
 const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
 if (reason.length === 0) {
  return c.json({ error: 'reason is required' }, 400);
 }
 const record = importStore.get(hash);
 if (record === null) return c.json({ error: 'not found' }, 404);
 if (record.status !== 'extracted') {
  return c.json({ error: 'this piece has not been extracted yet', reason: 'not-extracted' }, 409);
 }
 importStore.put({ ...record, status: 'excluded', excludeReason: reason }, importStore.prepared(hash));
 serverEmit(vaultRoot, 'elicitor', 'import-excluded', 'path=' + record.sourcePath);
 return c.json({ ok: true });
});

// ── Seeding routes (014 T12) ──

// GET/POST /api/import/survey?folder=… → { survey }
// The coarse, model-free map of a folder: per-node counts of files /
// harvested / refused / unread, computed from the import store, snapshotted
// to vault/imports/survey.json (a rebuildable cache — Q-3 — the one file in
// imports/ that may be deleted without loss).
// Registered for GET and POST: the web client's api() helper POSTs any path
// outside its read list, and the survey map (014 T13) calls through it.
// Read-only under both methods — nothing here reads a body or writes corpus.
const importSurvey = async (c: Context): Promise<Response> => {
 const folder = c.req.query('folder') ?? '';
 if (folder.length === 0) {
  return c.json({ error: 'folder is required' }, 400);
 }
 let survey: Survey;
 try {
  survey = pipelineSurvey({
   store: importStore,
   vaultRoot,
   folder,
   // A pure read computes the map and keeps nothing (129): under /v2 the
   // snapshot is written by act {v:'survey'}, which is why that verb exists.
   snapshot: !isPureRead(c),
  });
 } catch (err) {
  return c.json({ error: String(err) }, 400);
 }
 return c.json({ survey });
};
app.get('/api/import/survey', importSurvey);
app.post('/api/import/survey', importSurvey);

// POST /api/import/region {root, dating, authorship} → {slug}
// The ONLY writer of a region record, and it validates before it writes
// (Q-67): a pattern that cannot produce a day is 400 and nothing is written
// — a region that cannot date anything must not exist — and an authorship
// outside the three declared values is 400 with no server-side default, a
// default being a silent assertion about who wrote the person's notes.
app.post('/api/import/region', async (c) => {
 const body = await c.req.json<{ root?: string; dating?: unknown; authorship?: unknown }>();
 const root = typeof body.root === 'string' ? body.root.trim() : '';
 if (root.length === 0) {
  return c.json({ error: 'root is required' }, 400);
 }
 const d = body.dating as { kind?: unknown; key?: unknown; pattern?: unknown } | null | undefined;
 if (d === null || typeof d !== 'object' || (d.kind !== 'frontmatter' && d.kind !== 'filename')) {
  return c.json({ error: 'dating must be a frontmatter or filename rule' }, 400);
 }
 const dating: DatingRule =
  d.kind === 'filename'
   ? { kind: 'filename', pattern: typeof d.pattern === 'string' ? d.pattern : '' }
   : { kind: 'frontmatter', key: typeof d.key === 'string' ? d.key : '' };
 if (dating.kind === 'filename' && compilePattern(dating.pattern) === null) {
  return c.json({ error: 'the pattern cannot produce a day' }, 400);
 }
 if (dating.kind === 'frontmatter' && dating.key.length === 0) {
  return c.json({ error: 'a frontmatter rule needs a key' }, 400);
 }
 if (typeof body.authorship !== 'string' || !(AUTHORS as readonly string[]).includes(body.authorship)) {
  return c.json({ error: 'authorship must be one of authored, other, machine-assisted' }, 400);
 }
 const record = regionStore.declare({
  root,
  dating,
  authorship: body.authorship as Authorship,
 });
 return c.json({ slug: record.slug });
});
}
