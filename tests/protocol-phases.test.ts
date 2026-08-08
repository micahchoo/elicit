import { describe, expect, test } from 'vitest';
import { loadProtocolDefinitions } from '../src/protocols/registry.js';
import type { ProtocolDef } from '../src/protocols/registry.js';
import { SATURATED_MARKER } from '../src/protocols/machine.js';

// ── The plan (ticket 159, slice 2) ──
//
// Each instrument's phases, pinned from the campaign plan: id / label /
// minExchanges. The label is the short user-readable phase name; the floor
// is the code-enforced minimum number of exchanges before the phase may
// advance. All four instruments' phases declare a floor of 1 (the plan's
// "recall (1)", "name-the-kinds (1)", etc.).

const PLAN: Record<string, { phases: Array<[id: string, label: string, minExchanges: number]> }> = {
  cdm: {
    phases: [
      ['recall', 'recall a hard call', 1],
      ['account', 'walk it through', 1],
      ['decision-probes', 'decision probes', 1],
    ],
  },
  'concept-sorting': {
    phases: [
      ['name-the-kinds', 'name the kinds', 1],
      ['sort-into-piles', 'sort into piles', 1],
      ['what-shares', 'what each pile shares', 1],
    ],
  },
  'people-grid': {
    phases: [
      ['triads', 'which two are alike', 1],
      ['dimensions', 'the dimension', 1],
    ],
  },
  'laddered-grid': {
    phases: [
      ['examples', 'examples that differ', 1],
      ['how-can-you-tell', 'how can you tell', 1],
    ],
  },
  // Slice 6 unified drm: the existing three-flow as machine phases, with
  // the day-map renderer on the enumerate phase. The gate floor is 0 — the
  // terminal phase has nothing to exchange (the model may saturate on
  // entry); every other floor is 1.
  drm: {
    phases: [
      ['enumerate', 'walk back through yesterday', 1],
      ['probe', 'probe each episode', 1],
      ['gate', 'the gate', 0],
    ],
  },
};

// The marker affordance every phase prompt ends with (slice-2 authoring
// rule): the model may emit the saturation marker at the end of the
// instrument or a forward-advance marker otherwise — else it asks exactly
// one question. Built from the driver's own constant so the defs can never
// drift from the grammar.
const MARKER_AFFORDANCE =
  `If this phase is complete, you may end it by emitting ${SATURATED_MARKER} (at the end of the instrument) or [NEXT_PHASE:<next id>] — otherwise ask exactly ONE question.`;

describe('protocol phase defs (ticket 159, slice 2)', () => {
  const defs = loadProtocolDefinitions();

  for (const [name, plan] of Object.entries(PLAN)) {
    describe(name, () => {
      const def: ProtocolDef | undefined = defs.get(name);
      const phases = def?.phases;

      test('phases parse and the count matches the plan', () => {
        expect(def, `${name}: def missing`).toBeDefined();
        expect(phases, `${name}: phases`).toBeDefined();
        expect(phases!.length, `${name}: phase count`).toBe(plan.phases.length);
      });

      test('each phase matches the plan: id, label, minExchanges', () => {
        plan.phases.forEach(([id, label, minExchanges], i) => {
          const phase = phases![i]!;
          expect(phase.id, `${name}: phase ${i} id`).toBe(id);
          expect(phase.label, `${name}: phase ${id} label`).toBe(label);
          expect(phase.minExchanges, `${name}: phase ${id} minExchanges`).toBe(minExchanges);
        });
      });

      test('ids are unique and floors are non-negative', () => {
        const ids = phases!.map((p) => p.id);
        expect(new Set(ids).size, `${name}: unique ids`).toBe(ids.length);
        for (const phase of phases!) {
          expect(phase.minExchanges, `${name}: phase ${phase.id} floor`).toBeGreaterThanOrEqual(0);
        }
      });

      test('prompts are non-empty and non-identical across phases', () => {
        const prompts = phases!.map((p) => p.prompt);
        for (const prompt of prompts) {
          expect(prompt.length, `${name}: non-empty prompt`).toBeGreaterThan(0);
        }
        expect(new Set(prompts).size, `${name}: distinct prompts`).toBe(prompts.length);
      });

      test('every phase prompt ends with the marker affordance', () => {
        for (const phase of phases!) {
          expect(phase.prompt, `${name}: phase ${phase.id} affordance`)
            .toContain(MARKER_AFFORDANCE);
          expect(phase.prompt.endsWith(MARKER_AFFORDANCE), `${name}: phase ${phase.id} affordance is last`)
            .toBe(true);
        }
      });

      test('the last phase prompt carries the affordance (assignment minimum)', () => {
        const last = phases![phases!.length - 1]!;
        expect(last.prompt).toContain(MARKER_AFFORDANCE);
      });

      test('mid-phase prompts name a real next phase id (self-contained advance)', () => {
        for (let i = 0; i < phases!.length - 1; i++) {
          const phase = phases![i]!;
          const nextId = phases![i + 1]!.id;
          expect(phase.prompt, `${name}: phase ${phase.id} names next phase`).toContain(nextId);
        }
      });
    });
  }
});
