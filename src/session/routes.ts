/**
 * The session-flow cluster (Wave B extraction): every /api/session route —
 * the opener, pulse, turn, skip, defer, sounding, descent gates, machine
 * resume, repair, the DRM drive, end, gate and harvest — plus their helper
 * functions, moved wholesale out of src/server.ts. Wire shapes, route
 * paths, log kinds, and error statuses are byte-identical to the
 * pre-extraction server; this module exists to give the biggest cluster in
 * the repo a home of its own.
 *
 * The handlers close over exactly the bindings SessionCtx names: the live
 * maps server.ts owns (passed by reference, so in-place mutation is shared),
 * the stores, the model Completes, and read-handles for the two objects the
 * docket REPLACES on completion (currentIndex, snippetMap — the getters read
 * the live let-bindings in server.ts, never a snapshot).
 */

import type { Context, Hono } from 'hono';
import { readFileSync } from 'node:fs';
import type { ActivityEvent } from '../log/activity.js';
import type { EventKind } from '../log/kinds.js';
import type {
 CaptureChannel,
 Complete,
 CutProposal,
 HarvestDecision,
 LexicalIndex,
 Mode,
 ParkedLadder,
 Prosody,
 QuestionForm,
 QueueEntry,
 QueueStore,
 RepairRecord,
 SessionState,
 Snippet,
 SoundingEnd,
 Target,
 Turn,
 Vault,
} from '../types.js';
import type { GazetteerStore } from '../clerk/gazetteer-store.js';
import { resonateHybrid, type SemanticIndex } from '../index/semantic.js';
import { composeFromCompacted, composeRung } from '../clerk/sounding-rung.js';
import { loadLadderSummary } from '../clerk/sounding-summary.js';
import {
 addEpisode,
 answerProbe,
 applyGate as applyDRMGate,
 doneEnumerating,
 gateReading,
 initDRM,
 probeQuestion,
 resumeDRM,
 transcriptQuestion,
} from '../drm/state.js';
import { readDRM } from '../drm/park.js';
import type { DRMState, DrmUi } from '../drm/types.js';
import { machinePhaseMeta, startMachine, type MachineState } from '../protocols/machine.js';
import { parkMachinePointer, readMachineState, removeMachineState, writeMachineState } from '../protocols/park.js';
import { getProtocol } from '../protocols/registry.js';
import { createRandomizer, type RandomizerDraw } from '../randomizer/randomizer.js';
import { machineTurn, parseTriadPair, skipQuestion, startSession, userTurn } from '../elicitor/elicitor.js';
import { CLOSING_ACKNOWLEDGMENT, CLOSING_DOOR_QUESTION } from '../elicitor/protocol.js';
import { guardComposed } from '../language/emit-form.js';
import { repairedSnippetIds } from '../repair/consult.js';
import { readAllRepairs, writeRepair } from '../repair/store.js';
import { decide, propose, pendingBudEntries, HARVEST_ACTIONS, type HarvestDiagnostics } from '../harvester/harvester.js';
import { detectRepeats, type RepeatsFlag } from '../harvester/dedupe.js';
import { validateDecisions } from '../guards.js';
import { readPendingHarvest, removePendingHarvest, writePendingHarvest } from '../harvester/pending.js';
import { UNPROMPTED_MODE } from '../queue/mode-needs.js';
import { openQuestionEntry } from '../queue/open-question.js';
import { applyGate, enterSounding, gateStateFor, validateGateChoice } from '../sounding/ladder.js';
import { expectedLengthSentence, rungAllowance } from '../sounding/budget.js';
import { licenseSounding } from '../sounding/license.js';
import { parkPointer, writeLadder } from '../sounding/park.js';
import { resumeSounding } from '../sounding/resume.js';
import { surfaced } from '../log/surfaced.js';
import { appendClosing, mostRecentlyModifiedTranscript, readTranscript as readVaultTranscript } from '../vault/transcripts.js';
import { autoGatherSitting } from '../clerk/auto-gather.js';
import { createPieceStore } from '../piece/store.js';

// ── SessionCtx ──

/**
 * The bindings the session-flow handlers close over. The maps and stores
 * are the SAME objects server.ts owns — the handlers mutate them in place,
 * so every other route sees the writes. `currentIndex` and `snippetMap`
 * are read-handles: the docket REPLACES both on completion, so the getters
 * read the live let-bindings in server.ts, never a snapshot.
 */
/**
* Emit an activity event at the server seam. A named type so the
* signature's `kind: EventKind` never reads as an emit site to the
* emitted-kinds sweep (tests/emitted-kinds.ts scans property spellings,
* not types).
*/
export type ServerEmitFn = (
root: string,
actor: ActivityEvent['actor'],
eventKind: EventKind,
detail: string,
refs?: string[],
) => void;

export interface SessionCtx {
 /** Live sittings, keyed by session id. */
 sessions: Map<string, SessionState>;
 /** The machine protocol every route-created sitting runs (canon §10: the
 *  pick and the rotation are dead). Absent = reflective — the production
 *  default; the createApp seam lets tests drive machine protocols. */
 protocolName?: string;
 /** The sounding offer in flight per sitting (plan Task 8). */
 soundingOffers: Map<string, { text: string; construct: string }>;
 /** Proposed harvest cuts awaiting a decision (ticket 084 fallback). */
 sessionProposals: Map<string, CutProposal[]>;
 /** Sessions whose material arrived unprompted — kept snippets carry that origin. */
 unpromptedSessions: Set<string>;
 /** The capture channel for each unprompted session (ticket 048). */
 unpromptedChannels: Map<string, CaptureChannel | undefined>;
 /** The vault. */
 vault: Vault;
 /** The queue store. */
 queue: QueueStore;
 vaultRoot: string;
 /** The elicitor's own Complete — foreground model, a person waits on it. */
 complete: Complete;
 /** The gazetteer store the machine's people source reads; absent = cold. */
 gazetteerStore: GazetteerStore | undefined;
 /** The clerk's Complete — background model (Q-48). */
 clerkComplete: Complete;
 /** The clerk's cuts-constrained Complete (ticket 078). */
 harvestComplete: Complete;
 /** The semantic resonance channel; absent = the trigram fallback. */
 semanticIndex: SemanticIndex | undefined;
 /** Live read of the lexical index (replaced on docket completion). */
 currentIndex: () => LexicalIndex;
 /** Live read of the snippet map (rebuilt on docket completion). */
 snippetMap: () => ReadonlyMap<string, Snippet>;
 /** The harvest system prompt with the persona line, or undefined = stock. */
 harvestPromptNow: () => string | undefined;
 /** Read/clear handles for the spoken-turn prosody carrier (ticket 108). */
 pendingProsody: {
  current: () => { text: string; prosody: Prosody } | null;
  clear: () => void;
 };

  serverEmit: ServerEmitFn;
/** Start a docket run behind whatever called this. */
 startDocket: (trigger: string) => void;
 /** Scan transcript files for session metadata. */
 listSessions: (root: string) => { session: string; started: string; turnCount: number; chars: number }[];
 /** Narrowing guard for a capture channel value sent by the client. */
 isCaptureChannel: (v: unknown) => v is CaptureChannel;
}

// ── The session maps + ctx factory (Wave C3 F14) ──

/**
 * The five live session maps as one object — the per-createApp state the
 * session-flow handlers mutate. createSessionState builds them and the
 * SessionCtx that carries them, so src/server.ts owns no map literal; the
 * routes here and the unprompted-family routes there mutate the SAME maps.
 */
export type SessionMaps = {
 /** Live sittings, keyed by session id. */
 sessions: Map<string, SessionState>;
 /** The sounding offer in flight per sitting (plan Task 8). */
 soundingOffers: Map<string, { text: string; construct: string }>;
 /** Proposed harvest cuts awaiting a decision (ticket 084 fallback). */
 sessionProposals: Map<string, CutProposal[]>;
 /** Sessions whose material arrived unprompted — kept snippets carry that origin. */
 unpromptedSessions: Set<string>;
 /** The capture channel for each unprompted session (ticket 048). */
 unpromptedChannels: Map<string, CaptureChannel | undefined>;
};

/**
 * The per-createApp session state: the five maps plus the SessionCtx that
 * names them. The extras are the createApp bindings the ctx carries that
 * are NOT the maps (the stores, the model Completes, the read-handles,
 * the emit seam, the docket handle); the maps stay this module's own so
 * the lifetime is one-per-app, never module-scope (Wave C3 F14).
 */
export function createSessionState(
 extras: Omit<SessionCtx, keyof SessionMaps>,
): { maps: SessionMaps; ctx: SessionCtx } {
 const maps: SessionMaps = {
  sessions: new Map<string, SessionState>(),
  soundingOffers: new Map<string, { text: string; construct: string }>(),
  sessionProposals: new Map<string, CutProposal[]>(),
  unpromptedSessions: new Set<string>(),
  unpromptedChannels: new Map<string, CaptureChannel | undefined>(),
 };
 const ctx: SessionCtx = { ...maps, ...extras };
 return { maps, ctx };
}

// ── The opening pulse (ticket 105) ──
// ── The opening pulse (ticket 105) ──
// Rotated per sitting so a single unchanging wording never breeds pattern
// fatigue. The first-turn convention asks nothing diagnostic — just a line
// of inner weather, optional and skippable with no record of the skip.
const PULSE_PROMPTS = [
 "how are you showing up today?",
 "what's the weather inside?",
 "one word for where you are right now:",
 "what's on top of mind before we begin?",
 "how does today feel, in a line?",
] as const;

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
 * The quoted fragment of the queue entry whose question is on the table
 * (ticket 137). Absent when the open question is not a queue draw.
 */
