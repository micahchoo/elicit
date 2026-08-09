/**
 * DRM on the phase machine (ticket 159, slice 6) — the five drm routes
 * reimplemented on the machine, wire shapes intact.
 *
 * The wire harness drives createApp + /api/session + the five drm routes
 * (the machine-park harness pattern). Assertions pin the response shapes
 * field-for-field — every existing field plus the new `machinePhase` meta —
 * the renderer contract (the phase meta carries 'drm-day-map' during
 * enumeration), the machine side-record on park, and resume continuing the
 * exact phase + ui (including the legacy 'parked-drm' compat read).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { readMachineState } from '../src/protocols/park.js';
import type { DRMParkedState, DrmUi } from '../src/drm/types.js';
import type { QueueEntry, QueueStore } from '../src/types.js';

// ── Wire types (the asserted surface) ──

interface MachinePhaseMeta {
 id: string;
 label: string;
 step: number;
 of: number;
 renderer?: string;
}

interface DrmStartResponse {
 kind: 'drm-enumerate';
 yesterday: string;
 phase: string;
 machinePhase?: MachinePhaseMeta;
}
interface DrmEpisodeResponse {
 kind: 'drm-episode-added';
 count: number;
 machinePhase?: MachinePhaseMeta;
}
interface DrmProbeResponse {
 kind: 'drm-probe';
 text: string;
 episode: number;
 of: number;
 step: string;
 gate: { episode: number; of: number; label: string };
 machinePhase?: MachinePhaseMeta;
}
interface DrmGateResponse {
 kind: 'drm-gate';
 episode: number;
 of: number;
 atEnd: boolean;
 gate: { episode: number; of: number; label: string };
 machinePhase?: MachinePhaseMeta;
}
interface DrmClosedResponse {
 kind: 'drm-closed';
 endedBy: string;
 phase: string;
 machinePhase?: MachinePhaseMeta;
}
interface TurnResponse {
 kind: string;
 text?: string;
 phase?: MachinePhaseMeta;
}
interface SessionResponse {
 sessionId: string;
 protocol?: string;
}

// ── Wire harness (the machine-park pattern) ──

const roots: string[] = [];

afterAll(() => {
 for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function makeApp(script: string[]): Promise<{ app: Hono; root: string; queue: QueueStore }> {
 const root = mkdtempSync(join(tmpdir(), 'elicit-drm-routes-'));
 roots.push(root);
 const vault = createVault(root);
 const complete = makeScriptedComplete(script);
 const queue = createQueueStore(root);
 const index = buildIndex([]);
 const authStore = createFileAuth(join(root, '.auth.json'));
 const app = await createApp({ vault, complete, queue, index, vaultRoot: root, authStore });
 return { app, root, queue };
}

/** Write a legacy {root}/drm/<id>.md record — the shape writeDRM used to
 * produce, written directly so the compat read has a fixture to read. */
function writeLegacyPark(root: string, parked: DRMParkedState): void {
 const fm: Record<string, unknown> = {
  id: parked.id,
  session: parked.session,
  yesterday: parked.yesterday,
  started: parked.started,
  ended: parked.ended,
  endedBy: parked.endedBy,
  episodes: parked.episodes.map((ep) => ({
   name: ep.name,
   startHour: ep.startHour,
   probes: { ...ep.probes },
  })),
  currentEpisodeIdx: parked.currentEpisodeIdx,
  probeStep: parked.probeStep,
  fragments: parked.fragments.map((f) => ({
   episode: f.episode,
   aboutWhen: f.aboutWhen,
   step: f.step,
   question: f.question,
   answer: f.answer,
  })),
 };
 mkdirSync(join(root, 'drm'), { recursive: true });
 writeFileSync(join(root, 'drm', `${parked.id}.md`), matter.stringify('', fm), 'utf-8');
}

async function post<T>(app: Hono, path: string, body?: unknown): Promise<T> {
 const init: RequestInit =
  body === undefined
   ? { method: 'POST' }
   : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
 const res = await app.fetch(new Request(`http://localhost${path}`, init), { remoteAddr: '127.0.0.1' });
 return (await res.json()) as T;
}

