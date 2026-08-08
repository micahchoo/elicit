import { describe, expect, test } from 'vitest';
import {
  MACHINE_MARKER_GRAMMAR,
  MACHINE_SHAPE_RULES,
  advanceMachine,
  composeMachineSystemPrompt,
  machineQuestion,
  parseMachineMarker,
  recordExchange,
  startMachine,
} from '../src/protocols/machine.js';
import type { MachineState, PhaseDef } from '../src/protocols/machine.js';
import type { ProtocolDef } from '../src/protocols/registry.js';
import type { Complete } from '../src/types.js';
import { makeScriptedComplete } from './fakes.js';

// ── Fixtures ──

const PHASES: PhaseDef[] = [
  { id: 'recall', label: 'recall a hard call', minExchanges: 1, prompt: 'Recall the hardest call.' },
  { id: 'account', label: 'walk it through', minExchanges: 2, prompt: 'Walk it through step by step.' },
  { id: 'decision', label: 'decision probes', minExchanges: 0, prompt: 'Probe the decision points.' },
];

function makeDef(phases?: PhaseDef[]): ProtocolDef {
  return {
    name: 'fixture',
    title: 'fixture',
    targets: ['domain'],
    prerequisites: [],
    questionForm: 'deliberative',
    prompt: 'body',
    floorProbe: 'What was the hardest call?',
    rotation: false,
    ...(phases !== undefined ? { phases } : {}),
  };
}

// ── startMachine ──

