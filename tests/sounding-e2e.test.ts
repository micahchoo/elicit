import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import type { Hono } from 'hono';

import { createVault } from '../src/vault/vault.js';
import { makeScriptedComplete } from './fakes.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { readLadder } from '../src/sounding/park.js';
import { runDocket } from '../src/clerk/docket.js';
import { composeOpener, composeStillTrue } from '../src/clerk/composed.js';
import { runLadderSummaries } from '../src/clerk/sounding-summary.js';
import { appendEvent, type ActivityEvent } from '../src/log/activity.js';
import { CLOSING_DOOR_QUESTION, CLOSING_BOOKMARK_QUESTION } from '../src/elicitor/protocol.js';
import type { Complete, QueueStore, Vault } from '../src/types.js';

// ── Helpers ──

type TestApp = {
 app: Hono;
 root: string;
 queue: QueueStore;
 vault: Vault;
 complete: Complete;
};

/** Counts settled background docket runs and lets a test wait for one (tests/e2e.test.ts:127). */
function docketBarrier() {
 let settled = 0;
 const waiting: (() => void)[] = [];
 return {
  onDocketSettled(): void {
   settled++;
   for (const w of waiting.splice(0)) w();
  },
  get count(): number {
   return settled;
  },
  async waitFor(n: number): Promise<void> {
   while (settled < n) await new Promise<void>((r) => waiting.push(r));
  },
 };
}

/** Call a route and parse the JSON body. */
async function post(app: Hono, path: string, body?: unknown): Promise<any> {
 const init: RequestInit =
  body === undefined
   ? { method: 'POST' }
   : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
 const res = await app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
 return res.json();
}

// ── The scripted material ──
// The tests/e2e.test.ts pattern: a real createApp over a temp vault, a real
// createQueueStore, and a scripted Complete. The fixture strategy mirrors
// tests/sounding-routes.test.ts (T8): one thread of shared vocabulary so the
// license's sustained check fires, rich answers that hold their scripted
// phrase verbatim, and follow-up questions in the one shape every composed
// question takes (040).

/** One thread, so the license's sustained check (mean adjacent Jaccard over
 * the last three turns, >= 0.15) fires at the ninth turn. */
const THREAD = [
 'I keep noticing the pull toward the work even when I resist it.',
 'What I keep wanting is being seen in the work, and the pull agrees.',
 'Somehow the work and the pull both circle around being seen.',
 'When the pull arrives, I notice being seen in the work more clearly.',
 'I value being seen more than the pull being easy.',
 'I find the work asks me to follow the pull even when being seen stretches me.',
 'I notice the pull is quieter now, but being seen in the work keeps me honest.',
 'What I keep coming back to is being seen in the work.',
 'I suspect the work would be nothing without the pull of being seen honestly.',
] as const;

/** The red-light phrase the nth pre-offer turn is scripted to flag. */
const THREAD_PHRASES = ['the pull', 'being seen', 'the work'] as const;

/** A follow-up question in the one shape every composed question takes (040). */
function followUp(phrase: string, tail: string): string {
 return `You wrote: "${phrase}." ${tail}`;
}

/** The pre-offer turns' scripted questions; pairwise word-set Jaccard stays
 * under the near-duplicate guard's 0.5 bar, each quoting its phrase verbatim. */
const PRE_TAILS = [
 'When did you first notice the pull in your days?',
 'What does being seen make possible for you?',
 'How does the work choose what needs doing?',
 'What would it take to follow the pull this week?',
 'Who sees the work when you are in it?',
 'What part of the work asks the most of you?',
 'Where does the pull leave you at the end of a week?',
 'How much of yourself shows up when you write?',
 'What keeps you coming back to the work at all?',
] as const;

/** The descent's answers, each >= 8 words and holding its scripted phrase. */
const RUNG_ANSWERS = [
 'For the first time today I let the pull carry the whole sitting forward.',
 'It took me a while to admit that being seen changes how the room feels.',
 'I left the work on the desk overnight and found it waiting this morning.',
 'Each day the pull returns with the coffee and stays past the last line.',
 'What I resist about being seen is the part that wants to stay hidden.',
 'Until I name it, the work keeps circling the same unfinished paragraph.',
 'Late in the afternoon the pull asks again what I am avoiding in the page.',
 'I can hear the work and the pull arguing about being seen in the margins.',
 'The margins hold what neither voice could settle before the morning came back.',
 'I brought the pull to the window and let the light name it for the first time.',
 'Being seen by the work taught me something the room could not hold on its own.',
 'The work and the pull, finally quiet together on the same page this morning.',
] as const;

