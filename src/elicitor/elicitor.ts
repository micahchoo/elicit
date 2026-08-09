import { ulid } from 'ulid';
import type {
 Complete,
 Facet,
 Mode,
 QuestionForm,
 QuestionProvenance,
 QuestionSource,
 ParkedLadder,
 SessionState,
 SoundingEnd,
 Target,
 Turn,
 Prosody,
 Vault,
 QueueEntry,
 QueueStore,
 LexicalIndex,
} from '../types.js';
import {
 defaultQuestionForm,
 CLOSING_DOOR_QUESTION,
 CLOSING_ACKNOWLEDGMENT,
 type StarterQuestion,
} from './protocol.js';
import {
 getProtocol,
 DEFAULT_FLOOR_PROBE,
 type ProtocolDef,
} from '../protocols/registry.js';
import {
 advanceMachine,
 composeMachineSystemPrompt,
 machineQuestion,
 parseMachineMarker,
 recordExchange,
 startMachine,
 type MachineState,
 type TriadSelection,
} from '../protocols/machine.js';
import { writeMachineState } from '../protocols/park.js';
import { guardComposed } from '../language/emit-form.js';
import { appendEvent } from '../log/activity.js';
import { readAllRepairs } from '../repair/store.js';
import { repairedSnippetIds } from '../repair/consult.js';
import { loadQuestionBank } from './bank.js';
import { quotablePhrase, resonateHybrid, type SemanticIndex } from '../index/semantic.js';
import { isContentFree } from '../language/thin-answer.js';
import { isWeakForm } from '../language/weak-form.js';
import { composeJuxtaposition } from '../clerk/composed.js';
import { composeRung } from '../clerk/sounding-rung.js';
import { addRung, gateStateFor } from '../sounding/ladder.js';
import { descentEnd } from '../sounding/convergence.js';
import { SESSION_BUDGET } from '../sounding/budget.js';
import { checkQuestion, type GuardVerdict } from '../language/guards.js';
import type { RandomizerDraw } from '../randomizer/randomizer.js';

/**
 * The vault root per live session, keyed by session id. `startSession` records
 * it when the caller supplies it; the guard-floor path reads it back so the
 * elicitor can write its own activity events without holding the root on the
 * session (which lives in src/types.ts and is shared). Sessions are short-lived;
 * the map never clears, exactly like the server's own session table.
 */
const sessionVaultRoots = new Map<string, string>();

/**
 * One shared bank draw (ticket 021). Applies the weak-form filter to every
 * bank pool; if the filter empties the pool, fall through to the unfiltered
 * bank — a weak question beats no question. The opener and the drawFallback
 * path both route through here, so the filter has exactly one home.
 */
function bankDraw(
 bank: StarterQuestion[],
): { text: string; questionForm: QuestionForm; source?: QuestionSource } {
 const filtered = bank.filter((q) => !isWeakForm(q.text));
 const pool = filtered.length > 0 ? filtered : bank;
 const pick = pool[Math.floor(Math.random() * pool.length)]!;
 return {
  text: pick.text,
  questionForm: pick.questionForm,
  ...(pick.source ? { source: pick.source } : {}),
 };
}

/** Picks an opener from the question bank or forms one from mode.topic. */
function pickOpener(
 bank: StarterQuestion[],
 topic?: string,
): { text: string; questionForm: QuestionForm; source?: QuestionSource } {
 if (topic) {
  return {
   text: `You mentioned ${topic}. What would you like to explore about that?`,
   questionForm: 'deliberative',
  };
 }
 return bankDraw(bank);
}

/** A resolved opener: one of the three sources, in cascade order. */
type ResolvedOpener =
 | { kind: 'random'; draw: RandomizerDraw }
 | { kind: 'queue'; draw: QueueEntry }
 | { kind: 'bank'; opener: { text: string; questionForm: QuestionForm; source?: QuestionSource } };

/**
 * The one opener cascade: requested shuffle first, then a queue draw (only
 * when the shuffle drew nothing), then a system randomizer offer (only when
 * both drew nothing), then the bank. The pre-cascade sites ordered it this
 * way; this is their single home so every opener path falls the same.
 */
function resolveOpener(
 deps: {
  shuffleRequested?: boolean;
  randomizer?: (invokedBy: 'user' | 'system') => RandomizerDraw | null;
  queue: QueueStore;
 },
 mode: Mode,
 bank: StarterQuestion[],
): ResolvedOpener {
 const shuffled = deps.shuffleRequested ? (deps.randomizer?.('user') ?? null) : null;
 const queueDraw = shuffled ? null : deps.queue.draw(mode);
 const offered = shuffled || queueDraw ? null : (deps.randomizer?.('system') ?? null);
 const randomDraw = shuffled ?? offered;
 if (randomDraw) return { kind: 'random', draw: randomDraw };
 if (queueDraw) return { kind: 'queue', draw: queueDraw };
 return { kind: 'bank', opener: pickOpener(bank, mode.topic) };
}

/**
 * The one resolved-opener → turn mapping: held as pendingOpener (greeting) or
 * appended as the opening turn (pre-135), the random/queue/bank mapping with
 * the deck questionSource and queue gap branches has a single home. Returns
 * the full agent turn plus the queue entry id.
 */