describe('startMachine', () => {
  test('starts at phase 0 with zeroed per-phase exchanges', () => {
    const s = startMachine(makeDef(PHASES), '2026-08-06T00:00:00.000Z');
    expect(s.protocol).toBe('fixture');
    expect(s.phaseIndex).toBe(0);
    expect(s.exchanges).toEqual([0, 0, 0]);
    expect(s.startedAt).toBe('2026-08-06T00:00:00.000Z');
    expect(s.lastQuestionAt).toBeUndefined();
    expect(s.ui).toBeUndefined();
  });

  test('defaults startedAt to now when omitted', () => {
    const before = Date.now();
    const s = startMachine(makeDef(PHASES));
    const after = Date.now();
    const t = Date.parse(s.startedAt);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  test('a def without phases starts an inert machine', () => {
    const s = startMachine(makeDef());
    expect(s.phaseIndex).toBe(0);
    expect(s.exchanges).toEqual([]);
  });
});

// ── recordExchange ──

describe('recordExchange', () => {
  test('bumps only the current phase count', () => {
    let s = startMachine(makeDef(PHASES));
    s = recordExchange(s);
    s = recordExchange(s);
    expect(s.exchanges).toEqual([2, 0, 0]);
    s = { ...s, phaseIndex: 1 };
    s = recordExchange(s);
    expect(s.exchanges).toEqual([2, 1, 0]);
  });
});

// ── advanceMachine ──

describe('advanceMachine', () => {
  test('ignores an advance suggestion before the floor is met', () => {
    const def = makeDef(PHASES);
    const s = startMachine(def); // recall floor 1, zero exchanges
    const r = advanceMachine(s, def, '[NEXT_PHASE:account]');
    expect(r.closed).toBe(false);
    expect(r.state).toBe(s); // the machine stays — same object
    expect(r.state.phaseIndex).toBe(0);
  });

  test('advances when the floor is met and the transition exists', () => {
    const def = makeDef(PHASES);
    let s = recordExchange(startMachine(def)); // recall floor met
    const r = advanceMachine(s, def, '[NEXT_PHASE:account]');
    expect(r.closed).toBe(false);
    expect(r.state.phaseIndex).toBe(1);
    expect(r.state.exchanges).toEqual([1, 0, 0]); // per-phase counts preserved
    expect(r.state.startedAt).toBe(s.startedAt);
  });

  test('ignores [NEXT_PHASE:<unknown>] even with the floor met', () => {
    const def = makeDef(PHASES);
    let s = recordExchange(startMachine(def));
    const r = advanceMachine(s, def, '[NEXT_PHASE:nonexistent]');
    expect(r.closed).toBe(false);
    expect(r.state.phaseIndex).toBe(0);
  });

  test('ignores a non-forward [NEXT_PHASE] (same or earlier phase)', () => {
    const def = makeDef(PHASES);
    let s = recordExchange(startMachine(def));
    expect(advanceMachine(s, def, '[NEXT_PHASE:recall]').state.phaseIndex).toBe(0);
    const later = { ...s, phaseIndex: 2 };
    expect(advanceMachine(later, def, '[NEXT_PHASE:recall]').state.phaseIndex).toBe(2);
  });

  test('[SATURATED] at the last phase with the floor met closes the machine', () => {
    const def = makeDef(PHASES);
    const s = { ...startMachine(def), phaseIndex: 2 }; // decision floor 0, trivially met
    const r = advanceMachine(s, def, '[SATURATED]');
    expect(r.closed).toBe(true);
    expect(r.state).toBe(s);
  });

  test('[SATURATED] before the last phase is ignored', () => {
    const def = makeDef(PHASES);
    let s = recordExchange(startMachine(def)); // recall floor met, but not last
    const r = advanceMachine(s, def, '[SATURATED]');
    expect(r.closed).toBe(false);
    expect(r.state.phaseIndex).toBe(0);
  });

  test('[SATURATED] before the floor is met is ignored too', () => {
    const def = makeDef(PHASES);
    const s = startMachine(def);
    const r = advanceMachine(s, def, '[SATURATED]');
    expect(r.closed).toBe(false);
    expect(r.state.phaseIndex).toBe(0);
  });

  test('ignores plain question output (not an advance)', () => {
    const def = makeDef(PHASES);
    let s = recordExchange(startMachine(def));
    const r = advanceMachine(s, def, 'What made it hard?');
    expect(r.closed).toBe(false);
    expect(r.state.phaseIndex).toBe(0);
  });

  test('a def without phases never advances or closes', () => {
    const def = makeDef();
    const s = startMachine(def);
    expect(advanceMachine(s, def, '[SATURATED]').closed).toBe(false);
    expect(advanceMachine(s, def, '[NEXT_PHASE:account]').state).toBe(s);
  });
});

// ── parseMachineMarker ──

describe('parseMachineMarker', () => {
  test('a question with no marker is not a marker', () => {
    expect(parseMachineMarker('What made it hard?')).toBeNull();
  });

  test('extracts a bare [SATURATED]', () => {
    expect(parseMachineMarker('[SATURATED]')).toEqual({ kind: 'saturated' });
  });

  test('extracts [SATURATED] embedded in output', () => {
    expect(parseMachineMarker('I think we are done. [SATURATED]')).toEqual({ kind: 'saturated' });
  });

  test('extracts [NEXT_PHASE:<id>]', () => {
    expect(parseMachineMarker('[NEXT_PHASE:account]')).toEqual({ kind: 'nextPhase', id: 'account' });
  });

  test('[SATURATED] wins over [NEXT_PHASE] when both appear', () => {
    expect(parseMachineMarker('[NEXT_PHASE:account] [SATURATED]')).toEqual({ kind: 'saturated' });
  });
});

// ── machineQuestion / composition ──

describe('machineQuestion', () => {
  test('composes the phase prompt + shape rules + marker grammar into the system prompt', async () => {
    const def = makeDef(PHASES);
    const state = startMachine(def);
    const seen: string[] = [];
    const recording: Complete = async (system) => {
      seen.push(system);
      return 'What made it the hardest call?';
    };
    const q = await machineQuestion(state, def, [], recording);
    expect(q).toBe('What made it the hardest call?');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(PHASES[0]!.prompt);
    expect(seen[0]).toContain(MACHINE_SHAPE_RULES);
    expect(seen[0]).toContain(MACHINE_MARKER_GRAMMAR);
  });

  test('asks from the current phase', async () => {
    const def = makeDef(PHASES);
    const state = { ...startMachine(def), phaseIndex: 1 };
    const seen: string[] = [];
    const recording: Complete = async (system) => {
      seen.push(system);
      return 'What happened next?';
    };
    await machineQuestion(state, def, [], recording);
    expect(seen[0]).toContain(PHASES[1]!.prompt);
    expect(seen[0]).not.toContain(PHASES[0]!.prompt);
  });

  test('returns null when the model emits a marker', async () => {
    const def = makeDef(PHASES);
    const state = startMachine(def);
    const complete = makeScriptedComplete(['[SATURATED]']);
    expect(await machineQuestion(state, def, [], complete)).toBeNull();
  });

  test('returns null for empty model output', async () => {
    const def = makeDef(PHASES);
    const state = startMachine(def);
    const complete = makeScriptedComplete(['   ']);
    expect(await machineQuestion(state, def, [], complete)).toBeNull();
  });

  test('a def without phases returns null without calling the model', async () => {
    const def = makeDef();
    const state = startMachine(def);
    let called = false;
    const complete: Complete = async () => {
      called = true;
      return 'anything';
    };
    expect(await machineQuestion(state, def, [], complete)).toBeNull();
    expect(called).toBe(false);
  });
});

describe('composeMachineSystemPrompt', () => {
  test('exposes the composed prompt for the current phase', () => {
    const def = makeDef(PHASES);
    const state: MachineState = { ...startMachine(def), phaseIndex: 1 };
    const prompt = composeMachineSystemPrompt(def, state);
    expect(prompt).not.toBeNull();
    expect(prompt).toContain(PHASES[1]!.prompt);
    expect(prompt).toContain('[SATURATED]');
    expect(prompt).toContain('[NEXT_PHASE:<id>]');
  });

  test('returns null for a def without phases', () => {
    const def = makeDef();
    expect(composeMachineSystemPrompt(def, startMachine(def))).toBeNull();
  });
});