function openQueueQuotedFragment(queue: QueueStore, openQueueEntryId?: string): string | undefined {
 if (!openQueueEntryId) return undefined;
 const entry = queue.list().find((e) => e.id === openQueueEntryId);
 return entry?.quotedFragment;
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

/** The `started` stamp of a session transcript frontmatter, the review date shown on a pending harvest. */
function sessionStartedAt(root: string, sessionId: string): string {
 return readVaultTranscript(root, sessionId)?.started || new Date().toISOString();
}
/**
 * The one-turn unprompted sitting (Wave E S17): mint the timestamp and user
 * turn, open the transcript with the unprompted mode, append the turns. The
 * shared skeleton of the five capture flows — /api/unprompted, queue-answer,
 * composition, quest-return and artifact. Each site keeps its own
 * registration (unpromptedSessions/unpromptedChannels), background harvest
 * and events around the call, so nothing observable moves.
 */
export function startUnpromptedSitting(ctx: SessionCtx, args: {
 sessionId: string;
 text: string;
 protocol: string;
 /** Timestamp for the transcript and turns; default now (the queue-answer
  *  flow mints it first for its agent probe and passes it). */
 at?: string;
 /** Extra transcript metadata beyond mode/protocol/started (quest, direction). */
 transcript?: {
  quest?: string;
  direction?: string;
 };
 /** Turns appended BEFORE the user turn (the queue-answer's agent probe). */
 leadTurns?: Turn[];
}): { at: string; turn: Turn } {
 const at = args.at ?? new Date().toISOString();
 const turn: Turn = { role: 'user', text: args.text, at };
 ctx.vault.startTranscript(args.sessionId, {
  mode: UNPROMPTED_MODE,
  protocol: args.protocol,
  started: at,
  ...(args.transcript ?? {}),
 });
 for (const t of args.leadTurns ?? []) ctx.vault.appendTurn(args.sessionId, t);
 ctx.vault.appendTurn(args.sessionId, turn);
 return { at, turn };
}

 /**
  * Sessions with a background harvest in flight (ghost-harvest ticket): the
  * fire-and-return contract means a second start for the same session no-ops —
  * the first run already emitted harvest-started and will write the record.
  * Removed when the run settles, so a later end of a resumed sitting can
  * harvest again.
 */
 const harvestingSessions = new Set<string>();

 /**
  * Fire-and-return harvest (ticket 084): /end and /unprompted answer
  * immediately, propose runs behind the response. A finished run writes its
  * record to the pending queue, restart-proof and claimable by /harvest; a
  * failed run logs as failed and writes nothing, so the transcript stays the
 */
 export function startBackgroundHarvest(ctx: SessionCtx, args: {
  sessionId: string;
  turns: Turn[];
  protocol: string;
  started: string;
  origin: 'harvest' | 'unprompted';
  turnChannels?: (CaptureChannel | undefined)[];
  unpromptedChannel?: CaptureChannel;
 }): void {
  if (harvestingSessions.has(args.sessionId)) return;
  harvestingSessions.add(args.sessionId);
  const { vaultRoot, serverEmit, harvestComplete, harvestPromptNow, sessionProposals } = ctx;
  serverEmit(vaultRoot, 'harvester', 'harvest-started', `session=${args.sessionId} chunks=${args.turns.length}`);
  setImmediate(async () => {
   try {
    const result = await propose(args.sessionId, args.turns, harvestComplete, harvestPromptNow());
    if (result.diagnostics.parseMode === 'failed') {
     serverEmit(vaultRoot, 'harvester', 'harvest-failed', harvestDetail(result));
     return;
    }
    // §12.1 intake dedupe: compare the proposals against the vault corpus.
    // The index read can fail (a background docket run may hold it) — a
    // failed read means no flags this run, never a blocked harvest.
    let repeats: RepeatsFlag[] = [];
    try {
     repeats = detectRepeats(result.proposals, ctx.vault.rebuildIndex());
    } catch {
     repeats = [];
    }
    writePendingHarvest(vaultRoot, {
     sessionId: args.sessionId,
     at: new Date().toISOString(),
     started: args.started,
     protocol: args.protocol,
     origin: args.origin,
     proposals: result.proposals,
     // Wave 2 S1: the record keeps propose()'s buds so the count sentence
     // can say how many fragments couldn't stand alone. Written only when
     // there are any — an old-shape record (no buds) reads as none.
     ...(result.buds.length > 0 ? { buds: pendingBudEntries(result.buds) } : {}),
     // Batch C2 (§12.1): near-duplicates against the corpus as it exists
     // when this harvest lands, detected at intake and written with the
     // record so the review row can say so before the person decides.
     // Flag-only — never a silent drop; absent reads as no repeats.
     ...(repeats.length > 0 ? { repeats } : {}),
     ...(args.turnChannels !== undefined ? { turnChannels: args.turnChannels } : {}),
     ...(args.unpromptedChannel !== undefined ? { unpromptedChannel: args.unpromptedChannel } : {}),
    });
    sessionProposals.set(args.sessionId, result.proposals);
    serverEmit(vaultRoot, 'harvester', 'harvest-proposed', harvestDetail(result));
   } catch (err: unknown) {
    console.error(`harvest (${args.sessionId}) failed:`, String(err));
    serverEmit(vaultRoot, 'harvester', 'harvest-failed', `session=${args.sessionId}`);
   } finally {
    harvestingSessions.delete(args.sessionId);
   }
  });
 }

/**
 * Register the session-flow cluster: the ~20 /api/session routes and their
 * helpers, extracted wholesale from src/server.ts (Wave B). Called exactly
 * once at app build, at the cluster's old registration position, so the
 * Hono route table is unchanged entry-for-entry.
 */
export function createSessionRoutes(app: Hono, ctx: SessionCtx): void {
 const deps = {
  vault: ctx.vault,
  queue: ctx.queue,
  vaultRoot: ctx.vaultRoot,
  complete: ctx.complete,
  gazetteerStore: ctx.gazetteerStore,
  ...(ctx.protocolName !== undefined ? { protocolName: ctx.protocolName } : {}),
 };
 const {
  sessions,
  soundingOffers,
  sessionProposals,
  unpromptedSessions,
  unpromptedChannels,
  clerkComplete,
  harvestComplete,
  semanticIndex,
  currentIndex,
  snippetMap,
  harvestPromptNow,
  pendingProsody,
  serverEmit,
  startDocket,
  listSessions,
  isCaptureChannel,
 } = ctx;

// ── Route guards (Wave C3 F6/F14) ──
// The session-not-found and DRM-state guards every /api/session/:id route
// shares, folded from the 17 inline copies. Module-private: they close
// over the same `sessions` map the handlers mutate, and each returns the
// 400/404 Response the inline copies did — messages byte-identical.
function sessionOf(c: Context, sessionId: string): SessionState | Response {
 const state = sessions.get(sessionId);
 if (!state) return c.json({ error: 'session not found' }, 404);
 return state;
}

/** The DRM-running guard: 400 when no DRM machine is running. */
function drmRunningOf(c: Context, state: SessionState): { machine: MachineState; ui: DrmUi } | Response {
 const running = drmMachineOf(state);
 if (running === null) return c.json({ error: 'no DRM running' }, 400);
 return running;
}

/** The DRM-not-started guard: 400 when a machine IS already running (drm/start, drm/resume). */
function drmStartedOf(c: Context, state: SessionState): Response | null {
 if (drmMachineOf(state) !== null) return c.json({ error: 'DRM already running' }, 400);
 return null;
}

// GET /api/session/open → {sessionId: string} | {sessionId: null}
// The Today door (redesign wave 1): the most recent live sitting in the
// in-memory map, else null. The map keeps ended sittings — a sitting
// leaves it only when an empty sitting ends (ticket 145's guard) — so an
// ended session (endedAt set) is skipped: insertion order is opening order,
// and the last non-ended key is the most recently opened live sitting.
// Read-only: no side effects.
 app.get('/api/session/open', (c) => {
  let sessionId: string | null = null;
  for (const [id, state] of sessions) {
   if (!state.endedAt) sessionId = id;
  }
  return c.json({ sessionId });
 });

 // POST /api/session {mode?, shuffle?} → {sessionId, question, target, source?}
 app.post('/api/session', async (c) => {
  const body = await c.req.json<{ mode?: Mode; shuffle?: boolean }>();

  const mode = body.mode;
  if (mode !== undefined && mode.target !== undefined && mode.target !== 'self' && mode.target !== 'domain') {
   return c.json({ error: 'invalid target' }, 400);
  }

  // Q-115: advance the sitting counter the queue engagement ledger keys on
  // BEFORE any draw this sitting makes.
  deps.queue.noteSittingStarted();

  // No mode means the inward default (canon §5.2 — one word begin, no
  // declarations); an explicit target always wins.
  const target: Target = mode?.target ?? 'self';
  const normalized: Mode = mode ? { ...mode, target } : { target };

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

  // ── Close abandoned sittings on vault contact (ticket 135) ──
  (() => {
   try {
    const recent = mostRecentlyModifiedTranscript(deps.vaultRoot);
    if (recent === null) return;
    const tail = readFileSync(recent.path, 'utf8').slice(-500);
    const sections = tail.match(/^## (\w+)/gm);
    if (sections && sections.length > 0 && sections[sections.length - 1] === '## agent') {
     appendClosing(deps.vaultRoot, recent.session, CLOSING_ACKNOWLEDGMENT);
    }
   } catch { /* best-effort */ }
  })();

  const greetingText = PULSE_PROMPTS[Math.floor(Math.random() * PULSE_PROMPTS.length)]!;

  const state = startSession(normalized, {
   complete: deps.complete,
   vault: deps.vault,
   queue: deps.queue,
   index: currentIndex(),
   ...(semanticIndex ? { semantic: semanticIndex } : {}),
    randomizer,
   vaultRoot: deps.vaultRoot,
   greetingText,
   // The phase machine's people source (ticket 159, slice 3): the
   // gazetteer's named people, for people-grid's triads. Absent store →
   // empty list → people-grid degrades to reflective at session start.
   peopleSource: () => (deps.gazetteerStore?.list() ?? [])
    .filter((e) => e.kind === 'person')
    .map((e) => e.name),
   ...(body.shuffle ? { shuffleRequested: true } : {}),
   ...(deps.protocolName !== undefined ? { protocolName: deps.protocolName } : {}),
  });
  sessions.set(state.id, state);
  const opener = state.pendingOpener!;
  serverEmit(deps.vaultRoot, 'elicitor', 'session-started', `target=${target} declared=${mode?.target !== undefined} protocol=${state.protocol} shuffle=${body.shuffle === true}`);

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
  const openerQuotedFragment = openQueueQuotedFragment(deps.queue, state.openQueueEntryId);
  return c.json({
   sessionId: state.id,
   question: opener.text,
   target,
  // The greeting IS the pulse — the client renders it as the momentary-state
  // input before the opener (ticket 135).
  pulsePrompt: greetingText,
   // state.protocol, not selectedProtocol.name: a machine-time degradation
   // (people-grid with fewer than three gazetteer people → reflective,
   // ticket 159) is decided inside startSession and must be what the client
   // hears back.
   protocol: state.protocol,
   ...(draw && draw.question === opener.text
    ? {
     source: draw.provenance,
     // Display-only lineage (080): never quoted into the question, never
     // in the transcript — the frontend dims it above the resurfaced prose.
     ...(draw.snippetQuestion ? { snippetQuestion: draw.snippetQuestion } : {}),
     ...(draw.context ? { context: draw.context } : {}),
    }
    : {}),
    ...(openerQuotedFragment ? { quotedFragment: openerQuotedFragment } : {}),
  });
 });
 // POST /api/session/:id/pulse {text, prompt} → {ok} (ticket 105, 135)
 // Greeting path (ticket 135): greeting is turn 0, opener is pending.
 // The pulse route records the greeting answer and appends the opener.
 app.post('/api/session/:id/pulse', async (c) => {
  const sessionId = c.req.param('id');
  const state = sessionOf(c, sessionId);
  if (state instanceof Response) return state;
  const body = await c.req.json<{ text: string; prompt: string }>();
  const text = (body.text ?? '').trim();
  const now = new Date().toISOString();

  // ── Greeting path (ticket 135): greeting is turn 0 ──
  if (state.pendingOpener) {
   if (text) {
    const userTurnRecord: Turn = { role: 'user', text, at: now };
    state.turns.push(userTurnRecord);
    deps.vault.appendTurn(sessionId, userTurnRecord);
    serverEmit(deps.vaultRoot, 'elicitor', 'pulse-answered', `chars=${text.length}`);
   }
   const openerTurn: Turn = {
    role: 'agent',
    text: state.pendingOpener.text,
    at: now,
    questionForm: state.pendingOpener.questionForm,
    ...(state.pendingOpener.questionSource ? { questionSource: state.pendingOpener.questionSource } : {}),
    ...(state.pendingOpener.gap ? { gap: state.pendingOpener.gap } : {}),
   };
   state.turns.push(openerTurn);
   deps.vault.appendTurn(sessionId, openerTurn);
   state.questionCount++;
   delete state.pendingOpener;
   return c.json({ ok: true });
  }

 });
/**
 * The shared answer-path close (plan Task 8 contract): persist the finished
 * ladder, consume the carrier, log the close. One copy for the turn route
 * and the gate route, so the cap path and the park path can never write the
 * ladder differently. Returns the wire fields both routes append.
 */
function finishDescent(state: SessionState): { descentClosed: SoundingEnd; soundingId: string } {
 const finished = state.finishedSounding!;
 writeLadder(deps.vaultRoot, finished);
 delete state.finishedSounding;
 serverEmit(
  deps.vaultRoot,
  'elicitor',
  'sounding-ended',
  `sounding=${finished.id} rungs=${finished.rungs.length} endedBy=${finished.endedBy}`,
 );
 return { descentClosed: finished.endedBy, soundingId: finished.id };
}

/**
 * The gate route's descent-closed paths leave the sitting the way the
 * elicitor's closeDescent does: phase closing-door, door question asked
 * (Q-20, Q-47). Appended exactly as emitProbe appends it.
 */
function closeTheDoor(state: SessionState, at: string): void {
state.phase = 'closing-door';
const agentTurn: Turn = { role: 'agent', text: CLOSING_DOOR_QUESTION, at, questionForm: 'deliberative' };
state.deps.vault.appendTurn(state.id, agentTurn);
state.turns.push(agentTurn);
state.questionCount++;
}

/**
 * The rung-composition guard: the emit-form gate over the sitting's asked
 * set. One closure for every place a descent composes — the accept route,
 * the sounding gate, and the resume route — so the asked set and the
 * guard call cannot drift between them. The label names the site in the
 * rejection log.
 */
function makeRungGuard(state: SessionState, label: string) {
return (question: string) =>
 guardComposed(question, { asked: state.turns.filter((t) => t.role === 'agent').map((t) => t.text) }, label).verdict;
}


 // POST /api/session/:id/turn {text} → probe | saturated
 app.post('/api/session/:id/turn', async (c) => {
  const sessionId = c.req.param('id');
  const state = sessionOf(c, sessionId);
  if (state instanceof Response) return state;

  const body = await c.req.json<{ text: string; spoken?: boolean; channel?: CaptureChannel; pair?: unknown }>();
  if (!body.text || typeof body.text !== 'string') {
   return c.json({ error: 'text is required' }, 400);
  }
  if (body.channel !== undefined && !isCaptureChannel(body.channel)) {
   return c.json({ error: `invalid channel "${String(body.channel)}"` }, 400);
  }
  // The chip surface's pair (ticket 159, slice 7): additive and optional —
  // a prose-only turn is unchanged. A malformed pair is dropped, never a
  // 400, so the route contract holds for every existing client.
  const pair = parseTriadPair(body.pair);
  if (body.pair !== undefined && pair === undefined) {
   console.warn('Elicitor: malformed triad pair on /turn ignored');
  }

  // Detect resonance for juxtaposition info (before userTurn consumes the hit)
  const hits = await resonateHybrid(currentIndex(), semanticIndex, body.text);
  // Q-106: Exclude hits whose snippet is under repair — a repaired snippet
  // must not surface through resonance either.
  const allRepairsForHit = readAllRepairs(deps.vaultRoot);
  const repairedIdsForHit = repairedSnippetIds(allRepairsForHit);
  const cleanHits = repairedIdsForHit.size > 0
    ? hits.filter((h) => !repairedIdsForHit.has(h.snippetId))
    : hits;

  const hitCount = cleanHits.length;
  // Batch C3: the staging verdict with its evidence — which channel found
  // the hits. Lexical serves first (Q-17); a semantic count above zero is
  // the meaning channel standing in the lexical silence, and the log line
  // names both so the staging is observable, never assumed.
  const lexicalHits = cleanHits.filter((h) => h.channel === 'lexical').length;
  const semanticHits = hitCount - lexicalHits;
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'resonance-checked',
   `session=${sessionId} hits=${hitCount} lexical=${lexicalHits} semantic=${semanticHits}`,
  );

  // The rider is built AFTER userTurn. When the elicitor composed a
  // juxtaposition, the rider shows the snippet it ACTUALLY used
  // (Probe.juxtaposedSnippet) — the top hit here may be one it skipped
  // (repairs, per-sitting reuse, failed drafts). Otherwise the 068 contract
  // stands: resonance surfaces the top hit even when the question came from
  // elsewhere. Descent rungs and closing questions get no rider at all — it
  // used to ride on those too, noise beside a question that never used it.
  let juxtaposition: { snippetText: string; snippetDate: string } | undefined;
  let riderSnippetId: string | undefined;

 let turnProsody: Prosody | undefined;
 const pendingProsodyNow = pendingProsody.current();
 if (body.spoken && pendingProsodyNow && pendingProsodyNow.text === body.text) {
  turnProsody = pendingProsodyNow.prosody;
  pendingProsody.clear();
 }
 // Thread engagement (ticket 148): the reply answers the entry userTurn is
 // about to clear — capture its id first, judge the reply against it after.
 // Two disengaged replies running defer the whole thread (never expire —
 // dormancy is signal, Q-56).
 const answeredEntryId = state.openQueueEntryId;
 const phaseBefore = state.phase;
 const result = await userTurn(state, body.text, body.spoken, turnProsody, pair);
 // A turn landing resumes the sitting (ghost-harvest ticket): clear the end
 // timestamp so the today door offers it again. Any in-flight harvest is
 // stale — records are keyed by session and the resumed sitting's own later
 // harvest supersedes it (later write wins), so the turn is never refused.
 delete state.endedAt;
 if (answeredEntryId) {
  deps.queue.recordReplyDisengagement(answeredEntryId, body.text);
 }

  // Record the capture channel for this turn ordinal, unconditionally —
  // an absent channel pushes undefined so the ordinals never shift (ticket 048).
  state.turnChannels = [...(state.turnChannels ?? []), body.channel];

  // Activity event for close phase entry
  if (phaseBefore !== 'closing-door' && state.phase === 'closing-door') {
   serverEmit(deps.vaultRoot, 'elicitor', 'close-phase-entered', `session=${sessionId}`);
  }

  const inQuietPhase = state.sounding !== undefined || state.finishedSounding !== undefined
   || state.phase === 'closing-door';
  if (result.kind === 'probe' && result.juxtaposedSnippet) {
   riderSnippetId = result.juxtaposedSnippet.snippetId;
  } else if (!inQuietPhase && cleanHits.length > 0) {
   riderSnippetId = cleanHits[0]!.snippetId;
  }
  if (riderSnippetId !== undefined) {
   const snip = snippetMap().get(riderSnippetId);
   if (snip) {
    juxtaposition = {
     snippetText: snip.prose,
     snippetDate: snip.captured.slice(0, 10),
    };
   }
  }

  if (result.kind === 'saturated') {
   // The machine record cleanup (ticket 159, slice 5): the resumed sitting
   // finishing consumes the record it resumed; a fresh sitting removes its
   // own advance-written record — unless it parked, the act that keeps a
   // record past the sitting end.
   if (state.machineParked !== true) {
    removeMachineState(deps.vaultRoot, sessionId);
   }
   if (state.resumedMachineId) {
    removeMachineState(deps.vaultRoot, state.resumedMachineId);
   }
   return c.json({ kind: 'saturated', ...(result.closingText ? { closingText: result.closingText } : {}) });
  }

  // The descent is blocked at its checkpoint: no question until a gate
  // word arrives. The gate reading rides the response so the client can
  // render the rung it sits on.
  if (result.kind === 'checkpoint') {
   return c.json({ kind: 'checkpoint', sounding: gateStateFor(state.sounding!) });
  }

  // A descent that closed on this answer (cap or convergence) — persist
  // the ladder and answer with its id before the ordinary probe block.
  // The gate was never touched on this path; the response is the only
  // carrier of the ladder's identity.
  if (state.finishedSounding) {
   const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
   return c.json({
    kind: 'probe',
    text: result.text,
    questionForm: result.questionForm,
    ...(phaseMeta !== undefined ? { phase: phaseMeta } : { phase: state.phase }),
    ...(juxtaposition ? { juxtaposition } : {}),
    ...finishDescent(state),
   });
  }

  // Activity: question-asked or juxtaposition-offered
  if (juxtaposition && riderSnippetId !== undefined) {
   serverEmit(deps.vaultRoot, 'elicitor', 'juxtaposition-offered', `session=${sessionId} snippet=${riderSnippetId} source=juxtaposition`);
  } else {
   serverEmit(deps.vaultRoot, 'elicitor', 'question-asked', `session=${sessionId} source=${result.provenance}`);
  }

  // The just-served probe, when it was a queue draw (015). At the top of
  // userTurn the previous entry is answered and cleared, so a set id here
  // names the question this turn actually served.
  stampComposedServed(deps.vaultRoot, deps.queue, state.openQueueEntryId);

  // The entry license (plan Task 8): evaluated once per sitting, after the
  // turn so questionCount is current, and only while nothing was offered
  // yet — a set soundingOffer is the end of licensing, whatever it says.
  // Emitted on every evaluation, licensed or not (Q-62). A licensed offer
  // stashes the answer that earned it for the consent route, and the
  // response carries it exactly once.
  let soundingOfferWire: { construct: string; allowance: number; sentence: string } | undefined;
  if (state.soundingOffer === undefined) {
   const lic = licenseSounding(state);
   serverEmit(
    deps.vaultRoot,
    'elicitor',
    'sounding-license',
    // sustainedValue is the measured mean adjacent Jaccard — the ONLY numeric
    // evidence the threshold can ever be re-tuned from (Q-62; ticket 142
    // computed it and this line used to drop it).
    `late=${lic.reasons.late} sustained=${lic.reasons.sustained} sustainedValue=${lic.sustainedValue.toFixed(3)} unoffered=${lic.reasons.unoffered} licensed=${lic.licensed}`,
   );
   if (lic.licensed) {
    state.soundingOffer = 'offered';
    soundingOffers.set(sessionId, { text: body.text, construct: lic.construct ?? 'the thread' });
    const allowance = rungAllowance(state.mode, state.questionCount).allowance;
    serverEmit(
     deps.vaultRoot,
     'elicitor',
     'sounding-offered',
     `session=${sessionId} rungs=${allowance}`,
    );
    soundingOfferWire = {
     construct: lic.construct ?? 'the thread',
     allowance,
     sentence: expectedLengthSentence(allowance),
    };
   }
  }

  const servedQuotedFragment = openQueueQuotedFragment(deps.queue, state.openQueueEntryId);
  // Read AFTER userTurn: the meta describes the phase of the question being
  // served, which a ratified advance inside the turn may just have changed.
  // Every sitting now carries a machine (ticket 159, slice 4), so the turn
  // response's `phase` field is the machine shape — the session-phase-string
  // fallback is unreachable on the /turn route today and stays only to keep
  // the field honest for a hypothetical machine-less session.
  const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
  return c.json({
   kind: 'probe',
   text: result.text,
   questionForm: result.questionForm,
   ...(phaseMeta !== undefined ? { phase: phaseMeta } : { phase: state.phase }),
   ...(juxtaposition ? { juxtaposition } : {}),
   ...(state.sounding ? { sounding: gateStateFor(state.sounding) } : {}),
   ...(soundingOfferWire ? { soundingOffer: soundingOfferWire } : {}),
   ...(servedQuotedFragment ? { quotedFragment: servedQuotedFragment } : {}),
  });
});

// POST /api/session/:id/declare {topic} → {ok, topic} (redesign wave 4)
// Declaration by utterance: the person names what this sitting is about.
// The topic lands on the sitting Mode, so the next composed probe keeps
// the sitting on its named subject. Same guards as the turn route: a
// missing session 404s, a blank topic 400s. A declaration is a frame,
// not words the model answers, so no turn is recorded.
app.post('/api/session/:id/declare', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;

 const body = await c.req.json<{ topic?: unknown }>();
 const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
 if (topic.length === 0) {
  return c.json({ error: 'topic is required' }, 400);
 }

 // Last declaration wins: the Mode carries one topic for the sitting.
 state.mode = { ...state.mode, topic };

 serverEmit(deps.vaultRoot, 'elicitor', 'topic-declared', `session=${sessionId} topic=${topic}`);
 return c.json({ ok: true, topic });
});

// POST /api/session/:id/skip → question | exhausted
 // When the opener is still pending (greeting path, ticket 135), the skip
 // replaces the pending opener and writes the replaced question as a
 // skipped turn for audit.
 app.post('/api/session/:id/skip', (c) => {
  const sessionId = c.req.param('id');
  const state = sessionOf(c, sessionId);
  if (state instanceof Response) return state;

  // ── Pending opener path (ticket 135): replace before it fires ──
  if (state.pendingOpener) {
   const skippedTurn: Turn = {
    role: 'agent',
    text: state.pendingOpener.text,
    at: new Date().toISOString(),
    questionForm: state.pendingOpener.questionForm,
    skipped: true,
    ...(state.pendingOpener.questionSource ? { questionSource: state.pendingOpener.questionSource } : {}),
    ...(state.pendingOpener.gap ? { gap: state.pendingOpener.gap } : {}),
   };
   state.turns.push(skippedTurn);
   deps.vault.appendTurn(sessionId, skippedTurn);

   const bank = state.bank ?? [];
   const used = new Set(state.turns.filter(t => t.role === 'agent').map(t => t.text));
   const available = bank.filter(st => !used.has(st.text));
   if (available.length === 0) return c.json({ kind: 'exhausted' });
   const pick = available[Math.floor(Math.random() * available.length)]!;
   state.pendingOpener = {
    text: pick.text,
    questionForm: pick.questionForm,
    ...(pick.source ? { questionSource: pick.source } : {}),
   };
   delete state.openQueueEntryId;
   serverEmit(deps.vaultRoot, 'elicitor', 'question-asked', `session=${sessionId} source=skip`);
   return c.json({ kind: 'question', text: pick.text, questionForm: pick.questionForm });
  }

  // ── Pre-135 path: last agent turn is the current question ──
  const result = skipQuestion(state);
  if (result.kind === 'question') {
   serverEmit(deps.vaultRoot, 'elicitor', 'question-asked', `session=${sessionId} source=skip`);
  }
  return c.json(result);
 });

 // POST /api/session/:id/defer {need?} → question | exhausted
 // The question returns to the Queue as a plain open question. Distinct from
 // skip in the log; like skip, it does not consume budget. The declared-Mode
 // needs (time/energy) that used to ride the body died with the declarations
 // (canon §9 wave 1) — the entry carries no needs.
 app.post('/api/session/:id/defer', async (c) => {
  const sessionId = c.req.param('id');
  const state = sessionOf(c, sessionId);
  if (state instanceof Response) return state;

  // The question on the table: the pending opener while the greeting holds
  // the first turn (ticket 135), else the last agent turn.
  const deferred = state.pendingOpener
    ? state.pendingOpener
    : [...state.turns].reverse().find((t) => t.role === 'agent');
  if (!deferred) return c.json({ error: 'no question to defer' }, 400);

  deps.queue.add(
   openQuestionEntry({
    source: 'user-declared',
    license: 'user',
    question: deferred.text,
    questionForm: deferred.questionForm ?? 'deliberative',
   }),
  );

  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'question-deferred',
   `session=${sessionId}`,
  );

  const result = skipQuestion(state);
  // While the greeting still holds the first turn (ticket 135), the
  // replacement becomes the new pending opener — a deferral swaps the
  // question on the table the same way the skip route's pending-opener
  // path does, so the next defer defers the new question, not the stale one.
  if (result.kind === 'question' && state.pendingOpener) {
    state.pendingOpener = {
      text: result.text,
      questionForm: result.questionForm,
    };
  }
  return c.json(result);
 });

