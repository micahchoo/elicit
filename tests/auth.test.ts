import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileAuth, isLoopback, type AuthStore } from '../src/auth/auth.js';

// ── Helpers ──

function setupAuth(tmpDir: string): AuthStore {
  return createFileAuth(join(tmpDir, '.auth.json'));
}

// ── isLoopback ──

describe('isLoopback', () => {
  it('127.0.0.1 is loopback', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
  });

  it('::1 is loopback', () => {
    expect(isLoopback('::1')).toBe(true);
  });

  it('::ffff:127.0.0.1 is loopback', () => {
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });

  it('192.168.1.1 is not loopback', () => {
    expect(isLoopback('192.168.1.1')).toBe(false);
  });

  it('::1 with zone index is not matched (exact string match)', () => {
    expect(isLoopback('::1%lo')).toBe(false);
  });

  it('undefined is not loopback', () => {
    expect(isLoopback(undefined)).toBe(false);
  });

  it('empty string is not loopback', () => {
    expect(isLoopback('')).toBe(false);
  });
});

// ── AuthStore (file-backed) ──

describe('FileAuth', () => {
  let tmpDir: string;
  let store: AuthStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'elicit-auth-'));
    store = setupAuth(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exists returns false when no auth file', () => {
    expect(store.exists()).toBe(false);
  });

  it('verify returns false when no auth file', () => {
    expect(store.verify('anything')).toBe(false);
  });

  it('hash/verify roundtrip', () => {
    store.setup('correct-horse-battery-staple');
    expect(store.exists()).toBe(true);
    expect(store.verify('correct-horse-battery-staple')).toBe(true);
  });

  it('wrong password rejected', () => {
    store.setup('secret');
    expect(store.verify('wrong')).toBe(false);
  });

  it('wrong password rejected even with length match', () => {
    store.setup('password123');
    expect(store.verify('password456')).toBe(false);
  });

  it('setup returns salt and hash as hex', () => {
    const data = store.setup('test');
    expect(data.salt).toBeTypeOf('string');
    expect(data.hash).toBeTypeOf('string');
    expect(data.salt.length).toBeGreaterThan(0);
    expect(data.salt.length % 2).toBe(0);
    expect(data.hash.length).toBeGreaterThan(0);
    expect(data.hash.length % 2).toBe(0);
    expect(/^[0-9a-f]+$/i.test(data.salt)).toBe(true);
    expect(/^[0-9a-f]+$/i.test(data.hash)).toBe(true);
  });

  it('auth file is created with mode 0600', () => {
    store.setup('test');
    const st = statSync(store.filePath);
    const perms = st.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it('auth file is valid JSON with salt and hash', () => {
    store.setup('test');
    expect(existsSync(store.filePath)).toBe(true);
    const content = readFileSync(store.filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.salt).toBeTypeOf('string');
    expect(parsed.hash).toBeTypeOf('string');
  });

  it('new setup overwrites previous', () => {
    store.setup('old');
    const data1 = store.setup('new');
    expect(store.verify('old')).toBe(false);
    expect(store.verify('new')).toBe(true);
    const raw = readFileSync(store.filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.salt).toBe(data1.salt);
    expect(parsed.hash).toBe(data1.hash);
  });

  it('same password twice produces different hashes (unique salt)', () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'elicit-auth2-'));
    const store2 = setupAuth(tmpDir2);
    try {
      store.setup('same');
      store2.setup('same');
      const raw1 = readFileSync(store.filePath, 'utf-8');
      const raw2 = readFileSync(store2.filePath, 'utf-8');
      expect(raw1).not.toBe(raw2);
    } finally {
      rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});
