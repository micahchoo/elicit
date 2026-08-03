import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { loadEnvFile } from '../src/env.js';

/**
 * The .env loader is the machine-config seam: everything the server reads
 * from process.env at boot can come from this file. Two properties carry
 * the contract — a shell-exported variable always beats the file, and a
 * `~/` value expands to the home directory (the STT model dir lives under
 * one). The rest is parsing hygiene.
 */

const dirs: string[] = [];
const touched: string[] = [];

function envDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'elicit-env-'));
  dirs.push(dir);
  writeFileSync(join(dir, '.env'), content);
  return dir;
}

/** Track every key a test sets so afterEach can restore a clean slate. */
function expectKey(key: string): void {
  touched.push(key);
}

afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.length = 0;
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('loadEnvFile', () => {
  it('sets a plain KEY=value pair', () => {
    expectKey('ELICIT_TEST_PLAIN');
    loadEnvFile(envDir('ELICIT_TEST_PLAIN=hello\n'));
    expect(process.env.ELICIT_TEST_PLAIN).toBe('hello');
  });

  it('never overwrites a variable already in the environment', () => {
    expectKey('ELICIT_TEST_WINS');
    process.env.ELICIT_TEST_WINS = 'shell';
    loadEnvFile(envDir('ELICIT_TEST_WINS=file\n'));
    expect(process.env.ELICIT_TEST_WINS).toBe('shell');
  });

  it('expands a leading ~/ to the home directory', () => {
    expectKey('ELICIT_TEST_TILDE');
    loadEnvFile(envDir('ELICIT_TEST_TILDE=~/models/parakeet\n'));
    expect(process.env.ELICIT_TEST_TILDE).toBe(join(homedir(), 'models/parakeet'));
  });

  it('strips matching surrounding quotes but keeps inner content exact', () => {
    expectKey('ELICIT_TEST_DQ');
    expectKey('ELICIT_TEST_SQ');
    loadEnvFile(envDir('ELICIT_TEST_DQ="a b"\nELICIT_TEST_SQ=\'c=d\'\n'));
    expect(process.env.ELICIT_TEST_DQ).toBe('a b');
    expect(process.env.ELICIT_TEST_SQ).toBe('c=d');
  });

  it('splits on the FIRST = so values may contain =', () => {
    expectKey('ELICIT_TEST_URL');
    loadEnvFile(envDir('ELICIT_TEST_URL=http://h:1/v1?a=b\n'));
    expect(process.env.ELICIT_TEST_URL).toBe('http://h:1/v1?a=b');
  });

  it('ignores comments, blank lines, bare words, and malformed keys', () => {
    expectKey('ELICIT_TEST_KEPT');
    loadEnvFile(
      envDir('# comment\n\nnot a line\n9BAD=x\nELICIT-DASH=x\nELICIT_TEST_KEPT=yes\n'),
    );
    expect(process.env.ELICIT_TEST_KEPT).toBe('yes');
    expect(process.env['9BAD']).toBeUndefined();
    expect(process.env['ELICIT-DASH']).toBeUndefined();
  });

  it('is a no-op when the directory has no .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elicit-env-'));
    dirs.push(dir);
    expect(() => loadEnvFile(dir)).not.toThrow();
  });
});
