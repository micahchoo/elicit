import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// The phases-loader tests below serve phantom defs through a mocked node:fs —
// the established pattern for exercising loader paths without touching the
// real defs directory (see protocol-title-fallback.test.ts). The mock keeps
// every real fs function intact; only readdirSync/readFileSync calls on the
// defs dir see the phantom files, so the real-defs tests above are untouched.
const fsState = vi.hoisted(() => ({
  extraDefs: new Map<string, string>(),
}));

vi.mock('node:fs', async (importOriginal) => {
  // Inline typeof import matches protocol-title-fallback.test.ts; the mock
  // factory is hoisted above static imports, so only this form can name the
  // real module's type here.
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: ((dir: unknown) => {
      if (typeof dir === 'string' && dir.includes('defs')) {
        return [...(actual.readdirSync(dir) as string[]), ...fsState.extraDefs.keys()];
      }
      return actual.readdirSync(dir as Parameters<typeof actual.readdirSync>[0]);
    }) as typeof actual.readdirSync,
    readFileSync: ((path: unknown, ...rest: unknown[]) => {
      if (typeof path === 'string' && path.includes('defs')) {
        const name = path.split(/[\\/]/).pop()!;
        const extra = fsState.extraDefs.get(name);
        if (extra !== undefined) return extra;
      }
      return (actual.readFileSync as (p: unknown, ...r: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readFileSync,
  };
});

// Clear the module-level cache between test suites that modify defs.
// We import after setup so the lazy singleton picks up temp defs.
let registry: typeof import('../src/protocols/registry.js');

function tmpVault() {
  const root = join(tmpdir(), `elicit-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  return root;
}

// ── Registry ──

describe('protocol registry', () => {
  test('loads all four built-in defs', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    expect(defs.size).toBeGreaterThanOrEqual(4);
    expect(defs.has('reflective')).toBe(true);
    expect(defs.has('cdm')).toBe(true);
    expect(defs.has('laddered-grid')).toBe(true);
    expect(defs.has('concept-sorting')).toBe(true);
  });

  test('reflective targets self only', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    const r = defs.get('reflective')!;
    expect(r.targets).toEqual(['self']);
    expect(r.questionForm).toBe('theoretical');
    expect(r.prompt.length).toBeGreaterThan(100);
  });

  test('cdm targets domain only', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    const c = defs.get('cdm')!;
    expect(c.targets).toEqual(['domain']);
    expect(c.prompt).toContain('Critical Decision Method');
  });

  test('concept-sorting targets domain only', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    const cs = defs.get('concept-sorting')!;
    expect(cs.targets).toEqual(['domain']);
    expect(cs.prompt).toContain('concept-sorting');
  });


  test('getProtocol returns undefined for unknown name', async () => {
    registry = await import('../src/protocols/registry.js');
    expect(registry.getProtocol('nonexistent')).toBeUndefined();
  });

  test('getProtocol returns def for known name', async () => {
    registry = await import('../src/protocols/registry.js');
    const d = registry.getProtocol('cdm')!;
    expect(d.name).toBe('cdm');
    expect(d.prompt.length).toBeGreaterThan(50);
  });

  test('all six defs carry the settled titles and blurbs (ticket 157)', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    const settled: Record<string, { title: string; blurb: string }> = {
      drm: { title: 'walk back through yesterday', blurb: 'recover yesterday hour by hour, block by block' },
      reflective: { title: 'follow the thread', blurb: 'deepen the last thing you said' },
      cdm: { title: 'the hard call', blurb: 'take one hard decision apart' },
      'concept-sorting': { title: 'sort the kinds', blurb: 'name your kinds and pile them' },
      'people-grid': { title: 'which two are alike', blurb: 'compare the people in your life, three at a time' },
      'laddered-grid': { title: 'how can you tell', blurb: 'find the tells that separate your cases' },
    };
    for (const [name, want] of Object.entries(settled)) {
      const def = defs.get(name);
      expect(def, `${name}: def missing`).toBeDefined();
      expect(def!.title, `${name}: title`).toBe(want.title);
      expect(def!.blurb, `${name}: blurb`).toBe(want.blurb);
    }
    // The title is required on ProtocolDef and never degrades to empty.
    for (const [name, def] of defs) {
      expect(def.title.length, `${name}: empty title`).toBeGreaterThan(0);
    }
  });

  test('all defs have non-empty prompts and valid questionForms', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    const validForms = new Set(['deliberative', 'theoretical', 'why']);
    for (const [name, def] of defs) {
      expect(def.prompt.length, `${name}: empty prompt`).toBeGreaterThan(0);
      expect(validForms.has(def.questionForm), `${name}: invalid questionForm "${def.questionForm}"`).toBe(true);
      expect(def.targets.length, `${name}: no targets`).toBeGreaterThan(0);
      // The guard floor (ticket 079) is protocol data: a fixed, one-sentence
      // probe the elicitor serves when every fallback is empty. A def without
      // one silently gets the registry default, which is exactly the silent
      // decay the sweep guards against elsewhere — so every def must carry its
      // own, distinct from the default.
      expect(def.floorProbe.length, `${name}: empty floorProbe`).toBeGreaterThan(0);
      expect(def.floorProbe, `${name}: floorProbe is the generic default`)
        .not.toBe(registry.DEFAULT_FLOOR_PROBE);
    }
  });
});

// ── Phases frontmatter loader (ticket 159) ──

const PHASES_DEF = [
  '---',
  'name: zz-phases',
  'title: "phases probe"',
  'targets:',
  '  - self',
  'prerequisites: []',
  'questionForm: deliberative',
  'floorProbe: "What does the phases probe say?"',
  'rotation: false',
  'phases:',
  '  - id: recall',
  '    label: "recall a hard call"',
  '    minExchanges: 1',
  '    prompt: "Recall the hardest call you described."',
  '  - id: account',
  '    label: "walk it through"',
  '    minExchanges: 2',
  '    prompt: "Walk it through step by step."',
  '---',
  'Phases probe body.',
].join('\n');

const NO_PHASES_DEF = PHASES_DEF.replace(/\nphases:[\s\S]*\n---/, '\n---');

// A declared-but-empty phases list is a programming error, not a non-machine.
const PHASES_EMPTY_DEF = PHASES_DEF.replace(/\nphases:[\s\S]*\n---/, '\nphases: []\n---');

// phases declared as a scalar — not a list of phase objects.
const PHASES_STRING_DEF = PHASES_DEF.replace(/\nphases:[\s\S]*\n---/, '\nphases: "bogus"\n---');

describe('phases frontmatter loader (ticket 159)', () => {
  afterEach(() => {
    fsState.extraDefs.clear();
  });

  // The registry caches its defs in a module-level singleton, so each
  // scenario re-imports it as a fresh module instance via vi.resetModules()
  // — an intentional exercise of the module loading boundary (the dynamic
  // import is required for that cache-bust; a static import would pin the
  // first parse forever).

  test('a def with phases frontmatter parses them', async () => {
    fsState.extraDefs.set('zz-phases.md', PHASES_DEF);
    vi.resetModules();
    registry = await import('../src/protocols/registry.js');
    const def = registry.loadProtocolDefinitions().get('zz-phases')!;
    expect(def.phases).toEqual([
      { id: 'recall', label: 'recall a hard call', minExchanges: 1, prompt: 'Recall the hardest call you described.' },
      { id: 'account', label: 'walk it through', minExchanges: 2, prompt: 'Walk it through step by step.' },
    ]);
    expect(def.phases![0]!.renderer).toBeUndefined();
  });

  test('a phase renderer hint parses when present (slice-6 placeholder)', async () => {
    const withRenderer = PHASES_DEF.replace(
      '  - id: recall',
      '  - id: recall\n    renderer: day-map',
    );
    fsState.extraDefs.set('zz-phases.md', withRenderer);
    vi.resetModules();
    registry = await import('../src/protocols/registry.js');
    const def = registry.loadProtocolDefinitions().get('zz-phases')!;
    expect(def.phases![0]!.renderer).toBe('day-map');
  });

  test('a def without a phases key loads with phases undefined', async () => {
    fsState.extraDefs.set('zz-phases.md', NO_PHASES_DEF);
    vi.resetModules();
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    expect(defs.get('zz-phases')!.phases).toBeUndefined();
    // Non-machine defs stay key-absent. Every shipping def is a machine:
    // slice 2 made the four structured defs machines, slice 4 formalized
    // reflective (its one ways-in phase), slice 6 unified drm — whose
    // enumerate phase carries the day-map renderer, the machine's first
    // UI-bearing phase.
    for (const name of ['drm', 'reflective', 'cdm', 'concept-sorting', 'people-grid', 'laddered-grid']) {
      expect(defs.get(name)!.phases, `${name}: phases`).toBeDefined();
    }
    expect(defs.get('drm')!.phases![0]!.renderer, 'drm: day-map renderer').toBe('drm-day-map');
  });

  test('malformed phases lists fail loud at load', async () => {
    const cases: [string, string][] = [
      ['missing id', PHASES_DEF.replace('  - id: recall', '  - id: ""')],
      ['duplicate id', PHASES_DEF.replace('id: account', 'id: recall')],
      ['negative minExchanges', PHASES_DEF.replace('minExchanges: 1', 'minExchanges: -1')],
      ['fractional minExchanges', PHASES_DEF.replace('minExchanges: 1', 'minExchanges: 1.5')],
      ['string minExchanges', PHASES_DEF.replace('minExchanges: 1', 'minExchanges: "1"')],
      ['empty prompt', PHASES_DEF.replace('prompt: "Recall the hardest call you described."', 'prompt: ""')],
      ['empty phases list', PHASES_EMPTY_DEF],
      ['phases not a list', PHASES_STRING_DEF],
    ];
    for (const [name, content] of cases) {
      fsState.extraDefs.set('zz-phases.md', content);
      vi.resetModules();
      registry = await import('../src/protocols/registry.js');
      expect(() => registry.loadProtocolDefinitions(), name).toThrow(/phases/);
    }
  });
});