/** The rung questions, indexed by the rung they ask. The answers above never
 * share a trigram, so the echo check in descentEnd cannot mistake them for
 * convergence. */
const RUNG_TAILS = [
 'What would the work be without the pull of being seen?',
 'What does the pull ask of you right now?',
 'Where does being seen lead when you follow it?',
 'When did the work last ask you to sit down and name it?',
 'How does the pull sit with the work so far?',
 'What would change if nobody watched the page?',
 'What would you notice next if you stayed with the page?',
 'What keeps the pull present in your afternoons?',
 'What stays with being seen when the arguing rests?',
 'What did the light name when you brought the pull to the window?',
 'What happens when the room cannot hold what being seen taught you?',
 'What changes now that the work and the pull lie quiet on the same page?',
] as const;

/** The phrase the rung-k question quotes (RUNG_ANSWERS[k-1] holds it). Rung 0
 * is composed from the LICENSING answer — the ninth pre-offer turn's text —
 * and that answer is composed twice: once for the pre-offer turn's follow-up
 * (which quotes THREAD_PHRASES[8 % 3] = 'the work') and once for the accept,
 * so rung 0 quotes a DIFFERENT substring of the same answer ('being seen' is
 * the last half of THREAD[8]). */
const RUNG_PHRASES = ['being seen', 'the pull', 'being seen', 'the work', 'the pull', 'being seen', 'the work', 'the pull', 'being seen', 'the work', 'the pull', 'being seen'] as const;

function aRichAnswer(i: number): string {
 return RUNG_ANSWERS[i - 1]!;
}

/** The bookmark answer both sittings give; the second sitting's opener draws it. */
const BOOKMARK = 'I want to keep writing about the garden in spring.';

/** The scripted complete pair for one composed turn: red-light JSON, then the question. */
function turnScript(phrase: string, question: string): string[] {
 return [
  JSON.stringify({ lights: [{ kind: 'unexplored-referent', phrase }] }),
  question,
 ];
}

/** Test A's script: six pre-offer turns, the accept's rung-0 composition,
 * rungs 1-5, the checkpoint continue's composition, rungs 7-11. The checkpoint
 * turn and the cap turn compose nothing. (Allowance 12, checkpoint 6 —
 * re-derived 2026-08-05 gate-repair.) */
function capScript(): string[] {
 const out: string[] = [];
 for (let i = 0; i < 6; i++) {
  out.push(...turnScript(THREAD_PHRASES[i % 3]!, followUp(THREAD_PHRASES[i % 3]!, PRE_TAILS[i]!)));
 }
 // The accept composes rung 0 from the licensing answer — phrase differs from
 // the pre-offer turn that earned the offer.
 out.push(...turnScript(RUNG_PHRASES[0]!, followUp(RUNG_PHRASES[0]!, RUNG_TAILS[0]!)));
 for (const k of [1, 2, 3, 4, 5]) {
  out.push(...turnScript(RUNG_PHRASES[k]!, followUp(RUNG_PHRASES[k]!, RUNG_TAILS[k]!)));
 }
 // rung 6 → checkpoint: no calls; the continue composes rung 7's question.
 out.push(...turnScript(RUNG_PHRASES[6]!, followUp(RUNG_PHRASES[6]!, RUNG_TAILS[6]!)));
 for (const k of [7, 8, 9, 10, 11]) {
  out.push(...turnScript(RUNG_PHRASES[k]!, followUp(RUNG_PHRASES[k]!, RUNG_TAILS[k]!)));
 }
 return out;
}

/** Test B's script: the same sitting-1 walk down to the park, then the docket's
 * ladder-summary call, the second sitting's fresh resume composition (foothold
 * from the last kept rung), and rung 5's own composition. */
function parkScript(): string[] {
 const out: string[] = [];
 for (let i = 0; i < 6; i++) {
  out.push(...turnScript(THREAD_PHRASES[i % 3]!, followUp(THREAD_PHRASES[i % 3]!, PRE_TAILS[i]!)));
 }
 out.push(...turnScript(RUNG_PHRASES[0]!, followUp(RUNG_PHRASES[0]!, RUNG_TAILS[0]!)));
 for (const k of [1, 2, 3, 4]) {
  out.push(...turnScript(RUNG_PHRASES[k]!, followUp(RUNG_PHRASES[k]!, RUNG_TAILS[k]!)));
 }
 // rung 5 → checkpoint: no calls; the continue composes rung 6's question.
 out.push(...turnScript(RUNG_PHRASES[5]!, followUp(RUNG_PHRASES[5]!, RUNG_TAILS[5]!)));
 // park: no calls. Then the docket's ladder-summary job, one line.
 out.push('it ran from being seen to a shed nobody entered');
 // The second sitting's resume: a question composed FRESH, quoting the last
 // kept answer (the rung the descent was parked on).
 out.push(...turnScript('being seen', followUp('being seen', 'What does being seen need from you this week?')));
 // Rung 6's answer composes rung 7's question.
 out.push(...turnScript(RUNG_PHRASES[6]!, followUp(RUNG_PHRASES[6]!, RUNG_TAILS[6]!)));
 return out;
}

