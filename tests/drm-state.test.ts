/**
 * DRM state transitions — Q-85, over the machine's ui (ticket 159, slice 6).
 *
 * The drm flow's state lives in MachineState.ui as DrmUi; these pure
 * transitions are what the five drm routes run on machine.ui. The phase
 * itself (enumerate / probe / gate) is the machine's phaseIndex — the
 * routes guard it — so the transitions here carry no phase field.
 *
 * Verifies: init → add blocks → done enumerating → probe steps → gate →
 * close, plus fragment construction and the legacy resume (the pre-slice-6
 * park records the drm resume route's compat branch reads).
 */

import { describe, it, expect } from 'vitest';
import {
  initDRM,
  addEpisode,
  doneEnumerating,
  answerProbe,
  applyGate,
  gateReading,
  probeQuestion,
  buildProbeFragment,
  transcriptQuestion,
  resumeDRM,
} from '../src/drm/state.js';
import type { DrmUi, DRMParkedState } from '../src/drm/types.js';

/** A ui at the first probe of episode 1, with the four probes answered. */
function probedUi(): DrmUi {
  let ui = initDRM();
  ui = addEpisode(ui, 'morning coffee', 7);
  ui = addEpisode(ui, 'commute', 8);
  ui = doneEnumerating(ui);
  for (const answer of ['kitchen', 'drinking coffee', 'alone', 'calm and present']) {
    const r = answerProbe(ui, answer);
    ui = r.ui;
    if (r.fragment) ui.fragments.push(r.fragment);
  }
  return ui;
}

/** A legacy parked record, the shape the compat read hands to resumeDRM. */
function parkedRecord(overrides: Partial<DRMParkedState> = {}): DRMParkedState {
  return {
    id: 'drm-legacy-1',
    session: 's1',
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
    ...overrides,
  };
}

