import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// Clear the module-level cache between test suites that modify defs.
// We import after setup so the lazy singleton picks up temp defs.
let registry: typeof import('../src/protocols/registry.js');
let yieldMod: typeof import('../src/protocols/yield.js');

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
    expect(r.questionForm).toBe('deliberative');
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

  test('selectProtocolForTarget: self returns reflective', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    const p = registry.selectProtocolForTarget('self', 0, defs);
    expect(p.name).toBe('reflective');
    // self only has one protocol — always reflective regardless of index
    const p2 = registry.selectProtocolForTarget('self', 99, defs);
    expect(p2.name).toBe('reflective');
  });

  test('selectProtocolForTarget: domain rotates deterministically', async () => {
    registry = await import('../src/protocols/registry.js');
    const defs = registry.loadProtocolDefinitions();
    const domainDefs = [...defs.values()].filter((d) => d.targets.includes('domain'));
    expect(domainDefs.length).toBe(3);

    // sessionIndex 0, 1, 2 should pick three distinct protocols
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const p = registry.selectProtocolForTarget('domain', i, defs);
      seen.add(p.name);
    }
    expect(seen.size).toBe(3);

    // sessionIndex 3 wraps back to index 0
    const p0 = registry.selectProtocolForTarget('domain', 0, defs);
    const p3 = registry.selectProtocolForTarget('domain', 3, defs);
    expect(p3.name).toBe(p0.name);
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

// ── Yield ──

describe('yield tracking', () => {
  let vault: string;

  beforeEach(() => {
    vault = tmpVault();
  });

  afterEach(() => {
    try { rmSync(vault, { recursive: true, force: true }); } catch { /* ok */ }
  });

  function writeTranscript(sessionId: string, protocol: string, userTurns: number) {
    const dir = join(vault, 'transcripts');
    mkdirSync(dir, { recursive: true });
    let body = '';
    for (let i = 0; i < userTurns; i++) {
      body += `## user\n\nanswer text\n\n`;
      body += `## agent\n\nquestion text\n\n`;
    }
    const fm = `---\nsession: ${sessionId}\nmode:\n  minutes: 25\n  energy: medium\nprotocol: ${protocol}\nstarted: 2026-01-01T00:00:00.000Z\n---\n`;
    writeFileSync(join(dir, `${sessionId}.md`), fm + body, 'utf-8');
  }

  function writeSnippet(snippetId: string, sessionId: string) {
    const dir = join(vault, 'snippets', snippetId);
    mkdirSync(dir, { recursive: true });
    const fm = `---\nid: ${snippetId}\nversion: 1\ncaptured: 2026-01-01T00:01:00.000Z\nprovenance:\n  questionForm: deliberative\n  source: probe\n  session: ${sessionId}\n---\n`;
    writeFileSync(join(dir, 'v1.md'), fm + 'some prose', 'utf-8');
  }

  test('empty vault returns empty array', async () => {
    yieldMod = await import('../src/protocols/yield.js');
    const result = yieldMod.computeYield(vault);
    expect(result).toEqual([]);
  });

  test('session with no snippets yields zero ratio', async () => {
    writeTranscript('s1', 'reflective', 5);
    yieldMod = await import('../src/protocols/yield.js');
    const result = yieldMod.computeYield(vault);
    expect(result.length).toBe(1);
    expect(result[0]!.protocol).toBe('reflective');
    expect(result[0]!.sessionId).toBe('s1');
    expect(result[0]!.exchangeCount).toBe(5);
    expect(result[0]!.keptSnippetCount).toBe(0);
    expect(result[0]!.ratio).toBe(0);
  });

  test('computes ratio from matching snippets', async () => {
    writeTranscript('s1', 'cdm', 4);
    writeSnippet('snip-a', 's1');
    writeSnippet('snip-b', 's1');
    writeSnippet('snip-c', 's1');
    yieldMod = await import('../src/protocols/yield.js');
    const result = yieldMod.computeYield(vault);
    expect(result.length).toBe(1);
    expect(result[0]!.exchangeCount).toBe(4);
    expect(result[0]!.keptSnippetCount).toBe(3);
    expect(result[0]!.ratio).toBe(0.75);
  });

  test('snippets without session provenance are not counted', async () => {
    writeTranscript('s1', 'laddered-grid', 3);
    // Write snippet without session in provenance
    const dir = join(vault, 'snippets', 'orphan');
    mkdirSync(dir, { recursive: true });
    const fm = `---\nid: orphan\nversion: 1\ncaptured: 2026-01-01T00:01:00.000Z\nprovenance:\n  questionForm: deliberative\n  source: bank\n---\n`;
    writeFileSync(join(dir, 'v1.md'), fm + 'orphan prose', 'utf-8');
    yieldMod = await import('../src/protocols/yield.js');
    const result = yieldMod.computeYield(vault);
    expect(result.length).toBe(1);
    expect(result[0]!.keptSnippetCount).toBe(0);
  });

  test('multiple sessions aggregated correctly', async () => {
    writeTranscript('s1', 'reflective', 5);
    writeTranscript('s2', 'cdm', 3);
    writeSnippet('a', 's1');
    writeSnippet('b', 's1');
    writeSnippet('c', 's2');
    yieldMod = await import('../src/protocols/yield.js');
    const result = yieldMod.computeYield(vault);
    expect(result.length).toBe(2);

    const s1 = result.find((r) => r.sessionId === 's1')!;
    expect(s1.exchangeCount).toBe(5);
    expect(s1.keptSnippetCount).toBe(2);
    expect(s1.ratio).toBe(0.4);

    const s2 = result.find((r) => r.sessionId === 's2')!;
    expect(s2.exchangeCount).toBe(3);
    expect(s2.keptSnippetCount).toBe(1);
    expect(s2.ratio).toBeCloseTo(0.333, 2);
  });

  test('empty transcript (zero exchanges) yields ratio 0', async () => {
    writeTranscript('s1', 'reflective', 0);
    yieldMod = await import('../src/protocols/yield.js');
    const result = yieldMod.computeYield(vault);
    expect(result.length).toBe(1);
    expect(result[0]!.exchangeCount).toBe(0);
    expect(result[0]!.ratio).toBe(0);
  });
});
