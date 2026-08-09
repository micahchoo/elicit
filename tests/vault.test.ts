import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createVault } from '../src/vault/vault.js';
import { roleConfig } from '../src/llm.js';
import { decide } from '../src/harvester/harvester.js';
import type { Vault, Provenance, Mode, Turn, CutProposal } from '../src/types.js';

let root: string;
let vault: Vault;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-vault-test-'));
  vault = createVault(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeProvenance(overrides?: Partial<Provenance>): Provenance {
  return {
    kind: 'harvest',
    session: 'test-session',
    question: 'What shaped your thinking?',
    questionForm: 'deliberative',
    ...overrides,
  };
}

function makeMode(overrides?: Partial<Mode>): Mode {
  return {
    ...overrides,
  };
}

const sampleProse = 'I believe that quiet tools shape better thinking.';
const sampleProse2 = 'Version two: I now believe loud tools also work.';

describe('Vault', () => {
  // ── Snippet roundtrip ──

  it('snippet roundtrip preserves prose byte-for-byte', () => {
    const provenance = makeProvenance();
    const saved = vault.saveSnippet(sampleProse, provenance);
    const index = vault.rebuildIndex();
    const roundtripped = index.snippets[saved.id];
    expect(roundtripped).toBeDefined();
    expect(roundtripped!.prose).toBe(sampleProse);
    expect(Buffer.from(roundtripped!.prose)).toEqual(Buffer.from(sampleProse));
  });

  // ── Immutable versions (Q-5) ──

  it('saveVersion creates v2 and leaves v1 byte-identical', () => {
    const provenance = makeProvenance();
    const v1 = vault.saveSnippet(sampleProse, provenance);
    const v1Path = join(root, 'snippets', v1.id, 'v1.md');
    const v1Bytes = readFileSync(v1Path);
    expect(v1.version).toBe(1);

    const v2 = vault.saveVersion(v1.id, sampleProse2);
    expect(v2.id).toBe(v1.id);
    expect(v2.version).toBe(2);
    expect(v2.prose).toBe(sampleProse2);

    // v1 must be byte-identical
    const v1BytesAfter = readFileSync(v1Path);
    expect(v1BytesAfter).toEqual(v1Bytes);

    // v2 file must exist
    const v2Path = join(root, 'snippets', v1.id, 'v2.md');
    expect(existsSync(v2Path)).toBe(true);

    // Index sees both versions
    const index = vault.rebuildIndex();
    const indexed = index.snippets[v1.id];
    expect(indexed).toBeDefined();
    expect(indexed!.version).toBe(2);
    expect(indexed!.prose).toBe(sampleProse2);
  });

  // ── Q-4: no facet/stance in snippet frontmatter ──

  it('snippet file frontmatter contains no facet or stance key', () => {
    const provenance = makeProvenance();
    const saved = vault.saveSnippet(sampleProse, provenance);
    const raw = readFileSync(
      join(root, 'snippets', saved.id, 'v1.md'),
      'utf-8',
    );
    // Extract frontmatter between --- delimiters
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const frontmatter = fmMatch![1];
    expect(frontmatter).not.toContain('facet:');
    expect(frontmatter).not.toContain('stance:');
  });

  // ── Reading cites id@1 ──

  it('reading cites id@1', () => {
    const provenance = makeProvenance();
    const snippet = vault.saveSnippet(sampleProse, provenance);
    const reading = vault.saveReading({
      facet: 'value',
      stance: 'avowal',
      reading: 'User believes quiet tools shape thinking.',
      cites: [`${snippet.id}@1`],
    });
    expect(reading.cites).toEqual([`${snippet.id}@1`]);

    // Verify on disk
    const raw = readFileSync(
      join(root, 'wiki', 'readings', `${reading.id}.md`),
      'utf-8',
    );
    expect(raw).toContain(`- ${snippet.id}@1`);
  });

  // ── Transcript: append-only invariant (Q-8) ──

  it('appendTurn before startTranscript throws', () => {
    const turn: Turn = {
      role: 'user',
      text: 'Hello.',
      at: new Date().toISOString(),
    };
    expect(() => vault.appendTurn('nonexistent', turn)).toThrow();
  });

  it('appendTurn twice yields both turns in order', () => {
    const session = 'test-session-1';
    const mode = makeMode();
    vault.startTranscript(session, {
      mode,
      protocol: 'reflective-interview',
      started: new Date().toISOString(),
    });

    const t1: Turn = {
      role: 'agent',
      text: 'What matters most to you?',
      at: new Date().toISOString(),
      questionForm: 'deliberative',
    };
    const t2: Turn = {
      role: 'user',
      text: 'Quiet mornings.',
      at: new Date().toISOString(),
    };

    vault.appendTurn(session, t1);
    vault.appendTurn(session, t2);

    const raw = readFileSync(
      join(root, 'transcripts', `${session}.md`),
      'utf-8',
    );
    // Both turns appear in order
    const agentIdx = raw.indexOf('## agent');
    const userIdx = raw.indexOf('## user');
    expect(agentIdx).toBeGreaterThan(-1);
    expect(userIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeLessThan(userIdx);
    expect(raw).toContain('What matters most to you?');
    expect(raw).toContain('Quiet mornings.');
  });

  // ── Transcript carries Mode (Q-7) ──

  it('transcript frontmatter carries the Mode', () => {
    const session = 'test-session-mode';
    const mode: Mode = { target: 'self', topic: 'philosophy' };
    vault.startTranscript(session, {
      mode,
      protocol: 'reflective-interview',
      started: new Date().toISOString(),
    });

    const raw = readFileSync(
      join(root, 'transcripts', `${session}.md`),
      'utf-8',
    );
    expect(raw).toContain('target: self');
    expect(raw).toContain('topic: philosophy');
  });

  // ── Transcript carries quest/direction tags (Q-75) ──

  it('startTranscript writes quest and direction to frontmatter', () => {
    const session = 'test-session-quest';
    vault.startTranscript(session, {
      mode: makeMode(),
      protocol: 'coached',
      started: '2026-08-03T00:00:00.000Z',
      quest: 'q_01HZX0test',
      direction: 'd_01HZX0test',
    });

    const raw = readFileSync(
      join(root, 'transcripts', `${session}.md`),
      'utf-8',
    );
    expect(raw).toContain('quest: q_01HZX0test');
    expect(raw).toContain('direction: d_01HZX0test');
  });

  it('startTranscript without quest/direction writes neither key', () => {
    const session = 'test-session-plain';
    vault.startTranscript(session, {
      mode: makeMode(),
      protocol: 'reflective-interview',
      started: '2026-08-03T00:00:00.000Z',
    });

    const raw = readFileSync(
      join(root, 'transcripts', `${session}.md`),
      'utf-8',
    );
    expect(raw).not.toContain('quest');
    expect(raw).not.toContain('direction');
    // Absent stays absent: byte-identical to the pre-Q-75 shape.
    expect(raw).toBe(
      '---\n' +
        'session: test-session-plain\n' +
        'mode: {}\n' +
        'protocol: reflective-interview\n' +
        "started: '2026-08-03T00:00:00.000Z'\n" +
        '---\n' +
        '\n',
    );
  });

  // ── rebuildIndex from fresh instance (Q-3) ──

  it('rebuildIndex from a fresh Vault instance sees all files', () => {
    const provenance = makeProvenance();
    const snippet = vault.saveSnippet(sampleProse, provenance);
    const reading = vault.saveReading({
      facet: 'value',
      stance: 'avowal',
      reading: 'A reading.',
      cites: [`${snippet.id}@1`],
    });
    const bud = vault.saveBud('fragment', ['standalone'], 's1');
    const mode = makeMode();
    vault.startTranscript('s1', {
      mode,
      protocol: 'reflective-interview',
      started: new Date().toISOString(),
    });

    // Fresh Vault instance — index rebuilt purely from files
    const freshVault = createVault(root);
    const index = freshVault.rebuildIndex();

    expect(index.snippets[snippet.id]).toBeDefined();
    expect(index.snippets[snippet.id]!.prose).toBe(sampleProse);
    expect(index.readings[reading.id]).toBeDefined();
    expect(index.readings[reading.id]!.cites).toEqual([`${snippet.id}@1`]);
    expect(index.buds[bud.id]).toBeDefined();
    expect(index.buds[bud.id]!.fragment).toBe('fragment');
  });
});

// ── Ticket 048: the capture channel, recorded once or lost ──

describe('capture channel', () => {
  it('a snippet saved without a channel loads without one', () => {
    const saved = vault.saveSnippet(sampleProse, makeProvenance());

    const raw = readFileSync(join(root, 'snippets', saved.id, 'v1.md'), 'utf-8');
    expect(raw).not.toContain('channel');

    const loaded = createVault(root).rebuildIndex().snippets[saved.id];
    expect(loaded).toBeDefined();
    // Absent, not 'typed' and not undefined-valued: every snippet captured
    // before the field existed knows nothing about how it arrived, and a
    // default would be an answer the vault never observed.
    expect('channel' in loaded!.provenance).toBe(false);
  });

  it('round-trips each of the three channels', () => {
    for (const channel of ['typed', 'spoken', 'pasted'] as const) {
      const saved = vault.saveSnippet(sampleProse, makeProvenance({ channel }));
      const loaded = createVault(root).rebuildIndex().snippets[saved.id];
      expect(loaded!.provenance.channel).toBe(channel);
    }
  });

  it('carries the channel forward to a new version', () => {
    // A v2 is the same words' next self, captured the same way — the channel
    // travels with the provenance it belongs to.
    const v1 = vault.saveSnippet(sampleProse, makeProvenance({ channel: 'pasted' }));
    const v2 = vault.saveVersion(v1.id, sampleProse2);
    expect(v2.provenance.channel).toBe('pasted');

    const loaded = createVault(root).rebuildIndex().snippets[v1.id];
    expect(loaded!.provenance.channel).toBe('pasted');
  });
});

// ── Q-34: every agent-authored artifact carries a model stamp ──

describe('reading stamps', () => {
  let savedModel: string | undefined;

  beforeEach(() => {
    savedModel = process.env.ELICIT_CLERK_MODEL;
    delete process.env.ELICIT_CLERK_MODEL;
  });

  afterEach(() => {
    if (savedModel === undefined) delete process.env.ELICIT_CLERK_MODEL;
    else process.env.ELICIT_CLERK_MODEL = savedModel;
  });

  it('saveReading stamps at, model and modelAt, and rebuildIndex reads all three back', () => {
    const snippet = vault.saveSnippet(sampleProse, makeProvenance());
    const before = new Date().toISOString();
    const reading = vault.saveReading({
      facet: 'value',
      stance: 'avowal',
      reading: 'User believes quiet tools shape thinking.',
      cites: [`${snippet.id}@1`],
    });

    expect(reading.at).toBeDefined();
    expect(reading.model).toBeDefined();
    expect(reading.modelAt).toBeDefined();
    expect(reading.at! >= before).toBe(true);

    // The stamp lives in the markdown, not only in the returned object (Q-3).
    const raw = readFileSync(join(root, 'wiki', 'readings', `${reading.id}.md`), 'utf-8');
    // The model id holds a colon, so YAML quotes it — assert the key and the
    // value, never the rendering.
    expect(raw).toMatch(/^model: /m);
    expect(raw).toContain(reading.model!);
    expect(raw).toContain(reading.at!);

    const indexed = createVault(root).rebuildIndex().readings[reading.id];
    expect(indexed).toBeDefined();
    expect(indexed!.at).toBe(reading.at);
    expect(indexed!.model).toBe(reading.model);
    expect(indexed!.modelAt).toBe(reading.modelAt);
  });

  it('stamps the model the clerk role is pointed at', () => {
    process.env.ELICIT_CLERK_MODEL = 'under-test';
    const reading = vault.saveReading({
      facet: 'fact',
      stance: 'report-of-fact',
      reading: 'A reading.',
      cites: ['01ABC@1'],
    });
    expect(reading.model).toBe('under-test');
  });

  it('defaults to the same model the clerk role defaults to', () => {
    // The oracle is llm.ts, read through roleConfig at test time — a reading
    // is clerk work (Q-48), so a stamp naming any other model is a false
    // record of who wrote it.
    const reading = vault.saveReading({
      facet: 'fact',
      stance: 'report-of-fact',
      reading: 'A reading.',
      cites: ['01ABC@1'],
    });
    expect(reading.model).toBe(roleConfig('clerk').modelId);
  });

  it('parses a reading file written before the stamp existed, with all three absent', () => {
    const dir = join(root, 'wiki', 'readings');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'OLDREADING.md'),
      ['---', 'id: OLDREADING', 'facet: value', 'stance: avowal', 'cites:', '  - 01ABC@1', '---', 'An older reading.', ''].join('\n'),
      'utf-8',
    );

    const indexed = vault.rebuildIndex().readings.OLDREADING;
    expect(indexed).toBeDefined();
    expect(indexed!.reading).toBe('An older reading.');
    // Absent, not present-and-undefined: exactOptionalPropertyTypes makes
    // those two different states, and only one of them is what disk says.
    expect('at' in indexed!).toBe(false);
    expect('model' in indexed!).toBe(false);
    expect('modelAt' in indexed!).toBe(false);
  });

  it('stamps a reading written through the harvest path, with no model passed in', () => {
    process.env.ELICIT_CLERK_MODEL = 'harvest-path-model';
    const proposal: CutProposal = {
      text: sampleProse,
      sourceTurn: 0,
      facet: 'value',
      stance: 'avowal',
      reading: 'Quiet tools shape thinking.',
      question: 'What shaped your thinking?',
      questionForm: 'deliberative',
    };

    decide('test-session', [proposal], [{ proposal: 0, action: 'approve' }], vault);

    const readings = Object.values(vault.rebuildIndex().readings);
    expect(readings.length).toBe(1);
    expect(readings[0]!.model).toBe('harvest-path-model');
    expect(readings[0]!.at).toBeDefined();
  });
});
