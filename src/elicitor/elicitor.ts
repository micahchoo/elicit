import { ulid } from 'ulid';
import type { Complete, Mode, QuestionForm, QuestionSource, SessionState, Turn, Vault } from '../types.js';
import {
 defaultQuestionForm,
 MAX_PROBES,
 REFLECTIVE_INTERVIEW_PROMPT,
 type StarterQuestion,
} from './protocol.js';
import { loadQuestionBank } from './bank.js';

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
 const pick = bank[Math.floor(Math.random() * bank.length)]!;
 return {
  text: pick.text,
  questionForm: pick.questionForm,
  ...(pick.source ? { source: pick.source } : {}),
 };
}

export function startSession(
 mode: Mode,
 deps: { complete: Complete; vault: Vault; bank?: StarterQuestion[] },
): SessionState {
 const id = ulid();
 const started = new Date().toISOString();
 const bank = deps.bank ?? loadQuestionBank();
 const opener = pickOpener(bank, mode.topic);

 deps.vault.startTranscript(id, { mode, protocol: 'reflective-interview', started });

 const openerTurn: Turn = {
  role: 'agent',
  text: opener.text,
  at: started,
  questionForm: opener.questionForm,
  ...(opener.source ? { questionSource: opener.source } : {}),
 };

 deps.vault.appendTurn(id, openerTurn);

 return {
  id,
  mode,
  protocol: 'reflective-interview',
  deps,
  turns: [openerTurn],
  bank,
 };
}

export async function userTurn(
 s: SessionState,
 text: string,
): Promise<
 | { kind: 'probe'; text: string; questionForm: QuestionForm }
 | { kind: 'saturated' }
> {
 const now = new Date().toISOString();
 const userTurnRecord: Turn = { role: 'user', text, at: now };
 const probeCount = s.turns.filter((t) => t.role === 'agent' && !t.skipped).length;
 s.deps.vault.appendTurn(s.id, userTurnRecord);
 s.turns.push(userTurnRecord);

 if (probeCount >= MAX_PROBES) {
  return { kind: 'saturated' };
 }

 const response = await s.deps.complete(
  REFLECTIVE_INTERVIEW_PROMPT,
  s.turns,
  { temperature: 0.8 },
 );

 if (response.includes('[SATURATED]')) {
  return { kind: 'saturated' };
 }

 const agentTurn: Turn = {
  role: 'agent',
  text: response.trim(),
  at: new Date().toISOString(),
  questionForm: defaultQuestionForm,
 };

 s.deps.vault.appendTurn(s.id, agentTurn);
 s.turns.push(agentTurn);

 return { kind: 'probe', text: agentTurn.text, questionForm: defaultQuestionForm };
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
 * Skips do not count toward MAX_PROBES (Q-8: append before returning).
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

 return { kind: 'question', text: agentTurn.text, questionForm: pick.questionForm };
}

function findLastIndex<T>(arr: T[], pred: (el: T) => boolean): number {
 for (let i = arr.length - 1; i >= 0; i--) {
  if (pred(arr[i]!)) return i;
 }
 return -1;
}
