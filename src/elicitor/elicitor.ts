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
 Vault,
 QueueStore,
 LexicalIndex,
} from '../types.js';
import {
 defaultQuestionForm,
 CLOSING_DOOR_QUESTION,
 CLOSING_BOOKMARK_QUESTION,
 type StarterQuestion,
} from './protocol.js';
import {
 getProtocol,
 selectProtocolForTarget,
 loadProtocolDefinitions,
 DEFAULT_FLOOR_PROBE,
} from '../protocols/registry.js';
import { appendEvent } from '../log/activity.js';
import { loadQuestionBank } from './bank.js';
import { quotablePhrase, resonateHybrid, type SemanticIndex } from '../index/semantic.js';
import { isContentFree } from './answer-shape.js';
import { isWeakForm } from '../queue/bank-filter.js';
import { composeFollowUp, composeJuxtaposition, redLights } from '../clerk/composed.js';
import { composeRung } from '../clerk/sounding-rung.js';
import { addRung, gateStateFor } from '../sounding/ladder.js';
import { descentEnd } from '../sounding/convergence.js';
import { checkQuestion, type GuardVerdict } from './guards.js';
import { facetIntentForRedLight } from './facet-intent.js';
import type { RandomizerDraw } from '../randomizer/randomizer.js';

/**
 * The vault root per live session, keyed by session id. `startSession` records
 * it when the caller supplies it; the guard-floor path reads it back so the
 * elicitor can write its own activity events without holding the root on the
 * session (which lives in src/types.ts and is shared). Sessions are short-lived;
 * the map never clears, exactly like the server's own session table.
 */
const sessionVaultRoots = new Map<string, string>();

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
 // Apply weak-form filter to bank draws only (ticket 021).
 // If the filter empties the pool, fall through to unfiltered bank —
 // a weak question beats no question.
 const filtered = bank.filter((q) => !isWeakForm(q.text));
 const pool = filtered.length > 0 ? filtered : bank;
 const pick = pool[Math.floor(Math.random() * pool.length)]!;
 return {
  text: pick.text,
  questionForm: pick.questionForm,
  ...(pick.source ? { source: pick.source } : {}),
 };
}

