/**
 * Ticket 148 measurement: replay the archived shared vault's contaminated
 * serve sequence through the real QueueStore two-strike mechanism and count
 * how many cross-thread openers still get served.
 *
 * Method: copy the archived queue (READ-ONLY source) into a temp root,
 * reset entries to pending, then walk the recorded serve order (each
 * entry's answeredAt matched to the transcript whose sitting answered it,
 * ±2s). For each serve, feed the sitting's FIRST user reply to
 * recordReplyDisengagement — exactly what the live turn route now does —
 * and, before each new sitting, count how many of its would-be openers the
 * draw still offers.
 *
 * Historical fact from the archive: 18 entries were served as openers
 * across 20 Wendell/Tomas sittings. The number printed here is how many
 * of those serves survive the mechanism.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { createQueueStore } from '../src/queue/queue.js';

const ARCHIVE = 'archives/2026-08-05T05-28-13/vault';

// ── Load the recorded history ──
const queueDir = join(ARCHIVE, 'queue');
type Served = { id: string; answeredAt: string; question: string; cites: string[] };
const served: Served[] = [];
for (const f of readdirSync(queueDir).filter((f) => f.endsWith('.md'))) {
  const fm = matter(readFileSync(join(queueDir, f), 'utf8')).data as Record<string, any>;
  if (fm.answeredAt) {
    served.push({
      id: fm.id ?? f.replace('.md', ''),
      answeredAt: String(fm.answeredAt instanceof Date ? fm.answeredAt.toISOString() : fm.answeredAt),
      question: String(fm.question ?? ''),
      cites: Array.isArray(fm.cites) ? fm.cites.map(String) : [],
    });
  }
}
served.sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));

const transcripts: { session: string; started: string; firstReply: string }[] = [];
for (const f of readdirSync(join(ARCHIVE, 'transcripts')).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(ARCHIVE, 'transcripts', f), 'utf8');
  const fm = matter(raw).data as Record<string, any>;
  const m = raw.split(/^## user$/m)[1];
  const firstReply = m ? m.split(/^## /m)[0]!.trim() : '';
  const startedRaw = fm.started;
  const started = startedRaw instanceof Date ? startedRaw.toISOString() : String(startedRaw ?? '');
  transcripts.push({ session: String(fm.session ?? f.replace('.md', '')), started, firstReply });
}

function sittingFor(answeredAt: string): { session: string; firstReply: string } | undefined {
  const t = new Date(answeredAt).getTime();
  let best: { session: string; firstReply: string } | undefined;
  let bestDelta = 2000;
  for (const tr of transcripts) {
    const d = Math.abs(new Date(tr.started).getTime() - t);
    if (d < bestDelta) { bestDelta = d; best = tr; }
  }
  return best;
}

// ── Replay through the real store ──
const root = mkdtempSync(join(tmpdir(), 'measure-148-'));
cpSync(queueDir, join(root, 'queue'), { recursive: true });
const store = createQueueStore(root);
// Reset the history: everything answered becomes pending again.
for (const e of store.list()) {
  if (e.status === 'answered' || e.status === 'asked') store.markPending(e.id);
}

let servesBefore = 0;
let servesSurvived = 0;
let deferEvents = 0;
const perSitting: string[] = [];

// Q-115: the sitting-level ledger keys on sitting boundaries — advance the
// counter whenever the replay crosses into a new sitting, exactly as the
// live session route does, and let the store's own draw gate (paused or
// not) decide whether the serve would have happened.
let currentSitting = '';
let pausedBlocks = 0;
for (const s of served) {
  const sitting = sittingFor(s.answeredAt);
  if (!sitting || !sitting.firstReply) continue;
  if (sitting.session !== currentSitting) {
    currentSitting = sitting.session;
    store.noteSittingStarted();
  }
  servesBefore++;
  const entryNow = store.list().find((e) => e.id === s.id);
  const threadBlocked = !entryNow || entryNow.status === 'deferred';
  // The live path serves queue entries only through draw(), whose gate reads
  // the ledger. Read the same ledger here instead of calling draw() — a real
  // draw marks an arbitrary entry asked, and a drained pool would then
  // masquerade as the pause.
  const eng = JSON.parse(readFileSync(join(root, 'queue-engagement.json'), 'utf8')) as {
    sittingCounter: number; pausedUntilSitting: number;
  };
  const paused = eng.sittingCounter < eng.pausedUntilSitting;
  if (threadBlocked || paused) {
    if (paused && !threadBlocked) pausedBlocks++;
    perSitting.push(`blocked: entry ${s.id.slice(-6)} (${threadBlocked ? 'thread deferred' : 'queue paused'})`);
    continue;
  }
  servesSurvived++;
  const deferred = store.recordReplyDisengagement(s.id, sitting.firstReply);
  if (deferred) deferEvents++;
  perSitting.push(`serve ${servesSurvived}: entry ${s.id.slice(-6)} → sitting ${sitting.session.slice(-6)} ${deferred ? '→ THREAD DEFERRED' : ''}`);
}

console.log(perSitting.join('\n'));
console.log('---');
console.log(`historical serves replayed: ${servesBefore}`);
console.log(`serves surviving the two-strike mechanism: ${servesSurvived}`);
console.log(`thread-deferral events: ${deferEvents}`);
console.log(`blocked serves: ${servesBefore - servesSurvived} (queue-paused: ${pausedBlocks})`);
rmSync(root, { recursive: true, force: true });