function turnFromResolved(
 resolved: ResolvedOpener,
 started: string,
): { turn: Turn & { questionForm: QuestionForm }; openQueueEntryId?: string } {
 let openQueueEntryId: string | undefined;
 let turn: Turn & { questionForm: QuestionForm };
 if (resolved.kind === 'random') {
  const draw = resolved.draw;
  turn = {
   role: 'agent',
   text: draw.question,
   at: started,
   questionForm: draw.questionForm,
   ...(draw.draw.kind === 'deck'
    ? { questionSource: { channel: draw.draw.channel, blockId: draw.draw.blockId } }
    : {}),
  };
 } else if (resolved.kind === 'queue') {
  openQueueEntryId = resolved.draw.id;
  turn = {
   role: 'agent',
   text: resolved.draw.question,
   at: started,
   questionForm: resolved.draw.questionForm,
   ...(resolved.draw.gap ? { gap: resolved.draw.gap } : {}),
  };
 } else {
  turn = {
   role: 'agent',
   text: resolved.opener.text,
   at: started,
   questionForm: resolved.opener.questionForm,
   ...(resolved.opener.source ? { questionSource: resolved.opener.source } : {}),
  };
 }
 return { turn, ...(openQueueEntryId ? { openQueueEntryId } : {}) };
}

export function startSession(
 mode: Mode,
 deps: {
  complete: Complete;
  vault: Vault;
  queue: QueueStore;
  index: LexicalIndex;
  semantic?: SemanticIndex;
  bank?: StarterQuestion[];
  protocolName?: string;
  defaultTarget?: Target;
  randomizer?: (invokedBy: 'user' | 'system') => RandomizerDraw | null;
  shuffleRequested?: boolean;
  vaultRoot?: string;
  /**
   * People-source thunk for the phase machine (ticket 159, slice 3): the
   * gazetteer's named people. people-grid degrades to reflective when it
   * names fewer than three; the machine's triad phase annotates its
   * composed prompt with the names. Absent means no people index.
   */
  peopleSource?: () => string[];
  /**
   * The greeting line shown before the opener (ticket 135). When provided,
   * startSession writes it as the first turn and holds the opener in
   * pendingOpener. Absent means the opener fires first — the pre-135
   * call path, which the server can use for tests.
   */
  greetingText?: string;
 },
): SessionState {
 const id = ulid();
 const started = new Date().toISOString();
 const target: Target = mode.target ?? deps.defaultTarget ?? 'self';
 // Minutes and energy are no longer declarations (canon §5.2): the
 // normalized mode carries only target and a spoken topic — stale
 // minutes/energy in a body never reach the transcript frontmatter.
 const normalizedMode: Mode = {
  target,
  ...(mode.topic !== undefined ? { topic: mode.topic } : {}),
 };
 const bank = deps.bank ?? loadQuestionBank();

 // Rotation cut (ruling 2026-08-09): the sitting runs reflective by default;
 // a machine supplies its own protocol through deps.protocolName.
 const protocol = deps.protocolName ?? 'reflective';

 // ── Machine start (ticket 159, slice 3) ──
 // A def that declares phases starts a phase machine for the sitting.
 // people-grid needs three named people from the gazetteer to present its
 // triads; fewer degrades the whole sitting to reflective — the ladder's
 // register: drop the instrument, never the person's words.
 let protocolMachine: MachineState | undefined;
 let effectiveProtocol = protocol;
 const chosenDef = getProtocol(protocol);
 if (chosenDef?.phases !== undefined) {
  const people = deps.peopleSource?.() ?? [];
  if (chosenDef.name === 'people-grid' && people.length < 3) {
   console.warn(`Elicitor: people-grid needs three named people (found ${people.length}) — degrading to reflective`);
   effectiveProtocol = 'reflective';
   // The degraded sitting RUNS reflective, which is itself a machine
   // instance (ticket 159, slice 4): start its machine so the sitting
   // carries the phase meta and the gate surface like any other.
   const reflectiveDef = getProtocol('reflective');
   if (reflectiveDef !== undefined) protocolMachine = startMachine(reflectiveDef);
  } else {
   protocolMachine = startMachine(chosenDef);
  }
 }

 // ── Greeting (ticket 135): one framing turn before the opener ──
 // When a greeting is wanted, it becomes the sole initial turn. The opener
 // is deferred to pendingOpener; the pulse route appends it after the
 // greeting answer. Without a greeting, the opener fires first (pre-135).
 const hasGreeting = deps.greetingText !== undefined;
 if (hasGreeting) {
  const greetingTurn: Turn = {
   role: 'agent',
   text: deps.greetingText!,
   at: started,
   questionProvenance: 'greeting',
  };
  deps.vault.startTranscript(id, {
   mode: normalizedMode,
   protocol: effectiveProtocol,
   started,
  });
  deps.vault.appendTurn(id, greetingTurn);
  if (deps.vaultRoot) sessionVaultRoots.set(id, deps.vaultRoot);

  // Determine the opener but do NOT write it yet.
  const resolved = resolveOpener(deps, normalizedMode, bank);
  const { turn, openQueueEntryId } = turnFromResolved(resolved, started);
  const pendingOpener: SessionState['pendingOpener'] = {
   text: turn.text,
   questionForm: turn.questionForm,
   ...(turn.questionSource ? { questionSource: turn.questionSource } : {}),
   ...(turn.gap ? { gap: turn.gap } : {}),
  };

  return {
   id,
   mode: normalizedMode,
   protocol: effectiveProtocol,
   deps: {
    complete: deps.complete,
    vault: deps.vault,
    queue: deps.queue,
    index: deps.index,
    ...(deps.semantic ? { semantic: deps.semantic } : {}),
    ...(deps.peopleSource ? { peopleSource: deps.peopleSource } : {}),
   },
   turns: [greetingTurn],
   bank,
   questionCount: 0,        // greeting is framing, not a budget question
   phase: 'open',
   pendingOpener,
   ...(openQueueEntryId ? { openQueueEntryId } : {}),
   ...(protocolMachine !== undefined ? { protocolMachine } : {}),
  };
 }

// ── Pre-135 path: no greeting, opener fires first ──
const resolved = resolveOpener(deps, normalizedMode, bank);
const { turn: openerTurn, openQueueEntryId } = turnFromResolved(resolved, started);

deps.vault.startTranscript(id, {
 mode: normalizedMode,
 protocol: effectiveProtocol,
 started,
});
deps.vault.appendTurn(id, openerTurn);

if (deps.vaultRoot) sessionVaultRoots.set(id, deps.vaultRoot);

return {
 id,
 mode: normalizedMode,
 protocol: effectiveProtocol,
 deps: {
  complete: deps.complete,
  vault: deps.vault,
  queue: deps.queue,
  index: deps.index,
  ...(deps.semantic ? { semantic: deps.semantic } : {}),
  ...(deps.peopleSource ? { peopleSource: deps.peopleSource } : {}),
 },
 turns: [openerTurn],
 bank,
 questionCount: 1,
 phase: 'open',
 ...(openQueueEntryId ? { openQueueEntryId } : {}),
 ...(protocolMachine !== undefined ? { protocolMachine } : {}),
};
}

