import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THRESHOLDS, shadowDecision } from '../src/wiki/thresholds.js';

/**
 * The threshold registry is Q-35 turned into data, so its tests are of two
 * kinds. The behavioural half drives `shadowDecision` and reads the events it
 * emits. The conformance half takes its oracle from the SPEC FILES on disk —
 * the plan's threshold table and the decision register — never from the
 * implementation. An equality test between a constant and itself passes while
 * the value drifts off-spec (eval finding #2, and the reason canon.test.ts
 * exists); a registry whose numbers nobody checks against the decision that
 * set them is exactly that failure with a longer fuse.
 */

type Event = { at: string; actor: 'clerk'; kind: string; detail: string; refs?: string[] };

function collector(): { events: Event[]; log: (e: Event) => void } {
  const events: Event[] = [];
  return { events, log: (e: Event) => void events.push(e) };
}

const root = join(import.meta.dirname, '..');

describe('shadowDecision (Q-35)', () => {
  it('a shadowed threshold refuses the act and logs what it would have done', () => {
    const t = THRESHOLDS['lint.godNodeFanout'];
    const { events, log } = collector();

    const acted = shadowDecision(t, 'note god-node on referent=atlas', log);

    expect(acted).toBe(false);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('shadow-decision');
    expect(e.actor).toBe('clerk');
    expect(e.detail).toContain('lint.godNodeFanout');
    expect(e.detail).toContain('note god-node on referent=atlas');
    expect(Number.isNaN(Date.parse(e.at))).toBe(false);
  });

  it('a live threshold permits the act and logs nothing when it clips nothing', () => {
    const t = THRESHOLDS['mint.callsPerRun'];
    const { events, log } = collector();

    const acted = shadowDecision(t, 'mint a claim for reading 01K', log);

    expect(acted).toBe(true);
    expect(events).toEqual([]);
  });

  it('a live threshold that clips something logs threshold-clipped', () => {
    const t = THRESHOLDS['remeasure.liveCap'];
    const { events, log } = collector();

    const acted = shadowDecision(t, 'skip re-measure for candidate 01K — 2 already live', log, true);

    expect(acted).toBe(true);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.kind).toBe('threshold-clipped');
    expect(e.detail).toContain('remeasure.liveCap');
    expect(e.detail).toContain('skip re-measure for candidate 01K');
  });

  it('a boolean-valued threshold routes exactly like a numeric one', () => {
    // Two switches live in this register (`status.readLogDiscount`,
    // `clash.oppositionGate`). A switch that read `1` for "on" would be a
    // magic number pretending to be a measurement; the wider type is the
    // honest fix, and it must not buy a second code path.
    const discount = THRESHOLDS['status.readLogDiscount'];
    expect(discount.value).toBe(true);
    expect(discount.live).toBe(false);

    const shadowed = collector();
    expect(shadowDecision(discount, 'discount 1 read-log cite on claim 01K', shadowed.log)).toBe(false);
    expect(shadowed.events).toHaveLength(1);
    expect(shadowed.events[0]!.kind).toBe('shadow-decision');

    const gate = THRESHOLDS['clash.oppositionGate'];
    expect(gate.value).toBe(true);

    const live = collector();
    expect(shadowDecision(gate, 'pool candidate 01K/01M', live.log)).toBe(true);
    expect(live.events).toEqual([]);
  });

  it('never reports live for a shadowed threshold, whatever the clip flag says', () => {
    // The clip flag names the KIND of the record, never the licence to act.
    const t = THRESHOLDS['clash.embeddingCosine'];
    const { events, log } = collector();

    expect(shadowDecision(t, 'surface pair 01K/01M at cosine 0.91', log, true)).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('shadow-decision');
  });
});