// POST /api/session/:id/sounding {accept} → probe | declined
// The consent ask, one word in and one word out. Accepting enters the
// descent and composes rung 0 from the answer that licensed the offer;
// declining is recorded and never re-asked (Q-43).
app.post('/api/session/:id/sounding', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;

 let accept: unknown;
 try {
  accept = (await c.req.json<{ accept?: unknown }>()).accept;
 } catch {
  return c.json({ error: 'accept is required' }, 400);
 }
 if (typeof accept !== 'boolean') {
  return c.json({ error: 'accept must be a boolean' }, 400);
 }
 if (state.soundingOffer !== 'offered') {
  return c.json({ error: 'no offer on the table' }, 400);
 }

 if (!accept) {
  state.soundingOffer = 'declined';
  soundingOffers.delete(sessionId);
  serverEmit(deps.vaultRoot, 'elicitor', 'sounding-declined', `session=${sessionId}`);
  return c.json({ kind: 'declined' });
 }

 const stashed = soundingOffers.get(sessionId);
 if (!stashed) {
  // Unreachable by construction — the offer and its stash are one step —
  // but a missing stash must not enter a descent with no licensing answer.
  return c.json({ error: 'could not compose the first question — try again' }, 503);
 }
 soundingOffers.delete(sessionId);

 state.soundingOffer = 'entered';
 const now = new Date().toISOString();
 // Up to three drafts before the person sees a failure: a local model's
 // first-rung draft failing the emit gate is routine (measured: two
 // consecutive rejections before a clean rung on gemma4:e4b), and a person
 // who consented to a descent should not have to re-consent because the
 // drafter stuttered.
 let q: Awaited<ReturnType<typeof composeRung>> = null;
 for (let attempt = 0; attempt < 3 && !q; attempt++) {
  q = await composeRung(stashed.text, clerkComplete, makeRungGuard(state, 'Composed: rung rejected'));
 }
 if (!q) {
  // Composition failed thrice; the offer goes back on the table so the
  // person can decline it or accept again — the recorded choice for T8.
  state.soundingOffer = 'offered';
  soundingOffers.set(sessionId, stashed);
  return c.json({ error: 'could not compose the first question — try again' }, 503);
 }

 state.sounding = enterSounding({
  session: sessionId,
  construct: stashed.construct,
  licensingAnswer: stashed.text,
  mode: state.mode,
  questionCount: state.questionCount,
  at: now,
 });
 state.sounding.pendingQuestion = q;
 serverEmit(
  deps.vaultRoot,
  'elicitor',
  'sounding-entered',
  `session=${sessionId} sounding=${state.sounding.id} rungs=${state.sounding.allowance}`,
 );
 serverEmit(
  deps.vaultRoot,
  'elicitor',
  'sounding-rung',
  `sounding=${state.sounding.id} rung=0 of=${state.sounding.allowance}`,
 );
 return c.json({
  kind: 'probe',
  text: q.text,
  questionForm: 'deliberative',
  phase: state.phase,
  sounding: gateStateFor(state.sounding),
 });
 });