/** A question the session will ask, and where it came from. */
export interface Probe {
 kind: 'probe';
 text: string;
 questionForm: QuestionForm;
 provenance: QuestionProvenance;
 /**
  * The Facet this question asks for, when the source knows it: a queue entry
  * tagged at curation. Absent means unknown — never guessed (ticket 042).
  */
 targetFacet?: Facet;
 /**
  * The snippet a `juxtaposition` probe actually composed against. The server
  * renders its rider from THIS, not from the resonance top-hit — the elicitor
  * may have skipped hits (repairs, reuse, failed drafts), and a rider showing
  * a snippet the question never used misleads the reader. Set exactly when
  * `provenance === 'juxtaposition'`.
  */
 juxtaposedSnippet?: { snippetId: string; snippetText: string };
}

/**
 * Append an agent question to the transcript and count it against the budget.
 * The one place a question becomes real. Model-composed questions reach it
 * only through `guardQuestion`; queue and bank draws come straight here,
 * because canned material is the fallback that must always be available.
 */
function emitProbe(
 s: SessionState,
 text: string,
 questionForm: QuestionForm,
 provenance: QuestionProvenance,
 opts?: { source?: QuestionSource; targetFacet?: Facet; gap?: string },
): Probe {
const agentTurn: Turn = {
 role: 'agent',
 text,
 at: new Date().toISOString(),
 questionForm,
 ...(opts?.source ? { questionSource: opts.source } : {}),
 // The gap the drawn question answers — `gap` follows `source` exactly:
 // both are provenance the probe rides with (hop 2, Q-39).
 ...(opts?.gap ? { gap: opts.gap } : {}),
};
 s.deps.vault.appendTurn(s.id, agentTurn);
 s.turns.push(agentTurn);
 s.questionCount++;
 return {
  kind: 'probe',
  text,
  questionForm,
  provenance,
  ...(opts?.targetFacet ? { targetFacet: opts.targetFacet } : {}),
 };
}

/** Enter the close sequence and ask the door question. */
function emitClosingDoor(s: SessionState): Probe {
 s.phase = 'closing-door';
 return emitProbe(s, CLOSING_DOOR_QUESTION, 'deliberative', 'close');
}

/**
 * Close a descent. The order of the four steps is the whole point — it clears
 * `s.sounding`, so anything that does not hand the ladder off first loses it.
 * `s.finishedSounding` is the ONLY carrier (T1's type): set BEFORE clearing,
 * read by the route, which persists the ladder and clears the field. This
 * helper writes nothing to disk itself — elicitor.ts has no vault root and
 * src/sounding/park.ts (Task 7) is the persister.
 */
function closeDescent(s: SessionState, endedBy: SoundingEnd): Probe {
 // 1. Stamp the live state into a finished ladder.
 const finished: ParkedLadder = { ...s.sounding!, ended: new Date().toISOString(), endedBy };
 // 2. Hand it to the route BEFORE clearing anything. This is the only carrier.
 s.finishedSounding = finished;
 // 3. The descent is over; the sitting is not.
 delete s.sounding;                    // `delete`, never `= undefined` — exactOptionalPropertyTypes
 // 4. The two close moves survive every ending (Q-20, Q-47).
 return emitClosingDoor(s);
}

/** The question texts the agent has already asked this sitting — the guard reference set. */
function askedTexts(s: SessionState): string[] {
 return s.turns.filter((t) => t.role === 'agent').map((t) => t.text);
}

/**
 * The guard choke point. Every model-composed question passes here, whichever
 * priority produced it — juxtaposition and red-light follow-ups used to return
 * unchecked, and repeated themselves within one session (eval 2026-08-02 #4).
 *
 * `systemPrompt` is supplied only for prompt-generated probes: a composed
 * question is BUILT from the user's words (Q-12), so parrot-checking it
 * against its own compose prompt would reject every valid one.
 */
