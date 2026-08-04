import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';

import { archiveFreshStart, archiveStamp, freshStartTargets } from '../src/reset/fresh-start.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A project dir shaped like the repo: a vault with person data + git
 * history, instrument data that must stay, eval corpora that must move. */
function scaffold(): { cwd: string; vaultRoot: string } {
 const cwd = mkdtempSync(join(tmpdir(), 'fresh-start-'));
 const vaultRoot = join(cwd, 'vault');

 mkdirSync(join(vaultRoot, 'snippets', '01ABC'), { recursive: true });
 writeFileSync(join(vaultRoot, 'snippets', '01ABC', 'v1.md'), 'their words');
 mkdirSync(join(vaultRoot, '.git'), { recursive: true });
 writeFileSync(join(vaultRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
 writeFileSync(join(vaultRoot, '.auth.json'), '{"hash":"x"}');

 mkdirSync(join(cwd, 'data', 'annotations'), { recursive: true });
 writeFileSync(join(cwd, 'data', 'annotations', 'a.md'), 'note');
 mkdirSync(join(cwd, 'data', 'eval-007'), { recursive: true });
 writeFileSync(join(cwd, 'data', 'eval-007', 'pairs.json'), '[]');
 writeFileSync(join(cwd, 'data', 'prior-ingest.local.json'), '{}');

 // Instruments — must never move.
 writeFileSync(join(cwd, 'data', 'question-bank.jsonl'), '{"q":"?"}');
 writeFileSync(join(cwd, 'data', 'decisions.jsonl'), '{"d":1}');
 mkdirSync(join(cwd, 'data', 'decks'), { recursive: true });
 writeFileSync(join(cwd, 'data', 'decks', 'deck.json'), '[]');

 return { cwd, vaultRoot };
}

const NOW = new Date('2026-08-04T03:45:12.500Z');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('archiveStamp', () => {
 test('is an ISO second-stamp with no colons', () => {
  expect(archiveStamp(NOW)).toBe('2026-08-04T03-45-12');
 });
});

describe('freshStartTargets', () => {
 test('lists only person-derived paths that exist', () => {
  const { cwd, vaultRoot } = scaffold();
  const targets = freshStartTargets(cwd, vaultRoot);
  expect(targets).toContain(vaultRoot);
  expect(targets).toContain(join(cwd, 'data', 'annotations'));
  expect(targets).toContain(join(cwd, 'data', 'eval-007'));
  expect(targets).toContain(join(cwd, 'data', 'prior-ingest.local.json'));
  // gazetteer does not exist in this scaffold → not a target
  expect(targets).not.toContain(join(cwd, 'data', 'gazetteer'));
  // instruments are never targets
  expect(targets).not.toContain(join(cwd, 'data', 'question-bank.jsonl'));
  expect(targets).not.toContain(join(cwd, 'data', 'decisions.jsonl'));
  expect(targets).not.toContain(join(cwd, 'data', 'decks'));
 });

 test('picks up a new eval corpus without a code change', () => {
  const { cwd, vaultRoot } = scaffold();
  mkdirSync(join(cwd, 'data', 'eval-120-future'), { recursive: true });
  expect(freshStartTargets(cwd, vaultRoot)).toContain(join(cwd, 'data', 'eval-120-future'));
 });
});

describe('archiveFreshStart', () => {
 test('moves person data into the dated archive, mirrors the manual layout', () => {
  const { cwd, vaultRoot } = scaffold();
  const report = archiveFreshStart({ cwd, vaultRoot, now: NOW });

  const dir = join(cwd, 'archives', '2026-08-04T03-45-12');
  expect(report.archiveDir).toBe(dir);
  // vault lands whole at vault/, with its git history and auth file intact
  expect(readFileSync(join(dir, 'vault', 'snippets', '01ABC', 'v1.md'), 'utf-8')).toBe('their words');
  expect(existsSync(join(dir, 'vault', '.git', 'HEAD'))).toBe(true);
  expect(existsSync(join(dir, 'vault', '.auth.json'))).toBe(true);
  // data records land under data/
  expect(existsSync(join(dir, 'data', 'annotations', 'a.md'))).toBe(true);
  expect(existsSync(join(dir, 'data', 'eval-007', 'pairs.json'))).toBe(true);
  expect(existsSync(join(dir, 'data', 'prior-ingest.local.json'))).toBe(true);
 });

 test('the sources are gone and the instruments untouched', () => {
  const { cwd, vaultRoot } = scaffold();
  archiveFreshStart({ cwd, vaultRoot, now: NOW });

  expect(existsSync(vaultRoot)).toBe(false);
  expect(existsSync(join(cwd, 'data', 'annotations'))).toBe(false);
  expect(existsSync(join(cwd, 'data', 'eval-007'))).toBe(false);
  // instruments stay, byte for byte
  expect(readFileSync(join(cwd, 'data', 'question-bank.jsonl'), 'utf-8')).toBe('{"q":"?"}');
  expect(readFileSync(join(cwd, 'data', 'decisions.jsonl'), 'utf-8')).toBe('{"d":1}');
  expect(existsSync(join(cwd, 'data', 'decks', 'deck.json'))).toBe(true);
 });

 test('refuses an archive directory that already exists', () => {
  const { cwd, vaultRoot } = scaffold();
  mkdirSync(join(cwd, 'archives', '2026-08-04T03-45-12'), { recursive: true });
  expect(() => archiveFreshStart({ cwd, vaultRoot, now: NOW })).toThrow(/already exists/);
  // and refused means untouched: the vault is still in place
  expect(existsSync(join(vaultRoot, 'snippets', '01ABC', 'v1.md'))).toBe(true);
 });

 test('a second reset on the fresh state archives nothing but succeeds', () => {
  const { cwd, vaultRoot } = scaffold();
  archiveFreshStart({ cwd, vaultRoot, now: NOW });
  const again = archiveFreshStart({ cwd, vaultRoot, now: new Date('2026-08-04T04:00:00Z') });
  expect(again.moved).toEqual([]);
 });

 test('archiving eval corpora writes the Q-91 manifest with archive-relative paths', () => {
  const { cwd, vaultRoot } = scaffold();
  archiveFreshStart({ cwd, vaultRoot, now: NOW });

  const manifest = JSON.parse(readFileSync(join(cwd, 'data', 'eval-fixtures.json'), 'utf-8'));
  expect(manifest.entries).toHaveLength(1);
  expect(manifest.entries[0].archivedAt).toBe('2026-08-04T03-45-12');
  expect(manifest.entries[0].fixtures['eval-007']).toBe(
   join('archives', '2026-08-04T03-45-12', 'data', 'eval-007'),
  );
  // the pointer resolves: the corpus really is at the recorded path
  expect(existsSync(join(cwd, manifest.entries[0].fixtures['eval-007']))).toBe(true);
 });

 test('the manifest survives the next reset and accumulates entries', () => {
  const { cwd, vaultRoot } = scaffold();
  archiveFreshStart({ cwd, vaultRoot, now: NOW });
  // a new corpus appears after the first reset
  mkdirSync(join(cwd, 'data', 'eval-101'), { recursive: true });
  writeFileSync(join(cwd, 'data', 'eval-101', 'x.json'), '{}');
  const later = new Date('2026-08-05T10:00:00Z');
  const second = archiveFreshStart({ cwd, vaultRoot, now: later });

  // eval-fixtures.json itself was not a target of the second reset
  expect(second.moved.some((p) => p.endsWith('eval-fixtures.json'))).toBe(false);
  const manifest = JSON.parse(readFileSync(join(cwd, 'data', 'eval-fixtures.json'), 'utf-8'));
  expect(manifest.entries).toHaveLength(2);
  expect(manifest.entries[1].fixtures['eval-101']).toBe(
   join('archives', '2026-08-05T10-00-00', 'data', 'eval-101'),
  );
 });

 test('no eval corpora, no manifest', () => {
  const { cwd, vaultRoot } = scaffold();
  rmSync(join(cwd, 'data', 'eval-007'), { recursive: true });
  archiveFreshStart({ cwd, vaultRoot, now: NOW });
  expect(existsSync(join(cwd, 'data', 'eval-fixtures.json'))).toBe(false);
 });
});