// POST /api/session/:id/sounding/gate {choice} → probe | descent-closed
// The gate is a control, not a turn: the body carries a choice word and
// nothing else, so a continued descent composes its next rung from the
// ladder — the answer to the rung the checkpoint interrupted — never from
// the request.
app.post('/api/session/:id/sounding/gate', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;

 let choice: unknown;
 try {
  choice = (await c.req.json<{ choice?: unknown }>()).choice;
 } catch {
  return c.json({ error: 'choice is required' }, 400);
 }
 if (!validateGateChoice(choice)) {
  return c.json({ error: `invalid choice "${String(choice)}" — expected "continue", "park" or "another-day"` }, 400);
 }
 if (!state.sounding) return c.json({ error: 'no descent running' }, 400);

 const { end } = applyGate(state.sounding, choice);
 const now = new Date().toISOString();
 const guard = makeRungGuard(state, 'Composed: rung rejected');

 if (choice === 'continue') {
  if (end) {
   // The counter or the echo check closed the descent while the gate was
   // being asked — same stamp, shared close and door as the park path.
   const finished: ParkedLadder = { ...state.sounding, ended: now, endedBy: end };
   state.finishedSounding = finished;
   delete state.sounding;
   finishDescent(state);
   closeTheDoor(state, now);
   return c.json({ kind: 'descent-closed', endedBy: end, soundingId: finished.id });
  }
  const next = await composeRung(state.sounding.rungs.at(-1)!.answer, clerkComplete, guard);
  if (!next) {
   return c.json({ error: 'could not compose the next rung — try again' }, 503);
  }
  state.sounding.pendingQuestion = next;
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'sounding-rung',
   `sounding=${state.sounding.id} rung=${state.sounding.rungs.length} of=${state.sounding.allowance}`,
  );
  return c.json({
   kind: 'probe',
   text: next.text,
   questionForm: 'deliberative',
   phase: state.phase,
   sounding: gateStateFor(state.sounding),
  });
 }

 // park | another-day: the choice is the end, whatever the counter says.
 const finished: ParkedLadder = { ...state.sounding, ended: now, endedBy: end! };
 state.finishedSounding = finished;
 delete state.sounding;
 serverEmit(
  deps.vaultRoot,
  'elicitor',
  'sounding-gate',
  `sounding=${finished.id} rung=${finished.rungs.length} choice=${choice}`,
 );
 if (choice === 'park') {
  const entry = parkPointer(deps.queue, finished);
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'sounding-parked',
   `sounding=${finished.id} rungs=${finished.rungs.length} entry=${entry.id}`,
  );
 }
 finishDescent(state);
 closeTheDoor(state, now);
 return c.json({ kind: 'descent-closed', endedBy: end!, soundingId: finished.id, phase: 'closing-door' });
 });

