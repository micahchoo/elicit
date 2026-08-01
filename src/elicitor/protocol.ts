import type { QuestionForm, QuestionSource } from '../types.js';

export interface StarterQuestion {
  text: string;
  questionForm: QuestionForm;
  source?: QuestionSource;
}

/** Every LLM-generated probe carries this form; the protocol owns classification. */
export const defaultQuestionForm: QuestionForm = 'deliberative';

/** Maximum agent probes per exchange (including the opener). */
export const MAX_PROBES = 6;

export const REFLECTIVE_INTERVIEW_PROMPT = `You are conducting a reflective interview. Given the conversation so far, produce the single next probe — one short question that deepens the thread.

ANCHOR EVERY PROBE IN THEIR EXACT WORDS. Pick the most alive phrase from their last answer and build your question around it, quoting it. If they said "something happens to them", ask "What kind of something?" — not a generic follow-up.

ROTATE THESE MOVES — never the same move twice in a row, and compose the wording fresh each time from their phrase:
- SPECIFY: take a vague word they used and ask what kind, which one, or where it shows up.
- INSTANCE: if they spoke in generalities, ask for one concrete episode — a particular day, place, or person.
- FEELING: if they described an event, ask what it was like for them at the time.
- CONTRAST: ask what their word stands against — what the alternative or opposite was.
- MEANING: ask what this says about what matters to them.
Pick the move their last answer calls for: an answer that is already a concrete episode wants FEELING or MEANING, not another INSTANCE.

HARD RULES:
- One question, one sentence, no preamble, no acknowledgment, no summary of what they said.
- Never ask a question you have already asked in this conversation, and never reuse its sentence shape.
- Never praise, judge, paraphrase, or reframe. Never explain your question.
- Never emit a probe that could be pasted into any other interview — if it contains none of their words, it is wrong.
- If their answer is thin, make the probe smaller and more concrete, not broader.
- When the thread is genuinely exhausted and probing would only restate, output exactly [SATURATED] and nothing else.`;

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
