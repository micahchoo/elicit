import { ulid } from 'ulid';
import type {
 Complete,
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
 PROTOCOLS,
 CLOSING_DOOR_QUESTION,
 CLOSING_BOOKMARK_QUESTION,
 type StarterQuestion,
} from './protocol.js';
import { loadQuestionBank } from './bank.js';
import { resonate } from '../index/lexical.js';
import { isContentFree } from './answer-shape.js';
import { isWeakForm } from '../queue/bank-filter.js';
import { composeFollowUp, composeJuxtaposition, redLights } from '../clerk/composed.js';
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
 },
): SessionState {
 const id = ulid();
 const started = new Date().toISOString();
 const target: Target = mode.target ?? 'self';
 const normalizedMode: Mode = { ...mode, target };
 const bank = deps.bank ?? loadQuestionBank();

 // Opening: draw from queue first, bank fallback
 const queueDraw = deps.queue.draw(normalizedMode, 'opening');
 let openerTurn: Turn;

 if (queueDraw) {
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
  protocol: target,
  started,
 });
 deps.vault.appendTurn(id, openerTurn);

 return {
  id,
  mode: normalizedMode,
  protocol: target,
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
 };
}

export async function userTurn(
 s: SessionState,
 text: string,
 spoken?: boolean,
): Promise<
 | { kind: 'probe'; text: string; questionForm: QuestionForm; provenance: QuestionProvenance }
 | { kind: 'saturated' }
