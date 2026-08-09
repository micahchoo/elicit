/**
 * The transcript collection's read owner — ONE parser for every sitting file.
 *
 * The vault's write custody is centralized (startTranscript/appendTurn), but
 * the read side was not: each consumer hand-rolled readdirSync(transcripts)
 * + gray-matter with its own field handling (strata handles Date-vs-string
 * started, sitting reads mode, cadence reads started, lineage-mirror reads
 * protocol). A frontmatter change meant N coordinated edits with no type or
 * test tying them. This module is that single read — tolerant by default
 * (an unparseable transcript is skipped, never a throw), with the Date-vs-
 * string `started` normalization handled once. The skip is invisible
 * unless a caller opts in through the `onSkip` hook — adopt's reporting
 * seam makes an unparseable sitting visible instead of silently lost.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

/** The parsed identity of one sitting file. Absent fields stay absent. */
export type TranscriptMeta = {
  session: string;
  /** Normalized to an ISO string; a missing/empty started stays ''. */
  started: string;
  protocol?: string;
  /** The declared Mode's target, when the transcript declares one. */
  target?: 'self' | 'domain';
  /** The declared Mode's topic, when the transcript declares one. */
  topic?: string;
  quest?: string;
  direction?: string;
  /** The turn and char counters, when the frontmatter declares them. */
  turnCount?: number;
  chars?: number;
};

/** Read every transcript file, sorted by started ascending (oldest first). */
export function readTranscripts(root: string, onSkip?: (session: string) => void): TranscriptMeta[] {
  const dir = join(root, 'transcripts');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out: TranscriptMeta[] = [];
  for (const file of files) {
    const session = file.slice(0, -3);
    let parsed;
    try {
      parsed = matter(readFileSync(join(dir, file), 'utf-8'));
    } catch {
      onSkip?.(file.slice(0, -3)); // report the skip only to an opt-in listener
      continue; // an unreadable transcript tells us nothing
    }
    const d = parsed.data as Record<string, unknown>;
    const mode = (typeof d.mode === 'object' && d.mode !== null ? d.mode : {}) as Record<string, unknown>;
    const target = mode.target === 'self' || mode.target === 'domain' ? (mode.target as 'self' | 'domain') : undefined;
    const topic = typeof mode.topic === 'string' && mode.topic.trim().length > 0 ? mode.topic : undefined;
    const protocol = typeof d.protocol === 'string' ? d.protocol : undefined;
    const quest = typeof d.quest === 'string' ? d.quest : undefined;
    const direction = typeof d.direction === 'string' ? d.direction : undefined;
    const turnCount = typeof d.turnCount === 'number' ? d.turnCount : undefined;
    const chars = typeof d.chars === 'number' ? d.chars : undefined;
    const startedRaw = d.started;
    // gray-matter parses an unquoted ISO date into a Date; a quoted one stays
    // a string. Both occur in the real vault.
    const started = startedRaw instanceof Date
      ? startedRaw.toISOString()
      : typeof startedRaw === 'string'
        ? startedRaw
        : '';
    out.push({
      session,
      started,
      ...(protocol ? { protocol } : {}),
      ...(target ? { target } : {}),
      ...(topic ? { topic } : {}),
      ...(quest ? { quest } : {}),
      ...(direction ? { direction } : {}),
      ...(turnCount !== undefined ? { turnCount } : {}),
      ...(chars !== undefined ? { chars } : {}),
    });
  }
  out.sort((a, b) => a.started.localeCompare(b.started));
  return out;
}

/** Read one sitting file, or null when it is missing or unparseable. */
export function readTranscript(root: string, session: string): TranscriptMeta | null {
  return readTranscripts(root).find((t) => t.session === session) ?? null;
}

/** Body text of one sitting file, without frontmatter. '' when it is
 * missing or unparseable — the contract the old server.ts readTranscript
 * kept (existence check, then a raw matter read). Uses the SAME parse
 * invocation as readTranscripts, never matter.read: gray-matter caches
 * parses by content string, so a genuinely unparseable frontmatter throws
 * on first touch but is handed back as raw "content" on later cache hits.
 * The empty options object skips that cache, keeping the unparseable case
 * '' deterministically in any call order. */
export function readTranscriptBody(root: string, session: string): string {
  try {
    return matter(readFileSync(join(root, 'transcripts', `${session}.md`), 'utf-8'), {}).content;
  } catch {
    return '';
  }
}

/** The most recently MODIFIED sitting file, by filesystem mtime — a new
 * primitive: readTranscripts orders by `started`, which is not "which file
 * changed most recently". The ticket-135 close scan needs the mtime answer;
 * it used to hand-roll readdirSync+statSync inside the route. */
export function mostRecentlyModifiedTranscript(
  root: string,
): { session: string; path: string } | null {
  const dir = join(root, 'transcripts');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return null; // no transcripts directory — nothing was modified
  }
  let recent: { session: string; path: string } | null = null;
  let recentMtime = -Infinity;
  for (const file of files) {
    const path = join(dir, file);
    let mtimeMs: number | undefined;
    try {
      const st = statSync(path);
      if (st.isFile()) mtimeMs = st.mtimeMs;
    } catch {
      // raced away mid-scan; not a candidate
    }
    if (mtimeMs === undefined || mtimeMs <= recentMtime) continue;
    recent = { session: file.slice(0, -3), path };
    recentMtime = mtimeMs;
  }
  return recent;
}

/** Append the two-move closing section (Q-20) to a transcript. */
export function appendClosing(root: string, session: string, line: string): void {
  const file = join(root, 'transcripts', `${session}.md`);
  const existing = readFileSync(file, 'utf-8');
  const prevLen = Buffer.byteLength(existing);
  const block = `## closing\n\n${line}\n\n`;
  const updated = existing + block;
  if (Buffer.byteLength(updated) < prevLen) {
    throw new Error(
      `appendClosing would shrink transcript "${session}". It will not be applied.`,
    );
  }
  writeFileSync(file, updated, 'utf-8');
}
