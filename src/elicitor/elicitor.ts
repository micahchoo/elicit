import { ulid } from 'ulid';
import type { Complete, Mode, QuestionForm, SessionState, Turn, Vault } from '../types.js';
import {
 defaultQuestionForm,
 MAX_PROBES,
 REFLECTIVE_INTERVIEW_PROMPT,
 starterBank,
} from './protocol.js';

/** Picks an opener from the starter bank or forms one from mode.topic. */
function pickOpener(topic?: string): { text: string; questionForm: QuestionForm } {
 if (topic) {
  return {
   text: `You mentioned ${topic}. What would you like to explore about that?`,
   questionForm: 'deliberative',
  };
 }
 const pick = starterBank[Math.floor(Math.random() * starterBank.length)]!;
 return { text: pick.text, questionForm: pick.questionForm };
}

export function startSession(
 mode: Mode,
 deps: { complete: Complete; vault: Vault },
): SessionState {
 const id = ulid();
 const started = new Date().toISOString();
 const opener = pickOpener(mode.topic);

 deps.vault.startTranscript(id, { mode, protocol: 'reflective-interview', started });

 const openerTurn: Turn = {
  role: 'agent',
  text: opener.text,
  at: started,
  questionForm: opener.questionForm,
 };

 deps.vault.appendTurn(id, openerTurn);

 return {
  id,
  mode,
  protocol: 'reflective-interview',
  deps,
  turns: [openerTurn],
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

/** Static lookup of starter question texts. */
const starterTexts: Record<string, true> = Object.fromEntries(
 starterBank.map((s) => [s.text, true] as const),
);
/** Returns the set of starter texts already used (asked or skipped) in this session. */
function usedStarters(turns: Turn[]): Set<string> {
 const used = new Set<string>();
 for (const t of turns) {
  if (t.role === 'agent' && t.text in starterTexts) {
   used.add(t.text);
  }
 }
 return used;
}

/**
 * Skip the current question during an exchange.
 * Marks the last agent turn skipped in memory, picks an unused starter,
 * and appends the replacement as a new agent turn.
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

 const used = usedStarters(s.turns);
 const available = starterBank.filter((st) => !used.has(st.text));

 if (available.length === 0) return { kind: 'exhausted' };

 const pick = available[Math.floor(Math.random() * available.length)]!;
 const agentTurn: Turn = {
  role: 'agent',
  text: pick.text,
  at: new Date().toISOString(),
  questionForm: pick.questionForm,
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
