import { Hono, type Context } from 'hono';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import matter from 'gray-matter';
import { join, extname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { createVault } from './vault/vault.js';
import { startSession, userTurn, skipQuestion } from './elicitor/elicitor.js';
import { suggestTargetForVault } from './elicitor/target-default.js';
import { propose, decide, CUTS_RESPONSE_FORMAT, type HarvestDiagnostics } from './harvester/harvester.js';
import {
 writePendingHarvest,
 readPendingHarvest,
 listPendingHarvests,
 removePendingHarvest,
} from './harvester/pending.js';
import { createQueueStore } from './queue/queue.js';
import { buildIndex } from './index/lexical.js';
import {
 buildSemanticIndex,
 fileSnippetVectorStore,
 resonateHybrid,
 type SemanticIndex,
} from './index/semantic.js';
import { readCadence, cadenceSentence } from './log/cadence.js';
import { runDocket } from './clerk/docket.js';
import { nextConsolidation, saveSummary, loadSummaries } from './memory/cover.js';
import { composeOpener, composeStillTrue, composeExpedition } from './clerk/composed.js';
import { runWikiJobs, DEFAULT_CLERK_MODEL } from './clerk/wiki-jobs.js';
import { createImportStore } from './import/store.js';
import { chronological } from './piece/arrange.js';
import { createPieceStore } from './piece/store.js';
import { toMarkdown } from './piece/export.js';
import type { Arrangement, ArrangementEntry, Gap, Piece } from './piece/contract.js';
import { runImportExtraction } from './import/extract.js';
import { scanFolder, bodyHash, type ScanResult } from './import/scan.js';
import { adoptPriorIngest, type AdoptResult } from './import/adopt.js';
import { commitImport } from './import/commit.js';
import type { ImportDecision } from './import/contract.js';
import { proposeOps } from './clerk/mint.js';
import { judgeOpposition, composeRemeasure, judgeConfirmation } from './clerk/contradiction.js';
import {
 createClaimStore,
 appendSweepDeferral,
 readSweepDeferral,
 writeStillTrueCursor,
 readStillTrueCursor,
} from './wiki/store.js';
import { THRESHOLDS } from './wiki/thresholds.js';
import { createRegistry } from './wiki/registry.js';
import { lexicalChannel, referentChannel, poolCandidates, type ClashChannel } from './wiki/clash.js';
import {
 embeddingChannel,
 fileEmbeddingStore,
 localEmbedder,
 type Embed,
 type EmbeddingChannel,
} from './wiki/embedding.js';
import { lint } from './wiki/lint.js';
import { applyOps } from './wiki/ops.js';
import { coreness } from './wiki/status.js';
import { facetHeading, lintNote } from './queue/source-label.js';
import { FACETS } from './queue/facet-balance.js';
import type { Claim, ClaimGraph, LintFinding, LogFn } from './wiki/contract.js';
import { makeFakeComplete } from './fake-responder.js';
import { appendEvent, readEvents, type ActivityEvent } from './log/activity.js';
import { surfaced } from './log/surfaced.js';
import { createSttClient, type SttClient } from './stt/client.js';
import { resolveModelDir } from './stt/model.js';
import { createFileAuth, isLoopback, type AuthStore } from './auth/auth.js';
import { loadProtocolDefinitions, selectProtocolForTarget } from './protocols/registry.js';
import { createRandomizer, type RandomizerDraw } from './randomizer/randomizer.js';
import type {
 Vault,
 Complete,
 CaptureChannel,
 Facet,
 Mode,
 SessionState,
 CutProposal,
 HarvestDecision,
 QueueStore,
 LexicalIndex,
 DocketReport,
 QueueEntry,
 Snippet,
 Turn,
 Target,
} from './types.js';
export interface ServerDeps {
 vault: Vault;
 /** Foreground model: probes, red-lights, live composition. A person waits on it (Q-48). */
 complete: Complete;
 /**
  * Background model: harvest extraction, docket minting, consolidation.
  * Absent means one model does both jobs — the fake responder and the tests
  * work that way. The stamp is required next to the Complete so a clerk
  * artifact can never carry the elicitor's model name (Q-34).
  */
 clerk?: {
  complete: Complete;
  modelName: string;
  /**
   * The same clerk endpoint with the cuts JSON schema pinned at generation
   * (ticket 078). Harvest-only: the wiki mint jobs speak the op-list shape,
   * so the constrained variant must never serve them. Absent falls back to
   * `complete` — the fake responder and the tests keep the unconstrained path.
   */
  harvestComplete?: Complete;
 };
 /**
  * The embedder behind the third clash channel (Q-17). Injected for the same
  * reason `complete` is: it is the only other thing in this process that
  * reaches an endpoint, and a test must never do that. Absent means the
  * channel is not built — two channels still run, and the Clerk works with
  * the embedding server switched off because it does today.
  */
 embed?: { embed: Embed; model: string };
 queue: QueueStore;
 index: LexicalIndex;
 /**
  * The semantic resonance channel (Q-17, ticket 068). Built beside the lexical
  * index at boot and primed in the background; absent means the channel is off
  * and the hybrid degrades to the trigram index — the ordinary cold state,
  * the same shape as `embed` for the Clerk.
  */
 semanticIndex?: SemanticIndex;
 vaultRoot: string;
 authStore: AuthStore;
 /** Optional STT client for voice input. Lazily created as module singleton if absent. */
 sttClient?: SttClient;
 /** Model id stamped on elicitor-authored artifacts (Q-34). */
 modelName?: string;
 /**
  * Called after each background docket run settles, success or failure. The
  * docket runs off the response path (ticket 047), so this is the only seam
  * an embedder has to know that a run finished.
  */
 onDocketSettled?: () => void;
}

// ── MIME map for static serving ──

const MIME: Record<string, string> = {
 '.html': 'text/html; charset=utf-8',
 '.css': 'text/css; charset=utf-8',
 '.js': 'application/javascript; charset=utf-8',
 '.json': 'application/json',
 '.png': 'image/png',
 '.svg': 'image/svg+xml',
 '.ico': 'image/x-icon',
};

// ── STT client (lazy module singleton) ──

let _sttClient: SttClient | null = null;
let _sttUnavailable = false;

function getSttClient(deps: ServerDeps): SttClient | null {
 if (_sttClient) return _sttClient;
 if (_sttUnavailable) return null;
 if (deps.sttClient) {
  _sttClient = deps.sttClient;
  return _sttClient;
 }
 try {
  resolveModelDir(); // throws if unavailable
 } catch {
  _sttUnavailable = true;
  return null;
 }
 _sttClient = createSttClient();
 return _sttClient;
}

// ── Password gate ──

/** Session tokens for password-gated access. Maps token → expiry ms. */
const loginSessions = new Map<string, number>();
const COOKIE_NAME = 'elicit_session';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

function newSessionToken(): string {
 return randomBytes(32).toString('hex');
}

function checkSession(c: { req: { header: (n: string) => string | undefined } }): boolean {
 const cookie = c.req.header('cookie') ?? '';
 const match = /elicit_session=([^;]+)/.exec(cookie);
 if (!match) return false;
 const token = match[1]!;
 const expiry = loginSessions.get(token);
 if (!expiry || expiry < Date.now()) {
  loginSessions.delete(token);
  return false;
 }
 return true;
}

// ── Helpers ──


/** Extract the remote address from the Hono env (injected by the Node adapter). */
function getRemoteAddr(env: unknown): string | undefined {
 if (env && typeof env === 'object' && 'remoteAddr' in env) {
  const v = (env as Record<string, unknown>).remoteAddr;
  return typeof v === 'string' ? v : undefined;
 }
 return undefined;
}

/** Emit an activity event at the server seam. */
function serverEmit(
 root: string,
 actor: ActivityEvent['actor'],
 kind: string,
 detail: string,
 refs?: string[],
): void {
 appendEvent(root, { at: new Date().toISOString(), actor, kind, detail, ...(refs ? { refs } : {}) });
}

/**
 * The surfaced stamp for a queue question this sitting just served (015).
 * A queue entry whose question reached the person surfaces the snippets its
 * citations quote. user-declared entries carry no cites and no stamp.
 */
function stampComposedServed(root: string, queue: QueueStore, openQueueEntryId?: string): void {
 if (!openQueueEntryId) return;
 const entry = queue.list().find((e) => e.id === openQueueEntryId);
 if (!entry || entry.cites === undefined || entry.cites.length === 0) return;
 surfaced(root, entry.cites, 'composed-question');
}

/**
 * The `harvest-proposed` detail line — counts and flags only, never user text.
 * `parsed=false` distinguishes a collapsed extraction from a genuinely thin
 * sitting; before ticket 034 both logged as `proposals=0`.
 *
 * The ticket-037 diagnostics are here because a counter that stops at the
 * struct is not a record (ticket 066). Two of them — the episode pair — are a
 * Q-35 shadow record, which is the only evidence by which 037's episode fix
 * graduates or does not; the other three say what the structural checks did to
 * the model's own labelling. `src/log/format.ts#harvestProposed` renders every
 * one of them as English, and `tests/log-format.test.ts` fails if a value
 * added here does not reach that sentence.
 *
 * Three more fields reach the surface as of ticket 069: `cutsSeen`,
 * `inadmissibleDrops` and `contentFreeSkips`. `inadmissibleDrops` is the 044
 * admissibility gate's own counter — the only number that says whether the
 * gate is doing anything at all — and the renderer gives it the most legible
 * sentence of the three.
 */
function harvestDetail(result: {
 proposals: unknown[];
 buds: unknown[];
 diagnostics: HarvestDiagnostics;
}): string {
 const d = result.diagnostics;
 return [
  `proposals=${result.proposals.length}`,
  `buds=${result.buds.length}`,
  `parsed=${d.parsed}`,
  `parseMode=${d.parseMode}`,
  `chunks=${d.chunksParsed}/${d.chunks}`,
  `chunkErrors=${d.chunkErrors}`,
  `fabricationDrops=${d.fabricationDrops}`,
  `cutsSeen=${d.cutsSeen}`,
  `inadmissibleDrops=${d.inadmissibleDrops}`,
  `contentFreeSkips=${d.contentFreeSkips}`,
  `sourceTurnCorrections=${d.sourceTurnCorrections}`,
  `fragmentBuds=${d.fragmentBuds}`,
  `outOfVocabularyLabels=${d.outOfVocabularyLabels}`,
  `supersessionCorrections=${d.supersessionCorrections}`,
  `unmarkedIntentions=${d.unmarkedIntentions}`,
  `episodeAnchoredTurns=${d.episodeAnchoredTurns}`,
  `episodeBlindTurns=${d.episodeBlindTurns}`,
 ].join(' ');
}
// ── Defer: turning a declared need into Mode needs ──

/** The sitting lengths the Mode screen offers. A deferred question asks for the next one up. */
const MINUTE_LADDER = [10, 25, 45];

/** The next sitting length above the current one — capped at the longest the Mode screen offers. */
function moreMinutesThan(minutes: number): number {
 return MINUTE_LADDER.find((m) => m > minutes) ?? MINUTE_LADDER[MINUTE_LADDER.length - 1]!;
}

/** The next energy level above the current one — capped at 'high'. */
function moreEnergyThan(energy: Mode['energy']): Mode['energy'] {
 if (energy === 'low') return 'medium';
 return 'high';
}

/** The channels a client may declare for a turn's arrival (ticket 048). */
const CAPTURE_CHANNELS: readonly CaptureChannel[] = ['typed', 'spoken', 'pasted'];

/** Narrowing guard for a capture channel value sent by the client. */
function isCaptureChannel(v: unknown): v is CaptureChannel {
 return (CAPTURE_CHANNELS as readonly unknown[]).includes(v);
}

/** Scan transcript files for session metadata (used by docket). */
function listSessions(root: string): { session: string; started: string; turnCount: number; chars: number }[] {
 const dir = join(root, 'transcripts');
 if (!existsSync(dir)) return [];
 const results: { session: string; started: string; turnCount: number; chars: number }[] = [];
 for (const f of readdirSync(dir)) {
  if (!f.endsWith('.md')) continue;
  const raw = readFileSync(join(dir, f), 'utf-8');
  const parsed = matter(raw);
  const session = parsed.data.session ?? f.replace('.md', '');
  const data = parsed.data;
  results.push({
   session,
   started: data.started ?? '',
   turnCount: typeof data.turnCount === 'number' ? data.turnCount : 0,
   chars: typeof data.chars === 'number' ? data.chars : 0,
  });
 }
 return results;
}

/** Body text of one session's transcript, without frontmatter. */
function readTranscript(root: string, session: string): string {
 const file = join(root, 'transcripts', `${session}.md`);
 if (!existsSync(file)) return '';
 return matter(readFileSync(file, 'utf-8')).content;
}

/** The `started` stamp of a session transcript frontmatter, the review date shown on a pending harvest. */
function sessionStartedAt(root: string, sessionId: string): string {
 const file = join(root, 'transcripts', `${sessionId}.md`);
 if (!existsSync(file)) return new Date().toISOString();
 const started = matter(readFileSync(file, 'utf-8')).data.started;
 return typeof started === 'string' ? started : new Date().toISOString();
}

/**
 * One snippet version's prose, by path. Older versions stay on disk (Q-5).
 *
 * `rebuildIndex()` reads only the newest `v<N>.md` per snippet and returns
 * one Snippet per id, so it cannot answer a pin to an old version — and the
 * pinned-version invariant is the highest-value line in the slice (Q-5,
 * Q-39). This reads the file the pin names, by a path it already knows.
 * `.trimEnd()` matches what `rebuildIndex` does, so a pin at the current
 * version resolves byte-identically through either path.
 */
function readVersion(root: string, snippetId: string, version: number): string | null {
 try {
  return matter.read(join(root, 'snippets', snippetId, `v${version}.md`)).content.trimEnd();
 } catch { return null; }
}
// ── Marks for the review surface (T9) ──

/**
 * One region of a source body that preparation dropped, and why — the
 * reader sees *why* a paragraph carries no cuts. `at`/`length` are offsets
 * into the source body, so the surface can mark the words in place.
 */
type DroppedRegion = { at: number; length: number; why: 'quoted' | 'cited' | 'not-prose' };

/** A line preparation deletes outright, in `clean`'s own terms (body.ts). */
const IMAGE_LINE = /^!\[/;
const LINK_ONLY_LINE = /^\[.*\]\(.*\)$/;
const BARE_URL_LINE = /^https?:\/\//;
const RAW_HTML_LINE = /^<.*>$/;
const SHORTCODE = /\{\{[<%][\s\S]*?[>%]\}\}/;

/** The two citation shapes `dropCitedParagraphs` drops on (body.ts). */
const INLINE_CITE = /\[\([A-Z][^)]*\d{4}\)\]\(#/;
const PAREN_CITE = /\(\s*[A-Z][a-z]+\s+(and|&)?\s*[A-Za-z]*\s*\d{4}\s*\)/;

/** Classify one run of dropped lines: quoted beats cited beats not-prose. */
function classifyRun(body: string, runStart: number, runEnd: number): DroppedRegion {
 const trimmed = body.slice(runStart, runEnd).split('\n').map((l) => l.trim());
 const any = (re: RegExp): boolean => trimmed.some((t) => re.test(t));
 const why: DroppedRegion['why'] = trimmed.every((t) => t.startsWith('>'))
  ? 'quoted'
  : any(IMAGE_LINE) || any(LINK_ONLY_LINE) || any(BARE_URL_LINE) || any(RAW_HTML_LINE) || any(SHORTCODE)
   ? 'not-prose'
   : any(SHORTCODE) || any(INLINE_CITE) || any(PAREN_CITE)
    ? 'cited'
    : 'not-prose';
 return { at: runStart, length: runEnd - runStart, why };
}

/**
 * The regions of a source body that preparation dropped. A line survives
 * iff its trailing-whitespace-stripped text is empty (blank lines are
 * separators, never marks) or appears in the prepared prose; consecutive
 * non-surviving lines form one mark.
 */
function droppedRegions(body: string, prepared: string): DroppedRegion[] {
 const preparedLines = new Set(prepared.split('\n').map((l) => l.trimEnd()));
 const survives = (line: string): boolean => {
  const t = line.trimEnd();
  return t === '' || preparedLines.has(t);
 };
 const marks: DroppedRegion[] = [];
 let runStart = -1;
 let runEnd = 0;
 let at = 0;
 for (const line of body.split('\n')) {
  if (survives(line)) {
   if (runStart !== -1) marks.push(classifyRun(body, runStart, runEnd));
   runStart = -1;
  } else if (runStart === -1) {
   runStart = at;
   runEnd = at + line.length;
  } else {
   runEnd = at + line.length;
  }
  at += line.length + 1;
 }
 if (runStart !== -1) marks.push(classifyRun(body, runStart, runEnd));
 return marks;
}

// ── Create app ──

export async function createApp(deps: ServerDeps): Promise<Hono> {
 // The index every handler reads. It starts as the one handed in, so a fresh
 // process answers from what the vault already holds, and it is replaced only
 // by a completed DocketReport — the report stays the single index source.
 let currentIndex = deps.index;
 // The semantic channel the turn endpoint searches beside the lexical one.
 // Absent is the cold state: resonateHybrid degrades to the trigram index.
 const semanticIndex = deps.semanticIndex;
 const snippetMap = new Map(Object.values(deps.vault.rebuildIndex().snippets).map((s) => [s.id, s]));

 // Everything with nobody waiting on it goes to the clerk model (Q-48). One
 // Complete serving both roles is the degenerate case, not a fallback:
 // nothing here ever swaps models at runtime, because the stamp would lie.
 const clerkComplete = deps.clerk?.complete ?? deps.complete;
 const clerkModelName = deps.clerk?.modelName ?? deps.modelName;
 // Harvest cuts ride the grammar-constrained variant when the deps carry one
 // (ticket 078); everything else the clerk does stays unconstrained.
 const harvestComplete = deps.clerk?.harvestComplete ?? clerkComplete;

// The staging store the docket's extraction job reads: unreviewed files
// live here until the run before the person sits down (T6).
const importStore = createImportStore(deps.vaultRoot);

// The PieceStore the piece routes write through (T6) — one binding shared
// with T10's docket thunks. Every write passes the five guards.
const pieces = createPieceStore(deps.vaultRoot);

 // ── The Clerk's wiki work, constructed once (Q-22) ──
 //
 // The log sink below is the point of this block. Until it existed, every
 // `shadow-decision`, `threshold-clipped`, `clash-referent-clipped` and
 // `clash-embedding-clipped` was written into whatever a caller passed, and
 // in production there was no caller — so Q-35, which graduates a mechanism
 // on its shadow record, and Q-56, which makes a bound owe its clip record,
 // were both waiting on evidence that reached nowhere. It is the SAME
 // `appendEvent` the docket writes through, because Q-23 makes one audit
 // trail and a second one would be a second answer to "what did it do".
 const wikiLog: LogFn = (e) => appendEvent(deps.vaultRoot, e as ActivityEvent);

 // The Q-34 stamp for everything the wiki work writes. `bonsai-27b` is the
 // ELICITOR (Q-48); this is the careful model, and the registry and the
 // claims must carry one and the same name or the record cannot be read.
 const wikiModel = clerkModelName ?? DEFAULT_CLERK_MODEL;
 const claimStore = createClaimStore(deps.vaultRoot);
 // The still-true rotation cursor (ticket 075), disk-backed so rotation
 // survives restarts. The docket keeps an in-memory default for standalone
 // callers; production goes through the wiki dir like every other ledger.
 const stillTrueCursor = {
  read: () => readStillTrueCursor(deps.vaultRoot),
  write: (offset: number) => writeStillTrueCursor(deps.vaultRoot, offset),
 };
 const registry = createRegistry(claimStore, wikiModel, wikiLog);

 const embedding: EmbeddingChannel | null = deps.embed
  ? embeddingChannel({
   embed: deps.embed.embed,
   model: deps.embed.model,
   store: fileEmbeddingStore(deps.vaultRoot),
   log: wikiLog,
  })
  : null;
 const channels: ClashChannel[] = [lexicalChannel, referentChannel(registry, { log: wikiLog })];
 if (embedding) channels.push(embedding);

 /**
  * The lint findings of the LAST completed wiki run, and when it ran.
  *
  * `GET /api/wiki` reports these rather than calling `lint` itself, and the
  * reason is `shadowDecision`: two of lint's three rules are shadowed (Q-35),
  * so every call writes `shadow-decision` events. Linting on a read path would
  * therefore fill the graduation record with one entry per page view — the
  * same corruption as building a second Registry over one vault, arriving
  * through a different door. Freshness costs nothing here: claims change only
  * during a wiki run, so between runs these findings and the claims on disk
  * are exactly as consistent as they were when the run ended.
  *
  * `null` until the first run completes, and the route says so. "Looked and
  * found nothing" must not render as "never looked" (eval finding #8).
  */
 let lastLint: { findings: LintFinding[]; at: string } | null = null;

 /** One wiki run, with its collaborators already bound. Never on a response path. */
 async function runWikiJobsNow(): Promise<DocketReport['wiki']> {
  // `prime` is the async half `ClashChannel` cannot express, and it MUST run
  // before the pool: `candidates()` is cache-only, so an unprimed channel
  // answers from whatever is on disk and returns a correct-looking zero. The
  // failure is silent, which is why the call is here rather than left to a
  // reader of the deps object to remember.
  if (embedding) {
   const contents = deps.vault.rebuildIndex();
   const graph: ClaimGraph = {
    ...claimStore.loadSlice(),
    snippets: contents.snippets,
    readings: contents.readings,
   };
   await embedding.prime(graph);
  }

  const report = await runWikiJobs({
   store: claimStore,
   registry,
   queue: deps.queue,
   vault: deps.vault,
   complete: clerkComplete,
   channels,
   proposeOps,
   applyOps,
   lint,
   poolCandidates,
   judgeOpposition,
   composeRemeasure,
   judgeConfirmation,
   composeStillTrue,
   log: wikiLog,
   model: wikiModel,
   vaultRoot: deps.vaultRoot,
  });
  lastLint = { findings: report.lint, at: new Date().toISOString() };
  return report;
 }

/** One import extraction run — the real harvest path, ahead of review (Q-58). */
async function runImportJobsNow(): Promise<{ extracted: number; remaining: number; failed: number }> {
 return runImportExtraction({
  store: importStore,
  // Extraction IS the harvest path, so it rides the grammar-constrained
  // clerk variant the harvest does (ticket 078).
  complete: harvestComplete,
  readSource: (p) => readFileSync(p, 'utf-8'),
  log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
 });
}

// ── The docket, off the response path (ticket 047) ──
 // Opener minting is one LLM call per uncited snippet, so a docket run grows
 // with the vault. No request waits for one: handlers write to the vault,
 // answer, and the index catches up when the run finishes.

 /** True while a run is in flight. Two runs never overlap. */
 let docketRunning = false;
 /** A trigger that arrived mid-run, replayed once the run finishes. */
 let pendingTrigger: string | null = null;

 async function runDocketNow(trigger: string): Promise<void> {
  // The import job's counts, seen in the finally for the re-trigger. Hoisted
  // because the finally runs whether the run succeeded or failed.
  let importReport: { extracted: number; remaining: number; failed: number } | undefined;
  try {
   const report = await runDocket({
    vault: deps.vault,
    queue: deps.queue,
    complete: clerkComplete,
    buildIndex: (snippets) => buildIndex(snippets),
    composeOpener,
    composeStillTrue,
    composeExpedition,
    listSessions,
    nextConsolidation,
    saveSummary,
    loadSummaries,
    readTranscript,
    // Cover summaries are written by the clerk model, so they say so (Q-34).
    ...(clerkModelName ? { modelName: clerkModelName } : {}),
    log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
    runWikiJobs: runWikiJobsNow,
    runImportJobs: runImportJobsNow,
    stillTrueCursor,
    vaultRoot: deps.vaultRoot,
   });
   currentIndex = report.index;
   for (const s of Object.values(deps.vault.rebuildIndex().snippets)) {
    snippetMap.set(s.id, s);
   }
   if (report.imports) {
    importReport = report.imports;
    serverEmit(deps.vaultRoot, 'clerk', 'import-run', 'extracted=' + report.imports.extracted + ' remaining=' + report.imports.remaining + ' failed=' + report.imports.failed);
   }
   serverEmit(deps.vaultRoot, 'clerk', 'docket-run', `minted ${report.minted.length}, expired ${report.expired}`);

   // Ticket 075 — the drain bookkeeping. The clip record says "left for the
   // next run"; this is the machinery that makes the next run happen. The
   // deferral is a claimable record on disk (the Codex precedent), and the
   // chain is bounded by the backlog emptying. A FAILED run (the catch below)
   // appends no deferral line and schedules no drain — the ledger
   // distinguishes "found nothing" from "mechanism broken". This whole block
   // is wrapped in its own try/catch so it can never turn a successful run
   // into a failure.
   try {
    const previous = readSweepDeferral(deps.vaultRoot); // read BEFORE appending
    const { pending, fresh, clipped } = sweepWorkRemaining();
    if (pending > 0) {
     // The claimable deferral: this much sweep work is left after the run.
     appendSweepDeferral(deps.vaultRoot, pending);
     // The fresh > 0 gate stops the chain when every remaining reading is at
     // backoff (Q-29); the previousLive gate is what lets a boot run resume a
     // chain that a restart interrupted.
     if (fresh > 0 && (clipped || (previous?.remaining ?? 0) > 0)) {
      scheduleDrain();
     }
    } else if ((previous?.remaining ?? 0) > 0) {
     // Terminal claim — succeeded-no-output: the drain found nothing left, so
     // record the empty claim and stop. Distinct from a failed run, which
     // writes no line at all.
     appendSweepDeferral(deps.vaultRoot, 0);
    }
   } catch (err) {
    console.error('docket drain bookkeeping failed:', String(err));
   }
  } catch (err) {
   // Every write the run was meant to follow is already on disk. Only the
   // index is behind, so keep the one that was standing and say why.
   console.error(`docket (${trigger}) failed — held index unchanged:`, String(err));
   serverEmit(deps.vaultRoot, 'clerk', 'docket-run-failed', `trigger=${trigger} ${String(err)}`);
  } finally {
   docketRunning = false;
   const next = pendingTrigger;
   pendingTrigger = null;
   if (next) startDocket(next);
   // Q-56 loop guard: a run that extracted nothing must not re-trigger
   // forever — if the items keep failing, re-running burns the GPU on work
   // that will keep failing, so both conditions must hold. If the
   // pendingTrigger replay above already re-armed docketRunning, this call
   // defers via pendingTrigger — the later trigger wins, which is the
   // correct shape for a queue that keeps growing.
   if (importReport && importReport.remaining > 0 && importReport.extracted > 0) {
    startDocket('import');
   }
   deps.onDocketSettled?.();
  }
 }

 /** Start a docket run behind whatever called this. Never throws, never waits. */
 function startDocket(trigger: string): void {
  if (docketRunning) {
   // A second trigger starts nothing — runDocket's own lock would make it a
   // no-op anyway, and that no-op returns an empty index. Remember it
   // instead, so snippets harvested mid-run still reach the index.
   pendingTrigger = trigger;
   console.error(`docket (${trigger}) deferred — a run is already in flight`);
   return;
  }
  docketRunning = true;
  // Next tick, not this one: runDocket reads every snippet file in the vault
  // before its first await, and the response (or the listen call) goes first.
  // The catch is the backstop: nothing here is awaited, so a throw that got
  // past runDocketNow would surface as an unhandled rejection.
  setImmediate(() => {
   runDocketNow(trigger).catch((err: unknown) => {
    console.error(`docket (${trigger}) could not report its own failure:`, String(err));
   });
  });
 }

 // ── The sweep drain (ticket 075) ──
 //
 // `left for the next run` promised a run nothing scheduled. When a settle
 // leaves sweep work, the deferral records it (a claimable record on disk, the
 // Codex precedent) and this timer starts the next run itself — startDocket's
 // single-flight and pendingTrigger already serialize it. The chain is bounded
 // by the backlog emptying, never by a count.
 let drainTimer: ReturnType<typeof setTimeout> | null = null;

 /** The self-triggered drain's delay; tests shorten it via env. */
 function drainDelayMs(): number {
  const raw = Number(process.env.ELICIT_DOCKET_DRAIN_DELAY_MS ?? 2000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2000;
 }

 function scheduleDrain(): void {
  if (drainTimer !== null) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
   drainTimer = null;
   startDocket('drain');
  }, drainDelayMs());
 }

 /**
  * The sweep backlog as a settle left it, counted exactly as jobSweep counts
  * it (src/clerk/wiki-jobs.ts): pending readings are the ones no sweep line
  * covered, fresh are those still below the attempts backoff, and clipped is
  * whether one more run's quota could not take them all.
  */
 function sweepWorkRemaining(): { pending: number; fresh: number; clipped: boolean } {
  const backoff = typeof THRESHOLDS['sweep.attemptsBeforeBackoff'].value === 'number'
   ? THRESHOLDS['sweep.attemptsBeforeBackoff'].value
   : 0;
  const quota = typeof THRESHOLDS['mint.callsPerRun'].value === 'number'
   ? THRESHOLDS['mint.callsPerRun'].value
   : 0;
  const swept = claimStore.sweptReadingIds();
  const attempts = claimStore.attemptCounts();
  const pending = Object.values(deps.vault.rebuildIndex().readings).filter((r) => !swept.has(r.id));
  const fresh = pending.filter((r) => (attempts.get(r.id) ?? 0) < backoff);
  const ordered = fresh.length + (pending.length - fresh.length);
  return {
   pending: pending.length,
   fresh: fresh.length,
   clipped: ordered > quota,
  };
 }

 const app = new Hono();
 const sessions = new Map<string, SessionState>();
 const sessionProposals = new Map<string, CutProposal[]>();
 /** Sessions whose material arrived unprompted — kept snippets carry that origin. */
 const unpromptedSessions = new Set<string>();
 /**
  * The capture channel for each unprompted session — no SessionState exists
  * for those, so the channel rides here until harvest reads it (ticket 048).
  */
 const unpromptedChannels = new Map<string, CaptureChannel | undefined>();
 const { authStore } = deps;

 // ── Setup-required gate for non-API routes (must precede static serving) ──
 app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next();
  if (!authStore.exists()) {
   const remoteAddr = getRemoteAddr(c.env);
   if (!isLoopback(remoteAddr)) {
    return c.html(
     '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Elicit — setup required</title><style>body{font-family:system-ui,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1rem;color:#333;line-height:1.6}h1{font-weight:400;font-size:1.25rem}p{color:#666}</style></head><body><h1>finish setup from the host machine</h1><p>Open a browser on the computer running Elicit to set a password. LAN access is blocked until the gate is configured.</p></body></html>',
    );
   }
  }
  return next();
 });

 // ── Public API routes (no auth required) ──

 // GET /api/auth/status → {needsSetup}
 app.get('/api/auth/status', (c) => {
  return c.json({ needsSetup: !authStore.exists() });
 });

 // GET /api/stt/status → {available}
 app.get('/api/stt/status', (_c) => {
  try {
   resolveModelDir();
   return _c.json({ available: true });
  } catch {
   return _c.json({ available: false });
  }
 });

 // POST /api/setup {password} — loopback-only, creates auth file + issues session
 app.post('/api/setup', async (c) => {
  const remoteAddr = getRemoteAddr(c.env);
  if (!isLoopback(remoteAddr)) {
   return c.json({ error: 'setup must be done from the host machine' }, 403);
  }
  const body = await c.req.json<{ password: string }>();
  if (!body.password || typeof body.password !== 'string' || body.password.length < 1) {
   return c.json({ error: 'password required' }, 400);
  }
  authStore.setup(body.password);
  const token = newSessionToken();
  loginSessions.set(token, Date.now() + SESSION_TTL);
  const cookie = `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`;
  return new Response(JSON.stringify({ ok: true }), {
   status: 200,
   headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': cookie,
   },
  });
 });

 // POST /api/login {password} → {ok: true} + session cookie
 app.post('/api/login', async (c) => {
  const body = await c.req.json<{ password: string }>();
  if (!body.password) {
   return c.json({ error: 'password required' }, 400);
  }
  if (!authStore.verify(body.password)) {
   return c.json({ error: 'invalid password' }, 401);
  }
  const token = newSessionToken();
  loginSessions.set(token, Date.now() + SESSION_TTL);
  const cookie = `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`;
  return new Response(JSON.stringify({ ok: true }), {
   status: 200,
   headers: {
    'Content-Type': 'application/json',
    'Set-Cookie': cookie,
   },
  });
 });

 // ── Auth middleware for remaining API routes ──
 app.use('/api/*', async (c, next) => {
  if (!authStore.exists()) {
   // No auth file — check loopback
   const remoteAddr = getRemoteAddr(c.env);
   if (isLoopback(remoteAddr)) return next();
   return c.json({ error: 'setup required' }, 403);
  }
  // Auth file exists — require session
  if (!checkSession(c)) {
   return new Response('Unauthorized', { status: 401 });
  }
  return next();
 });

 // GET /api/target-suggestion → {target, recent, declaredRequired}
 // What the Mode screen should pre-fill when the user has not chosen. The
 // Target still has to be declared (Q-19); this only stops the pre-fill from
 // pointing inward every time.
 app.get('/api/target-suggestion', (c) => {
  const { target, recent } = suggestTargetForVault(deps.vaultRoot);
  return c.json({ target, recent, declaredRequired: true });
 });

 // POST /api/session {mode, shuffle?} → {sessionId, question, target, source?}
 app.post('/api/session', async (c) => {
  const body = await c.req.json<{ mode: Mode; shuffle?: boolean }>();
  const mode = body.mode;
  if (!mode || typeof mode.minutes !== 'number' || !mode.energy) {
   return c.json({ error: 'invalid mode' }, 400);
  }
  // Absent target: fall back to what the corpus asks for, not inward by
  // reflex (Q-19, ticket 042). An explicit target always wins.
  const suggestion = suggestTargetForVault(deps.vaultRoot);
  const target: Target = mode.target ?? suggestion.target;
  const normalized: Mode = { ...mode, target };

  // Protocol selection: load defs, count prior sessions, rotate deterministically
  const protocolDefs = loadProtocolDefinitions();
  const sessionCount = listSessions(deps.vaultRoot).length;
  const selectedProtocol = selectProtocolForTarget(target, sessionCount, protocolDefs);

  // The Randomizer (Q-18). Wrapped so the response can say what was dealt:
  // `startSession` returns a SessionState, and no SessionState carries the
  // provenance of a draw — the transcript keeps the question, this keeps
  // the source. NOTE: no apostrophes in comments here. `tests/emitted-kinds`
  // scans this file for `serverEmit` calls with a string tracker that does
  // not skip comments, so an odd number of them hides every kind below.
  const shuffle = createRandomizer({
   root: deps.vaultRoot,
   vault: deps.vault,
   queue: deps.queue,
  });
  const dealt: { draw: RandomizerDraw | null } = { draw: null };
  const randomizer = (invokedBy: 'user' | 'system'): RandomizerDraw | null => {
   dealt.draw = shuffle(invokedBy);
   return dealt.draw;
  };

  const state = startSession(normalized, {
   complete: deps.complete,
   vault: deps.vault,
   queue: deps.queue,
   index: currentIndex,
   ...(semanticIndex ? { semantic: semanticIndex } : {}),
   protocolName: selectedProtocol.name,
   randomizer,
   vaultRoot: deps.vaultRoot,
   ...(body.shuffle ? { shuffleRequested: true } : {}),
  });
  sessions.set(state.id, state);
  const opener = state.turns[0]!;

  serverEmit(deps.vaultRoot, 'elicitor', 'session-started', `mode=${normalized.minutes}m/${normalized.energy} target=${target} declared=${mode.target !== undefined} protocol=${selectedProtocol.name} shuffle=${body.shuffle === true}`);

  // Usage stamps (015): what this opening actually served to the person.
  // A resurfacing draw puts the snippet itself on the table; a queue draw
  // puts the snippets its question quotes on the table. Deck draws surface
  // a curated card, not a claim or snippet, so they keep the draw record
  // and do not stamp.
  stampComposedServed(deps.vaultRoot, deps.queue, state.openQueueEntryId);

  const draw = dealt.draw;

  if (draw && draw.draw.kind === 'resurfacing' && draw.question === opener.text) {
   surfaced(deps.vaultRoot, [draw.draw.snippetId], 'draw');
  }
  return c.json({
   sessionId: state.id,
   question: opener.text,
   target,
   ...(draw && draw.question === opener.text
    ? {
     source: draw.provenance,
     // Display-only lineage (080): never quoted into the question, never
     // in the transcript — the frontend dims it above the resurfaced prose.
     ...(draw.snippetQuestion ? { snippetQuestion: draw.snippetQuestion } : {}),
     ...(draw.context ? { context: draw.context } : {}),
    }
    : {}),
  });
 });

 // POST /api/session/:id/turn {text} → probe | saturated
 app.post('/api/session/:id/turn', async (c) => {
  const sessionId = c.req.param('id');
  const state = sessions.get(sessionId);
  if (!state) return c.json({ error: 'session not found' }, 404);

  const body = await c.req.json<{ text: string; spoken?: boolean; channel?: CaptureChannel }>();
  if (!body.text || typeof body.text !== 'string') {
   return c.json({ error: 'text is required' }, 400);
  }
  if (body.channel !== undefined && !isCaptureChannel(body.channel)) {
   return c.json({ error: `invalid channel "${String(body.channel)}"` }, 400);
  }

  // Detect resonance for juxtaposition info (before userTurn consumes the hit)
  const hits = await resonateHybrid(currentIndex, semanticIndex, body.text);

  // Ticket 036 item 2. The count is emitted on EVERY turn, zero included:
  // until now the index was searched on each turn and said nothing when it
  // found nothing, so "looked and found no echo" and "never looked" reached
  // the Activity Log identically, which is the one thing Q-23 cannot afford.
  // The actor is the elicitor, not the clerk — this is a live-session act.
  // Never the text, only how many (Q-22).
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'resonance-checked',
   `session=${sessionId} hits=${hits.length}`,
  );

  let juxtaposition: { snippetText: string; snippetDate: string } | undefined;
  if (hits.length > 0) {
   const hit = hits[0]!;
   const snip = snippetMap.get(hit.snippetId);
   if (snip) {
    juxtaposition = {
     snippetText: snip.prose,
     snippetDate: snip.captured.slice(0, 10),
    };
   }
  }

  const result = await userTurn(state, body.text, body.spoken);

  // Record the capture channel for this turn ordinal, unconditionally —
  // an absent channel pushes undefined so the ordinals never shift (ticket 048).
  state.turnChannels = [...(state.turnChannels ?? []), body.channel];

  // Activity event for close phase entry
  if (state.phase === 'closing-door') {
   serverEmit(deps.vaultRoot, 'elicitor', 'close-phase-entered', `session=${sessionId}`);
  }

  if (result.kind === 'saturated') {
   return c.json({ kind: 'saturated' });
  }

  // Activity: question-asked or juxtaposition-offered
  if (juxtaposition) {
   serverEmit(deps.vaultRoot, 'elicitor', 'juxtaposition-offered', `session=${sessionId} snippet=${hits[0]!.snippetId} source=juxtaposition`);
  } else {
   serverEmit(deps.vaultRoot, 'elicitor', 'question-asked', `session=${sessionId} source=${result.provenance}`);
  }

  // The just-served probe, when it was a queue draw (015). At the top of
  // userTurn the previous entry is answered and cleared, so a set id here
  // names the question this turn actually served.
  stampComposedServed(deps.vaultRoot, deps.queue, state.openQueueEntryId);

  return c.json({
   kind: 'probe',
   text: result.text,
   questionForm: result.questionForm,
   phase: state.phase,
   ...(juxtaposition ? { juxtaposition } : {}),
  });
 });

 // POST /api/session/:id/skip → question | exhausted
 app.post('/api/session/:id/skip', (c) => {
  const sessionId = c.req.param('id');
  const state = sessions.get(sessionId);
  if (!state) return c.json({ error: 'session not found' }, 404);

  const result = skipQuestion(state);
  return c.json(result);
 });

 // POST /api/session/:id/defer {need?} → question | exhausted
 // The question returns to the Queue with the declared Mode needs. Distinct
 // from skip in the log; like skip, it does not consume budget.
 app.post('/api/session/:id/defer', async (c) => {
  const sessionId = c.req.param('id');
  const state = sessions.get(sessionId);
  if (!state) return c.json({ error: 'session not found' }, 404);

  let need: unknown;
  try {
   need = (await c.req.json<{ need?: unknown }>()).need;
  } catch {
   // No body — deferred with no declared need
  }
  if (need !== undefined && need !== 'time' && need !== 'energy') {
   return c.json({ error: `invalid need "${String(need)}" — expected "time" or "energy"` }, 400);
  }

  const deferred = [...state.turns].reverse().find((t) => t.role === 'agent');
  if (!deferred) return c.json({ error: 'no question to defer' }, 400);

  const modeNeeds: QueueEntry['modeNeeds'] | undefined =
   need === 'time'
    ? { minMinutes: moreMinutesThan(state.mode.minutes) }
    : need === 'energy'
     ? { energy: moreEnergyThan(state.mode.energy) }
     : undefined;

  deps.queue.add({
   source: 'user-declared',
   license: 'user',
   question: deferred.text,
   questionForm: deferred.questionForm ?? 'deliberative',
   sharpness: 'weak',
   horizon: 'session',
   ...(modeNeeds ? { modeNeeds } : {}),
  });

  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'question-deferred',
   `session=${sessionId} needs=${need ?? 'none'}`,
  );

  const result = skipQuestion(state);
  return c.json(result);
 });

 /**
  * Fire-and-return harvest (ticket 084): /end and /unprompted answer
  * immediately, propose runs behind the response. A finished run writes its
  * record to the pending queue, restart-proof and claimable by /harvest; a
  * failed run logs as failed and writes nothing, so the transcript stays the
  * recovery path. The queue is offer-only — deciding happens through /harvest.
  */
 function startBackgroundHarvest(args: {
  sessionId: string;
  turns: Turn[];
  protocol: string;
  started: string;
  origin: 'harvest' | 'unprompted';
  turnChannels?: (CaptureChannel | undefined)[];
  unpromptedChannel?: CaptureChannel;
 }): void {
  serverEmit(deps.vaultRoot, 'harvester', 'harvest-started', `session=${args.sessionId} chunks=${args.turns.length}`);
  setImmediate(() => {
   propose(args.sessionId, args.turns, harvestComplete)
    .then((result) => {
     if (result.diagnostics.parseMode === 'failed') {
      serverEmit(deps.vaultRoot, 'harvester', 'harvest-failed', harvestDetail(result));
      return;
     }
     writePendingHarvest(deps.vaultRoot, {
      sessionId: args.sessionId,
      at: new Date().toISOString(),
      started: args.started,
      protocol: args.protocol,
      origin: args.origin,
      proposals: result.proposals,
      ...(args.turnChannels !== undefined ? { turnChannels: args.turnChannels } : {}),
      ...(args.unpromptedChannel !== undefined ? { unpromptedChannel: args.unpromptedChannel } : {}),
     });
     sessionProposals.set(args.sessionId, result.proposals);
     serverEmit(deps.vaultRoot, 'harvester', 'harvest-proposed', harvestDetail(result));
    })
    .catch((err: unknown) => {
     console.error(`harvest (${args.sessionId}) failed:`, String(err));
     serverEmit(deps.vaultRoot, 'harvester', 'harvest-failed', `session=${args.sessionId}`);
    });
  });
 }

 // POST /api/session/:id/end → harvesting (ticket 084)
 // The harvest runs behind this response; the finished proposals land in the
 // pending queue for the review surface.
 app.post('/api/session/:id/end', (c) => {
  const sessionId = c.req.param('id');
  const state = sessions.get(sessionId);
  if (!state) return c.json({ error: 'session not found' }, 404);

  // Snapshot the capture channels by value (ticket 048): the sitting may be
  // gone by the time the background run writes its record.
  const turnChannels = state.turnChannels ? [...state.turnChannels] : undefined;
  startBackgroundHarvest({
   sessionId,
   turns: state.turns,
   protocol: state.protocol,
   started: sessionStartedAt(deps.vaultRoot, sessionId),
   origin: 'harvest',
   ...(turnChannels !== undefined ? { turnChannels } : {}),
  });
  return c.json({ status: 'harvesting', sessionId });
 });

 // POST /api/session/:id/harvest {decisions} → {snippets, buds}
 app.post('/api/session/:id/harvest', async (c) => {
  const sessionId = c.req.param('id');
  // The pending record is the primary source (ticket 084); the in-memory map
  // is the migration fallback for a harvest proposed before this build.
  const record = readPendingHarvest(deps.vaultRoot, sessionId);
  const proposals = record?.proposals ?? sessionProposals.get(sessionId);
  if (!proposals) {
   return c.json(
    { error: 'no proposals — call /end first' },
    400,
   );
  }

  const body = await c.req.json<{ decisions: HarvestDecision[] }>();
  if (!Array.isArray(body.decisions)) {
   return c.json({ error: 'decisions must be an array' }, 400);
  }

  // Validate decisions (ticket 024)
  const VALID_ACTIONS = ['approve', 'trim', 'restate', 'discard'] as const;
  for (const d of body.decisions) {
   if (!(VALID_ACTIONS as readonly string[]).includes(d.action)) {
    return c.json(
     { error: `invalid action "${String(d.action)}" in decision`, entry: d },
     400,
    );
   }
   if (typeof d.proposal !== 'number' || d.proposal < 0 || d.proposal >= proposals.length) {
    return c.json(
     { error: `invalid proposal index ${d.proposal} (have ${proposals.length} proposals)`, entry: d },
     400,
    );
   }
   if (d.channel !== undefined && !isCaptureChannel(d.channel)) {
    return c.json(
     { error: `invalid channel "${String(d.channel)}" in decision`, entry: d },
     400,
    );
   }
  }

  const state = sessions.get(sessionId);
  const channelOf = record
   ? record.origin === 'unprompted'
    ? () => record.unpromptedChannel
    : record.turnChannels
     ? (p: CutProposal) => record.turnChannels?.[p.sourceTurn] ?? undefined
     : undefined
   : unpromptedSessions.has(sessionId)
    ? () => unpromptedChannels.get(sessionId)
    : state?.turnChannels
     ? (p: CutProposal) => state.turnChannels?.[p.sourceTurn]
     : undefined;
  const result = decide(
   sessionId,
   proposals,
   body.decisions,
   deps.vault,
   record ? record.origin : unpromptedSessions.has(sessionId) ? 'unprompted' : 'harvest',
   channelOf,
  );

  serverEmit(deps.vaultRoot, 'harvester', 'session-harvested', `kept=${result.snippets.length} budded=${result.buds.length}`, result.snippets.map((s) => s.id));

  // The snippets are on disk, so the answer is ready. The docket that
  // reindexes them and mints their openers runs behind this response.
  startDocket('harvest');

  // A decided harvest leaves the queue; the map entry goes with it so a
  // later decide cannot double-claim the same material.
  if (record) removePendingHarvest(deps.vaultRoot, sessionId);
  sessionProposals.delete(sessionId);

  return c.json({ snippets: result.snippets, buds: result.buds });
 });

 // GET /api/harvest-queue → {pending} (ticket 084)
 // The review surface: every finished harvest awaiting a decision, newest
 // first. Offer-only — deciding still happens through POST /harvest.
 app.get('/api/harvest-queue', (c) => {
  const pending = listPendingHarvests(deps.vaultRoot).map((r) => ({
   sessionId: r.sessionId,
   at: r.at,
   started: r.started,
   protocol: r.protocol,
   origin: r.origin,
   proposalCount: r.proposals.length,
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
  const record = readPendingHarvest(deps.vaultRoot, sessionId);
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json(record);
 });

 // POST /api/unprompted {text} → harvesting (ticket 084)
 // The user wrote or pasted material with no question asked. It becomes a
 // transcript of one user turn, then harvests behind this response; the
 // review cards for its cuts land in the pending queue.
 app.post('/api/unprompted', async (c) => {
  const body = await c.req.json<{ text: string; channel?: CaptureChannel }>();
  if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
   return c.json({ error: 'text is required' }, 400);
  }
  if (body.channel !== undefined && !isCaptureChannel(body.channel)) {
   return c.json({ error: `invalid channel "${String(body.channel)}"` }, 400);
  }
  const text = body.text.trim();

  const sessionId = ulid();
  const at = new Date().toISOString();
  const turn: Turn = { role: 'user', text, at };

  deps.vault.startTranscript(sessionId, {
   mode: { minutes: 0, energy: 'medium', target: 'self' },
   protocol: 'unprompted',
   started: at,
  });
  deps.vault.appendTurn(sessionId, turn);
  unpromptedSessions.add(sessionId);
  unpromptedChannels.set(sessionId, body.channel);

  // Never log the content — only how much of it there was.
  serverEmit(deps.vaultRoot, 'elicitor', 'unprompted-entry', `session=${sessionId} chars=${text.length}`);

  startBackgroundHarvest({
   sessionId,
   turns: [turn],
   protocol: 'unprompted',
   started: at,
   origin: 'unprompted',
   ...(body.channel !== undefined ? { unpromptedChannel: body.channel } : {}),
  });
  return c.json({ status: 'harvesting', sessionId });
 });

 // ── The four T9 routes: scan a folder, hand the next piece to read, take
 // decisions on it, or take the reason for refusing it whole. No fifth route
 // writes without a review behind it. The folder path is read from the
 // request and off local disk by design (Q-57), so the /api/* auth lock is
 // the control — there is no traversal check to write.

 // POST /api/import/scan {folder} → {pending, skipped, adopted, refused}
 // The folder becomes staging records, and nothing else: extraction runs in
 // the docket behind this response (T6) and the corpus is written only by a
 // review decision.
 app.post('/api/import/scan', async (c) => {
  const body = await c.req.json<{ folder?: string }>();
  const folder = typeof body.folder === 'string' ? body.folder.trim() : '';
  if (folder.length === 0) {
   return c.json({ error: 'folder is required' }, 400);
  }
  // Adoption FIRST, and with this folder: the path arrives here or nowhere
  // (T8), and adoption is idempotent so a re-scan can never skip it. A bad
  // folder path throws — answer 400 with what it said.
  let adopted: AdoptResult;
  let scanned: ScanResult;
  try {
   adopted = adoptPriorIngest({
    store: importStore,
    vaultRoot: deps.vaultRoot,
    folder,
    log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
   });
   scanned = scanFolder(folder);
  } catch (err) {
   return c.json({ error: String(err) }, 400);
  }
  const { added, skipped, refused } = importStore.admit(scanned.items);
  startDocket('import');
  // Two refusal sources, one list: scanFolder refuses on the file alone;
  // admit refuses on what the store knows (Q-59's no-lastmod). To the
  // reader they are one thing — a file that did not come in, and why.
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'import-scanned',
   'files=' + (scanned.items.length + scanned.refused.length) +
    ' toImport=' + added.length +
    ' refused=' + (scanned.refused.length + refused.length),
  );
  return c.json({
   pending: added.length,
   skipped: skipped.length,
   adopted: adopted.accepted + adopted.excluded,
   refused: [...scanned.refused, ...refused].map((r) => ({ file: basename(r.sourcePath), reason: r.reason })),
  });
 });

 // GET /api/import/next → the oldest extracted piece, whole, or `waiting`.
 // Registered for GET and POST: the web client's api() helper POSTs any path
 // outside its GET_PREFIXES list and the review surface calls through it.
 // Read-only under both methods — nothing here reads a body or writes.
 const importNext = async (c: Context): Promise<Response> => {
  const record = importStore.nextExtracted();
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
    remaining: Math.max(0, importStore.list('extracted').length - 1),
   },
  });
 };
 app.get('/api/import/next', importNext);
 app.post('/api/import/next', importNext);

 // POST /api/import/:hash/decisions {decisions} → {sessionId, snippets}
 // One decision per proposed cut, validated like the harvest route's
 // (ticket 024). Everything else is commitImport's gate: a stale or
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
  const VALID_ACTIONS = ['approve', 'trim', 'discard'] as const;
  const cuts = record.cuts ?? [];
  for (const d of body.decisions) {
   if (!(VALID_ACTIONS as readonly string[]).includes(d.action)) {
    return c.json(
     { error: `invalid action "${String(d.action)}" in decision`, entry: d },
     400,
    );
   }
   if (typeof d.cut !== 'number' || !Number.isInteger(d.cut) || d.cut < 0 || d.cut >= cuts.length) {
    return c.json(
     { error: `invalid cut index ${String(d.cut)} (have ${cuts.length} cuts)`, entry: d },
     400,
    );
   }
  }
  const result = commitImport(
   {
    vault: deps.vault,
    store: importStore,
    readSource: (p) => readFileSync(p, 'utf-8'),
    log: (e) => appendEvent(deps.vaultRoot, e as ActivityEvent),
   },
   hash,
   body.decisions,
  );
  if (result.ok) return c.json({ sessionId: result.sessionId, snippets: result.snippets });
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
  serverEmit(deps.vaultRoot, 'elicitor', 'import-excluded', 'path=' + record.sourcePath);
  return c.json({ ok: true });
 });

 // GET /api/queue → {pending, open}
 app.get('/api/queue', (c) => {
  const all = deps.queue.list();
  const pending = all.filter((e) => e.status === 'pending');
  const open = all.filter(
   (e) => e.status === 'pending' && (e.horizon === 'days' || e.horizon === 'session'),
  );
  return c.json({ pending, open });
 });

 // GET /api/cadence → the record, as a sentence (ticket 056)
 //
 // Zero outbound contact stays (Q-22); this is a line the person may read on
 // a surface they chose to open, never a signal that reaches out. The wording
 // lives server-side so it is testable — see `src/log/cadence.ts` for why
 // every phrase in it is the phrase it is (Q-24: dormancy is signal, not debt).
 app.get('/api/cadence', (c) => {
  const cadence = readCadence(deps.vaultRoot);
  return c.json({ cadence, sentence: cadenceSentence(cadence) });
 });

 // GET /api/activity[?since=ISO] → SSE stream or JSON snapshot
 app.get('/api/activity', (c) => {
  const since = c.req.query('since') ?? undefined;
  const events = readEvents(deps.vaultRoot, since);

  // Return JSON if client doesn't accept text/event-stream
  const accept = c.req.header('accept') ?? '';
  if (!accept.includes('text/event-stream')) {
   return c.json({ events });
  }

  // SSE stream
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
   start(controller) {
    // Send past events
    for (const ev of events) {
     if (closed) return;
     controller.enqueue(
      encoder.encode(`event: activity\ndata: ${JSON.stringify(ev)}\n\n`),
     );
    }
    // Send initial heartbeat
    controller.enqueue(encoder.encode(': heartbeat\n\n'));

    // Poll for new events every 2 seconds
    let lastAt = events.length > 0 ? events[events.length - 1]!.at : (since ?? new Date(0).toISOString());
    const interval = setInterval(() => {
     if (closed) {
      clearInterval(interval);
      return;
     }
     const newEvents = readEvents(deps.vaultRoot, lastAt);
     for (const ev of newEvents) {
      if (ev.at > lastAt) {
       controller.enqueue(
        encoder.encode(`event: activity\ndata: ${JSON.stringify(ev)}\n\n`),
       );
       lastAt = ev.at;
      }
     }
    }, 2000);

    // Clean up on close
    const cleanup = () => {
     closed = true;
     clearInterval(interval);
    };
    c.req.raw.signal.addEventListener('abort', cleanup);
   },
  });

  return new Response(stream, {
   headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
   },
  });
 });

 // GET /api/snippets
 app.get('/api/snippets', (c) => {
  const index = deps.vault.rebuildIndex();
  return c.json({ snippets: Object.values(index.snippets) });
 });

 // ── The wiki, as a page (Q-21, Q-23, Q-25) ──
 //
 // Both routes are READ routes. Nothing a client can send edits a claim; the
 // read-log write below records a reading, not an edit.
 //
 // The shaping happens HERE, not in the client. Two tickets stand behind that
 // rule: 038 closed because the activity stream leaked identifiers onto a
 // surface a person reads, and 063 found 26 event kinds arriving as two
 // context-free words. A route that hands over raw enums and trusts the
 // renderer is the same mistake with a network hop in the middle. So facets
 // arrive as headings, lint findings arrive as notes, and the claims arrive in
 // the order they are meant to be read.

 /** A claim in the default reading: not archived, not superseded (Q-29). */
 const isLive = (cl: Claim): boolean => cl.archived !== true && cl.supersededBy === undefined;

 // GET /api/wiki[?all=1] → the wiki grouped by facet and ordered for reading
 app.get('/api/wiki', (c) => {
  // Nothing is deleted — an archived or superseded claim is simply not the
  // default reading. `?all=1` is how a reader asks for the whole record.
  const all = c.req.query('all') === '1';
  const contents = deps.vault.rebuildIndex();
  const graph: ClaimGraph = {
   ...claimStore.loadSlice(),
   snippets: contents.snippets,
   readings: contents.readings,
  };

  // Coreness over the WHOLE graph, archived claims included, and computed
  // once per claim rather than once per comparison. Scoring the whole graph
  // is also what keeps the order a reader sees from moving when `?all=1`
  // widens the page: a claim's neighbourhood does not shrink because the page
  // stopped showing part of it. The number is computed on demand and stored
  // nowhere (Q-21) — this route is its one caller.
  const score = new Map(graph.claims.map((cl) => [cl.id, coreness(cl.id, graph)]));

  const byFacet = new Map<Facet, Claim[]>();
  for (const cl of graph.claims) {
   if (!all && !isLive(cl)) continue;
   const group = byFacet.get(cl.facet);
   if (group) group.push(cl);
   else byFacet.set(cl.facet, [cl]);
  }

  // `FACETS` order, so two readings of one vault are the same page. An empty
  // facet is omitted: a heading over nothing is chrome, and the document rule
  // has no room for it. Ties break on id, because `coreness` is a
  // neighbourhood measure and a whole component scores alike.
  const facets = FACETS.filter((f) => byFacet.has(f)).map((f) => ({
   facet: f,
   heading: facetHeading(f),
   claims: (byFacet.get(f) ?? []).sort(
    (a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1),
   ),
  }));

  // A dissolved Contradiction is not material any more, so it is not part of
  // the default reading either. It is still on disk, and `?all=1` shows it.
  const contradictions = graph.contradictions.filter((x) => all || x.status === 'open');

  // Lint arrives as a note and nothing else. `LintFinding.detail` names claim
  // ids and `snippetId@version` cites, and `kind` is a slug — the route drops
  // both rather than trusting a renderer not to print them (tickets 038, 063).
  const hidden = new Set(graph.claims.filter((cl) => !isLive(cl)).map((cl) => cl.id));
  const lintNotes = (lastLint?.findings ?? [])
   .filter((f) => all || !hidden.has(f.subject))
   .map((f) => ({ kind: f.kind, subject: f.subject, note: lintNote(f.kind) }));

  // Usage stamps (015): every claim this page serves is surfaced, with the
  // snippets its citations render. One line per claim; ?all=1 serves the
  // whole record and stamps it too. The /api/snippets pool is display
  // support, not display, and never stamps.
  for (const facet of facets) {
   for (const cl of facet.claims) {
    surfaced(deps.vaultRoot, [cl.id, ...cl.cites], 'wiki');
   }
  }

  return c.json({
   facets,
   contradictions,
   lint: lintNotes,
   // Null means the Clerk has not read the wiki yet in this process, which
   // is a different thing from having read it and found nothing.
   lintedAt: lastLint?.at ?? null,
   all,
  });
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
  if (!claimStore.readClaim(id)) return c.json({ error: 'claim not found' }, 404);

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

  claimStore.recordRead(id, new Date().toISOString(), surface);
  return c.json({ ok: true });
 });

 // POST /api/transcribe — raw Float32 PCM body, returns {text}
 app.post('/api/transcribe', async (c) => {
  const client = getSttClient(deps);
  if (!client) {
   return c.json({ error: 'STT model not available' }, 503);
  }

  const rateStr = c.req.query('rate') ?? '16000';
  const sampleRate = parseInt(rateStr, 10);
  if (isNaN(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
   return c.json({ error: 'invalid rate' }, 400);
  }

  const raw = await c.req.arrayBuffer();
  if (raw.byteLength < 4) {
   return c.json({ error: 'empty or too-short audio' }, 400);
  }

  const samples = new Float32Array(raw);
  const start = performance.now();
  const text = await client.transcribe(samples, sampleRate);
  const duration = Math.round(performance.now() - start);
  const chars = text.length;

 serverEmit(deps.vaultRoot, 'system', 'transcribed', `${duration}ms ${chars}chars`);

 return c.json({ text });
 });

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
  const piece = pieces.get(c.req.param('id'));
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  return c.json(enrichPiece(piece));
 });

 // POST /api/piece/:id/reorder — a permutation of the on-disk entry ids, or
 // 400: a reorder that adds or drops is not a reorder.
 app.post('/api/piece/:id/reorder', async (c) => {
  const pieceId = c.req.param('id');
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; entries: string[] }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
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
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; entry: string }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
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
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; text: string; after?: string }>();
  if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
   return c.json({ error: 'text is required' }, 400);
  }
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
  const at = insertionIndex(a.entries, body.after);
  if (at === -1) return c.json({ error: 'no such entry' }, 400);

  const text = body.text.trim();
  const sessionId = ulid();
  const atTime = new Date().toISOString();
  // A composition act is its own sitting (Q-50): its cites are independent
  // of the sittings that produced the paragraphs around it.
  deps.vault.startTranscript(sessionId, {
   mode: { minutes: 0, energy: 'medium', target: 'self' },
   protocol: 'composition',
   started: atTime,
  });
  deps.vault.appendTurn(sessionId, { role: 'user', text, at: atTime });
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
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; gap: string; after?: string; question?: string }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
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
   source: 'gap-declared',
   license: 'arrangement-gap',
   question,
   questionForm: 'deliberative',
   sharpness: 'weak',
   horizon: 'session',
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
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
  const body = await c.req.json<{ arrangement: string; gap: string; snippet: string; version: number }>();
  const a = piece.arrangements.find((x) => x.id === body.arrangement);
  if (!a) return c.json({ error: 'unknown arrangement' }, 400);
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
  if (!pieces.get(pieceId)) return c.json({ error: 'piece not found' }, 404);
  const updated = pieces.setDown(pieceId, 'user');
  serverEmit(deps.vaultRoot, 'clerk', 'piece-set-down', `piece=${pieceId}`);
  return c.json(enrichPiece(updated));
 });

 app.post('/api/piece/:id/pick-up', (c) => {
  const pieceId = c.req.param('id');
  if (!pieces.get(pieceId)) return c.json({ error: 'piece not found' }, 404);
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
  const piece = pieces.get(pieceId);
  if (!piece) return c.json({ error: 'piece not found' }, 404);
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

 // Static fallback: serve web/dist when it exists
 app.get('/*', (c) => {
  const distDir = join(process.cwd(), 'web', 'dist');
  if (!existsSync(distDir)) return c.notFound();

  let reqPath = c.req.path;
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = join(distDir, reqPath);

  // Directory traversal guard
  if (!filePath.startsWith(distDir)) return c.notFound();

  let stats;
  try {
   stats = statSync(filePath);
  } catch {
   return c.notFound();
  }
  if (!stats.isFile()) return c.notFound();

  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const content = readFileSync(filePath);

  return new Response(content, {
   status: 200,
   headers: { 'Content-Type': contentType },
  });
 });

 // Boot docket last: the app is wired, so requests that arrive while it runs
 // are served from the index we were handed instead of waiting for a new one.
 startDocket('boot');

 return app;
}

// ── Node.js HTTP adapter ──

async function readBody(
 nodeReq: IncomingMessage,
): Promise<Buffer | null> {
 if (nodeReq.method === 'GET' || nodeReq.method === 'HEAD') return null;
 const chunks: Buffer[] = [];
 for await (const chunk of nodeReq) {
  chunks.push(chunk);
 }
 return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

async function toWebRequest(
 nodeReq: IncomingMessage,
): Promise<Request> {
 const hostRaw = nodeReq.headers.host;
 const host = Array.isArray(hostRaw)
  ? (hostRaw[0] ?? 'localhost')
  : (hostRaw ?? 'localhost');
 const url = `http://${host}${nodeReq.url}`;

 const body = await readBody(nodeReq);

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

 return new Request(url, {
  method: nodeReq.method ?? 'GET',
  headers,
  body: body as BodyInit | null,
 });
}

function nodeAdapter(app: Hono) {
 return async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
  try {
   const webReq = await toWebRequest(nodeReq);
   const webRes = await app.fetch(webReq, { remoteAddr: nodeReq.socket?.remoteAddress });

   const resHeaders: Record<string, string> = {};
   webRes.headers.forEach((v, k) => {
    resHeaders[k] = v;
   });
   nodeRes.writeHead(webRes.status, resHeaders);

   if (!webRes.body) {
    nodeRes.end();
    return;
   }
   // Stream the body chunk-by-chunk — arrayBuffer() would drain an
   // endless body (e.g. SSE) to completion and never resolve.
   const reader = webRes.body.getReader();
   const pump = async () => {
    try {
     while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      nodeRes.write(Buffer.from(value));
     }
     nodeRes.end();
    } catch (err) {
     nodeRes.destroy(err as Error);
    }
   };
   void pump();
  } catch (err) {
   if (!nodeRes.headersSent) {
    nodeRes.writeHead(500);
   }
   nodeRes.end(String(err));
  }
 };
}