export function startSession(
 mode: Mode,
 deps: {
  complete: Complete;
  vault: Vault;
  queue: QueueStore;
  index: LexicalIndex;
  /**
   * The semantic resonance channel (Q-17, ticket 068). Optional: absent is
   * the ordinary cold state, in which the hybrid degrades to the trigram
   * index — the system works with the embedding server switched off because
   * it works with it switched off today.
   */
  semantic?: SemanticIndex;
  bank?: StarterQuestion[];
  protocolName?: string;
  /**
   * Target to use when the Mode declares none. The caller supplies it because
   * the honest default is corpus-shaped (`suggestTargetForVault`) and the
   * elicitor holds no vault path. 'self' remains the last resort so an absent
   * target never crashes a caller (Q-19, ticket 042).
   */
  defaultTarget?: Target;
  /**
   * The Randomizer's draw (Q-18), passed as a closure so the elicitor never
   * learns what a deck or a snippet stratum is. `null` means it had nothing to
   * shuffle, or — for `'system'` — that no coverage ground licensed it.
   */
  randomizer?: (invokedBy: 'user' | 'system') => RandomizerDraw | null;
  /** True when the person chose "shuffle a deck" instead of "begin". */
  shuffleRequested?: boolean;
  /**
   * The vault root the session's activity log lives in. The caller holds it
   * (the server owns the vault path); passed so the elicitor can log the
   * guard floor it reaches (ticket 079). Absent means the floor is served
   * silently — the log is evidence, not a dependency.
   */
  vaultRoot?: string;
 },
): SessionState {
 const id = ulid();
 const started = new Date().toISOString();
 const target: Target = mode.target ?? deps.defaultTarget ?? 'self';
 const normalizedMode: Mode = { ...mode, target };
 const bank = deps.bank ?? loadQuestionBank();

 // Protocol name: explicit pass-in wins; fall back to first protocol for target
 const protocol = deps.protocolName ?? selectProtocolForTarget(target, 0, loadProtocolDefinitions()).name;

 // Opening, in this order and the order is a values statement:
 //   1. the shuffle the person asked for — never vetoed (Q-16, Q-18);
 //   2. the Queue;
 //   3. a shuffle nobody asked for, and only on a licensed coverage ground —
 //      in shadow today, so this rung never fires (Q-35);
 //   4. the bank.
 // Position 3 sits after the Queue and before the bank because the Queue is
 // material this vault minted about this person, and a deck card is not.
 const shuffled = deps.shuffleRequested ? (deps.randomizer?.('user') ?? null) : null;
 const queueDraw = shuffled ? null : deps.queue.draw(normalizedMode, 'opening');
 const offered = shuffled || queueDraw ? null : (deps.randomizer?.('system') ?? null);
 const randomDraw = shuffled ?? offered;
 let openerTurn: Turn;
 // The entry whose question is on the table. Held from here so the answering
 // turn can close it; a bank or Randomizer opener leaves it absent, and
 // nothing is marked.
 let openQueueEntryId: string | undefined;

 if (randomDraw) {
  openerTurn = {
   role: 'agent',
   text: randomDraw.question,
   at: started,
   questionForm: randomDraw.questionForm,
   // A deck card keeps the are.na source it was curated from; a resurfaced
   // snippet has no block behind it, so it carries none rather than a fake.
   ...(randomDraw.draw.kind === 'deck'
    ? {
     questionSource: {
      channel: randomDraw.draw.channel,
      blockId: randomDraw.draw.blockId,
     },
    }
    : {}),
  };
 } else if (queueDraw) {
  openQueueEntryId = queueDraw.id;
  deps.queue.markAsked(queueDraw.id);
  openerTurn = {
   role: 'agent',
   text: queueDraw.question,
   at: started,
   questionForm: queueDraw.questionForm,
   // The drawn entry names the Gap it was minted to fill; the asking turn
   // carries it so the harvest can put it on the snippet (hop 2, Q-39).
   ...(queueDraw.gap ? { gap: queueDraw.gap } : {}),
  };
 } else {
  const opener = pickOpener(bank, normalizedMode.topic);
  openerTurn = {
   role: 'agent',
   text: opener.text,
   at: started,
   questionForm: opener.questionForm,
   ...(opener.source ? { questionSource: opener.source } : {}),
  };
 }

 deps.vault.startTranscript(id, {
  mode: normalizedMode,
  protocol,
  started,
 });
 deps.vault.appendTurn(id, openerTurn);

 // The activity-log root for this session, if the caller supplied one. The
 // floor path below is the only reader; every other sitting event is emitted
 // at the server seam, which holds the root itself.
 if (deps.vaultRoot) sessionVaultRoots.set(id, deps.vaultRoot);

 return {
  id,
  mode: normalizedMode,
  protocol,
  deps: {
   complete: deps.complete,
   vault: deps.vault,
   queue: deps.queue,
   index: deps.index,
   ...(deps.semantic ? { semantic: deps.semantic } : {}),
  },
  turns: [openerTurn],
  bank,
  questionCount: 1,
  phase: 'open',
  ...(openQueueEntryId ? { openQueueEntryId } : {}),
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
  * tagged at curation, or a follow-up whose Red Light names what is missing.
  * Absent means unknown — never guessed (ticket 042).
  */
 targetFacet?: Facet;
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
 const asked = s.turns.filter((t) => t.role === 'agent').map((t) => t.text);
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
  case 'ok':
   return '';
 }
}

