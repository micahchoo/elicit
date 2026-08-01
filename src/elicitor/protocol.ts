import type { QuestionForm } from '../types.js';

export interface StarterQuestion {
  text: string;
  questionForm: QuestionForm;
}

/** Every LLM-generated probe carries this form; the protocol owns classification. */
export const defaultQuestionForm: QuestionForm = 'deliberative';

/** Maximum agent probes per exchange (including the opener). */
export const MAX_PROBES = 6;

export const REFLECTIVE_INTERVIEW_PROMPT = `You are conducting a reflective interview. Your role is to draw out the person's thinking through short, open-ended probes — never leading questions, never evaluations, never summaries of what they said.

RULES:
- Ask one question at a time. Keep it short — usually one sentence.
- Prefer probes that invite the person to go deeper on what they just shared: "What did that feel like at the time?" "What did you make of that?" "And then what happened?"
- Never paraphrase or reframe what the person said. Their words are the signal.
- Never praise, judge, or diagnose.
- When the person has fully explored a thread and further probing would only restate, emit the exact token [SATURATED] on its own line. Do not add commentary.
- If the person's answer is thin or evasive, try one clean redirect: "Say more about that." If they still don't engage, move on with a fresh starter question.`;

export const starterBank: StarterQuestion[] = [
  {
    text: "What's been on your mind lately?",
    questionForm: 'deliberative',
  },
  {
    text: 'Tell me about a moment this week that stuck with you.',
    questionForm: 'deliberative',
  },
  {
    text: 'What do you believe about how people change?',
    questionForm: 'theoretical',
  },
  {
    text: 'Why do you do the work you do?',
    questionForm: 'why',
  },
  {
    text: "What's something you know now that you wish you'd known five years ago?",
    questionForm: 'deliberative',
  },
  {
    text: 'When did you last change your mind about something important?',
    questionForm: 'deliberative',
  },
  {
    text: 'What would you be doing if no one were watching?',
    questionForm: 'theoretical',
  },
  {
    text: "What's a decision you're sitting on right now?",
    questionForm: 'deliberative',
  },
  {
    text: "What do you value that most people don't?",
    questionForm: 'theoretical',
  },
  {
    text: "Why have you kept the commitments you've kept?",
    questionForm: 'why',
  },
];