function guardQuestion(
 s: SessionState,
 question: string,
 systemPrompt?: string,
): GuardVerdict {
 const asked = askedTexts(s);
 return checkQuestion(question, {
  asked,
  ...(systemPrompt !== undefined ? { systemPrompt } : {}),
 });
}

/** The corrective instruction appended to a probe prompt after a rejection. */
function guardCorrection(verdict: GuardVerdict, asked: string[]): string {
 switch (verdict) {
  case 'parrot':
   return 'CRITICAL: Do NOT reuse any phrase, sentence shape, or near-substring from the instructions above. Compose an entirely fresh question from their words.';
  case 'conversation-referential':
   return 'CRITICAL: Your question must be about what the speaker said — not about the conversation itself. Do not reference "this conversation" or ask about the interaction.';
  case 'near-duplicate':
   return `CRITICAL: Your question is too similar to one already asked in this conversation. Already asked: ${asked.join(' | ')}\n\nCompose a genuinely different question — different syntactic shape, different angle, different move from the repertoire.`;
 case 'not-interrogative':
  return 'CRITICAL: Your previous response was rejected because it was not a question. Return ONE question, addressed to the speaker, ending in a question mark.';
  case 'ok':
   return '';
 }
}

/**
 * The corrective instruction appended after an emit-form rejection (ticket
 * 144): the question leaked a template token, a placeholder slot, or a
 * mid-phrase break. Guard verdicts get their own corrections above.
 */
const MACHINE_FORM_CORRECTION =
 'CRITICAL: Your output was rejected for its form. Output exactly ONE complete question sentence: no preamble, no placeholders, no template tokens, no mid-phrase breaks.';

/** The outcome of one machine turn (ticket 159, slice 3). */
export type MachineTurnResult =
 | { kind: 'served'; probe: Probe }
 | { kind: 'closed' }
 | { kind: 'fallthrough' };

/**
 * Persist the machine state after a ratified phase advance (ticket 159,
 * slice 5): the side-record is written on every phase advance AND on park,
 * so a crash never loses a phase the person already walked. The vault root
 * comes from the per-session table the server seeded at start; a direct
 * elicitor call (no vaultRoot) simply skips the write.
 */
function persistMachineAdvance(s: SessionState): void {
 const vaultRoot = sessionVaultRoots.get(s.id);
 if (vaultRoot === undefined || s.protocolMachine === undefined) return;
 writeMachineState(vaultRoot, s.id, s.protocolMachine);
}

/**
 * The chip surface's pair on the turn wire (ticket 159, slice 7): two
 * distinct non-empty names. Additive and optional — a prose-only answer is
 * a perfectly valid turn and carries no pair. A malformed pair is dropped
 * (the text stands alone) rather than failing the route, so the wire stays
 * byte-compatible with every existing client.
 */
export function parseTriadPair(value: unknown): [string, string] | undefined {
 if (!Array.isArray(value) || value.length !== 2) return undefined;
 const [a, b] = value as [unknown, unknown];
 if (typeof a !== 'string' || typeof b !== 'string') return undefined;
 const na = a.trim();
 const nb = b.trim();
 if (na.length === 0 || nb.length === 0 || na === nb) return undefined;
 return [na, nb];
}

/**
 * The phase machine's turn (ticket 159, slice 3): compose the current
 * phase's question with the machine's own seam, run it through the same
 * guard pipeline as every probe (guardQuestion + emit form), and serve it.
 *
 * CONTROL FLOW (the chosen design):
 * - A model output that is a marker — [NEXT_PHASE:<id>] or [SATURATED] —
 *   makes machineQuestion return null; the recorder wrapper keeps the raw
 *   output and `advanceMachine` ratifies it. A ratified advance moves the
 *   machine and the NEXT phase's question is composed in the same turn. A
 *   ratified [SATURATED] at the last phase closes: `closed` → the caller
 *   enters the existing closing-door flow, mirroring P3's [SATURATED].
 * - A refused marker (premature floor / illegal transition) or a question
 *   rejected twice by the guards falls through: `fallthrough` → P1/P2/P3
 *   serve this turn and the machine state is untouched (the caller already
 *   cleared machineLastServed, so the next turn does not count an exchange
 *   for the fallback question).
 * - Bounded: one corrective guard retry (the P3 posture) and at most one
 *   ratified advance per turn (every phase declares minExchanges >= 1, so a
 *   fresh phase's floor cannot be met on the turn it was entered).
 *
 * Exported for the machine resume route (ticket 159, slice 5): a resumed
 * machine's next question is composed with this exact seam — guard pipeline
 * and marker ratification included — so a resumption cannot serve a
 * question the turn flow itself would have rejected.
 */
