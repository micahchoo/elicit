/**
 * DRM persistence — Q-85, ticket 159 slice 6.
 *
 * Slice 6 parks the MACHINE: the drm flow's state rides inside
 * MachineState.ui (DrmUi) and the side-record is vault/machines/<sessionId>
 * .json (src/protocols/park.ts). The first block pins that roundtrip.
 * The legacy {root}/drm/<id>.md frontmatter format survives as the compat
 * read for pre-slice-6 parks (the drm resume route's legacy branch); the
 * second block pins writeDRM/readDRM roundtripping it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDRM, addEpisode, doneEnumerating, answerProbe, applyGate } from '../src/drm/state.js';
import { writeDRM, readDRM } from '../src/drm/park.js';
import { writeMachineState, readMachineState } from '../src/protocols/park.js';
import type { DrmUi, DRMParkedState } from '../src/drm/types.js';
import type { MachineState } from '../src/protocols/machine.js';

/** A ui with one completed episode and one pending (the park-time shape). */
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
  const ui = probedUi();
  return {
    id: 'drm-legacy-1',
    session: 's1',
    yesterday: ui.yesterday,
    phase: 'parked',
    episodes: ui.episodes,
    currentEpisodeIdx: 1,
    probeStep: 'place',
    fragments: ui.fragments,
    started: '2026-08-05T18:00:00.000Z',
    ended: '2026-08-05T18:30:00.000Z',
    endedBy: 'park',
    ...overrides,
  };
}

describe('DRM machine-record persistence (slice 6)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elicit-drm-mach-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('roundtrips the drm ui inside the machine record', () => {
    // A drm machine parked at the probe phase: the ui carries the resume
    // point (episode 2, place) exactly as the gate route writes it.
    const gate = applyGate(probedUi(), 'park');
    const machine: MachineState = {
      protocol: 'drm',
      phaseIndex: 1,
      exchanges: [0, 0, 0],
      startedAt: '2026-08-05T18:00:00.000Z',
      ui: gate.parked! as unknown as Record<string, unknown>,
    };

    writeMachineState(root, 's1', machine);

    const loaded = readMachineState(root, 's1');
    expect(loaded).not.toBeNull();
    expect(loaded!.protocol).toBe('drm');
    expect(loaded!.phaseIndex).toBe(1);
    expect(loaded!.ui).not.toBeUndefined();

    const ui = loaded!.ui as unknown as DrmUi;
    expect(ui.episodes).toHaveLength(2);
    expect(ui.episodes[0]!.name).toBe('morning coffee');
    expect(ui.episodes[1]!.probes).toEqual({ place: null, activity: null, 'who-with': null, affect: null });
    // The parked resume point survives byte-for-byte
    expect(ui.currentEpisodeIdx).toBe(1);
    expect(ui.probeStep).toBe('place');
    // The probed episode's answers and the kept fragment ride along
    expect(ui.episodes[0]!.probes.place).toBe('kitchen');
    expect(ui.fragments).toHaveLength(1);
    expect(ui.fragments[0]!.answer).toBe('calm and present');

    // The resumed sitting continues the exact probe position
    const question = answerProbe(ui, 'on the train').ui;
    expect(question.probeStep).toBe('activity');
    expect(question.currentEpisodeIdx).toBe(1);
  });

  it('returns null for a missing machine record', () => {
    expect(readMachineState(root, 'no-such-session')).toBeNull();
  });
});

describe('DRM legacy park format (the compat read)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elicit-drm-test-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('roundtrips a legacy parked DRM through disk', () => {
    const parked = parkedRecord();

    // Write to disk
    writeDRM(root, parked);

    // Read back
    const loaded = readDRM(root, parked.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(parked.id);
    expect(loaded!.yesterday).toBe(parked.yesterday);
    expect(loaded!.episodes).toHaveLength(2);
    expect(loaded!.currentEpisodeIdx).toBe(1);
    expect(loaded!.probeStep).toBe('place');
    expect(loaded!.endedBy).toBe('park');
  });

  it('returns null for missing DRM file', () => {
    expect(readDRM(root, 'no-such-id')).toBeNull();
  });

  it('preserves fragments through roundtrip', () => {
    const parked = parkedRecord();
    writeDRM(root, parked);
    const loaded = readDRM(root, parked.id)!;
    expect(loaded.fragments).toHaveLength(1);
    expect(loaded.fragments[0]!.episode).toContain('morning coffee');
    expect(loaded.fragments[0]!.step).toBe('affect');
    expect(loaded.fragments[0]!.answer).toBe('calm and present');
  });

  it('preserves episode probe answers through roundtrip', () => {
    const parked = parkedRecord();
    writeDRM(root, parked);
    const loaded = readDRM(root, parked.id)!;
    expect(loaded.episodes[0]!.probes.place).toBe('kitchen');
    expect(loaded.episodes[0]!.probes.activity).toBe('drinking coffee');
    expect(loaded.episodes[0]!.probes['who-with']).toBe('alone');
    expect(loaded.episodes[0]!.probes.affect).toBe('calm and present');
    // The pending episode is untouched
    expect(loaded.episodes[1]!.probes.place).toBeNull();
  });
});