describe('the register itself', () => {
  it('every threshold records the condition that would graduate it', () => {
    // Q-35: "every PROVISIONAL register entry names its graduation condition,
    // not a date". This iteration is that rule's enforcement — a threshold
    // whose graduation condition is unrecorded can never honestly graduate,
    // because nobody will remember what evidence was meant to justify it.
    for (const [key, t] of Object.entries(THRESHOLDS)) {
      expect(t.graduatesWhen.trim().length, `${key} has no graduation condition`).toBeGreaterThan(20);
    }
  });

  it('every key is its own name, so a log line names the entry it came from', () => {
    for (const [key, t] of Object.entries(THRESHOLDS)) {
      expect(t.name).toBe(key);
    }
  });

  it('clash.oppositionGate ships live — Q-49, by name', () => {
    // B10's resolution is a decision, not an oversight. Reversing it means
    // editing this line, which says out loud what reverting costs: Q-30
    // stages 2-5 lose their input and the pipeline becomes a shadow feature.
    expect(THRESHOLDS['clash.oppositionGate'].live).toBe(true);

    const register = readFileSync(join(root, 'docs/decisions/elicit.md'), 'utf-8');
    expect(register).toContain('stage-1 opposition judgment ships LIVE');
  });

  it('remeasure.liveCap holds the number Q-30 wrote', () => {
    const register = readFileSync(join(root, 'docs/decisions/elicit.md'), 'utf-8');
    expect(register).toContain('≤2 live re-measures in the Queue');
    expect(THRESHOLDS['remeasure.liveCap'].value).toBe(2);
  });
});

describe('conformance with the plan that specified the table', () => {
  // The plan's threshold table is the only place the whole table is specified.
  // Reading it here means a value edited in code without a decision behind it
  // fails, and a decision recorded without the code following it fails too.
  const plan = readFileSync(
    join(root, 'docs/superpowers/plans/2026-08-02-the-clerk.md'),
    'utf-8',
  );

  const HEADER = '| name | start value | live? | graduates when |';

  type Row = { name: string; value: number | boolean; live: boolean };

  function specRows(): Row[] {
    const start = plan.indexOf(HEADER);
    if (start < 0) throw new Error(`threshold table header not found: ${HEADER}`);
    const body = plan.slice(start).split('\n').slice(2); // header + separator
    const rows: Row[] = [];
    for (const line of body) {
      if (!line.trimStart().startsWith('|')) break;
      const cells = line.split('|').slice(1, -1);
      const nameCell = cells[0] ?? '';
      const valueCell = (cells[1] ?? '').trim();
      const liveCell = (cells[2] ?? '').trim();
      const name = /`([^`]+)`/.exec(nameCell)?.[1];
      if (!name) throw new Error(`unparseable threshold row: ${line}`);
      // Cells read "3 content words", "0.85", "`true` (on)" — the value is
      // always the leading token, the rest is the unit in prose.
      let value: number | boolean;
      if (valueCell.startsWith('`true`')) value = true;
      else {
        const num = /^(\d+(?:\.\d+)?)/.exec(valueCell);
        if (!num?.[1]) throw new Error(`unparseable value for ${name}: ${valueCell}`);
        value = Number(num[1]);
      }
      rows.push({ name, value, live: liveCell.includes('**live**') });
    }
    return rows;
  }

  it('declares exactly the thresholds the plan tabulates', () => {
    const spec = specRows();
    expect(spec.length).toBeGreaterThan(0);
    expect(Object.keys(THRESHOLDS).sort()).toEqual(spec.map((r) => r.name).sort());
  });

  it('holds the plan value and the plan shadow flag for every entry', () => {
    for (const row of specRows()) {
      const t = (THRESHOLDS as Record<string, { value: number | boolean; live: boolean }>)[row.name];
      expect(t, `${row.name} is specified but not declared`).toBeDefined();
      expect(t!.value, `${row.name} value`).toBe(row.value);
      expect(t!.live, `${row.name} live flag`).toBe(row.live);
    }
  });

  it('ships shadow-first: only the entries the plan marked live are live', () => {
    // The default is shadow. If this count creeps up, a mechanism graduated
    // without the record Q-35 asks for, and the diff says which one.
    const live = Object.values(THRESHOLDS).filter((t) => t.live).map((t) => t.name).sort();
    expect(live).toEqual(specRows().filter((r) => r.live).map((r) => r.name).sort());
  });
});