export async function machineTurn(
 s: SessionState,
 def: ProtocolDef,
): Promise<MachineTurnResult> {
 const people = s.deps.peopleSource?.() ?? [];
 const annotate = (system: string): string => {
  const peopleBlock = people.length >= 3
   ? `\n\nPEOPLE (from the gazetteer — present exactly these three names in prose, no interface): ${people.slice(0, 3).join(', ')}.`
   : '';
  // The chip surface's structured input (ticket 159, slice 7): the person's
  // latest tapped pair rides every composition, so the model can ground
  // follow-ups ("You said X and Y are alike…") even when the answer prose
  // never repeated the names. The LLM client strips unknown turn fields, so
  // the pair reaches the model here, at the same seam as the names.
  // The machine's ui is Record<string, unknown>; the triads key carries the
  // slice-7 shape (TriadSelection[]), asserted once at this boundary.
  const uiTriads = s.protocolMachine?.ui as { triads?: TriadSelection[] } | undefined;
  const triads = uiTriads?.triads ?? [];
  const latest = triads.length > 0 ? triads[triads.length - 1]! : undefined;
  const triadBlock = latest === undefined
   ? ''
   : `\n\nTRIAD (the person's latest selection): ${latest.selected[0]} and ${latest.selected[1]} were the two chosen as alike.`;
  // The declared topic (redesign wave 4): a mid-sitting declaration lands
  // on s.mode.topic and rides every machine composition, so the interview
  // channels keep the sitting on its named subject.
  const topicBlock = s.mode.topic === undefined
   ? ''
   : `\n\nThe sitting's declared subject: ${s.mode.topic}. Keep questions on that subject.`;
  return peopleBlock === '' && triadBlock === '' && topicBlock === ''
   ? system
   : `${system}${peopleBlock}${triadBlock}${topicBlock}`;
 };
 let lastOutput: string | undefined;
 const recording: Complete = async (system, turns, opts) => {
  const out = await s.deps.complete(annotate(system), turns, opts);
  lastOutput = out;
  return out;
 };
 const systemFor = (): string => {
  const base = composeMachineSystemPrompt(def, s.protocolMachine!);
  return base === null ? '' : annotate(base);
 };
 const guarded = (q: string): GuardVerdict | 'emit-form' => {
  // The caller logs its own retry line ('Elicitor: machine question rejected
  // by <verdict> guard — retrying'), so the helper logs nothing here.
  const verdict = guardComposed(
   q,
   { asked: askedTexts(s), systemPrompt: systemFor() },
   'Elicitor: machine question rejected by',
   () => {},
  ).verdict;
  return verdict;
 };

 const composeOnce = async (
  retriesLeft: number,
  correction?: string,
 ): Promise<MachineTurnResult> => {
  let out: string;
  if (correction === undefined) {
   // The machine's own composition seam (initial attempt).
   out = (await machineQuestion(s.protocolMachine!, def, s.turns, recording)) ?? '';
   if (out === '') {
    // Marker or empty model output: ratify when the recorder caught a marker.
    if (lastOutput === undefined || parseMachineMarker(lastOutput) === null) {
     return { kind: 'fallthrough' };
    }
    const adv = advanceMachine(s.protocolMachine!, def, lastOutput);
    if (adv.closed) return { kind: 'closed' };
    if (adv.state !== s.protocolMachine) {
     s.protocolMachine = adv.state;
     persistMachineAdvance(s); // the side-record follows every ratified advance
     return composeOnce(retriesLeft); // ratified advance → next phase's question
    }
    return { kind: 'fallthrough' }; // refused marker → this turn falls through
   }
  } else {
   // The corrective retry rides the same recorder (so a marker in the retry
   // is ratified identically) with the correction appended.
   out = (await recording(`${systemFor()}\n\n${correction}`, s.turns)).trim();
   if (out.length === 0) return { kind: 'fallthrough' };
   if (parseMachineMarker(out) !== null) {
    const adv = advanceMachine(s.protocolMachine!, def, out);
    if (adv.closed) return { kind: 'closed' };
    if (adv.state !== s.protocolMachine) {
     s.protocolMachine = adv.state;
     persistMachineAdvance(s); // the side-record follows every ratified advance
     return composeOnce(retriesLeft);
    }
    return { kind: 'fallthrough' };
   }
  }
  const verdict = guarded(out);
  if (verdict === 'ok') {
   s.machineLastServed = true;
   return { kind: 'served', probe: emitProbe(s, out, def.questionForm, 'machine') };
  }
  if (retriesLeft <= 0) return { kind: 'fallthrough' };
  const asked = askedTexts(s);
  const nextCorrection = verdict === 'emit-form'
   ? MACHINE_FORM_CORRECTION
   : guardCorrection(verdict, asked);
  console.warn(`Elicitor: machine question rejected by ${verdict} guard — retrying`);
  return composeOnce(retriesLeft - 1, nextCorrection);
 };

 return composeOnce(1);
}

