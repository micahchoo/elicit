/**
 * DRM state machine tests — Q-85.
 *
 * Verifies: init → enumerate → probe → gate → complete
 * Plus: fragment construction, affect nudge, gate choices.
 */

import { describe, it, expect } from 'vitest';
import {
  initDRM,
  beginDRM,
  addEpisode,
  doneEnumerating,
  answerProbe,
  applyGate,
  gateReading,
  probeQuestion,
  buildProbeFragment,
  resumeDRM,
} from '../src/drm/state.js';

describe('DRM state machine', () => {
  it('initialises with intro phase and yesterday date', () => {
    const s = initDRM('s1');
    expect(s.phase).toBe('intro');
    expect(s.yesterday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.episodes).toEqual([]);
    expect(s.fragments).toEqual([]);
  });

  it('begins enumeration from intro', () => {
    const s = initDRM('s1');
    const { state, yesterday } = beginDRM(s);
    expect(state.phase).toBe('enumerate');
    expect(yesterday).toBe(s.yesterday);
  });

  it('rejects begin if already started', () => {
    const s = initDRM('s1');
    const { state } = beginDRM(s);
    expect(() => beginDRM(state)).toThrow('Already started');
  });

  it('adds episodes during enumeration', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = addEpisode(state, 'commute', 8);
    expect(state.episodes).toHaveLength(2);
    expect(state.episodes[0]!.name).toBe('morning coffee');
    expect(state.episodes[0]!.startHour).toBe(7);
    expect(state.episodes[1]!.name).toBe('commute');
  });

  it('rejects addEpisode outside enumeration', () => {
    const s = initDRM('s1');
    expect(() => addEpisode(s, 'test', 8)).toThrow('Not enumerating');
  });

  it('rejects addEpisode with invalid hour', () => {
    const s = initDRM('s1');
    const state = beginDRM(s).state;
    expect(() => addEpisode(state, 'test', -1)).toThrow('Hour must be 0');
    expect(() => addEpisode(state, 'test', 24)).toThrow('Hour must be 0');
  });

  it('transitions to probe phase after doneEnumerating', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = doneEnumerating(state);
    expect(state.phase).toBe('probe');
    expect(state.currentEpisodeIdx).toBe(0);
    expect(state.probeStep).toBe('place');
  });

  it('rejects doneEnumerating with no episodes', () => {
    const s = initDRM('s1');
    const state = beginDRM(s).state;
    expect(() => doneEnumerating(state)).toThrow('Name at least one episode');
  });

  it('advances through probe steps in order', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = doneEnumerating(state);

    // place
    expect(state.probeStep).toBe('place');
    const r1 = answerProbe(state, 'kitchen table');
    state = r1.state;
    expect(r1.atGate).toBe(false);
    expect(state.probeStep).toBe('activity');

    // activity
    const r2 = answerProbe(state, 'drinking coffee');
    state = r2.state;
    expect(r2.atGate).toBe(false);
    expect(state.probeStep).toBe('who-with');

    // who-with
    const r3 = answerProbe(state, 'alone');
    state = r3.state;
    expect(r3.atGate).toBe(false);
    expect(state.probeStep).toBe('affect');

    // affect — last probe, should hit gate
    const r4 = answerProbe(state, 'calm and present');
    state = r4.state;
    expect(r4.atGate).toBe(true);
    expect(r4.fragment).not.toBeNull();
    expect(r4.fragment!.step).toBe('affect');
    expect(r4.fragment!.answer).toBe('calm and present');
    expect(r4.fragment!.aboutWhen).toBe(state.yesterday);
  });

  it('gate continue advances to next episode', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = addEpisode(state, 'commute', 8);
    state = doneEnumerating(state);

    // Answer all probes for episode 1
    state = answerProbe(state, 'kitchen').state;
    state = answerProbe(state, 'drinking').state;
    state = answerProbe(state, 'alone').state;
    state = answerProbe(state, 'calm').state;

    // At gate
    const g = applyGate(state, 'continue');
    expect(g.complete).toBe(false);
    expect(g.state.currentEpisodeIdx).toBe(1);
    expect(g.state.probeStep).toBe('place');
  });

  it('gate continue on last episode completes', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'only episode', 7);
    state = doneEnumerating(state);
    state = answerProbe(state, 'a').state;
    state = answerProbe(state, 'b').state;
    state = answerProbe(state, 'c').state;
    state = answerProbe(state, 'd').state;

    const g = applyGate(state, 'continue');
    expect(g.complete).toBe(true);
    expect(g.state.phase).toBe('complete');
  });

  it('gate park returns parked state', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = addEpisode(state, 'commute', 8);
    state = doneEnumerating(state);
    state = answerProbe(state, 'a').state;
    state = answerProbe(state, 'b').state;
    state = answerProbe(state, 'c').state;
    state = answerProbe(state, 'd').state;

    const g = applyGate(state, 'park');
    expect(g.complete).toBe(false);
    expect(g.parked).not.toBeNull();
    expect(g.parked!.endedBy).toBe('park');
    expect(g.parked!.currentEpisodeIdx).toBe(1); // parked at next episode
    expect(g.state.phase).toBe('parked');
  });

  it('gate another-day completes with fragments kept', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = doneEnumerating(state);
    state = answerProbe(state, 'a').state;
    state = answerProbe(state, 'b').state;
    state = answerProbe(state, 'c').state;
    state = answerProbe(state, 'd').state;

    const g = applyGate(state, 'another-day');
    expect(g.complete).toBe(true);
    expect(g.state.phase).toBe('complete');
  });

  it('resumes from parked state', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = addEpisode(state, 'commute', 8);
    state = doneEnumerating(state);
    state = answerProbe(state, 'a').state;
    state = answerProbe(state, 'b').state;
    state = answerProbe(state, 'c').state;
    state = answerProbe(state, 'd').state;

    const g = applyGate(state, 'park');
    const resumed = resumeDRM(g.parked!, 's2');
    expect(resumed.phase).toBe('probe');
    expect(resumed.currentEpisodeIdx).toBe(1);
    expect(resumed.probeStep).toBe('place');
    expect(resumed.session).toBe('s2');
  });

  it('resume with all episodes done completes immediately', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'only', 7);
    state = doneEnumerating(state);
    state = answerProbe(state, 'a').state;
    state = answerProbe(state, 'b').state;
    state = answerProbe(state, 'c').state;
    state = answerProbe(state, 'd').state;

    const g = applyGate(state, 'park');
    // Force parked to have done all (simulate park after last episode)
    const parked = { ...g.parked!, currentEpisodeIdx: 1 };
    const resumed = resumeDRM(parked, 's2');
    expect(resumed.phase).toBe('complete');
  });

  it('builds fragments with episode context', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = doneEnumerating(state);
    state = answerProbe(state, 'kitchen table').state;

    const ep = state.episodes[0]!;
    const frag = buildProbeFragment(state, ep, 'place');
    expect(frag.episode).toContain('morning coffee');
    expect(frag.episode).toContain('~7:00');
    expect(frag.answer).toBe('kitchen table');
    expect(frag.step).toBe('place');
    expect(frag.question).toContain('morning coffee');
    expect(frag.question).toContain('Where were you?');
    expect(frag.aboutWhen).toBe(state.yesterday);
  });

  it('probeQuestion includes episode context for harvest review', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'lunch with Mira', 12);
    state = doneEnumerating(state);

    const q = probeQuestion(state);
    expect(q).toContain('lunch with Mira');
    expect(q).toContain('~12:00');
    expect(q).toContain('Where were you?');
  });

  it('gateReading shows episode position', () => {
    const s = initDRM('s1');
    let state = beginDRM(s).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = addEpisode(state, 'commute', 8);
    state = doneEnumerating(state);

    const reading = gateReading(state);
    expect(reading.episode).toBe(1);
    expect(reading.of).toBe(2);
    expect(reading.label).toContain('morning coffee');
  });
});