// POST /api/session/:id/sounding/resume {queueEntryId} → probe | 404 | 503
// Picking a parked descent back up (T12): the pointer names the ladder, the
// ladder is the truth, and the resumed question is composed FRESH at resume
// time (Q-45) — nothing pre-composed is ever read off disk. The allowance is
// recomputed from THIS sitting's remaining budget, never restored from the
// parked ladder (Q-47). A resume that cannot compose is a failed call, not a
// closed descent — the pointer stays live for another try (the plan's
// asymmetry note: do not unify with mid-descent convergence).
app.post('/api/session/:id/sounding/resume', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;

 const body = await c.req.json<{ queueEntryId?: unknown }>().catch(() => null);
 const queueEntryId = body?.queueEntryId;
 if (typeof queueEntryId !== 'string' || queueEntryId.trim() === '') {
  return c.json({ error: 'queueEntryId is required' }, 400);
 }

 const entry = deps.queue
  .list({ source: 'parked-sounding' })
  .find((e) => e.id === queueEntryId);
 if (!entry) return c.json({ error: 'no parked descent with that id' }, 404);

 const summary = loadLadderSummary(deps.vaultRoot, entry.soundingId ?? '');
 const resumed = resumeSounding(deps.vaultRoot, entry, state.mode, state.questionCount, summary);
 if (!resumed) {
  // A dead pointer is a 404, never a crash: the ladder file is gone but the
  // sitting is fine, so the person stays in it.
  return c.json({ error: 'this descent is no longer on disk' }, 404);
 }

 const guard = makeRungGuard(state, 'Composed: resumed rung rejected');
 const q = await composeFromCompacted(resumed.compacted, clerkComplete, guard);
 if (!q) {
  // A resume that cannot compose is a failed call, not a closed descent.
  return c.json({ error: 'could not compose the next question — try again' }, 503);
 }

 deps.queue.markAnswered(entry.id);
 state.sounding = { ...resumed.state, pendingQuestion: q };
 state.soundingOffer = 'entered';
 serverEmit(
  deps.vaultRoot,
  'elicitor',
  'sounding-resumed',
  `sounding=${resumed.state.id} rungs=${resumed.state.rungs.length} verbatim=${resumed.compacted.verbatim.length}`,
 );
 return c.json({
  kind: 'probe',
  text: q.text,
  questionForm: 'deliberative',
  phase: state.phase,
  sounding: gateStateFor(state.sounding),
 });
 });

// POST /api/session/:id/machine/resume {queueEntryId} → probe | door | 503 | 404
// Picking a parked machine back up (ticket 159, slice 5): the pointer names
// the side-record, the side-record is the truth, and the resumed question is
// composed FRESH at resume time (Q-45) with the machine turn seam — nothing
// pre-composed is ever read off disk. A corrupt or missing record is skipped
// with a log line and the machine restarts at phase 0 (the ladder register:
// a broken record never crashes a resume, never hides a valid record beside
// it). A resume that cannot compose is a failed call, not a closed machine —
// the pointer stays live for another try (the sounding asymmetry note).
app.post('/api/session/:id/machine/resume', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;

 const body = await c.req.json<{ queueEntryId?: unknown }>().catch(() => null);
 const queueEntryId = body?.queueEntryId;
 if (typeof queueEntryId !== 'string' || queueEntryId.trim() === '') {
  return c.json({ error: 'queueEntryId is required' }, 400);
 }

 const entry = deps.queue
  .list({ source: 'parked-machine' })
  .find((e) => e.id === queueEntryId);
 if (!entry) return c.json({ error: 'no parked machine with that id' }, 404);

 const recordId = entry.machineId ?? '';
 const parked = readMachineState(deps.vaultRoot, recordId);
 const def = getProtocol(parked?.protocol ?? entry.machineProtocol ?? state.protocol);
 if (def === undefined || def.phases === undefined) {
  // The record names an instrument the registry no longer carries — a dead
  // pointer is a 404, never a crash (the sounding precedent).
  return c.json({ error: 'this parked machine is no longer available' }, 404);
 }

 if (parked === null) {
  // Corrupt or missing record: skip it with a log and restart the machine
  // at phase 0 under the parked instrument — never a crash.
  console.warn(`Machine: parked machine record ${recordId} unreadable — restarting ${def.name} at phase 0`);
  state.protocolMachine = startMachine(def);
 } else {
  // The resumed sitting continues the exact phase: phaseIndex and the
  // per-phase exchange counts come straight off the record.
  state.protocolMachine = parked;
 }
 state.resumedMachineId = recordId;

 // Compose the resumed machine's next question fresh. A machine that cannot
 // compose is a failed call, not a closed machine — the pointer stays live
 // and the restored state is reverted for another try.
 const machine = await machineTurn(state, def);
 if (machine.kind === 'served') {
  deps.queue.markAnswered(entry.id);
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'machine-resumed',
   `session=${sessionId} phase=${state.protocolMachine.phaseIndex + 1} of=${def.phases.length}`,
  );
  const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
  return c.json({
   kind: 'probe',
   text: machine.probe.text,
   questionForm: machine.probe.questionForm,
   ...(phaseMeta !== undefined ? { phase: phaseMeta } : { phase: state.phase }),
  });
 }
 if (machine.kind === 'closed') {
  // The parked machine had already saturated when it parked: the resumed
  // sitting enters the closing door directly, exactly as a turn-side
  // [SATURATED] would.
  deps.queue.markAnswered(entry.id);
  serverEmit(
   deps.vaultRoot,
   'elicitor',
   'machine-resumed',
   `session=${sessionId} phase=${state.protocolMachine.phaseIndex + 1} of=${def.phases.length}`,
  );
  const at = new Date().toISOString();
  closeTheDoor(state, at);
  return c.json({ kind: 'door', text: CLOSING_DOOR_QUESTION, phase: state.phase });
 }
 // fallthrough — revert the restore and leave the pointer live.
 delete state.protocolMachine;
 delete state.resumedMachineId;
 return c.json({ error: 'could not compose the next question — try again' }, 503);
});

