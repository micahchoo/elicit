import { ulid } from 'ulid';
import type {
 Complete,
 Facet,
 Mode,
 QuestionForm,
 QuestionProvenance,
 QuestionSource,
 SessionState,
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
import { getProtocol, selectProtocolForTarget, loadProtocolDefinitions } from '../protocols/registry.js';
import { loadQuestionBank } from './bank.js';
import { resonate } from '../index/lexical.js';
import { isContentFree } from './answer-shape.js';
import { isWeakForm } from '../queue/bank-filter.js';
import { composeFollowUp, composeJuxtaposition, redLights } from '../clerk/composed.js';
import { checkQuestion, type GuardVerdict } from './guards.js';
import { facetIntentForRedLight } from './facet-intent.js';
import type { RandomizerDraw } from '../randomizer/randomizer.js';

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

 return {
  id,
  mode: normalizedMode,
  protocol,
  deps: {
   complete: deps.complete,
   vault: deps.vault,
   queue: deps.queue,
   index: deps.index,
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
 opts?: { source?: QuestionSource; targetFacet?: Facet },
): Probe {
 const agentTurn: Turn = {
  role: 'agent',
  text,
  at: new Date().toISOString(),
  questionForm,
  ...(opts?.source ? { questionSource: opts.source } : {}),
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
): Promise<Probe | { kind: 'saturated' }> {
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

 // ── Pivot rule (ticket 020): content-free closed answers get a fresh draw ──
 if (isContentFree(text)) {
  const drawn = drawFallback(s);
  if (drawn) return drawn;
  // Nothing to draw — fall through to composition
 }

 // ── Probe flow: juxtaposition > red-light compose > generic LLM probe ──

 // Priority 1: resonance → juxtaposition
 const hits = resonate(s.deps.index, text);
 for (const hit of hits) {
  const juxtaposed = await composeJuxtaposition(
   text,
   hit,
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
  }
 }

 return emitProbe(s, probeText, defaultQuestionForm, 'probe');
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
