/**
 * The harvest review queue: finished proposals on disk, claimable across
 * restarts (ticket 084).
 *
 * `sessionProposals` is an in-memory Map, so a restart between /end and
 * /harvest used to evaporate a sitting's harvest. This module is the 075
 * deferral pattern applied to that seam: a finished run writes
 * `<vault>/harvest/pending/<sessionId>.json`; deciding reads it and removes
 * it; an unfinished run writes nothing, because the transcript is already on
 * disk and recovery is a re-run, never a resume.
 *
 * The record also carries the capture-channel resolution (ticket 048) so a
 * decided harvest after a restart still stamps its Snippets with the channel
 * of the turn that produced them — the live session map is gone by then, and
 * `turnChannels` was the only place that mapping lived.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaptureChannel, CutProposal } from '../types.js';

export type PendingHarvest = {
 sessionId: string;
 /** When the harvest finished — the queue orders by this, newest first. */
 at: string;
 /** When the sitting started — the date shown on the review surface. */
 started: string;
 /** 'unprompted', or the sitting protocol. */
 protocol: string;
 /** Origin of the kept material; decide() stamps it into Provenance. */
 origin: 'harvest' | 'unprompted';
 proposals: CutProposal[];
 /**
  * Capture channel per user-turn ordinal, index-aligned with
  * `CutProposal.sourceTurn`. Sitting harvests only. Present only when the
  * sitting recorded at least one channel; an undefined slot means that turn
  * declared none, exactly as the live map read it.
  */
 turnChannels?: (CaptureChannel | undefined)[];
 /** The single channel of an unprompted entry, when the client declared one. */
 unpromptedChannel?: CaptureChannel;
};

function pendingDir(root: string): string {
 return join(root, 'harvest', 'pending');
}

/**
 * A session id must be a plain token. The queue endpoints are reachable
 * without auth (all /api routes are), so a raw join would let a crafted id
 * walk out of the pending directory.
 */
function isSafeId(sessionId: string): boolean {
 return /^[A-Za-z0-9_-]{1,64}$/.test(sessionId);
}

export function writePendingHarvest(root: string, record: PendingHarvest): void {
 if (!isSafeId(record.sessionId)) throw new Error(`refusing unsafe session id: ${record.sessionId}`);
 const dir = pendingDir(root);
 mkdirSync(dir, { recursive: true });
 writeFileSync(join(dir, `${record.sessionId}.json`), JSON.stringify(record, null, 1), 'utf-8');
}

/**
 * One pending harvest, or null when the record is missing or corrupt. A
 * half-written final record is skipped on the sweep ledger's precedent — it
 * must not hide the records beside it, and an unfinished harvest re-runs from
 * the transcript anyway.
 */
export function readPendingHarvest(root: string, sessionId: string): PendingHarvest | null {
 if (!isSafeId(sessionId)) return null;
 const file = join(pendingDir(root), `${sessionId}.json`);
 if (!existsSync(file)) return null;
 try {
  return JSON.parse(readFileSync(file, 'utf-8')) as PendingHarvest;
 } catch {
  return null;
 }
}

/** Every harvest awaiting review, newest first. Corrupt records are skipped. */
export function listPendingHarvests(root: string): PendingHarvest[] {
 const dir = pendingDir(root);
 if (!existsSync(dir)) return [];
 const records: PendingHarvest[] = [];
 for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const record = readPendingHarvest(root, f.slice(0, -'.json'.length));
  if (record) records.push(record);
 }
 records.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
 return records;
}

export function removePendingHarvest(root: string, sessionId: string): void {
 if (!isSafeId(sessionId)) return;
 rmSync(join(pendingDir(root), `${sessionId}.json`), { force: true });
}