// POST /api/session/:id/repair — the repair verb (Q-104..Q-108)
// Accepts { snippetRef: string; quotedFragment: string }
// Writes repair record, expires citing queue entries, emits repair event,
// and returns a fresh non-callback question (Q-105).
app.post('/api/session/:id/repair', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;

 const body = await c.req.json<{ snippetRef?: unknown; quotedFragment?: unknown }>();
 if (!body.snippetRef || typeof body.snippetRef !== 'string') {
  return c.json({ error: 'snippetRef is required' }, 400);
 }
 if (!body.quotedFragment || typeof body.quotedFragment !== 'string') {
  return c.json({ error: 'quotedFragment is required' }, 400);
 }

 // Q-106: Write the repair side-record
 const repair: RepairRecord = {
  snippetRef: body.snippetRef,
  quotedFragment: body.quotedFragment,
  sitting: sessionId,
  at: new Date().toISOString(),
 };
 writeRepair(deps.vaultRoot, repair);

 // Q-106: Expire open queue entries citing the repaired snippet. A repair on
 // any version quarantines the whole snippet (consult.ts), so a cite of any
 // version expires the entry via the store's own markExpired primitive.
 const repairedIds = repairedSnippetIds(readAllRepairs(deps.vaultRoot));
 for (const status of ['pending', 'asked'] as const) {
  for (const entry of deps.queue.list({ status })) {
   const cites = entry.cites ?? [];
   if (cites.some((cite) => repairedIds.has(cite.split('@')[0]!))) {
    deps.queue.markExpired(entry.id);
   }
  }
 }

 // Q-108: Emit the one activity-stream event
 serverEmit(deps.vaultRoot, 'elicitor', 'repair', `snippet=${body.snippetRef}`);

 // Q-105: The fixed mechanical template turn — acknowledgments, no re-quote,
 // fresh question. Never carries the fragment (Q-105: never re-quoted).
 const repairText = `I see — that fragment was not yours. I have unlinked it and it will not appear in future questions.`;
 const repairTurn: Turn = {
  role: 'agent',
  text: repairText,
  at: new Date().toISOString(),
  questionProvenance: 'repair',
  questionForm: 'deliberative',
  repairId: sessionId,
 };
 state.turns.push(repairTurn);
 deps.vault.appendTurn(sessionId, repairTurn);

 // Q-107: The correction turn is excluded from harvest — mark the last user
 // turn (the correction) with the repair id.
 const lastUserTurn = [...state.turns].reverse().find(t => t.role === 'user');
 if (lastUserTurn) {
  lastUserTurn.repairId = sessionId;
 }

 // Q-105: Fresh non-callback question from bank/queue (never a callback).
 // Serve a bank question that is NOT a queue callback.
 const bank = state.bank ?? [];
 const usedTexts = new Set(state.turns.filter(t => t.role === 'agent').map(t => t.text));
 const available = bank.filter(st => !usedTexts.has(st.text));
 let nextQuestion: string;
 let nextForm: QuestionForm;
 if (available.length > 0) {
  const pick = available[Math.floor(Math.random() * available.length)]!;
  nextQuestion = pick.text;
  nextForm = pick.questionForm;
 } else {
  // Fall back to queue draw
  const draw = deps.queue.draw(state.mode);
  if (draw) {
   nextQuestion = draw.question;
   nextForm = draw.questionForm;
   deps.queue.markAsked(draw.id);
   state.openQueueEntryId = draw.id;
  } else {
   nextQuestion = 'What would you like to talk about?';
   nextForm = 'deliberative';
  }
 }

 const nextTurn: Turn = {
  role: 'agent',
  text: nextQuestion,
  at: new Date().toISOString(),
  questionForm: nextForm,
  questionProvenance: 'bank',
 };
 state.turns.push(nextTurn);
 deps.vault.appendTurn(sessionId, nextTurn);
 state.questionCount++;

 return c.json({
  kind: 'probe',
  text: nextQuestion,
  questionForm: nextForm,
 });
});

// ── DRM (Day Reconstruction Method) routes ──
// Q-85: user-declared entry only, fixed probes, gate always visible,
// fragments through ordinary harvest review. Follows the Sounding endpoint
// pattern for auth, session lookup, response shape, and park/resume.
//
// Ticket 159, slice 6: the drm flow's state lives in the phase machine —
// MachineState.ui holds the DrmUi (episodes, probe position, fragments,
// the yesterday anchor) and the machine's phaseIndex IS the drm phase
// (enumerate → probe → gate). The routes drive the machine with the pure
// transitions from src/drm/state.ts and write the result back; no drm
// state lives in a bespoke SessionState field anymore. The wire shapes are
// unchanged field-for-field; the responses additionally carry `machinePhase`
// — the machine phase meta (with the phase's renderer when it declares one,
// ticket 159 slice 6) — so the DRM screen can dispatch on the renderer.

/** The live drm machine + its ui, or null when no drm is running. */
function drmMachineOf(state: SessionState): { machine: MachineState; ui: DrmUi } | null {
 const machine = state.protocolMachine;
 if (machine === undefined || machine.protocol !== 'drm') return null;
 if (machine.ui === undefined) return null;
 return { machine, ui: drmUiOf(machine) };
}

/**
 * The machine's ui bucket (typed `Record<string, unknown>` by the machine
 * contract) interpreted as the drm ui. The bucket boundary is the only
 * cast: inside the drm layer everything is DrmUi-typed.
 */
function drmUiOf(machine: MachineState): DrmUi {
 return machine.ui as unknown as DrmUi;
}

/** Write a new drm ui back into the machine's ui bucket. */
function withDrmUi(machine: MachineState, ui: DrmUi): MachineState {
 return { ...machine, ui: ui as unknown as Record<string, unknown> };
}

/** A legacy (pre-slice-6) DRMState as a drm machine at the probe phase. */
function machineFromDrmState(drm: DRMState): MachineState {
 const ui: DrmUi = {
  yesterday: drm.yesterday,
  episodes: drm.episodes,
  currentEpisodeIdx: drm.currentEpisodeIdx,
  probeStep: drm.probeStep,
  fragments: drm.fragments,
 };
 return {
  protocol: 'drm',
  // The three drm phases (enumerate → probe → gate); a legacy record that
  // had already probed every episode completes at the gate.
  phaseIndex: drm.phase === 'complete' ? 2 : 1,
  exchanges: [0, 0, 0],
  startedAt: drm.started,
  ui: ui as unknown as Record<string, unknown>,
 };
}

// POST /api/session/:id/drm/start — begin a DRM session
// The machine starts at the enumerate phase (index 0) with a fresh ui; the
// 'begin' word on the screen is the client-side intro, the machine is
// already at the day-map.
app.post('/api/session/:id/drm/start', (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;
 const blocked = drmStartedOf(c, state);
 if (blocked) return blocked;

 const def = getProtocol('drm');
 if (def === undefined) return c.json({ error: 'DRM is not a known protocol' }, 500);
 const machine = withDrmUi(startMachine(def), initDRM());
 state.protocolMachine = machine;

 serverEmit(deps.vaultRoot, 'elicitor', 'drm-started', `episodes=0`);

 const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
 return c.json({
  kind: 'drm-enumerate',
  yesterday: drmUiOf(machine).yesterday,
  phase: state.phase,
  ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
 });
});

// POST /api/session/:id/drm/episode {name, startHour} — add an episode
app.post('/api/session/:id/drm/episode', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;
 const running = drmRunningOf(c, state);
 if (running instanceof Response) return running;
 if (running.machine.phaseIndex !== 0) return c.json({ error: 'Not enumerating' }, 400);

 const body = await c.req.json<{ name: string; startHour: number }>();
 if (typeof body.name !== 'string' || body.name.trim() === '') {
  return c.json({ error: 'name is required' }, 400);
 }
 if (typeof body.startHour !== 'number' || body.startHour < 0 || body.startHour > 23) {
  return c.json({ error: 'startHour must be 0–23' }, 400);
 }

 const nextUi = addEpisode(running.ui, body.name.trim(), body.startHour);
 state.protocolMachine = withDrmUi(running.machine, nextUi);

 serverEmit(deps.vaultRoot, 'elicitor', 'drm-episode-added',
  `count=${nextUi.episodes.length} name=${body.name.trim()}`);

 const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
 return c.json({
  kind: 'drm-episode-added',
  count: nextUi.episodes.length,
  ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
 });
});