> {
 const now = new Date().toISOString();
 const userTurnRecord: Turn = { role: 'user', text, at: now, ...(spoken ? { spoken: true as const } : {}) };
 s.deps.vault.appendTurn(s.id, userTurnRecord);
 s.turns.push(userTurnRecord);

 // Bookmark answer — close completes; the answer becomes a user-declared queue entry
 if (s.phase === 'closing-bookmark') {
  s.deps.queue.add({
   source: 'user-declared',
   license: 'user',
   question: text,
   questionForm: 'deliberative',
   sharpness: 'weak',
   horizon: 'now',
  });
  return { kind: 'saturated' };
 }

 // Closing-door → advance to the bookmark question
 if (s.phase === 'closing-door') {
  s.phase = 'closing-bookmark';
  const agentTurn: Turn = {
   role: 'agent',
   text: CLOSING_BOOKMARK_QUESTION,
   at: new Date().toISOString(),
   questionForm: 'deliberative',
  };
  s.deps.vault.appendTurn(s.id, agentTurn);
  s.turns.push(agentTurn);
  s.questionCount++;
  return {
   kind: 'probe',
   text: agentTurn.text,
   questionForm: 'deliberative',
   provenance: 'close',
  };
 }

 // Budget: min(20, max(10, mode.minutes))
 const budget = Math.min(20, Math.max(10, s.mode.minutes));

 // At budget-2, trigger the close sequence
 if (s.questionCount >= budget - 2) {
  s.phase = 'closing-door';
  const agentTurn: Turn = {
   role: 'agent',
   text: CLOSING_DOOR_QUESTION,
   at: new Date().toISOString(),
   questionForm: 'deliberative',
  };
  s.deps.vault.appendTurn(s.id, agentTurn);
  s.turns.push(agentTurn);
  s.questionCount++;
  return {
   kind: 'probe',
   text: agentTurn.text,
   questionForm: 'deliberative',
   provenance: 'close',
  };
 }

 // ── Pivot rule (ticket 020): content-free closed answers get a fresh draw ──
 if (isContentFree(text)) {
  const queueDraw = s.deps.queue.draw(s.mode, 'mid');
  if (queueDraw) {
   s.deps.queue.markAsked(queueDraw.id);
   const agentTurn: Turn = {
    role: 'agent',
    text: queueDraw.question,
    at: new Date().toISOString(),
    questionForm: queueDraw.questionForm,
   };
   s.deps.vault.appendTurn(s.id, agentTurn);
   s.turns.push(agentTurn);
   s.questionCount++;
   return {
    kind: 'probe',
    text: agentTurn.text,
    questionForm: queueDraw.questionForm,
    provenance: 'bank',
   };
  }
  // Queue empty — fall through to bank
  const unused = (s.bank ?? []).filter(
   (q) => !s.turns.some((t) => t.role === 'agent' && t.text === q.text),
  );
  if (unused.length > 0) {
   const pick = unused[Math.floor(Math.random() * unused.length)]!;
   const agentTurn: Turn = {
    role: 'agent',
    text: pick.text,
    at: new Date().toISOString(),
    questionForm: pick.questionForm,
    ...(pick.source ? { questionSource: pick.source } : {}),
   };
   s.deps.vault.appendTurn(s.id, agentTurn);
   s.turns.push(agentTurn);
   s.questionCount++;
   return {
    kind: 'probe',
    text: agentTurn.text,
    questionForm: pick.questionForm,
    provenance: 'bank',
   };
  }
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
  if (juxtaposed) {
   const agentTurn: Turn = {
    role: 'agent',
    text: juxtaposed,
    at: new Date().toISOString(),
    questionForm: 'deliberative',
   };
   s.deps.vault.appendTurn(s.id, agentTurn);
   s.turns.push(agentTurn);
   s.questionCount++;
   return {
    kind: 'probe',
    text: agentTurn.text,
    questionForm: 'deliberative',
    provenance: 'juxtaposition',
   };
  }
 }

 // Priority 2: red-light detection → composed follow-up
 const lights = await redLights(text, s.deps.complete);
 for (const light of lights) {
  const followUp = await composeFollowUp(text, light, s.deps.complete);
  if (followUp) {
   const agentTurn: Turn = {
    role: 'agent',
    text: followUp,
    at: new Date().toISOString(),
    questionForm: 'deliberative',
   };
   s.deps.vault.appendTurn(s.id, agentTurn);
   s.turns.push(agentTurn);
   s.questionCount++;
   return {
    kind: 'probe',
    text: agentTurn.text,
    questionForm: 'deliberative',
    provenance: 'composed',
   };
  }
 }

 // Priority 3: generic LLM probe (Target-aware protocol)
 const target: Target = s.mode.target ?? 'self';
 const protocols = PROTOCOLS[target] ?? PROTOCOLS.self;
 const probeIndex = s.questionCount;
 const systemPrompt = protocols[probeIndex % protocols.length]!;

 const response = await s.deps.complete(systemPrompt, s.turns, {
  temperature: 0.8,
 });

 if (response.includes('[SATURATED]')) {
  s.phase = 'closing-door';
  const agentTurn: Turn = {
   role: 'agent',
   text: CLOSING_DOOR_QUESTION,
   at: new Date().toISOString(),
   questionForm: 'deliberative',
  };
  s.deps.vault.appendTurn(s.id, agentTurn);
  s.turns.push(agentTurn);
  s.questionCount++;
  return {
   kind: 'probe',
   text: agentTurn.text,
   questionForm: 'deliberative',
   provenance: 'close',
  };
 }

 let probeText = response.trim();

 // ── Parrot guard (ticket 020): reject question that parrots the prompt ──
 if (isParrot(probeText, systemPrompt)) {
  console.warn('Elicitor: parrot guard triggered — question echoes prompt');
  // Retry with explicit anti-parrot instruction
  const guardedPrompt = `${systemPrompt}\n\nCRITICAL: Do NOT reuse any phrase, sentence shape, or near-substring from the instructions above. Compose an entirely fresh question from their words.`;
  const retryResponse = await s.deps.complete(guardedPrompt, s.turns, {
   temperature: 0.8,
  });
  if (retryResponse.includes('[SATURATED]')) {
   s.phase = 'closing-door';
   const agentTurn: Turn = {
    role: 'agent',
    text: CLOSING_DOOR_QUESTION,
    at: new Date().toISOString(),
    questionForm: 'deliberative',
   };
   s.deps.vault.appendTurn(s.id, agentTurn);
   s.turns.push(agentTurn);
   s.questionCount++;
   return {
    kind: 'probe',
    text: agentTurn.text,
    questionForm: 'deliberative',
    provenance: 'close',
   };
  }
  probeText = retryResponse.trim();
  if (isParrot(probeText, systemPrompt)) {
   console.warn('Elicitor: parrot guard retry also failed — drawing fallback');
   const fb = drawFallback(s);
   if (fb) return fb;
  }
 }

 // ── Conversation-referential guard: reject "this conversation" probes ──
 if (isConversationReferential(probeText)) {
  console.warn('Elicitor: conversation-referential guard triggered');
  const guardedPrompt = `${systemPrompt}\n\nCRITICAL: Your question must be about what the speaker said — not about the conversation itself. Do not reference "this conversation" or ask about the interaction.`;
  const retryResponse = await s.deps.complete(guardedPrompt, s.turns, {
   temperature: 0.8,
  });
  if (retryResponse.includes('[SATURATED]')) {
   s.phase = 'closing-door';
   const agentTurn: Turn = {
    role: 'agent',
    text: CLOSING_DOOR_QUESTION,
    at: new Date().toISOString(),
    questionForm: 'deliberative',
   };
   s.deps.vault.appendTurn(s.id, agentTurn);
   s.turns.push(agentTurn);
   s.questionCount++;
   return {
    kind: 'probe',
    text: agentTurn.text,
    questionForm: 'deliberative',
    provenance: 'close',
   };
  }
  probeText = retryResponse.trim();
  if (isConversationReferential(probeText)) {
   console.warn('Elicitor: conversation-ref guard retry also failed — drawing fallback');
   const fb = drawFallback(s);
   if (fb) return fb;
  }
 }

 // ── Near-duplicate guard: reject probes too similar to already-asked questions ──
 if (isNearDuplicate(probeText, s)) {
  console.warn('Elicitor: near-duplicate guard triggered');
  const askedTexts = s.turns
   .filter((t) => t.role === 'agent')
   .map((t) => t.text)
   .join(' | ');
  const guardedPrompt = `${systemPrompt}\n\nCRITICAL: Your question is too similar to one already asked in this conversation. Already asked: ${askedTexts}\n\nCompose a genuinely different question — different syntactic shape, different angle, different move from the repertoire.`;
  const retryResponse = await s.deps.complete(guardedPrompt, s.turns, {
   temperature: 0.8,
  });
  if (retryResponse.includes('[SATURATED]')) {
   s.phase = 'closing-door';
   const agentTurn: Turn = {
    role: 'agent',
    text: CLOSING_DOOR_QUESTION,
    at: new Date().toISOString(),
    questionForm: 'deliberative',
   };
   s.deps.vault.appendTurn(s.id, agentTurn);
   s.turns.push(agentTurn);
   s.questionCount++;
   return {
    kind: 'probe',
    text: agentTurn.text,
    questionForm: 'deliberative',
    provenance: 'close',
   };
  }
  probeText = retryResponse.trim();
  if (isNearDuplicate(probeText, s)) {
   console.warn('Elicitor: near-dup guard retry also failed — drawing fallback');
   const fb = drawFallback(s);
   if (fb) return fb;
  }
 }

 const agentTurn: Turn = {
  role: 'agent',
  text: probeText,
  at: new Date().toISOString(),
  questionForm: defaultQuestionForm,
 };

 s.deps.vault.appendTurn(s.id, agentTurn);
 s.turns.push(agentTurn);
 s.questionCount++;

 return {
  kind: 'probe',
  text: agentTurn.text,
  questionForm: defaultQuestionForm,
  provenance: 'probe',
 };
}

