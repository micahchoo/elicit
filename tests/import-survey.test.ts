import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import { surveyFolder, writeSurvey, type Survey, type SurveyNode } from '../src/import/survey.js';
import { bodyHash } from '../src/import/scan.js';
import { createImportStore } from '../src/import/store.js';
import { FIXTURE_FILES } from './fixtures/seeding-vault/manifest.js';

/** The committed seeding fixture (T3): six files, no frontmatter. Never mutated. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'seeding-vault');

const node = (s: Survey, path: string): SurveyNode | undefined => s.nodes.find((n) => n.path === path);
const bodyOf = (rel: string): string => matter(readFileSync(join(FIXTURE, rel), 'utf-8')).content;

describe('surveyFolder (a model-free map of the tree, harvested state from the store)', () => {
  let vaultRoot: string;
  let store: ReturnType<typeof createImportStore>;

  beforeEach(() => {
    vaultRoot = mkdtempSync(join(tmpdir(), 'survey-'));
    store = createImportStore(vaultRoot);
  });

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('counts markdown files per folder and aggregates up the tree', () => {
    const s = surveyFolder(FIXTURE, store);
    expect(node(s, '')!.total.files).toBe(FIXTURE_FILES); // 6, from the fixture manifest
    expect(node(s, 'journal')!.files).toBe(4); // DIRECT children only — the two 2019 files are not direct
    expect(node(s, 'journal/2019')!.files).toBe(2);
  });

  it('marks a file harvested only when its body hash has an accepted record', () => {
    const rel = 'journal/2021-03-04.md';
    store.put({
      hash: bodyHash(bodyOf(rel)),
      sourcePath: join(FIXTURE, rel),
      date: '2021-03-04',
      status: 'accepted',
      attempts: 0,
    });
    expect(node(surveyFolder(FIXTURE, store), 'journal')!.harvested).toBe(1);
  });

  it('counts an excluded record as refused, never as harvested and never as unread', () => {
    const rel = 'journal/2021-03-04.md';
    store.put({
      hash: bodyHash(bodyOf(rel)),
      sourcePath: join(FIXTURE, rel),
      date: '2021-03-04',
      status: 'excluded',
      excludeReason: 'not mine alone',
      attempts: 0,
    });
    const n = node(surveyFolder(FIXTURE, store), 'journal')!;
    expect(n.refused).toBe(1);
    expect(n.harvested).toBe(0);
    expect(n.files).toBe(n.harvested + n.refused + n.unread);
  });

  it('omits folders that hold no markdown at any depth', () => {
    const copy = join(vaultRoot, 'copy');
    cpSync(FIXTURE, copy, { recursive: true });
    mkdirSync(join(copy, 'attachments'), { recursive: true });
    writeFileSync(join(copy, 'attachments', 'a.png'), '');
    expect(node(surveyFolder(copy, store), 'attachments')).toBeUndefined();
  });

  it('cannot make a model call — the module imports no LLM path', () => {
    const src = readFileSync('src/import/survey.ts', 'utf-8');
    expect(src).not.toMatch(/from ['"][^'"]*llm|from ['"][^'"]*harvester|: Complete\b/);
  });

 it('a written survey reads back after a restart', () => {
  const s = surveyFolder(FIXTURE, store);
  writeSurvey(vaultRoot, s);
  // readSurvey died with the reach pipeline (canon §10 cut) — the snapshot
  // itself is the contract, read directly off disk.
  const snapshot = JSON.parse(readFileSync(join(vaultRoot, 'imports', 'survey.json'), 'utf-8')) as {
   nodes: unknown[];
  };
  expect(snapshot.nodes).toHaveLength(s.nodes.length);
 });
});