// POST /api/session/:id/drm/enumerate-done — finish enumeration
// The enumerate phase is a UI phase: its advance (enumerate → probe) is the
// route's act, and the side-record follows the advance (the slice-5
// durability register — a crash never loses a phase already walked).
app.post('/api/session/:id/drm/enumerate-done', (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;
 const running = drmRunningOf(c, state);
 if (running instanceof Response) return running;
 if (running.machine.phaseIndex !== 0) return c.json({ error: 'Not enumerating' }, 400);

 let nextUi: DrmUi;
 try {
  nextUi = doneEnumerating(running.ui);
 } catch (e) {
  return c.json({ error: String(e) }, 400);
 }
 const nextMachine: MachineState = { ...withDrmUi(running.machine, nextUi), phaseIndex: 1 };
 state.protocolMachine = nextMachine;
 writeMachineState(deps.vaultRoot, sessionId, nextMachine);

 serverEmit(deps.vaultRoot, 'elicitor', 'drm-enumeration-finished',
  `episodes=${nextUi.episodes.length}`);

const question = probeQuestion(nextUi);
const cleanText = transcriptQuestion(nextUi);
const now = new Date().toISOString();
const agentTurn: Turn = { role: 'agent', text: cleanText, at: now };
deps.vault.appendTurn(sessionId, agentTurn);
state.turns.push(agentTurn);

 const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
 return c.json({
  kind: 'drm-probe',
  text: question,
  episode: nextUi.currentEpisodeIdx + 1,
  of: nextUi.episodes.length,
  step: nextUi.probeStep,
  gate: gateReading(nextUi),
  ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
 });
});

// POST /api/session/:id/drm/probe {text} — answer current probe
app.post('/api/session/:id/drm/probe', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;
 const running = drmRunningOf(c, state);
 if (running instanceof Response) return running;
 if (running.machine.phaseIndex !== 1) return c.json({ error: 'Not in probe phase' }, 400);

 const body = await c.req.json<{ text: string }>();
 if (typeof body.text !== 'string' || body.text.trim() === '') {
  return c.json({ error: 'text is required' }, 400);
 }

const now = new Date().toISOString();
// Write the user's answer as a turn — transcript AND in-memory (ticket 147)
const userTurn: Turn = { role: 'user', text: body.text, at: now };
deps.vault.appendTurn(sessionId, userTurn);
state.turns.push(userTurn);

const probeResult = answerProbe(running.ui, body.text);
// Push the fragment into the new ui BEFORE assigning (ticket 147)
const nextUi = probeResult.ui;
if (probeResult.fragment) {
  nextUi.fragments.push(probeResult.fragment);
}
state.protocolMachine = withDrmUi(running.machine, nextUi);

 serverEmit(deps.vaultRoot, 'elicitor', 'drm-probe-answered',
  `step=${nextUi.probeStep}`);

 const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);

 if (probeResult.atGate) {
  // All probes done for this episode — show gate
  return c.json({
   kind: 'drm-gate',
   episode: nextUi.currentEpisodeIdx + 1,
   of: nextUi.episodes.length,
   atEnd: probeResult.atEnd,
   gate: gateReading(nextUi),
   ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
  });
 }

// More probes — ask the next one
const question = probeQuestion(nextUi);
const cleanText = transcriptQuestion(nextUi);
const agentTurn: Turn = { role: 'agent', text: cleanText, at: now };
deps.vault.appendTurn(sessionId, agentTurn);
state.turns.push(agentTurn);

 return c.json({
  kind: 'drm-probe',
  text: question,
  episode: nextUi.currentEpisodeIdx + 1,
  of: nextUi.episodes.length,
  step: nextUi.probeStep,
  gate: gateReading(nextUi),
  ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
 });
});

// POST /api/session/:id/drm/gate {choice} — continue/park/another-day
// Park persists the MACHINE (slice 6): the side-record carries the DrmUi
// with the next un-probed episode as the resume point, and the pointer is
// a 'parked-machine' entry (machineId + machineProtocol). The finished-DRM
// stamp stays on the session for the record of how the walk ended.
app.post('/api/session/:id/drm/gate', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;
 const running = drmRunningOf(c, state);
 if (running instanceof Response) return running;
 if (running.machine.phaseIndex !== 1) return c.json({ error: 'Not at a gate' }, 400);

 const body = await c.req.json<{ choice: 'continue' | 'park' | 'another-day' }>();
 if (!['continue', 'park', 'another-day'].includes(body.choice)) {
  return c.json({ error: 'choice must be continue, park, or another-day' }, 400);
 }

 const result = applyDRMGate(running.ui, body.choice);

 if (body.choice === 'park' && result.parked) {
  const parkedMachine: MachineState = withDrmUi(running.machine, result.parked);
  state.protocolMachine = parkedMachine;
  state.machineParked = true;
  // The resumed sitting that parks again supersedes the record it resumed:
  // one live record per parked machine, never two.
  if (state.resumedMachineId) {
   removeMachineState(deps.vaultRoot, state.resumedMachineId);
   delete state.resumedMachineId;
  }
  writeMachineState(deps.vaultRoot, sessionId, parkedMachine);
  const def = getProtocol(parkedMachine.protocol);
  const phases = def?.phases;
  if (phases !== undefined && phases.length > 0) {
   parkMachinePointer(deps.queue, parkedMachine, sessionId, phases);
  }

  serverEmit(deps.vaultRoot, 'elicitor', 'drm-parked',
   `episode=${result.parked.currentEpisodeIdx}`);

  const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
  return c.json({
   kind: 'drm-closed',
   endedBy: 'park',
   phase: state.phase,
   ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
  });
 }

 if (body.choice === 'another-day') {
  // Abandon, keep fragments — they live in the transcript, which the
  // harvest reads. The machine is gone with the drm; the side-record (if
  // any) is removed by the end flow (machineParked is false).
  delete state.protocolMachine;

  return c.json({
   kind: 'drm-closed',
   endedBy: 'another-day',
   phase: state.phase,
  });
 }

 // Continue: advance to next episode
 if (result.complete) {
  delete state.protocolMachine;

  serverEmit(deps.vaultRoot, 'elicitor', 'drm-completed',
   `fragments=${drmUiOf(running.machine).fragments.length}`);

  return c.json({
   kind: 'drm-closed',
   endedBy: 'complete',
   phase: state.phase,
  });
 }

 state.protocolMachine = withDrmUi(running.machine, result.ui);

// Next episode — ask first probe
const question = probeQuestion(result.ui);
const cleanText = transcriptQuestion(result.ui);
const now = new Date().toISOString();
const agentTurn: Turn = { role: 'agent', text: cleanText, at: now };
deps.vault.appendTurn(sessionId, agentTurn);
state.turns.push(agentTurn);

 const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
 return c.json({
  kind: 'drm-probe',
  text: question,
  episode: result.ui.currentEpisodeIdx + 1,
  of: result.ui.episodes.length,
  step: result.ui.probeStep,
  gate: gateReading(result.ui),
  ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
 });
});

