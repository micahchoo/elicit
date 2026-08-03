import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { createCoverageStore } from '../src/ktg/coverage.js';
import type { CoverageStore, NodeReading } from '../src/ktg/coverage.js';

let root: string;
let store: CoverageStore;

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'elicit-ktg-coverage-'));
 store = createCoverageStore(root);
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

function makeReading(overrides?: Partial<NodeReading>): NodeReading {
 return {
  nodeId: 'cooking.knife-skills.chiffonade',
  cites: ['snip-1'],
  status: 'touched',
  model: 'mr-ktg-v1',
  at: '2026-08-03T10:00:00.000Z',
  ...overrides,
 };
}

describe('ktg coverage — status derivation', () => {
 it('unprobed: no reading file exists for the node', () => {
  expect(store.coverageForNode('cooking.knife-skills.chiffonade', () => 'sitting-1')).toBe('unprobed');
 });

 it('unprobed: a reading file whose cites are empty', () => {
  store.writeReading(makeReading({ cites: [] }));
  expect(store.coverageForNode('cooking.knife-skills.chiffonade', () => 'sitting-1')).toBe('unprobed');
 });

 it('touched: cites all resolve to one sitting', () => {
  const reading = makeReading({ cites: ['snip-1', 'snip-2'] });
  store.writeReading(reading);
  const sittingOf = (id: string) => (id.startsWith('snip-') ? 'sitting-1' : null);
  expect(store.coverageForNode('cooking.knife-skills.chiffonade', sittingOf)).toBe('touched');
 });

 it('evidenced: cites resolve across two sittings (cross-sitting, Q-50)', () => {
  const reading = makeReading({ cites: ['snip-1', 'snip-2', 'snip-3'] });
  store.writeReading(reading);
  const sittingOf = (id: string) => (id === 'snip-1' ? 'sitting-1' : 'sitting-2');
  expect(store.coverageForNode('cooking.knife-skills.chiffonade', sittingOf)).toBe('evidenced');
 });

 it('evidenced needs two DISTINCT sittings, not two cites', () => {
  const reading = makeReading({ cites: ['snip-1', 'snip-2', 'snip-3'] });
  store.writeReading(reading);
  // three cites, but the resolver says every one came from sitting-1
  expect(store.coverageForNode('cooking.knife-skills.chiffonade', () => 'sitting-1')).toBe('touched');
 });

 it('cites with no identifiable sitting stay touched — never inflated to evidenced', () => {
  const reading = makeReading({ cites: ['snip-1', 'snip-2'] });
  store.writeReading(reading);
  expect(store.coverageForNode('cooking.knife-skills.chiffonade', () => null)).toBe('touched');
 });
});

describe('ktg coverage — write and read', () => {
 it('writeReading → readReading round-trips the full reading', () => {
  const reading = makeReading({
   cites: ['snip-1', 'snip-2'],
   status: 'evidenced',
   model: 'mr-ktg-v2',
  });
  store.writeReading(reading);

  const got = store.readReading('cooking.knife-skills.chiffonade');
  expect(got).not.toBeNull();
  expect(got!.nodeId).toBe(reading.nodeId);
  expect(got!.cites).toEqual(['snip-1', 'snip-2']);
  expect(got!.status).toBe('evidenced');
  expect(got!.model).toBe('mr-ktg-v2');
  expect(got!.at).toBe(reading.at);
 });

 it('readReading returns null for a node never written', () => {
  expect(store.readReading('cooking.knife-skills.chiffonade')).toBeNull();
 });

 it('persists to vault/ktg/coverage/<nodeId>.md with frontmatter and one cite link per line', () => {
  store.writeReading(makeReading({ cites: ['snip-1', 'snip-2'] }));

  const file = join(root, 'ktg', 'coverage', 'cooking.knife-skills.chiffonade.md');
  const onDisk = readFileSync(file, 'utf-8');
  const parsed = matter(onDisk);
  expect(parsed.data).toMatchObject({
   nodeId: 'cooking.knife-skills.chiffonade',
   status: 'touched',
   model: 'mr-ktg-v1',
   at: '2026-08-03T10:00:00.000Z',
  });
  expect(parsed.content.trim().split('\n')).toEqual([
   '- [snip-1](snippets/snip-1.md)',
   '- [snip-2](snippets/snip-2.md)',
  ]);
 });

 it('re-writing a node replaces the reading (one file per node)', () => {
  store.writeReading(makeReading({ status: 'touched', cites: ['snip-1'] }));
  store.writeReading(makeReading({ status: 'evidenced', cites: ['snip-1', 'snip-2'] }));

  expect(readdirSync(join(root, 'ktg', 'coverage'))).toEqual(['cooking.knife-skills.chiffonade.md']);
  const got = store.readReading('cooking.knife-skills.chiffonade')!;
  expect(got.status).toBe('evidenced');
  expect(got.cites).toEqual(['snip-1', 'snip-2']);
 });

 it('listReadings returns every node, including nodes with empty cites', () => {
  store.writeReading(makeReading({ nodeId: 'a.b.c', cites: ['snip-1'] }));
  store.writeReading(makeReading({ nodeId: 'd.e.f', cites: [] }));

  const byId = Object.fromEntries(store.listReadings().map((r) => [r.nodeId, r]));
  expect(Object.keys(byId).sort()).toEqual(['a.b.c', 'd.e.f']);
  expect(byId['a.b.c']!.cites).toEqual(['snip-1']);
  expect(byId['d.e.f']!.cites).toEqual([]);
 });
});