export async function userTurn(
 s: SessionState,
 text: string,
 spoken?: boolean,
 prosody?: Prosody,
 pair?: [string, string],
): Promise<Probe | { kind: 'saturated'; closingText?: string } | { kind: 'checkpoint' }> {
 const now = new Date().toISOString();
 const userTurnRecord: Turn = { role: 'user', text, at: now, ...(spoken ? { spoken: true as const } : {}), ...(prosody ? { prosody } : {}) };
 s.deps.vault.appendTurn(s.id, userTurnRecord);
 s.turns.push(userTurnRecord);

 // The answer landed, so the entry that asked for it is answered (ticket 041).
 // This runs before every branch below and is the ONLY route to `answered`:
 // the test is behavioural — a question was put and something came back — so
 // "dunno" counts exactly as a paragraph does. Whether the answer was worth
 // anything is a different measurement, and it needs its own field rather
 // than a reinterpretation of this one. Recorded after the turn is in the
 // transcript, so no entry is ever marked for a turn that was not written.
 // `delete`, never `= undefined`: exactOptionalPropertyTypes is on.
 if (s.openQueueEntryId) {
  s.deps.queue.markAnswered(s.openQueueEntryId);
  delete s.openQueueEntryId;
 }

 // Closing-door → the door answer saturates the sitting. The phase stays
 // 'closing-door' until /end; the close has no bookmark question.
 if (s.phase === 'closing-door') {
  return { kind: 'saturated', closingText: CLOSING_ACKNOWLEDGMENT };
 }

 // Budget: a fixed question count — minutes are not declared (canon §5.3)
 const budget = SESSION_BUDGET;

 // At budget-2, trigger the close sequence — never mid-descent: the
 // descent IS the sitting from that point (sounding/budget.ts doc), and
 // its allowance reserves the close moves for after it ends.
 if (!s.sounding && s.questionCount >= budget - 2) {
  return emitClosingDoor(s);
 }

 // ── The descent (soundings): a live Sounding suspends ordinary selection ──
 // The four priorities below are untouched and unreachable while a descent is
 // live — a descent answers only rung questions (plan Task 6, Step 6).
 if (s.sounding) {
  const pending = s.sounding.pendingQuestion!;   // set at enter, and after every rung
  s.sounding = addRung(s.sounding, pending.text, pending.foothold, text, now);

  // The end check runs HERE, on the answer path, before anything is composed.
  // Cap and convergence close the descent whether or not the gate is touched.
  const end = descentEnd(s.sounding);
  if (end) return closeDescent(s, end);

  // The checkpoint blocks: no next question until a gate word arrives.
  if (gateStateFor(s.sounding).checkpoint) return { kind: 'checkpoint' as const };

  // Up to three drafts: a local model's rung draft failing the emit gate is
  // routine, and closing a live descent over a drafter stutter threw away a
  // consented ladder (measured: a 9-rung allowance closed at rung 3).
  let next: Awaited<ReturnType<typeof composeRung>> = null;
  for (let attempt = 0; attempt < 3 && !next; attempt++) {
   next = await composeRung(text, s.deps.complete, (q) => guardQuestion(s, q));
  }
  if (!next) return closeDescent(s, 'composition-failed'); // the drafter, not the answers, ran out
  s.sounding.pendingQuestion = next;
  return emitProbe(s, next.text, 'deliberative', 'composed');
 }

 // ── Machine bookkeeping (ticket 159) ──
 // The answer to the last machine question landed: count it. Only when the
 // question actually served was the machine's — a fallback turn must not
 // advance the machine (the person answered a non-machine question). Runs
 // for every machine-active sitting before any composition, so a reflective
 // machine question answered on the last turn counts exactly once whether
 // or not a fallback channel serves this turn.
 if (s.protocolMachine !== undefined && s.machineLastServed === true) {
  let next = recordExchange(s.protocolMachine);
  // The chip surface's structured input (ticket 159, slice 7): when the
  // answered question was the machine's triads phase and the turn carried
  // the tapped pair, record the round into the machine's ui — the plan
  // shape, ui.triads = [{ names, selected }], one record per answered
  // triad. machineLastServed gates it, so a fallback turn's pair (which the
  // chips cannot even produce — they render only under the machine's
  // triads meta) never corrupts the ui.
  if (pair !== undefined) {
   const phase = getProtocol(next.protocol)?.phases?.[next.phaseIndex];
   if (phase?.renderer === 'triads') {
    const names = (s.deps.peopleSource?.() ?? []).slice(0, 3);
    // The machine's ui is Record<string, unknown>; the triads key carries
    // the slice-7 shape (TriadSelection[]), asserted once at this boundary.
    const uiTriads = next.ui as { triads?: TriadSelection[] } | undefined;
    next = { ...next, ui: { ...next.ui, triads: [...(uiTriads?.triads ?? []), { names, selected: pair }] } };
   }
  }
  s.protocolMachine = next;
  delete s.machineLastServed;
 }

 // ── Machine priority (ticket 159, slice 3) ──
 // Ticket 158: the sitting's protocol is the register for ALL composed
 // questions. Resolve the def once here; the machine reads its phases, and
 // P1/P2/P3 carry it into their prompts below.
 // The machine runs FIRST for the structured instruments (cdm,
 // concept-sorting, people-grid, laddered-grid): its current-phase question
 // is the priority, and P1/P2/P3 serve one-turn stand-ins when the machine
 // question is rejected. Reflective is the exception (slice 4): its
 // one-phase machine wraps the P1/P2/P3 flow, so its ways-in question is
 // the P3-equivalent — P1 juxtaposition stays the dominant channel, and
 // the machine serves only when it is quiet.
 // The machine's OWN protocol is authoritative when a machine is present: a
 // resumed machine (ticket 159, slice 5) can run a different instrument than
 // the sitting was rotated into, and composition must follow the machine,
 // never the session's declaration.
 const protocolDef = getProtocol(s.protocolMachine?.protocol ?? s.protocol);
 const machineActive = protocolDef !== undefined && protocolDef.phases !== undefined && s.protocolMachine !== undefined;
 if (machineActive && s.protocol !== 'reflective') {
  const machine = await machineTurn(s, protocolDef!);
  if (machine.kind === 'closed') return emitClosingDoor(s);
  if (machine.kind === 'served') return machine.probe;
  // fallthrough — the ordinary channels serve this turn; the machine state
  // is untouched and the next turn resumes it at the same phase.
 }

 // ── Pivot rule (ticket 020): content-free closed answers get a fresh draw ──
 if (isContentFree(text)) {
  const drawn = drawFallback(s);
  if (drawn) return drawn;
  // Nothing to draw — fall through to composition
 }

 // ── Probe flow: juxtaposition > machine ways-in > generic LLM probe ──

 // Priority 1: resonance → juxtaposition
  const hits = await resonateHybrid(s.deps.index, s.deps.semantic, text);
  // Q-106: Exclude hits whose snippet is under repair
  const vaultRoot = sessionVaultRoots.get(s.id);
  const allRepairs = vaultRoot ? readAllRepairs(vaultRoot) : [];
  const badSnippetIds = repairedSnippetIds(allRepairs);
  // One juxtaposition per snippet per sitting: the same snippet re-surfacing
  // turn after turn produced three consecutive questions off one sentence
  // (measured, sitting 01KZA76H…) — the person answers, and the answer
  // re-resonates with the very snippet that prompted it. The sitting-scoped
  // guard breaks that loop; the snippet is fair game again next sitting.
  const used = (s.juxtaposedSnippetIds ??= []);
  const cleanHits = hits.filter(
    (h) => !badSnippetIds.has(h.snippetId) && !used.includes(h.snippetId),
  );
  for (const hit of cleanHits) {
  // Q-12 requires the composed question to quote a verbatim substring, and a
  // semantic hit shares no such substring with the turn — the whole point of
  // the channel. The 068 ruling: the semantic path quotes the SNIPPET's own
  // words, the person's past prose framed then-versus-now. The lexical arm
  // passes through unchanged: its sharedPhrase is the reason the two texts
  // are connected.
  const quotable = hit.channel === 'lexical'
   ? hit
   : {
    snippetId: hit.snippetId,
    version: hit.version,
    snippetText: hit.snippetText,
    sharedPhrase: quotablePhrase(hit.snippetText),
    score: hit.score,
   };
  const juxtaposed = await composeJuxtaposition(
   text,
   quotable,
   s.deps.complete,
   sessionVaultRoots.get(s.id),
   protocolDef,
  );
  if (!juxtaposed) continue;
  const verdict = guardQuestion(s, juxtaposed);
  if (verdict !== 'ok') {
   console.warn(
    `Elicitor: juxtaposition rejected by ${verdict} guard — trying the next source`,
   );
   continue;
  }
  used.push(hit.snippetId);
  return {
   ...emitProbe(s, juxtaposed, 'deliberative', 'juxtaposition'),
   juxtaposedSnippet: { snippetId: hit.snippetId, snippetText: hit.snippetText },
  };
 }

 // Priority 2 (cut, ruling 2026-08-09): the red-light channel is gone —
 // composition survives ONLY as resonance-licensed juxtaposition through the
 // emit gate (above). The generic probe below is the fallback after it.

 // Priority 3: the machine's ways-in question for reflective (ticket 159,
 // slice 4 — its one-phase machine wraps the P1/P2/P3 flow, so the machine
 // question is the P3-equivalent). Rejected twice, the generic probe serves
 // this turn and the machine resumes next turn at the same phase. Structured
 // protocols reach this point only on a machine fallthrough and use the
 // generic probe, exactly as before.
 if (machineActive && s.protocol === 'reflective') {
  const machine = await machineTurn(s, protocolDef!);
  if (machine.kind === 'closed') return emitClosingDoor(s);
  if (machine.kind === 'served') return machine.probe;
 }

 // Priority 3 (fallback): generic LLM probe (protocol from registry)
 const basePrompt = protocolDef?.prompt ?? (() => { throw new Error(`Unknown protocol "${s.protocol}"`); })();
 // The declared topic (redesign wave 4): a mid-sitting declaration lands on
 // s.mode.topic, and this prompt carries it so the generic channel keeps
 // the sitting on its named subject.
 const systemPrompt = s.mode.topic === undefined
  ? basePrompt
  : `${basePrompt}\n\nThe sitting's declared subject: ${s.mode.topic}. Keep questions on that subject.`;

 const response = await s.deps.complete(systemPrompt, s.turns, {
  temperature: 0.8,
 });

 if (response.includes('[SATURATED]')) {
  return emitClosingDoor(s);
 }

 let probeText = response.trim();

 // ── Guards (ticket 020, 035): one verdict, one corrective retry, then fall back ──
 let verdict = guardQuestion(s, probeText, systemPrompt);
 if (verdict !== 'ok') {
  console.warn(`Elicitor: ${verdict} guard triggered — retrying`);
  const asked = askedTexts(s);
  const guardedPrompt = `${systemPrompt}\n\n${guardCorrection(verdict, asked)}`;
  const retryResponse = await s.deps.complete(guardedPrompt, s.turns, {
   temperature: 0.8,
  });
  if (retryResponse.includes('[SATURATED]')) {
   return emitClosingDoor(s);
  }
  probeText = retryResponse.trim();
  verdict = guardQuestion(s, probeText, systemPrompt);
  if (verdict !== 'ok') {
   console.warn(
    `Elicitor: ${verdict} guard retry also failed — drawing fallback`,
   );
   const fb = drawFallback(s);
   if (fb) return fb;

   // Guard floor (ticket 079): the composed question was rejected twice and
   // nothing remains to draw. Q-55's own principle — a composed floor beats a
   // bad draw — cuts the other way here: a FIXED protocol-appropriate probe
   // constant beats text that failed validation twice. Drawn from the active
   // protocol's own material (defs/*.md), deterministic and zero-LLM, so the
   // failure path needs nothing that can itself fail. Served unchecked, like
   // any canned draw — it is what the guards fall back TO. This return is
   // what makes the fallthrough below unreachable: probeText was rejected
   // twice and must never reach the person.
   emitGuardFloor(s, verdict);
   const floorText = getProtocol(s.protocol)?.floorProbe ?? DEFAULT_FLOOR_PROBE;
   return emitProbe(s, floorText, protocolDef?.questionForm ?? defaultQuestionForm, 'probe');
  }
 }

 return emitProbe(s, probeText, protocolDef?.questionForm ?? defaultQuestionForm, 'probe');
}

