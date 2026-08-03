/**
 * DRM park/resume persistence tests — Q-85.
 *
 * Verifies roundtrip: park → write → read → resume.
 * Follows the Sounding park.ts test pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDRM, beginDRM, addEpisode, doneEnumerating, answerProbe, applyGate, resumeDRM } from '../src/drm/state.js';
import { writeDRM, readDRM } from '../src/drm/park.js';

describe('DRM persistence', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elicit-drm-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('roundtrips a parked DRM through disk', () => {
    // Set up a DRM session with one completed episode and one pending
    let state = initDRM('s1');
    state = beginDRM(state).state;
    state = addEpisode(state, 'morning coffee', 7);
    state = addEpisode(state, 'commute', 8);
    state = doneEnumerating(state);
    state = answerProbe(state, 'kitchen').state;
    state = answerProbe(state, 'drinking coffee').state;
    state = answerProbe(state, 'alone').state;
    state = answerProbe(state, 'calm and present').state;

    // Park
    const gate = applyGate(state, 'park');
    expect(gate.parked).not.toBeNull();

    // Write to disk
    writeDRM(root, gate.parked!);

    // Read back
    const loaded = readDRM(root, gate.parked!.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(gate.parked!.id);
    expect(loaded!.yesterday).toBe(gate.parked!.yesterday);
    expect(loaded!.episodes).toHaveLength(2);
    expect(loaded!.currentEpisodeIdx).toBe(1);
    expect(loaded!.probeStep).toBe('place');
    expect(loaded!.endedBy).toBe('park');

    // Resume
    const resumed = resumeDRM(loaded!, 's2');
    expect(resumed.phase).toBe('probe');
    expect(resumed.episodes).toHaveLength(2);
    expect(resumed.currentEpisodeIdx).toBe(1);
    expect(resumed.probeStep).toBe('place');
  });

  it('returns null for missing DRM file', () => {
    const result = readDRM(root, 'nonexistent');
    expect(result).toBeNull();
  });

  it('preserves fragments through roundtrip', () => {
    let state = initDRM('s1');
    state = beginDRM(state).state;
    state = addEpisode(state, 'only episode', 7);
    state = doneEnumerating(state);
    state = answerProbe(state, 'a').state;
    state = answerProbe(state, 'b').state;
    state = answerProbe(state, 'c').state;
    const result = answerProbe(state, 'felt good');
    state = result.state;

    // Fragment was produced for the affect answer
    expect(result.fragment).not.toBeNull();
    expect(result.fragment!.answer).toBe('felt good');
    expect(result.fragment!.step).toBe('affect');

    // Park with continue to complete
    const gate = applyGate(state, 'continue');
    expect(gate.complete).toBe(true);

    // Build a parked state manually (simulating the server's finish path)
    const parked = {
      ...gate.state,
      ended: new Date().toISOString(),
      endedBy: 'park' as const,
      fragments: [...state.fragments, result.fragment!],
    };

    writeDRM(root, parked);
    const loaded = readDRM(root, parked.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.fragments).toHaveLength(1);
    expect(loaded!.fragments[0]!.answer).toBe('felt good');
    expect(loaded!.fragments[0]!.aboutWhen).toBe(state.yesterday);
  });

  it('preserves episode probe answers through roundtrip', () => {
    let state = initDRM('s1');
    state = beginDRM(state).state;
    state = addEpisode(state, 'morning', 7);
    state = doneEnumerating(state);
    state = answerProbe(state, 'bedroom').state;
    state = answerProbe(state, 'reading').state;
    state = answerProbe(state, 'alone').state;
    state = answerProbe(state, 'peaceful').state;
    const gate = applyGate(state, 'park');

    writeDRM(root, gate.parked!);
    const loaded = readDRM(root, gate.parked!.id);

    expect(loaded!.episodes[0]!.probes.place).toBe('bedroom');
    expect(loaded!.episodes[0]!.probes.activity).toBe('reading');
    expect(loaded!.episodes[0]!.probes['who-with']).toBe('alone');
    expect(loaded!.episodes[0]!.probes.affect).toBe('peaceful');
  });
});