async function newSession(app: Hono): Promise<string> {
 const res = await post<SessionResponse>(app, '/api/session', {});
 expect(res.sessionId).toBeTruthy();
 return res.sessionId;
}

/** The drm phase meta constants, pinned by the defs. */
const ENUMERATE = { id: 'enumerate', label: 'walk back through yesterday', step: 1, of: 3, renderer: 'drm-day-map' };
const PROBE = { id: 'probe', label: 'probe each episode', step: 2, of: 3 };

/** Answer probes until the episode gate returns. */
async function probeEpisode(app: Hono, id: string, answers: string[]): Promise<DrmGateResponse> {
 let res: DrmProbeResponse | DrmGateResponse | null = null;
 for (const text of answers) {
  res = await post<DrmProbeResponse | DrmGateResponse>(app, `/api/session/${id}/drm/probe`, { text });
  if (res.kind === 'drm-gate') return res;
 }
 throw new Error(`probeEpisode: expected a gate after ${answers.length} answers (got ${res?.kind})`);
}

// ── The wire: a drm sitting through the machine ──

describe('the five drm routes on the machine (ticket 159, slice 6)', () => {
 it('walks start → blocks → enumerate-done → probes → gate → close, shapes intact', async () => {
  const { app, root } = await makeApp([]);
  const id = await newSession(app);

  // start: the machine begins at the day-map phase
  const start = await post<DrmStartResponse>(app, `/api/session/${id}/drm/start`);
  expect(start.kind).toBe('drm-enumerate');
  expect(start.yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(start.phase).toBe('open');
  expect(start.machinePhase).toEqual(ENUMERATE);

  // blocks: enumeration continues, count rides the response
  const ep1 = await post<DrmEpisodeResponse>(app, `/api/session/${id}/drm/episode`, { name: 'morning coffee', startHour: 7 });
  expect(ep1.kind).toBe('drm-episode-added');
  expect(ep1.count).toBe(1);
  expect(ep1.machinePhase).toEqual(ENUMERATE);

  const ep2 = await post<DrmEpisodeResponse>(app, `/api/session/${id}/drm/episode`, { name: 'commute', startHour: 8 });
  expect(ep2.kind).toBe('drm-episode-added');
  expect(ep2.count).toBe(2);
  expect(ep2.machinePhase).toEqual(ENUMERATE);

  // the phase advance (enumerate → probe) writes the side-record
  const done = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/enumerate-done`);
  expect(done.kind).toBe('drm-probe');
  expect(done.text).toBe('\u2190 morning coffee (~7:00) \u00b7 Where were you?');
  expect(done.episode).toBe(1);
  expect(done.of).toBe(2);
  expect(done.step).toBe('place');
  expect(done.gate).toEqual({ episode: 1, of: 2, label: 'episode 1: morning coffee' });
  // the renderer is gone in the probe phase — the meta still rides
  expect(done.machinePhase).toEqual(PROBE);
  expect(existsSync(join(root, 'machines', `${id}.json`))).toBe(true);

  // probes: place → activity → who-with → affect, then the gate
  let probe = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/probe`, { text: 'kitchen table' });
  expect(probe.kind).toBe('drm-probe');
  expect(probe.step).toBe('activity');
  expect(probe.text).toBe('\u2190 morning coffee (~7:00) \u00b7 What were you doing?');

  probe = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/probe`, { text: 'drinking coffee' });
  expect(probe.step).toBe('who-with');
  expect(probe.text).toBe('\u2190 morning coffee (~7:00) \u00b7 Who were you with?');

  probe = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/probe`, { text: 'alone' });
  expect(probe.step).toBe('affect');
  expect(probe.text).toBe('\u2190 morning coffee (~7:00) \u00b7 How did that time feel?');

  const gate1 = await post<DrmGateResponse>(app, `/api/session/${id}/drm/probe`, { text: 'calm and present' });
  expect(gate1.kind).toBe('drm-gate');
  expect(gate1.episode).toBe(1);
  expect(gate1.of).toBe(2);
  expect(gate1.atEnd).toBe(false);
  expect(gate1.gate.label).toBe('episode 1: morning coffee');
  expect(gate1.machinePhase).toEqual(PROBE);

  // gate continue → episode 2's first probe
  const next = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/gate`, { choice: 'continue' });
  expect(next.kind).toBe('drm-probe');
  expect(next.text).toBe('\u2190 commute (~8:00) \u00b7 Where were you?');
  expect(next.episode).toBe(2);
  expect(next.step).toBe('place');
  expect(next.gate).toEqual({ episode: 2, of: 2, label: 'episode 2: commute' });

  // the last episode's gate is the end
  const gate2 = await probeEpisode(app, id, ['on the train', 'reading', 'alone', 'glad of the quiet']);
  expect(gate2.kind).toBe('drm-gate');
  expect(gate2.atEnd).toBe(true);

  const closed = await post<DrmClosedResponse>(app, `/api/session/${id}/drm/gate`, { choice: 'continue' });
  expect(closed).toEqual({ kind: 'drm-closed', endedBy: 'complete', phase: 'open' });
 });

 it('guards the flow: start twice, empty day, wrong phase, bad words', async () => {
  const { app } = await makeApp([]);
  const id = await newSession(app);

  const first = await post<DrmStartResponse>(app, `/api/session/${id}/drm/start`);
  expect(first.kind).toBe('drm-enumerate');
  const again = await post<{ error: string }>(app, `/api/session/${id}/drm/start`);
  expect(again.error).toBe('DRM already running');

  // a second sitting with no drm running: every route refuses
  const other = await newSession(app);
  expect((await post<{ error: string }>(app, `/api/session/${other}/drm/episode`, { name: 'x', startHour: 8 })).error).toBe('no DRM running');
  expect((await post<{ error: string }>(app, `/api/session/${other}/drm/probe`, { text: 'x' })).error).toBe('no DRM running');
  expect((await post<{ error: string }>(app, `/api/session/${other}/drm/gate`, { choice: 'continue' })).error).toBe('no DRM running');
  expect((await post<{ error: string }>(app, `/api/session/${other}/drm/enumerate-done`)).error).toBe('no DRM running');

  // an empty day cannot move to probes (the route preserves the old
  // String(e) wire form)
  const empty = await newSession(app);
  await post<DrmStartResponse>(app, `/api/session/${empty}/drm/start`);
  expect((await post<{ error: string }>(app, `/api/session/${empty}/drm/enumerate-done`)).error).toBe('Error: Name at least one episode');

  // the machine's phase guards the routes after enumeration
  const mid = await newSession(app);
  await post<DrmStartResponse>(app, `/api/session/${mid}/drm/start`);
  await post<DrmEpisodeResponse>(app, `/api/session/${mid}/drm/episode`, { name: 'morning coffee', startHour: 7 });
  await post<DrmProbeResponse>(app, `/api/session/${mid}/drm/enumerate-done`);
  expect((await post<{ error: string }>(app, `/api/session/${mid}/drm/episode`, { name: 'late', startHour: 9 })).error).toBe('Not enumerating');
  expect((await post<{ error: string }>(app, `/api/session/${mid}/drm/probe`, { text: '' })).error).toBe('text is required');
  expect((await post<{ error: string }>(app, `/api/session/${mid}/drm/gate`, { choice: 'sideways' })).error).toBe('choice must be continue, park, or another-day');
  const liveProbe = await post<DrmProbeResponse>(app, `/api/session/${mid}/drm/probe`, { text: 'kitchen' });
  expect(liveProbe.kind).toBe('drm-probe');
 });

 it('carries the renderer on the turn-response phase meta during enumeration', async () => {
  // The /turn route's machine question for a drm sitting sits in the
  // enumerate phase: the phase meta declares the day-map renderer. The
  // sitting opens with the rotated protocol (reflective); drm/start runs
  // the drm machine. The machine serves at P3 (reflective sittings run
  // P1/P2 first), so the script answers the red-light pass then the
  // machine's enumerate question.
  const { app } = await makeApp(['{}', 'What block of yesterday would you start with?']);
  const id = await newSession(app);
  await post<DrmStartResponse>(app, `/api/session/${id}/drm/start`);

  const turn = await post<TurnResponse>(app, `/api/session/${id}/turn`, { text: 'I remember the morning most clearly.' });
  expect(turn.kind).toBe('probe');
  expect(turn.phase).toEqual(ENUMERATE);
 });

 it('park writes the machine record; resume continues the exact phase and ui', async () => {
  const { app, root, queue } = await makeApp([]);
  const parked = await newSession(app);
  await post<DrmStartResponse>(app, `/api/session/${parked}/drm/start`);
  await post<DrmEpisodeResponse>(app, `/api/session/${parked}/drm/episode`, { name: 'morning coffee', startHour: 7 });
  await post<DrmEpisodeResponse>(app, `/api/session/${parked}/drm/episode`, { name: 'commute', startHour: 8 });
  await post<DrmProbeResponse>(app, `/api/session/${parked}/drm/enumerate-done`);
  await probeEpisode(app, parked, ['kitchen table', 'drinking coffee', 'alone', 'calm and present']);

  const park = await post<DrmClosedResponse>(app, `/api/session/${parked}/drm/gate`, { choice: 'park' });
  expect(park.kind).toBe('drm-closed');
  expect(park.endedBy).toBe('park');
  expect(park.machinePhase).toEqual(PROBE);

  // The machine record IS the parked drm: the ui carries the resume point
  // (episode 2, place) with every episode and the kept fragment intact.
  const record = readMachineState(root, parked);
  expect(record).not.toBeNull();
  expect(record!.protocol).toBe('drm');
  expect(record!.phaseIndex).toBe(1);
  const ui = record!.ui as unknown as DrmUi;
  expect(ui.episodes).toHaveLength(2);
  expect(ui.episodes[0]!.probes.affect).toBe('calm and present');
  expect(ui.currentEpisodeIdx).toBe(1);
  expect(ui.probeStep).toBe('place');

  // The pointer is a 'parked-machine' entry naming the record.
  const pointer = queue.list({ source: 'parked-machine' })[0]!;
  expect(pointer.machineId).toBe(parked);
  expect(pointer.machineProtocol).toBe('drm');
  expect(pointer.status).toBe('pending');

  // Resume into a fresh (reflective) sitting: the exact phase and ui
  // continue — episode 2's place probe, not a restart.
  const resumedSession = await newSession(app);
  const resumed = await post<DrmProbeResponse>(app, `/api/session/${resumedSession}/drm/resume`, {
   queueEntryId: pointer.id,
  });
  expect(resumed.kind).toBe('drm-probe');
  expect(resumed.text).toBe('\u2190 commute (~8:00) \u00b7 Where were you?');
  expect(resumed.episode).toBe(2);
  expect(resumed.of).toBe(2);
  expect(resumed.step).toBe('place');
  expect(resumed.machinePhase).toEqual(PROBE);

  // The pointer is consumed; the record stays (the record is the truth).
  expect(queue.list({ source: 'parked-machine' }).find((e) => e.id === pointer.id)!.status).toBe('answered');
  expect(existsSync(join(root, 'machines', `${parked}.json`))).toBe(true);

  // The resumed sitting probes the rest and parks again: the re-park
  // supersedes the record it resumed (one live record per parked machine).
  await probeEpisode(app, resumedSession, ['on the train', 'reading', 'alone', 'glad of the quiet']);
  const repark = await post<DrmClosedResponse>(app, `/api/session/${resumedSession}/drm/gate`, { choice: 'park' });
  expect(repark.kind).toBe('drm-closed');
  expect(repark.endedBy).toBe('park');
  expect(readMachineState(root, resumedSession)!.phaseIndex).toBe(1);
  // The resumed sitting's own record now exists; the resumed one is gone.
  expect(existsSync(join(root, 'machines', `${resumedSession}.json`))).toBe(true);
  expect(existsSync(join(root, 'machines', `${parked}.json`))).toBe(false);
 });

 it('resumes a legacy parked-drm pointer through the compat read', async () => {
  // A pre-slice-6 park: the {root}/drm/<id>.md record + a 'parked-drm'
  // pointer. The migration decision keeps these resumable.
  const { app, root, queue } = await makeApp([]);
  const legacy: DRMParkedState = {
   id: 'drm-legacy-1',
   session: 'old-session',
   yesterday: '2026-08-05',
   phase: 'parked',
   episodes: [
    { name: 'morning coffee', startHour: 7, probes: { place: 'kitchen', activity: 'drinking coffee', 'who-with': 'alone', affect: 'calm' } },
    { name: 'commute', startHour: 8, probes: { place: null, activity: null, 'who-with': null, affect: null } },
   ],
   currentEpisodeIdx: 1,
   probeStep: 'place',
   fragments: [],
   started: '2026-08-05T18:00:00.000Z',
   ended: '2026-08-05T18:30:00.000Z',
   endedBy: 'park',
  };
  writeLegacyPark(root, legacy);
  const pointer: QueueEntry = queue.add({
   source: 'parked-drm',
   license: 'user',
   question: 'DRM: morning coffee',
   questionForm: 'deliberative',
   horizon: 'session',
   drmId: legacy.id,
  });

  const id = await newSession(app);
  const resumed = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/resume`, {
   queueEntryId: pointer.id,
  });
  expect(resumed.kind).toBe('drm-probe');
  expect(resumed.text).toBe('\u2190 commute (~8:00) \u00b7 Where were you?');
  expect(resumed.episode).toBe(2);
  expect(resumed.of).toBe(2);
  expect(resumed.step).toBe('place');
  expect(resumed.machinePhase).toEqual(PROBE);

  expect(queue.list({ source: 'parked-drm' })[0]!.status).toBe('answered');
 });

 it('recovers a drm parked mid-enumeration by the everyday gate', async () => {
  // The machine unification makes the everyday gate reachable while the
  // day-map is still open: it parks the drm machine at the enumerate
  // phase. The drm resume advances that record to the probes — the day
  // was mapped as far as it went — instead of stranding the walk.
  const { app, queue } = await makeApp([]);
  const parked = await newSession(app);
  await post<DrmStartResponse>(app, `/api/session/${parked}/drm/start`);
  await post<DrmEpisodeResponse>(app, `/api/session/${parked}/drm/episode`, { name: 'morning coffee', startHour: 7 });
  const gate = await post<{ kind: string; phase: string }>(app, `/api/session/${parked}/gate`, { choice: 'park' });
  expect(gate.kind).toBe('door');

  const pointer = queue.list({ source: 'parked-machine' })[0]!;
  const id = await newSession(app);
  const resumed = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/resume`, { queueEntryId: pointer.id });
  expect(resumed.kind).toBe('drm-probe');
  expect(resumed.episode).toBe(1);
  expect(resumed.step).toBe('place');
  expect(resumed.text).toContain('morning coffee');
  expect(resumed.machinePhase).toEqual(PROBE);

  // …and the walk continues from there
  const probe = await post<DrmProbeResponse>(app, `/api/session/${id}/drm/probe`, { text: 'kitchen table' });
  expect(probe.kind).toBe('drm-probe');
  expect(probe.step).toBe('activity');
 });

 it('404s a resume that names no parked DRM', async () => {
  const { app } = await makeApp([]);
  const id = await newSession(app);
  const res = await post<{ error: string }>(app, `/api/session/${id}/drm/resume`, { queueEntryId: 'no-such-entry' });
  expect(res.error).toBe('no parked DRM with that id');
 });
});
