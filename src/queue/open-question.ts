/**
 * The open-question entry shape — the base fields every server-side mint of
 * a session-horizon open question shares. Before this module the four sites
 * (claim-challenged, gap-declared, gap-fill, defer) rebuilt
 * `{source, license, question, questionForm, sharpness:'weak',
 * horizon:'session'}` by hand, and the shape could drift one site at a time.
 *
 * The helper returns only the SHARED fields; a caller spreads its own extras
 * (`gap`, `modeNeeds`, ...) onto the result, so a site's extra fields stay
 * exactly where they are while the shared shape has ONE declaration.
 *
 * Pure module: type-only imports, so `web/main.ts` can bundle it (precedent:
 * `src/queue/mode-needs.ts`, which is also pure).
 */

import type { QuestionForm, QueueDraft, QueueEntry } from '../types.js';

export type OpenQuestionSeed = {
  source: QueueEntry['source'];
  license: string;
  question: string;
  questionForm: QuestionForm;
};

/**
 * The base of an open-question queue entry: the four seed fields plus the
 * fixed `sharpness: 'weak'` / `horizon: 'session'` pair. Spread site extras
 * onto the result before calling `QueueStore.add`.
 */
export function openQuestionEntry(seed: OpenQuestionSeed): QueueDraft {
  return {
    source: seed.source,
    license: seed.license,
    question: seed.question,
    questionForm: seed.questionForm,
    sharpness: 'weak',
    horizon: 'session',
  };
}
