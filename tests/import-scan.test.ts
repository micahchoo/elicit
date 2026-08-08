import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanFolder } from '../src/import/scan.js';

// A chmod-000 directory only throws for a non-root reader; root bypasses
// the mode bits, so the permission case is skipped there.
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

/** The committed fixture. These tests NEVER mutate it — a scan must be re-runnable. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import-folder');

/**
 * A scratch copy of the fixture for the tests that edit files. Copying first
 * is the point: the frontmatter-bump and body-edit tests would otherwise
 * change what the fixture asserts, and a scan that rewrites its input is a
 * scan nobody can trust with a real folder.
 */
let FIXTURE_COPY: string;

beforeAll(() => {
  FIXTURE_COPY = mkdtempSync(join(tmpdir(), 'import-scan-'));
  cpSync(FIXTURE, FIXTURE_COPY, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_COPY, { recursive: true, force: true });
});

/** Rewrite a copy's `lastmod` line — a frontmatter-only edit (Q-59's first sitting). */
function bumpLastmod(file: string, value: string): void {
  const raw = readFileSync(file, 'utf-8');
  writeFileSync(file, raw.replace(/^lastmod:.*$/m, `lastmod: ${value}`));
}

describe('scanFolder (a folder becomes items and refusals, and no date is guessed)', () => {
  it('refuses a file with no frontmatter date, with a reason, and imports nothing', () => {
    const r = scanFolder(FIXTURE);
    expect(r.refused).toContainEqual({ sourcePath: join(FIXTURE, 'undated.md'), reason: 'no-date' });
    expect(r.items.map((i) => i.sourcePath)).not.toContain(join(FIXTURE, 'undated.md'));
  });

  it('refuses a file whose body is empty after the frontmatter', () => {
    expect(scanFolder(FIXTURE).refused).toContainEqual({
      sourcePath: join(FIXTURE, 'frontmatter-only.md'),
      reason: 'empty-body',
    });
  });

  it('hashes the body, so a frontmatter-only edit is the same item', () => {
    const before = scanFolder(FIXTURE).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
    bumpLastmod(join(FIXTURE_COPY, 'dated-essay.md'), '2026-02-22');
    const after = scanFolder(FIXTURE_COPY).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
    expect(after.hash).toBe(before.hash);
  });

  it('hashes the body, so a body edit is a different item', () => {
    const before = scanFolder(FIXTURE).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
    const copyFile = join(FIXTURE_COPY, 'dated-essay.md');
    writeFileSync(copyFile, `${readFileSync(copyFile, 'utf-8')}\n\nA new closing paragraph.`);
    const after = scanFolder(FIXTURE_COPY).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
    expect(after.hash).not.toBe(before.hash);
  });

  it('takes the sitting date from `date`, never from `lastmod` or the mtime', () => {
    const item = scanFolder(FIXTURE).items.find((i) => i.sourcePath.endsWith('dated-essay.md'))!;
    expect(item.date).toBe('2018-09-01');
  });

  it.skipIf(IS_ROOT)('names the subdirectory it choked on (ticket 154)', () => {
    // One unreadable subdirectory must not abort the scan with a nameless
    // error: the throw names the folder, and the route relays it as-is.
    const locked = join(FIXTURE_COPY, 'locked');
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, 'inside.md'), '---\ndate: 2026-01-01\n---\n\nbody\n');
    chmodSync(locked, 0o000);
    try {
      let thrown: unknown = null;
      try {
        scanFolder(FIXTURE_COPY);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain(`cannot read folder ${locked}`);
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});
