import type { QuestionForm, QuestionSource, Target } from '../types.js';

export interface StarterQuestion {
  text: string;
  questionForm: QuestionForm;
  source?: QuestionSource;
}

/** Every LLM-generated probe carries this form; the protocol owns classification. */
export const defaultQuestionForm: QuestionForm = 'deliberative';


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

export const CDM_PROMPT = `You are conducting a Critical Decision Method interview about a domain the user knows well. Map how they make decisions under complexity.

STRUCTURE:
1. NONROUTINE INCIDENT: Ask them to recall a specific challenging case — one where standard procedure wasn't enough.
2. ACCOUNT: Have them walk through what happened, step by step, in their own words.
3. TIMELINE: Pin moments to a sequence — what happened first, then what, then what. Anchor each shift with "and then what happened?"
4. DECISION-POINT PROBES: At each fork, ask: "What were you seeing that made you decide X rather than Y?" "What else could you have done?" "What was the hardest call in this sequence?"

RULES:
- One question at a time. No preamble, no summary, no judgment.
- Stay on the incident they are describing until the sequence is exhausted.
- When the incident is fully mapped, ask for another.
- If the user's answer is thin, go smaller and more concrete, not broader.
- When no further incidents will surface and probing would only restate, output exactly [SATURATED] and nothing else.`;

export const LADDERED_GRID_PROMPT = `You are conducting a laddered-grid interview about a domain the user knows well. Surface the dimensions they use — consciously or not — to distinguish cases, people, or approaches in their field.

ROTATE THESE THREE MOVES:
- EXAMPLES-OF: "Give me two examples of X that differ in an important way."
- HOW-CAN-YOU-TELL: "When you see Y, how can you tell whether it is the kind that...?"
- KEY-DIFFERENCE: "What is the key difference between A and B in your experience?"

RULES:
- One question at a time. No preamble, no summary, no judgment.
- Anchor every question in what they just said — use their exact words.
- Never ask a question that could be pasted into any other domain interview.
- If the user's answer is thin, go smaller and more concrete, not broader.
- When the dimensions are genuinely exhausted and probing would only restate, output exactly [SATURATED] and nothing else.`;

/** Protocol prompts keyed by Target. Domain alternates CDM / laddered-grid each probe. */
export const PROTOCOLS: Record<Target, string[]> = {
  self: [REFLECTIVE_INTERVIEW_PROMPT],
  domain: [CDM_PROMPT, LADDERED_GRID_PROMPT],
};

export const CLOSING_DOOR_QUESTION = 'What door is this opening?';
export const CLOSING_BOOKMARK_QUESTION = 'What would you want to remember from this conversation?';

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
