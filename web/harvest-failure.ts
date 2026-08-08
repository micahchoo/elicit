/**
 * The harvest-failure sentence (ticket 154).
 *
 * When a harvest's parse fails, the server logs `harvest-failed` and writes
 * NO pending record — the harvest-queue routes know nothing about the
 * sitting, so the person's only signal is the activity feed. The sentence
 * says what is true: the transcript is intact, and the stumble was the
 * reader's, not the words'. Reassurance is the fact, not an apology.
 */
export const HARVEST_FAILED_SENTENCE =
  'the reader stumbled on this sitting; your words are safe in the transcript.';

/** The activity-event slice the matcher reads (the client's own copy of the
 * shape; the server's type stays server-side). */
export type ActivityEventLike = { at: string; kind: string; detail: string };

/** The session id a detail line names, or null when it names none. */
function sessionOf(detail: string): string | null {
  const m = /session=([A-Za-z0-9_-]+)/.exec(detail);
  return m?.[1] ?? null;
}

/**
 * Whether the activity feed records a failed harvest for this session.
 *
 * `harvest-started` names its session. `harvest-failed` has two shapes — the
 * propose-throw variant names its session directly, and the parse-failed
 * variant (`parsed=false`) carries none, so it is attributed to the nearest
 * `harvest-started` BEFORE it. The backward walk keeps concurrent harvests
 * from crossing: a failure belongs to the start that preceded it, and only
 * to that one.
 */
export function harvestFailedFor(events: readonly ActivityEventLike[], sessionId: string): boolean {
  for (let i = 0; i < events.length; i++) {
    const failed = events[i];
    if (!failed || failed.kind !== 'harvest-failed') continue;
    // The propose-throw variant names its session outright.
    if (sessionOf(failed.detail) === sessionId) return true;
    // The parse-failed variant names none: walk back to the start that
    // preceded it — that session's harvest is the one that failed.
    for (let j = i - 1; j >= 0; j--) {
      const started = events[j];
      if (!started) continue;
      if (started.kind === 'harvest-started') {
        if (sessionOf(started.detail) === sessionId) return true;
        break; // this failure belongs to another session — keep looking
      }
    }
  }
  return false;
}
