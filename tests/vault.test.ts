import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createVault } from '../src/vault/vault.js';
import type { Vault, Provenance, Mode, Turn } from '../src/types.js';

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
    minutes: 30,
    energy: 'medium',
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
    const mode: Mode = { minutes: 25, energy: 'low', topic: 'philosophy' };
    vault.startTranscript(session, {
      mode,
      protocol: 'reflective-interview',
      started: new Date().toISOString(),
    });

    const raw = readFileSync(
      join(root, 'transcripts', `${session}.md`),
      'utf-8',
    );
    expect(raw).toContain('minutes: 25');
    expect(raw).toContain('energy: low');
    expect(raw).toContain('topic: philosophy');
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
