import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { ParkedLadder, QueueEntry, QueueStore, Rung, Target } from '../types.js';
import { parkPointer as queueParkPointer } from '../queue/queue.js';

/**
 * The pointer-source kind a parked sounding mints. Owned here, not by the
 * queue's draw: the queue filters parked pointers by the kinds configured
 * at construction, and the composition root passes this one in.
 */
export const PARKED_SOURCE = 'parked-sounding' as const;

/** `{root}/soundings/{id}.md` — the whole ladder, frontmatter only. */
function ladderPath(root: string, id: string): string {
  return join(root, 'soundings', `${id}.md`);
}

/**
 * The only sounding module that touches disk (T7 contract). A finished
 * ladder is the truth (Q-3), so it is written whole: a descent resumed from
 * a rung number is not a descent resumed at all.
 */
export function writeLadder(root: string, l: ParkedLadder): void {
  const fm: Record<string, unknown> = {
    id: l.id,
    session: l.session,
    started: l.started,
    ended: l.ended,
    endedBy: l.endedBy,
    construct: l.construct,
    licensingAnswer: l.licensingAnswer,
    allowance: l.allowance,
    checkpointRung: l.checkpointRung,
    rungs: l.rungs.map((r: Rung) => ({
      question: r.question,
      foothold: r.foothold,
      answer: r.answer,
      at: r.at,
    })),
  };
  // Every optional field is written under a guard, never as a present key
  // holding `undefined` — `matter.stringify` throws on that and the whole
  // write is lost (queue.ts:245-248 records the lesson).
  if (l.pendingQuestion) fm.pendingQuestion = l.pendingQuestion;
  mkdirSync(join(root, 'soundings'), { recursive: true });
  writeFileSync(ladderPath(root, l.id), matter.stringify('', fm), 'utf-8');
}

/** Parse the ladder back; null when the file is missing. */
export function readLadder(root: string, id: string): ParkedLadder | null {
  try {
    const d = matter.read(ladderPath(root, id)).data as Record<string, unknown>;
    return {
      id: d.id as string,
      session: d.session as string,
      started: d.started as string,
      ended: d.ended as string,
      endedBy: d.endedBy as ParkedLadder['endedBy'],
      construct: d.construct as string,
      licensingAnswer: d.licensingAnswer as string,
      allowance: d.allowance as number,
      checkpointRung: d.checkpointRung as number,
      rungs: d.rungs as Rung[],
      ...(d.pendingQuestion
        ? { pendingQuestion: d.pendingQuestion as { text: string; foothold: string } }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The 'park' word mints this: a pointer whose `question` records the LAST
 * rung's question — what was on the table — never a composed next question
 * (Q-45). The draw never serves it (the 'sounding' filter); a resumption
 * reads the ladder, not the pointer (Q-3, Q-64).
 */
export function parkPointer(queue: QueueStore, l: ParkedLadder, target?: Target): QueueEntry {
  const last = l.rungs[l.rungs.length - 1]!;
  return queueParkPointer(queue, {
    kind: PARKED_SOURCE,
    question: last.question,
    idField: { soundingId: l.id },
    ...(target ? { target } : {}),
  });
}
