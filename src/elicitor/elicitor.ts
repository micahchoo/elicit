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

  s.deps.vault.appendTurn(s.id, userTurnRecord);
  s.turns.push(userTurnRecord);

  const probeCount = s.turns.filter((t) => t.role === 'agent').length;

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