/**
 * Parrot guard: rejects a generated question that appears as a near-substring
 * of the prompt that produced it. Normalizes whitespace and case before checking.
 */
function isParrot(question: string, prompt: string): boolean {
 const normQ = question.replace(/\s+/g, ' ').toLowerCase().trim();
 const normP = prompt.replace(/\s+/g, ' ').toLowerCase();
 // Check for verbatim substring match of at least 8 words
 const qWords = normQ.split(' ');
 if (qWords.length < 4) return false;
 // Sliding window: check if any 4+ consecutive words from the question
 // appear as a substring in the prompt
 for (let i = 0; i <= qWords.length - 4; i++) {
  const phrase = qWords.slice(i, i + 4).join(' ');
  if (normP.includes(phrase)) return true;
 }
 return false;
}

/**
 * Conversation-referential guard: rejects probes about the conversation itself.
 * "What are you trying to achieve in this conversation?" is furniture.
 */
function isConversationReferential(question: string): boolean {
 return /\bthis conversation\b/i.test(question);
}

/** Normalize question text for duplicate comparison. */
function normalizeQuestion(text: string): string {
 return text
  .toLowerCase()
  .replace(/[^\w\s]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
}

/**
 * Near-duplicate guard: rejects a generated probe that is too similar
 * to a question already asked in this session. Uses word-set Jaccard
 * similarity after normalization.
 */
function isNearDuplicate(question: string, session: SessionState): boolean {
 const normQ = normalizeQuestion(question);
 const qWords = new Set(normQ.split(' ').filter((w) => w.length > 1));
 if (qWords.size < 2) return false;

 for (const turn of session.turns) {
  if (turn.role !== 'agent') continue;
  const normA = normalizeQuestion(turn.text);
  const aWords = new Set(normA.split(' ').filter((w) => w.length > 1));
  if (aWords.size < 2) continue;

  const intersection = new Set([...qWords].filter((w) => aWords.has(w)));
  const union = new Set([...qWords, ...aWords]);
  if (union.size === 0) continue;

  const similarity = intersection.size / union.size;
  if (similarity >= 0.5) return true;
 }

 return false;
}

/**
 * Fallback draw from queue then bank. Returns a probe result or null if both empty.
 */
function drawFallback(s: SessionState):
 | { kind: 'probe'; text: string; questionForm: QuestionForm; provenance: QuestionProvenance }
 | null {
 // Try queue first
 const queueDraw = s.deps.queue.draw(s.mode, 'mid');
 if (queueDraw) {
  s.deps.queue.markAsked(queueDraw.id);
  const agentTurn: Turn = {
   role: 'agent',
   text: queueDraw.question,
   at: new Date().toISOString(),
   questionForm: queueDraw.questionForm,
  };
  s.deps.vault.appendTurn(s.id, agentTurn);
  s.turns.push(agentTurn);
  s.questionCount++;
  return {
   kind: 'probe',
   text: agentTurn.text,
   questionForm: queueDraw.questionForm,
   provenance: 'bank',
  };
 }

 // Bank fallback
 const unused = (s.bank ?? []).filter(
  (q) => !s.turns.some((t) => t.role === 'agent' && t.text === q.text),
 );
 if (unused.length > 0) {
  const pick = unused[Math.floor(Math.random() * unused.length)]!;
  const agentTurn: Turn = {
   role: 'agent',
   text: pick.text,
   at: new Date().toISOString(),
   questionForm: pick.questionForm,
   ...(pick.source ? { questionSource: pick.source } : {}),
  };
  s.deps.vault.appendTurn(s.id, agentTurn);
  s.turns.push(agentTurn);
  s.questionCount++;
  return {
   kind: 'probe',
   text: agentTurn.text,
   questionForm: pick.questionForm,
   provenance: 'bank',
  };
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
