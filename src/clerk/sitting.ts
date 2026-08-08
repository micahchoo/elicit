/**
 * Which sitting a snippet came from.
 *
 * A composed question inherits the Target of the sitting whose words it quotes
 * (ticket 045). The Snippet itself does not record a Target — its Provenance
 * records the session — so the Target is read back from that session's
 * transcript frontmatter, which `Vault.startTranscript` writes as `mode`.
 *
 * Absent is a real answer here, never a default of 'self'. A missing
 * transcript, an older transcript written before Mode carried a Target, or a
 * session whose Mode declared none, all produce an empty context — and an
 * entry with no Target claim serves either kind of sitting.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import type { Target } from '../types.js';
import { readTranscript } from '../vault/transcripts.js';
import type { SittingContext } from './composed.js';

/** Read one session's declared Target and topic from its transcript. */
export function readSitting(root: string, session: string): SittingContext {
  const t = readTranscript(root, session);
  if (t === null) return {};
  return {
    ...(t.target ? { target: t.target } : {}),
    ...(t.topic ? { topic: t.topic } : {}),
  };
}

/**
 * A `readSitting` that reads each session at most once.
 *
 * A docket run composes over every uncited snippet of the last two sittings,
 * so without this the same two transcripts are parsed once per snippet.
 */
export function sittingCache(
  root: string,
  read: (root: string, session: string) => SittingContext = readSitting,
): (session: string) => SittingContext {
  const seen = new Map<string, SittingContext>();
  return (session: string) => {
    let ctx = seen.get(session);
    if (ctx === undefined) {
      ctx = read(root, session);
      seen.set(session, ctx);
    }
    return ctx;
  };
}