/**
 * Log the guard floor honestly (ticket 079): twice rejected, fallback empty,
 * fixed probe served. A distinct kind, because Q-55's ladder work (061)
 * established that which rung emptied the pool must be legible — the queue's
 * own floor is logged separately, and this is the elicitor's rung beyond it.
 * Never the probe text, only what happened and to whom (Q-22).
 */
function emitGuardFloor(s: SessionState, verdict: GuardVerdict): void {
 const root = sessionVaultRoots.get(s.id);
 if (root === undefined) return; // caller holds the root; the log is evidence, not a dependency
 try {
  appendEvent(root, {
   at: new Date().toISOString(),
   actor: 'elicitor',
   kind: 'guard-floor',
   detail: `protocol=${s.protocol} verdict=${verdict} queue=0 bank=0`,
  });
 } catch {
  // Deliberately silent, exactly as the queue's draw logging is.
 }
}

/**
 * Fallback draw from queue then bank. Returns a probe result or null if both empty.
 * Canned material bypasses the guards on purpose: it is what the guards fall
 * back TO, so it must never be rejectable.
 */
function drawFallback(s: SessionState): Probe | null {
 // Try queue first
 const queueDraw = s.deps.queue.draw(s.mode);
 if (queueDraw) {
   s.openQueueEntryId = queueDraw.id;
  return emitProbe(s, queueDraw.question, queueDraw.questionForm, 'bank', {
   ...(queueDraw.targetFacet ? { targetFacet: queueDraw.targetFacet } : {}),
   ...(queueDraw.gap ? { gap: queueDraw.gap } : {}),
  });
 }

// Bank fallback. One shared bank draw (ticket 021): the weak-form filter
// applies here too, and a weak question still beats no question — when the
// filter empties the unused pool, the unfiltered pool serves.
const bank = s.bank ?? [];
const used = usedStarters(s.turns, new Set(bank.map((q) => q.text)));
const unused = pickUnusedBank(s, used);
if (unused.length > 0) {
 const pick = bankDraw(unused);
 return emitProbe(s, pick.text, pick.questionForm, 'bank', {
  ...(pick.source ? { source: pick.source } : {}),
 });
}

 return null;
}