// POST /api/session/:id/drm/resume {queueEntryId} — resume a parked DRM
// Slice 6: drm parks mint 'parked-machine' pointers (the machine side-record
// is the truth, the pointer only points). LEGACY 'parked-drm' pointers keep
// working through a compat read — a pre-slice-6 park reads its old
// {root}/drm/<id>.md record and is rebuilt as a machine at the probe phase,
// so a person who parked before the migration still picks the walk back up.
app.post('/api/session/:id/drm/resume', async (c) => {
 const sessionId = c.req.param('id');
 const state = sessionOf(c, sessionId);
 if (state instanceof Response) return state;
 const blocked = drmStartedOf(c, state);
 if (blocked) return blocked;

 const body = await c.req.json<{ queueEntryId: string }>();
 const queueEntryId = body.queueEntryId;
 if (typeof queueEntryId !== 'string' || queueEntryId.trim() === '') {
  return c.json({ error: 'queueEntryId is required' }, 400);
 }

 const entry = deps.queue
  .list({ source: 'parked-machine' })
  .find((e) => e.id === queueEntryId)
  ?? deps.queue
   .list({ source: 'parked-drm' })
   .find((e) => e.id === queueEntryId);
 if (!entry) return c.json({ error: 'no parked DRM with that id' }, 404);

 let machine: MachineState;
 if (entry.source === 'parked-machine') {
  const record = readMachineState(deps.vaultRoot, entry.machineId ?? '');
  if (record === null || record.protocol !== 'drm') {
   return c.json({ error: 'this DRM is no longer on disk' }, 404);
  }
  machine = record;
 } else {
  const parked = readDRM(deps.vaultRoot, entry.drmId ?? '');
  if (parked === null) {
   return c.json({ error: 'this DRM is no longer on disk' }, 404);
  }
  machine = machineFromDrmState(resumeDRM(parked, sessionId));
 }

 const ui = drmUiOf(machine);
 // A record parked mid-enumeration (the everyday gate can park a drm
 // sitting while the day-map is still open): the day was mapped as far as
 // it went — advance to the probes exactly as enumerate-done would. An
 // empty day has nothing to probe and closes below like any walked-out
 // record.
 if (machine.phaseIndex === 0) {
  machine = { ...machine, phaseIndex: ui.episodes.length === 0 ? 2 : 1 };
 }

 state.protocolMachine = machine;
 // The resumed sitting owns the record now: an end without a re-park
 // consumes it (the slice-5 register).
 if (entry.source === 'parked-machine') {
  state.resumedMachineId = entry.machineId ?? sessionId;
 }

 // Mark the pointer answered
 deps.queue.markAnswered(entry.id);

 serverEmit(deps.vaultRoot, 'elicitor', 'drm-resumed',
  `episodes=${ui.episodes.length} at=${ui.currentEpisodeIdx}`);

 if (machine.phaseIndex === 2 || ui.currentEpisodeIdx >= ui.episodes.length) {
  // Parked after the last episode — nothing left to probe: close it.
  delete state.protocolMachine;
  return c.json({
   kind: 'drm-closed',
   endedBy: 'complete',
   phase: state.phase,
  });
 }

const question = probeQuestion(ui);
const cleanText = transcriptQuestion(ui);
const now = new Date().toISOString();
const agentTurn: Turn = { role: 'agent', text: cleanText, at: now };
deps.vault.appendTurn(sessionId, agentTurn);
state.turns.push(agentTurn);

 const phaseMeta = machinePhaseMeta(state.protocolMachine, state.deps.peopleSource);
 return c.json({
  kind: 'drm-probe',
  text: question,
  episode: ui.currentEpisodeIdx + 1,
  of: ui.episodes.length,
  step: ui.probeStep,
  gate: gateReading(ui),
  ...(phaseMeta !== undefined ? { machinePhase: phaseMeta } : {}),
 });
});


 /**
  * The end flow shared by POST /end and the gate route's 'another-day'
  * (ticket 159, slice 4): close an abandoned sitting, recover the open queue
  * entry, and harvest behind the response — the review queue is the
  * destination. The caller has already 404'd on a missing session.
  */
 function endSessionHarvest(state: SessionState, sessionId: string): { status: string; sessionId: string } {
  // A second end no-ops (ghost-harvest ticket): the sitting already ended —
  // no re-harvest, no re-write of machine records, no second harvest-started.
  if (state.endedAt) return { status: 'already-ended', sessionId };
  // Close abandoned sittings (ticket 135): if the last turn is an agent
  // question, write a ## closing section so no transcript ends unanswered.
  const turns = state.turns;
  if (turns.length > 0 && turns[turns.length - 1]!.role === 'agent') {
   appendClosing(deps.vaultRoot, sessionId, CLOSING_ACKNOWLEDGMENT);
  }

  // The machine side-record (ticket 159, slice 5): a sitting that ends has
  // no parked machine awaiting resume — UNLESS it parked, the act that made
  // the record and the whole of 'depth kept'. A resumed sitting's record is
  // always consumed by the end; a fresh sitting's own record (written by the
  // phase advances) is removed too unless the park act preserved it. Runs
  // before the empty-sitting guard so an empty sitting cleans up the same.
  if (state.machineParked !== true) {
   removeMachineState(deps.vaultRoot, sessionId);
  }
  if (state.resumedMachineId) {
   removeMachineState(deps.vaultRoot, state.resumedMachineId);
  }

  // asked→pending recovery: return queue entry if sitting ends unanswered (ticket 145)
  if (state.openQueueEntryId) {
   deps.queue.markPending(state.openQueueEntryId);
  }

  const turnChannels = state.turnChannels ? [...state.turnChannels] : undefined;

  // Empty sitting guard: zero user turns leaves no trace (ticket 145)
  const userTurns = turns.filter(t => t.role === 'user');
  if (userTurns.length === 0) {
   sessions.delete(sessionId);
   return { status: 'empty', sessionId };
  }
  // The end timestamp: the today door hides ended sittings and a second
  // /end no-ops. Cleared when a turn lands — the sitting resumed.
  state.endedAt = new Date().toISOString();
  startBackgroundHarvest(ctx, {
   sessionId,
   turns,
   protocol: state.protocol,
   started: sessionStartedAt(deps.vaultRoot, sessionId),
   origin: 'harvest',
   ...(turnChannels !== undefined ? { turnChannels } : {}),
  });
  return { status: 'harvesting', sessionId };
 }

 // POST /api/session/:id/end → harvesting (ticket 084)
 // The harvest runs behind this response; the finished proposals land in the
 // pending queue for the review surface.
 app.post('/api/session/:id/end', (c) => {
  const sessionId = c.req.param('id');
  const state = sessionOf(c, sessionId);
  if (state instanceof Response) return state;
  return c.json(endSessionHarvest(state, sessionId));
 });

 // POST /api/session/:id/gate {choice: 'continue'|'park'|'another-day'} (ticket 159, slice 4)
 // The everyday sitting's gate: the standard control surface on every
 // sitting. 'continue' is a no-op — the person just answers, the next turn
 // is the continuation. 'park' enters the closing-door flow, following the
 // Sounding precedent: the machine side-record is slice 5, TODAY the sitting
 // proceeds to the close and harvests at /end. 'another-day' is the
 // harvest-now wire (the old action-row button) — end and harvest behind the
 // response. While a descent runs, the sounding gate is the surface; this
 // route refuses, so the two can never disagree about who closes what.
 app.post('/api/session/:id/gate', async (c) => {
  const sessionId = c.req.param('id');
  const state = sessionOf(c, sessionId);
  if (state instanceof Response) return state;

  let choice: unknown;
  try {
   choice = (await c.req.json<{ choice?: unknown }>()).choice;
  } catch {
   return c.json({ error: 'choice is required' }, 400);
  }
  if (!validateGateChoice(choice)) {
   return c.json({ error: `invalid choice "${String(choice)}" — expected "continue", "park" or "another-day"` }, 400);
  }
  if (state.sounding) {
   return c.json({ error: 'a descent is running — use /api/session/:id/sounding/gate' }, 400);
  }

  if (choice === 'continue') {
   // A no-op: the person just answers. The response carries the session
   // phase so the surface has a heartbeat.
   return c.json({ kind: 'continue', phase: state.phase });
  }

  if (choice === 'another-day') {
   return c.json(endSessionHarvest(state, sessionId));
  }

  // park — depth kept: the machine parks first (the side-record, ticket
  // 159, slice 5), then the sitting proceeds to the closing door (the
  // Sounding precedent); harvest happens at /end. Already closing, a second
  // park stays in the close without re-asking the door or re-parking. A
  // missing machine state parks nothing (defensive — every sitting is a
  // machine sitting today, but the record write is the machine's act).
  if (state.phase === 'closing-door') {
   return c.json({ kind: 'door', text: CLOSING_DOOR_QUESTION, phase: state.phase });
  }
  const now = new Date().toISOString();
  if (state.protocolMachine) {
   // The side-record: written on park AND on every ratified advance, so
   // the park write is the durable checkpoint of the exact park-time state.
   writeMachineState(deps.vaultRoot, sessionId, state.protocolMachine);
   state.machineParked = true;
   // The resumed sitting that parks again supersedes the record it resumed:
   // one live record per parked machine, never two.
   if (state.resumedMachineId) {
    removeMachineState(deps.vaultRoot, state.resumedMachineId);
    delete state.resumedMachineId;
   }
   const def = getProtocol(state.protocolMachine.protocol);
   const phases = def?.phases;
   if (phases !== undefined && phases.length > 0) {
    parkMachinePointer(deps.queue, state.protocolMachine, sessionId, phases);
    serverEmit(
     deps.vaultRoot,
     'elicitor',
     'machine-parked',
     `session=${sessionId} phase=${state.protocolMachine.phaseIndex + 1} of=${phases.length}`,
    );
   }
  }
  closeTheDoor(state, now);
  return c.json({ kind: 'door', text: CLOSING_DOOR_QUESTION, phase: state.phase });
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

  // Validate decisions (ticket 024) — the shared guard (Wave C3 F3)
  const invalid = validateDecisions(HARVEST_ACTIONS, body.decisions, {
   indexField: 'proposal',
   count: proposals.length,
   checkChannel: true,
  });
  if (invalid) return c.json(invalid, 400);

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

  // §12.1: the receipt shows the dedupe sentence only for passages the
  // person actually kept. The flags ride the record (read before it is
  // removed below); each kept snippet is stamped with the flag of the
  // proposal it came from, mirroring decide()'s own keep rules (approve
  // always saves; trim/restate save only when they carry text), so the
  // receipt needs no index arithmetic.
  const repeatByProposal = new Map((record?.repeats ?? []).map((r) => [r.proposal, r]));
  // One flag per KEPT decision, in decide()'s own order: approve always
  // keeps; trim/restate keep only when they carry text; discard keeps
  // nothing. The i-th kept decision is the i-th snippet, so the zips
  // align — a discard between two keeps must not shift the flag.
  const keptFlags: (RepeatsFlag | undefined)[] = [];
  for (const d of body.decisions) {
   const keeps = d.action === 'approve' || ((d.action === 'trim' || d.action === 'restate') && d.text !== undefined);
   if (keeps) keptFlags.push(repeatByProposal.get(d.proposal));
  }
  const snippets = result.snippets.map((s, i) => {
   const flag = keptFlags[i];
   return flag !== undefined
    ? { ...s, repeats: { olderSnippetId: flag.olderSnippetId, olderCaptured: flag.olderCaptured } }
    : s;
  });

  // The snippets are on disk, so the answer is ready. The docket that
  // reindexes them and mints their openers runs behind this response.
  startDocket('harvest');

  // §5.3 auto-gather (redesign-2026-08-09): after each harvest, ONE model
  // call per OPEN composition asks whether any of this sitting's kept
  // passages belong — judged against the subject line and the existing
  // material, claim-free (§5, Q-37 amended). Fire-and-forget, never on the
  // response path; it only writes Offers (Q-39 — nothing is placed without
  // the person's touch), and a denied passage is never offered again. The
  // store instance is a file facade over the same pieces/ the boot owns, so
  // a second instance sees every write the piece routes make (Q-3).
  if (result.snippets.length > 0) {
   const pieces = createPieceStore(deps.vaultRoot, {
    snippets: () => deps.vault.rebuildIndex().snippets,
   });
   void autoGatherSitting({
    pieces,
    snippets: () => deps.vault.rebuildIndex().snippets,
    passages: result.snippets,
    complete: clerkComplete,
    log: (e) => serverEmit(deps.vaultRoot, e.actor, e.kind, e.detail),
    sourceSitting: sessionId,
   }).catch((err: unknown) => {
    serverEmit(deps.vaultRoot, 'clerk', 'auto-gather-failed', `session=${sessionId}: ${String(err)}`);
   });
  }

  // A decided harvest leaves the queue; the map entry goes with it so a
  // later decide cannot double-claim the same material.
  if (record) removePendingHarvest(deps.vaultRoot, sessionId);
  sessionProposals.delete(sessionId);

  return c.json({ snippets, buds: result.buds, repeats: result.snippets.map((s, i) => keptFlags[i]).filter((f): f is RepeatsFlag => f !== undefined) });
 });
}