describe('DRM state transitions (the machine ui)', () => {
  it('initialises with the yesterday anchor and empty collections', () => {
    const ui = initDRM();
    expect(ui.yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ui.episodes).toEqual([]);
    expect(ui.fragments).toEqual([]);
    expect(ui.currentEpisodeIdx).toBe(0);
    expect(ui.probeStep).toBe('place');
  });

  it('adds episodes', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'morning coffee', 7);
    ui = addEpisode(ui, 'commute', 8);
    expect(ui.episodes).toHaveLength(2);
    expect(ui.episodes[0]!.name).toBe('morning coffee');
    expect(ui.episodes[0]!.startHour).toBe(7);
    expect(ui.episodes[1]!.name).toBe('commute');
    // Each new episode starts with all four probes unasked
    expect(ui.episodes[1]!.probes).toEqual({ place: null, activity: null, 'who-with': null, affect: null });
  });

  it('rejects addEpisode with invalid hour', () => {
    const ui = initDRM();
    expect(() => addEpisode(ui, 'test', -1)).toThrow('Hour must be 0');
    expect(() => addEpisode(ui, 'test', 24)).toThrow('Hour must be 0');
  });

  it('doneEnumerating resets the probe position to the first episode', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'morning coffee', 7);
    ui = doneEnumerating(ui);
    expect(ui.currentEpisodeIdx).toBe(0);
    expect(ui.probeStep).toBe('place');
  });

  it('rejects doneEnumerating with no episodes', () => {
    expect(() => doneEnumerating(initDRM())).toThrow('Name at least one episode');
  });

  it('advances through probe steps in order', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'morning coffee', 7);
    ui = doneEnumerating(ui);

    // place
    expect(ui.probeStep).toBe('place');
    const r1 = answerProbe(ui, 'kitchen table');
    ui = r1.ui;
    expect(r1.atGate).toBe(false);
    expect(ui.probeStep).toBe('activity');

    // activity
    const r2 = answerProbe(ui, 'drinking coffee');
    ui = r2.ui;
    expect(r2.atGate).toBe(false);
    expect(ui.probeStep).toBe('who-with');

    // who-with
    const r3 = answerProbe(ui, 'alone');
    ui = r3.ui;
    expect(r3.atGate).toBe(false);
    expect(ui.probeStep).toBe('affect');

    // affect — last probe, should hit gate
    const r4 = answerProbe(ui, 'calm and present');
    ui = r4.ui;
    expect(r4.atGate).toBe(true);
    expect(r4.fragment).not.toBeNull();
    expect(r4.fragment!.step).toBe('affect');
    expect(r4.fragment!.answer).toBe('calm and present');
    expect(r4.fragment!.aboutWhen).toBe(ui.yesterday);
  });

  it('gate continue advances to next episode', () => {
    const ui = probedUi();
    const g = applyGate(ui, 'continue');
    expect(g.complete).toBe(false);
    expect(g.parked).toBeNull();
    expect(g.ui.currentEpisodeIdx).toBe(1);
    expect(g.ui.probeStep).toBe('place');
  });

  it('gate continue on last episode completes', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'only episode', 7);
    ui = doneEnumerating(ui);
    for (const answer of ['a', 'b', 'c', 'd']) {
      const r = answerProbe(ui, answer);
      ui = r.ui;
      if (r.fragment) ui.fragments.push(r.fragment);
    }
    const g = applyGate(ui, 'continue');
    expect(g.complete).toBe(true);
    expect(g.parked).toBeNull();
  });

  it('gate park returns the resume-point ui', () => {
    const ui = probedUi();
    const g = applyGate(ui, 'park');
    expect(g.complete).toBe(false);
    expect(g.parked).not.toBeNull();
    // Parked at the NEXT episode — this one is complete — with probes reset
    expect(g.parked!.currentEpisodeIdx).toBe(1);
    expect(g.parked!.probeStep).toBe('place');
    // The live ui is untouched by the park word
    expect(g.ui.currentEpisodeIdx).toBe(0);
  });

  it('gate another-day completes with fragments kept', () => {
    const ui = probedUi();
    const g = applyGate(ui, 'another-day');
    expect(g.complete).toBe(true);
    expect(g.parked).toBeNull();
    expect(g.ui.fragments).toHaveLength(1);
  });

  it('legacy resume continues at the next un-probed episode', () => {
    const resumed = resumeDRM(parkedRecord(), 's2');
    expect(resumed.phase).toBe('probe');
    expect(resumed.currentEpisodeIdx).toBe(1);
    expect(resumed.probeStep).toBe('place');
    expect(resumed.session).toBe('s2');
    expect(resumed.episodes).toHaveLength(2);
  });

  it('legacy resume with all episodes done completes immediately', () => {
    const parked = parkedRecord({ currentEpisodeIdx: 2 });
    const resumed = resumeDRM(parked, 's2');
    expect(resumed.phase).toBe('complete');
  });

  it('builds fragments with episode context', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'morning coffee', 7);
    ui = doneEnumerating(ui);
    ui = answerProbe(ui, 'kitchen table').ui;

    const ep = ui.episodes[0]!;
    const frag = buildProbeFragment(ui, ep, 'place');
    expect(frag.episode).toContain('morning coffee');
    expect(frag.episode).toContain('~7:00');
    expect(frag.answer).toBe('kitchen table');
    expect(frag.step).toBe('place');
    expect(frag.question).toContain('morning coffee');
    expect(frag.question).toContain('Where were you?');
    expect(frag.aboutWhen).toBe(ui.yesterday);
  });

  it('probeQuestion includes episode context for harvest review', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'lunch with Mira', 12);
    ui = doneEnumerating(ui);

    const q = probeQuestion(ui);
    expect(q).toContain('lunch with Mira');
    expect(q).toContain('~12:00');
    expect(q).toContain('Where were you?');
  });

  it('transcriptQuestion returns the raw probe without episode chrome', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'lunch with Mira', 12);
    ui = doneEnumerating(ui);

    const q = transcriptQuestion(ui);
    expect(q).toBe('Where were you?');
    expect(q).not.toContain('←');
    expect(q).not.toContain('·');
    expect(q).not.toContain('lunch with Mira');
    expect(q).not.toContain('~12:00');
    // probeQuestion with chrome still works
    const chromeQ = probeQuestion(ui);
    expect(chromeQ).toContain('lunch with Mira');
    expect(chromeQ).toContain('←');
    expect(chromeQ).toContain('·');
  });

  it('gateReading shows episode position', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'morning coffee', 7);
    ui = addEpisode(ui, 'commute', 8);
    ui = doneEnumerating(ui);

    const reading = gateReading(ui);
    expect(reading.episode).toBe(1);
    expect(reading.of).toBe(2);
    expect(reading.label).toContain('morning coffee');
  });

  it('accumulates fragments from answerProbe into the ui fragments', () => {
    let ui = initDRM();
    ui = addEpisode(ui, 'morning coffee', 7);
    ui = addEpisode(ui, 'commute', 8);
    ui = doneEnumerating(ui);

    // Answer all 4 probes for episode 1
    let result = answerProbe(ui, 'kitchen table');
    ui = result.ui;
    expect(result.fragment).toBeNull(); // not yet at affect
    expect(ui.fragments).toHaveLength(0);

    result = answerProbe(ui, 'drank coffee');
    ui = result.ui;
    expect(result.fragment).toBeNull();

    result = answerProbe(ui, 'alone');
    ui = result.ui;
    expect(result.fragment).toBeNull();

    result = answerProbe(ui, 'quiet, good');
    ui = result.ui;
    // Final probe (affect) produces a fragment
    expect(result.fragment).not.toBeNull();
    expect(result.fragment!.step).toBe('affect');
    expect(result.fragment!.answer).toBe('quiet, good');
    expect(result.fragment!.episode).toContain('morning coffee');
    expect(result.atGate).toBe(true);

    // Push the fragment (as the server route does)
    if (result.fragment) result.ui.fragments.push(result.fragment);
    ui = result.ui;
    expect(ui.fragments).toHaveLength(1);
    expect(ui.fragments[0]!.answer).toBe('quiet, good');
  });
});