export async function userTurn(
 s: SessionState,
 text: string,
 spoken?: boolean,
): Promise<Probe | { kind: 'saturated' } | { kind: 'checkpoint' }> {
 const now = new Date().toISOString();
 const userTurnRecord: Turn = { role: 'user', text, at: now, ...(spoken ? { spoken: true as const } : {}) };
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

 // Bookmark answer — close completes; the answer becomes a user-declared queue entry.
 // It carries this sitting's Target so a later sitting of the other kind cannot
 // draw it (045); startSession always resolves mode.target, so it is present.
 if (s.phase === 'closing-bookmark') {
  s.deps.queue.add({
   source: 'user-declared',
   license: 'user',
   question: text,
   questionForm: 'deliberative',
   sharpness: 'weak',
   horizon: 'now',
   ...(s.mode.target ? { target: s.mode.target } : {}),
   ...(s.mode.topic ? { topic: s.mode.topic } : {}),
  });
  return { kind: 'saturated' };
 }

 // Closing-door → advance to the bookmark question
 if (s.phase === 'closing-door') {
  s.phase = 'closing-bookmark';
  return emitProbe(s, CLOSING_BOOKMARK_QUESTION, 'deliberative', 'close');
 }

 // Budget: min(20, max(10, mode.minutes))
 const budget = Math.min(20, Math.max(10, s.mode.minutes));

 // At budget-2, trigger the close sequence
 if (s.questionCount >= budget - 2) {
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

  const next = await composeRung(text, s.deps.complete, (q) => guardQuestion(s, q));
  if (!next) return closeDescent(s, 'convergence');   // no foothold — the chain cannot continue
  s.sounding.pendingQuestion = next;
  return emitProbe(s, next.text, 'deliberative', 'composed');
 }

 // ── Pivot rule (ticket 020): content-free closed answers get a fresh draw ──
 if (isContentFree(text)) {
  const drawn = drawFallback(s);
  if (drawn) return drawn;
  // Nothing to draw — fall through to composition
 }

 // ── Probe flow: juxtaposition > red-light compose > generic LLM probe ──

 // Priority 1: resonance → juxtaposition
 const hits = await resonateHybrid(s.deps.index, s.deps.semantic, text);
 for (const hit of hits) {
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
  );
  if (!juxtaposed) continue;
  const verdict = guardQuestion(s, juxtaposed);
  if (verdict !== 'ok') {
   console.warn(
    `Elicitor: juxtaposition rejected by ${verdict} guard — trying the next source`,
   );
   continue;
  }
  return emitProbe(s, juxtaposed, 'deliberative', 'juxtaposition');
 }

 // Priority 2: red-light detection → composed follow-up
 const lights = await redLights(text, s.deps.complete);
 for (const light of lights) {
  const followUp = await composeFollowUp(text, light, s.deps.complete);
  if (!followUp) continue;
  const verdict = guardQuestion(s, followUp);
  if (verdict !== 'ok') {
   console.warn(
    `Elicitor: composed follow-up rejected by ${verdict} guard — trying the next source`,
   );
   continue;
  }
  // The Red Light names what the utterance is missing, so it names the Facet
  // the follow-up asks for — the one place composition knows its own intent.
  return emitProbe(s, followUp, 'deliberative', 'composed', {
   targetFacet: facetIntentForRedLight(light.kind),
  });
 }

 // Priority 3: generic LLM probe (protocol from registry)
 const protocolDef = getProtocol(s.protocol);
 const systemPrompt = protocolDef?.prompt ?? (() => { throw new Error(`Unknown protocol "${s.protocol}"`); })();

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
  const asked = s.turns.filter((t) => t.role === 'agent').map((t) => t.text);
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
   return emitProbe(s, floorText, defaultQuestionForm, 'probe');
  }
 }

 return emitProbe(s, probeText, defaultQuestionForm, 'probe');
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
 const queueDraw = s.deps.queue.draw(s.mode, 'mid');
 if (queueDraw) {
  s.deps.queue.markAsked(queueDraw.id);
  s.openQueueEntryId = queueDraw.id;
  return emitProbe(s, queueDraw.question, queueDraw.questionForm, 'bank', {
   ...(queueDraw.targetFacet ? { targetFacet: queueDraw.targetFacet } : {}),
   ...(queueDraw.gap ? { gap: queueDraw.gap } : {}),
  });
 }

 // Bank fallback
 const unused = (s.bank ?? []).filter(
  (q) => !s.turns.some((t) => t.role === 'agent' && t.text === q.text),
 );
 if (unused.length > 0) {
  const pick = unused[Math.floor(Math.random() * unused.length)]!;
  return emitProbe(s, pick.text, pick.questionForm, 'bank', {
   ...(pick.source ? { source: pick.source } : {}),
  });
 }

 return null;
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

 const bank = s.bank ?? [];
 const bankTexts = new Set(bank.map((q) => q.text));
 const used = usedStarters(s.turns, bankTexts);
 const available = bank.filter((st) => !used.has(st.text));

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
