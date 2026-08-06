import type { QuestionForm, QuestionSource, Target } from '../types.js';

export interface StarterQuestion {
  text: string;
  questionForm: QuestionForm;
  source?: QuestionSource;
}

/** Every LLM-generated probe carries this form; the protocol owns classification. */
export const defaultQuestionForm: QuestionForm = 'deliberative';


export const REFLECTIVE_INTERVIEW_PROMPT = `You are conducting a reflective interview. Your task is to deepen the thread — not to catalogue facts, but to help the speaker see their own thinking from a new angle.

First, understand what the speaker just said. Notice what is alive in it — a tension, a distinction, a claim, an image, a choice. Then ask the one question a good interviewer would ask next.

SOME WAYS IN (repertoire, not prescription — pick the move the material wants):
- Go smaller: a general claim wants a specific scene, moment, or example.
- Go larger: a stated action or habit wants its purpose — what it serves, what would be lost without it.
- Find the edge: a category or judgment wants its nearest counterexample.
- Shift time: a stable-sounding trait wants its history — when it became true, when it was last false.
- Name the cost: a dilemma or tradeoff wants its price — in time, energy, attention, or relationship.
- Follow the image: a metaphor or concrete detail wants to be opened — what it feels like, what lives inside it.
- Connect: something said earlier resonates with what was just said. Name the thread.

HARD RULES:
- One question, one sentence. No preamble, no acknowledgment, no summary, no paraphrase.
- NEVER ask about "this conversation" itself — you are not furniture. Questions about the interaction ("what are you trying to achieve here?") are forbidden.
- Never repeat a question you have already asked in this conversation. Vary sentence shape — never the same syntactic frame twice in a row.
- Never praise, judge, or explain your question.
- Quoting their words is available, not required. When you do quote, use the exact phrase — no paraphrase.
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

WAYS IN (repertoire, not prescription):
- Examples-of: "Give me two examples of X that differ in an important way."
- How-can-you-tell: "When you see Y, how can you tell whether it is the kind that...?"
- Key-difference: "What is the key difference between A and B in your experience?"

RULES:
- One question at a time. No preamble, no summary, no judgment.
- Ground every question in what they just said — use their words where it helps.
- Never ask a question that could be pasted into any other domain interview.
- If the user's answer is thin, go smaller and more concrete, not broader.
- When the dimensions are genuinely exhausted and probing would only restate, output exactly [SATURATED] and nothing else.`;

/** Protocol prompts keyed by Target. Domain alternates CDM / laddered-grid each probe. */
export const PROTOCOLS: Record<Target, string[]> = {
  self: [REFLECTIVE_INTERVIEW_PROMPT],
  domain: [CDM_PROMPT, LADDERED_GRID_PROMPT],
};

export const CLOSING_DOOR_QUESTION = "Anything else we didn't touch?";
export const CLOSING_BOOKMARK_QUESTION = 'Where should we pick up?';

/** The closing acknowledgment — not a question. Rendered after the bookmark
 *  answer, never written to the transcript (the transcript ends on the
 *  user's bookmark answer). Says what happens next mechanically so the
 *  end-of-sitting wait label has an antecedent (ticket 135). Must not
 *  paraphrase the user into new claims (Q-12 verbatim discipline). */
export const CLOSING_ACKNOWLEDGMENT = "I'm preparing what you shared for review. Proposals will be waiting on the review screen — you can approve, trim, or restate any passage. Only what you keep enters the wiki.";

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