/** Start the app on the given host:port. Returns the node:http Server. */
export function serveApp(
 app: Hono,
 port: number,
 host?: string,
): Promise<Server> {
 const bindHost = host ?? process.env.ELICIT_HOST ?? '127.0.0.1';
 return new Promise<Server>((resolve) => {
  const server = createServer(nodeAdapter(app));
  server.listen(port, bindHost, () => resolve(server));
 });
}

// ── Standalone entry ──
// Activated only when this file is run directly (not imported).
// tsx sets process.argv[1] to the resolved .ts path.

const isDirect =
 typeof process.argv[1] === 'string' &&
 (process.argv[1].endsWith('/server.ts') ||
  process.argv[1].endsWith('/server.js') ||
  process.argv[1].endsWith('\\server.ts') ||
  process.argv[1].endsWith('\\server.js'));
if (isDirect) {
 const vaultRoot = process.env.ELICIT_VAULT_ROOT ?? './vault';
 const vault = createVault(vaultRoot);

 const llmMode = process.env.ELICIT_LLM ?? 'fake';
 let complete: Complete;
 let clerk: ServerDeps['clerk'];
 /**
  * The embedder for the third clash channel. Real endpoints only: under the
  * fake responder there is nothing to embed with, and a fabricated vector
  * would be cached, which makes it permanent.
  */
 let embed: ServerDeps['embed'];
 /** Elicitor stamp. Undefined under the fake responder — nothing real produced it. */
 let modelName: string | undefined;
 // Two lines the reader can check against the two endpoints (Q-48).
 let roleLines: string[];

 if (llmMode === 'local') {
  const { makeComplete, roleConfig, describeRole } = await import('./llm.js');
  const elicitorCfg = roleConfig('elicitor');
  const clerkCfg = roleConfig('clerk');
  complete = makeComplete('elicitor');
  clerk = {
   complete: makeComplete('clerk'),
   modelName: clerkCfg.modelId,
   harvestComplete: makeComplete('clerk', { responseFormat: CUTS_RESPONSE_FORMAT }),
  };
  modelName = elicitorCfg.modelId;
  embed = localEmbedder();
  roleLines = [describeRole(elicitorCfg), describeRole(clerkCfg)];
 } else {
  // One fake answers both roles. Nothing is stamped with a real model name.
  complete = makeFakeComplete();
  roleLines = ['elicitor: fake', 'clerk: fake'];
 }
 const queueRoot = process.env.ELICIT_QUEUE_DIR ?? vaultRoot;
 const queue = createQueueStore(queueRoot);
 const indexData = vault.rebuildIndex();
 const index = buildIndex(Object.values(indexData.snippets));
 // The semantic resonance channel (Q-17, ticket 068), beside the lexical
 // index: the same corpus, at the same moment. `prime` prunes the cache to
 // the ids it is given, so the corpus MUST be the whole vault — a subset
 // would delete every other snippet's vector on its first pass. Background,
 // like the boot docket: the first sitting is served by the lexical index
 // while the vectors fill, and a clipped run resumes next boot (PRIME_CAP).
 // Under the fake responder there is no embedder, so there is no channel:
 // a fabricated vector would be cached, which makes it permanent.
 const semanticIndex = embed
  ? buildSemanticIndex(Object.values(indexData.snippets), {
   embed: embed.embed,
   model: embed.model,
   store: fileSnippetVectorStore(vaultRoot),
   log: (e) => appendEvent(vaultRoot, e as ActivityEvent),
  })
  : undefined;
 if (semanticIndex) void semanticIndex.prime();
 const authStore = createFileAuth(join(vaultRoot, '.auth.json'));

 const bindHost = process.env.ELICIT_HOST ?? '127.0.0.1';
 const port = parseInt(process.env.ELICIT_PORT ?? '4517', 10);

 // Say where we are BEFORE the boot docket runs: on a populated vault with a
 // slow local model the docket takes minutes, and a silent terminal reads as
 // a hang. The address is knowable now, so print it now.
 console.error(`\n  elicit → http://${bindHost}:${port}`);
 for (const line of roleLines) console.error(`  ${line}`);
 console.error(`  vault: ${vaultRoot} (ELICIT_LLM=${llmMode})`);
 console.error('  starting…\n');

 const app = await createApp({
  vault,
  complete,
  ...(clerk ? { clerk } : {}),
  ...(embed ? { embed } : {}),
  queue,
  index,
  ...(semanticIndex ? { semanticIndex } : {}),
  vaultRoot,
  authStore,
  ...(modelName ? { modelName } : {}),
 });
 await serveApp(app, port);
 console.error(`  ready → http://${bindHost}:${port}`);
 console.error('  the clerk is reading the vault in the background\n');
}
