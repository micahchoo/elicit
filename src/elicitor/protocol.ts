import type { QuestionForm, QuestionSource } from '../types.js';

export interface StarterQuestion {
  text: string;
  questionForm: QuestionForm;
  source?: QuestionSource;
}

/** Every LLM-generated probe carries this form; the protocol owns classification. */
export const defaultQuestionForm: QuestionForm = 'deliberative';


export const CLOSING_DOOR_QUESTION = "Anything else we didn't touch?";

/** The closing acknowledgment — not a question. Rendered after the closing-door
 *  answer, never written to the transcript (the transcript ends on the
 *  user's door answer). Says what happens next mechanically so the
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