// ── The boot ──

const roots: string[] = [];

afterAll(() => {
 for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Boot the REAL app over a temp vault and wait for its boot docket, which
 * settles over an empty vault without a model call — the scripted Complete is
 * then aligned with the sitting's own calls. */
async function makeApp(script: string[], modelName?: string): Promise<TestApp> {
 const root = mkdtempSync(join(tmpdir(), 'elicit-sounding-e2e-'));
 roots.push(root);
 const vault = createVault(root);
 const complete = makeScriptedComplete(script);
 const queue = createQueueStore(root);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(root, '.auth.json'));
 const barrier = docketBarrier();
 const app = await createApp({
  vault,
  complete,
  queue,
  index,
  vaultRoot: root,
  authStore,
  ...(modelName ? { modelName } : {}),
  onDocketSettled: barrier.onDocketSettled,
 });
 await barrier.waitFor(1);
 return { app, root, queue, vault, complete };
}

async function newSession(app: Hono, minutes = 20): Promise<string> {
 const res = await post(app, '/api/session', { mode: { minutes, energy: 'medium' } });
 expect(res.sessionId).toBeTruthy();
 return res.sessionId;
}

/** Drive turns until the response carries the offer; returns it and the answer that earned it. */
async function turnUntilLicensed(app: Hono, sessionId: string): Promise<{ res: any; licensingAnswer: string }> {
 for (let i = 0; i < 12; i++) {
  const text = THREAD[i % THREAD.length]!;
  const res = await post(app, `/api/session/${sessionId}/turn`, { text });
  if (res.soundingOffer) return { res, licensingAnswer: text };
 }
 throw new Error('the offer never arrived');
}

// ── The tests ──

describe('soundings end to end (Task 13)', () => {
 it('the descent runs itself out: cap closes it, the on-disk ladder chains every rung, and the sitting keeps going', async () => {
  const { app, root } = await makeApp([...capScript(), 'padding a', 'padding b', 'padding c', 'padding d']);
  const id = await newSession(app);

  // 1. Turn until the license fires; the offer arrives with a number in its sentence.
  const { res: offer, licensingAnswer } = await turnUntilLicensed(app, id);
  expect(offer.soundingOffer).toBeDefined();
  expect(offer.soundingOffer.allowance).toBe(12);
  expect(offer.soundingOffer.sentence).toContain(String(offer.soundingOffer.allowance));

  // 2. Accept: rung 0's question is composed. The foothold is asserted from
  //    the on-disk ladder below, never from this response.
  const accepted = await post(app, `/api/session/${id}/sounding`, { accept: true });
  expect(accepted.kind).toBe('probe');
  expect(accepted.text).toBeTruthy();
  expect(accepted.sounding).toEqual({ rung: 0, of: 12, checkpoint: false });

  // 3. Answer every rung, never pressing park or another-day — the checkpoint's
  //    mandatory continue is the mechanism, not a gate word.
  let soundingId: string | undefined;
  for (let i = 1; i <= 12; i++) {
   const res = await post(app, `/api/session/${id}/turn`, { text: aRichAnswer(i) });
   if (res.descentClosed) {
    // 4. The cap closed the descent on the eighth answer, with the door
    //    question already on the wire.
    expect(res.descentClosed).toBe('cap');
    expect(res.soundingId).toBeTruthy();
    expect(res.phase).toBe('closing-door');
    expect(res.text).toBe(CLOSING_DOOR_QUESTION);
    soundingId = res.soundingId;
    break;
   }
   if (i === 6) {
    expect(res.kind).toBe('checkpoint');
    expect(res.text).toBeUndefined();
    expect(res.sounding).toEqual({ rung: 6, of: 12, checkpoint: true });
    const gate = await post(app, `/api/session/${id}/sounding/gate`, { choice: 'continue' });
    expect(gate.kind).toBe('probe');
    expect(gate.text).toBeTruthy();
   } else {
    expect(res.kind).toBe('probe');
    expect(res.text).toBeTruthy();
    expect(res.sounding).toEqual({ rung: i, of: 12, checkpoint: false });
   }
  }
  expect(soundingId).toBeDefined();

  // The ladder on disk is the truth (Q-3): `soundings/<id>.md`, not the wire.
  const ladder = readLadder(root, soundingId!);
  expect(ladder).not.toBeNull();
  expect(ladder!.endedBy).toBe('cap');
  expect(ladder!.rungs.length).toBe(ladder!.allowance);
  expect(ladder!.licensingAnswer).toBe(licensingAnswer);
  // Every rung's foothold is a verbatim substring of the preceding rung's
  // answer — rung 0 against the licensing answer. Walk the whole array; this
  // is the one place the backwards chain is checked against real composed
  // questions rather than fixtures.
  expect(ladder!.licensingAnswer).toContain(ladder!.rungs[0]!.foothold);
  for (let i = 1; i < ladder!.rungs.length; i++) {
   expect(ladder!.rungs[i - 1]!.answer).toContain(ladder!.rungs[i]!.foothold);
  }
  for (const rung of ladder!.rungs) {
   expect(rung.question).toContain(rung.foothold);
  }

  // 5. The sitting continues: the door answer brings the bookmark question,
  //    and the bookmark answer saturates.
  const door = await post(app, `/api/session/${id}/turn`, { text: 'Nothing else for now.' });
  expect(door.kind).toBe('probe');
  expect(door.text).toBe(CLOSING_BOOKMARK_QUESTION);
  expect(door.phase).toBe('closing-bookmark');
  const bookmark = await post(app, `/api/session/${id}/turn`, { text: BOOKMARK });
  expect(bookmark.kind).toBe('saturated');
 });

 it('the descent that is parked and picked up: the pointer is never drawn, the docket summarizes it, and the resumed chain keeps its footing', async () => {
  const { app, root, queue, vault, complete } = await makeApp([...parkScript(), 'padding a', 'padding b', 'padding c', 'padding d'], 'test-clerk');
  const id1 = await newSession(app);
  await turnUntilLicensed(app, id1);
  const accepted = await post(app, `/api/session/${id1}/sounding`, { accept: true });
  expect(accepted.sounding).toEqual({ rung: 0, of: 12, checkpoint: false });

  // 1. Four rungs, each carrying the gate reading and the next question together.
  for (let i = 1; i <= 4; i++) {
   const res = await post(app, `/api/session/${id1}/turn`, { text: aRichAnswer(i) });
   expect(res.kind).toBe('probe');
   expect(res.text).toBeTruthy();
   expect(res.sounding).toEqual({ rung: i, of: 12, checkpoint: false });
  }

  // 2. The checkpoint rung: no question until a gate word arrives.
  const checkpoint = await post(app, `/api/session/${id1}/turn`, { text: aRichAnswer(5) });
  expect(checkpoint.kind).toBe('checkpoint');
  expect(checkpoint.text).toBeUndefined();
  expect(checkpoint.sounding).toEqual({ rung: 5, of: 12, checkpoint: true });

  // 3. Continue: a probe comes back.
  const cont = await post(app, `/api/session/${id1}/sounding/gate`, { choice: 'continue' });
  expect(cont.kind).toBe('probe');
  expect(cont.text).toBeTruthy();

  // 4. Park: the ladder file holds every rung, the Queue holds one pointer,
  //    and the draw never returns it (the 'sounding' filter is not relaxable).
  const parked = await post(app, `/api/session/${id1}/sounding/gate`, { choice: 'park' });
  expect(parked.kind).toBe('descent-closed');
  expect(parked.endedBy).toBe('park');
  expect(parked.phase).toBe('closing-door');
  expect(parked.soundingId).toBeTruthy();
  const soundingId = parked.soundingId as string;

  const ladder = readLadder(root, soundingId);
  expect(ladder).not.toBeNull();
  expect(ladder!.endedBy).toBe('park');
  expect(ladder!.rungs.length).toBe(5);
  expect(ladder!.licensingAnswer).toContain(ladder!.rungs[0]!.foothold);
  for (let i = 1; i < ladder!.rungs.length; i++) {
   expect(ladder!.rungs[i - 1]!.answer).toContain(ladder!.rungs[i]!.foothold);
  }
  const pointers = queue.list({ source: 'parked-sounding' });
  expect(pointers).toHaveLength(1);
  const pointer = pointers[0]!;
  const draw = queue.draw({ minutes: 20, energy: 'medium', target: 'self' }, 'opening');
  expect(draw).toBeNull();

  // 5. Run the docket: the ladder-summary job stamps one line for the parked
  //    ladder, model-stamped (frontmatter model + at).
  await runDocket({
   vault,
   queue,
   complete,
   buildIndex: (snippets) => buildIndex(snippets),
   composeOpener,
   composeStillTrue,
   listSessions: () => [],
   runLadderSummaries,
   modelName: 'test-clerk',
   log: (e) => appendEvent(root, e as ActivityEvent),
   vaultRoot: root,
  });
  const summariesDir = join(root, 'marginalia', 'sounding-summaries');
  expect(existsSync(summariesDir)).toBe(true);
  const summaryFiles = readdirSync(summariesDir).filter((f) => f.endsWith('.md'));
  expect(summaryFiles).toHaveLength(1);
  const summary = matter(readFileSync(join(summariesDir, summaryFiles[0]!), 'utf-8'));
  expect(summary.data.model).toBe('test-clerk');
  // The stamp is a YAML ISO timestamp, which gray-matter parses as a Date.
  expect(summary.data.at).toBeInstanceOf(Date);
  expect(summary.content.trim()).toBe('it ran from being seen to a shed nobody entered');

  // The first sitting still closes cleanly: door then bookmark.
  const door1 = await post(app, `/api/session/${id1}/turn`, { text: 'Nothing else for now.' });
  expect(door1.kind).toBe('probe');
  expect(door1.text).toBe(CLOSING_BOOKMARK_QUESTION);
  const saturated1 = await post(app, `/api/session/${id1}/turn`, { text: BOOKMARK });
  expect(saturated1.kind).toBe('saturated');

  // 6. A second sitting: the opener is the bookmark the first sitting declared
  //    — never the parked pointer's question.
  const sess2 = await post(app, '/api/session', { mode: { minutes: 20, energy: 'medium' } });
  expect(sess2.sessionId).toBeTruthy();
  expect(sess2.question).toBe(BOOKMARK);
  expect(sess2.question).not.toBe(ladder!.rungs.at(-1)!.question);
  const id2 = sess2.sessionId as string;

  // 7. Resume from the pointer: a question composed FRESH at resume time
  //    (Q-45) — not the parked ladder's last question — whose foothold is a
  //    substring of the last kept answer, carrying the parked rung count.
  const resumed = await post(app, `/api/session/${id2}/sounding/resume`, { queueEntryId: pointer.id });
  expect(resumed.kind).toBe('probe');
  expect(resumed.text).toBeTruthy();
  expect(resumed.text).not.toBe(ladder!.rungs.at(-1)!.question);
  expect(ladder!.rungs.at(-1)!.answer).toContain('being seen');
  expect(resumed.text).toContain('being seen');
  expect(resumed.sounding).toEqual({ rung: ladder!.rungs.length, of: 12, checkpoint: false });

  // Answer the resumed question: addRung enforces the backwards chain live.
  // The resumed allowance is 12, so its checkpoint is ceil(12/2) = 6 — the
  // very next rung. The answer lands as the checkpoint, question withheld.
  const rung6 = await post(app, `/api/session/${id2}/turn`, { text: aRichAnswer(6) });
  expect(rung6.kind).toBe('checkpoint');
  expect(rung6.text).toBeUndefined();
  expect(rung6.sounding).toEqual({ rung: 6, of: 12, checkpoint: true });

  // 8. Park again — one descent, one file — and the second sitting still ends
  //    with the door question and then the bookmark question.
  const parked2 = await post(app, `/api/session/${id2}/sounding/gate`, { choice: 'park' });
  expect(parked2.kind).toBe('descent-closed');
  expect(parked2.endedBy).toBe('park');
  expect(parked2.phase).toBe('closing-door');
  expect(parked2.soundingId).toBe(soundingId);
  const ladder2 = readLadder(root, soundingId);
  expect(ladder2).not.toBeNull();
  expect(ladder2!.rungs.length).toBe(6);
  expect(ladder2!.rungs[4]!.answer).toContain(ladder2!.rungs[5]!.foothold);
  expect(ladder2!.rungs[5]!.question).toContain(ladder2!.rungs[5]!.foothold);

  const door2 = await post(app, `/api/session/${id2}/turn`, { text: 'Nothing else for now.' });
  expect(door2.kind).toBe('probe');
  expect(door2.text).toBe(CLOSING_BOOKMARK_QUESTION);
  const saturated2 = await post(app, `/api/session/${id2}/turn`, { text: 'Somewhere else.' });
  expect(saturated2.kind).toBe('saturated');
 });
});
