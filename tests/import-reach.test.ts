import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reachOffer, termsOf } from '../src/import/reach.js';
import { bodyHash } from '../src/import/scan.js';
import { createImportStore } from '../src/import/store.js';
import { surveyFolder, type Survey } from '../src/import/survey.js';
import type { LogFn } from '../src/wiki/contract.js';

/** A decline made yesterday: older than any decline a test writes, so the
 * least-recently-declined rule can order by it. */
const YESTERDAY = '2026-08-02T10:00:00.000Z';

let fixture: string;
let survey: Survey;
let events: { kind: string; detail: string }[];

const log: LogFn = (e) => void events.push({ kind: e.kind, detail: e.detail });
const logged = (kind: string) => events.filter((e) => e.kind === kind);
/** The live questions' terms — the Direction, standing in. */
const live = (q: string) => () => termsOf(q);

beforeEach(() => {
 events = [];
 fixture = mkdtempSync(join(tmpdir(), 'elicit-reach-'));
 mkdirSync(join(fixture, 'journal/therapy-sessions'), { recursive: true });
 mkdirSync(join(fixture, 'journal/work-notes'), { recursive: true });
 mkdirSync(join(fixture, 'journal/done'), { recursive: true });
 writeFileSync(join(fixture, 'journal/therapy-sessions/notes.md'), '# notes\n\nsessions about therapy work\n');
 writeFileSync(join(fixture, 'journal/work-notes/ideas.md'), '# ideas\n\nrandom thoughts\n');
 const done = join(fixture, 'journal/done/finished.md');
 writeFileSync(done, '# finished\n\ndone at last\n');
 const store = createImportStore(fixture);
 // One accepted record makes journal/done fully harvested: unread 0.
 store.put({
  hash: bodyHash(readFileSync(done, 'utf-8')),
  sourcePath: done,
  date: '2026-08-01',
  status: 'accepted',
  attempts: 0,
 });
 survey = surveyFolder(fixture, store);
});

afterEach(() => {
 rmSync(fixture, { recursive: true, force: true });
});

describe('reachOffer (seeding Task 11)', () => {
 it('offers the unread region whose own names the live questions touch', () => {
  const o = reachOffer({
   survey,
   liveTerms: live('what changed about how you run therapy sessions'),
   declined: () => null,
   log,
  });
  expect(o!.path).toBe('journal/therapy-sessions');
 });

 it('offers nothing when overlap is one term', () => {
  expect(reachOffer({ survey, liveTerms: live('therapy'), declined: () => null, log })).toBeNull();
 });

 it('never offers a node with nothing unread', () => {
  // The only node whose terms clear the bar is fully harvested: unread 0
  // excludes it before ranking, so no candidate survives.
  const harvested: Survey = {
   at: '2026-08-01T00:00:00.000Z',
   root: fixture,
   nodes: [
    {
     path: 'journal/therapy-sessions',
     files: 1,
     harvested: 1,
     refused: 0,
     unread: 0,
     total: { files: 1, harvested: 1, refused: 0, unread: 0 },
    },
   ],
  };
  expect(
   reachOffer({
    survey: harvested,
    liveTerms: live('what changed about how you run therapy sessions'),
    declined: () => null,
    log,
   }),
  ).toBeNull();
 });

 it('logs an evaluation even when it offers nothing', () => {
  expect(reachOffer({ survey: null, liveTerms: () => new Set(), declined: () => null, log })).toBeNull();
  expect(logged('reach-evaluated')).toHaveLength(1);
 });

 it('ranks a declined region behind an equal one that was not', () => {
  // Both regions overlap at two terms — 'therapy' and 'sessions' versus
  // 'work' and 'notes' — and both have one unread note, so the tie breaks
  // on the decline ledger: therapy-sessions was declined, work-notes never
  // was, and the never-declined region ranks first.
  const o = reachOffer({
   survey,
   liveTerms: live('sessions about notes from therapy work'),
   declined: (p) => (p === 'journal/therapy-sessions' ? YESTERDAY : null),
   log,
  });
  expect(o!.path).toBe('journal/work-notes');
 });

 it('still offers a declined region when it is the only match', () => {
  const o = reachOffer({
   survey,
   liveTerms: live('what changed about how you run therapy sessions'),
   declined: (p) => (p === 'journal/therapy-sessions' ? YESTERDAY : null),
   log,
  });
  expect(o!.path).toBe('journal/therapy-sessions');
 });

 it('cannot read a note — the module imports no prose reader', () => {
  const src = readFileSync('src/import/reach.ts', 'utf-8');
  expect(src).not.toMatch(/gray-matter|from '\.\/scan/);
 });

 it('offers a region whose files it has never opened', () => {
  const note = join(fixture, 'journal/therapy-sessions/notes.md');
  chmodSync(note, 0o000);
  try {
   const o = reachOffer({
    survey,
    liveTerms: live('what changed about how you run therapy sessions'),
    declined: () => null,
    log,
   });
   expect(o!.path).toBe('journal/therapy-sessions');
  } finally {
   chmodSync(note, 0o644);
  }
 });
});