/** The bank questions not yet asked or skipped this sitting — the shared unused pool for skip and fallback. */
function pickUnusedBank(s: SessionState, used: Set<string>): StarterQuestion[] {
 return (s.bank ?? []).filter((q) => !used.has(q.text));
}

/** Returns the set of bank question texts already used (asked or skipped) in this session. */
function usedStarters(turns: Turn[], bankTexts: Set<string>): Set<string> {
 const used = new Set<string>();
 for (const t of turns) {
  if (t.role === 'agent' && bankTexts.has(t.text)) {
   used.add(t.text);
  }
 }
 return used;
}

/**
 * Skip the current question during an exchange.
 * Marks the last agent turn skipped in memory, picks an unused question from the
 * session's bank, and appends the replacement as a new agent turn.
 *
 * Skips do not consume budget (Q-8: append before returning).
 */
export function skipQuestion(
 s: SessionState,
):
 | { kind: 'question'; text: string; questionForm: QuestionForm }
 | { kind: 'exhausted' } {
 const lastAgentIdx = findLastIndex(s.turns, (t) => t.role === 'agent');
 if (lastAgentIdx === -1) return { kind: 'exhausted' };

 s.turns[lastAgentIdx]!.skipped = true;

// A skipped question was not answered. The entry stays `asked` — dropping the
// pairing here is what stops the NEXT turn from marking it (ticket 041).
delete s.openQueueEntryId;
// A skipped machine question is not an exchange: without this, the next
// machine turn would count the skip against the phase floor (ticket 159).
delete s.machineLastServed;

 const bank = s.bank ?? [];
 const used = usedStarters(s.turns, new Set(bank.map((q) => q.text)));
 const available = pickUnusedBank(s, used);

 if (available.length === 0) return { kind: 'exhausted' };

 const pick = available[Math.floor(Math.random() * available.length)]!;
 const agentTurn: Turn = {
  role: 'agent',
  text: pick.text,
  at: new Date().toISOString(),
  questionForm: pick.questionForm,
  ...(pick.source ? { questionSource: pick.source } : {}),
 };

 // Q-8: append BEFORE returning — the replacement is already in the transcript
 s.deps.vault.appendTurn(s.id, agentTurn);
 s.turns.push(agentTurn);

 return {
  kind: 'question',
  text: agentTurn.text,
  questionForm: pick.questionForm,
 };
}

function findLastIndex<T>(arr: T[], pred: (el: T) => boolean): number {
 for (let i = arr.length - 1; i >= 0; i--) {
  if (pred(arr[i]!)) return i;
 }
 return -1;
}
