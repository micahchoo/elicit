import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chmodSync } from 'node:fs';

// ── Types ──

export interface AuthData {
 salt: string;  // hex
 hash: string;  // hex
}

export interface AuthStore {
 /** Whether an auth file exists on disk. */
 exists(): boolean;
 /** Verify a password against the stored hash. Returns false if no auth file. */
 verify(password: string): boolean;
 /** Create/replace the auth file with a scrypt-hashed password. */
 setup(password: string): AuthData;
 /** Full path to the auth file, for tests that need to check permissions. */
 readonly filePath: string;
}

// ── Constants ──

const KEYLEN = 32;
const SALT_LEN = 16;
const SCRYPT_OPTS: { N: number; r: number; p: number } = { N: 2 ** 14, r: 8, p: 1 };

// ── Implementation ──

class FileAuth implements AuthStore {
 readonly filePath: string;

 constructor(filePath: string) {
  this.filePath = filePath;
 }

 exists(): boolean {
  return existsSync(this.filePath);
 }

 verify(password: string): boolean {
  if (!existsSync(this.filePath)) return false;
  const raw = readFileSync(this.filePath, 'utf-8');
  let data: AuthData;
  try {
   data = JSON.parse(raw) as AuthData;
  } catch {
   return false;
  }
  if (!data.salt || !data.hash) return false;

  const salt = Buffer.from(data.salt, 'hex');
  const want = Buffer.from(data.hash, 'hex');
  const got = scryptSync(password, salt, KEYLEN, SCRYPT_OPTS);

  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
 }

 setup(password: string): AuthData {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEYLEN, SCRYPT_OPTS);
  const data: AuthData = {
   salt: salt.toString('hex'),
   hash: hash.toString('hex'),
  };
  writeFileSync(this.filePath, JSON.stringify(data) + '\n', { mode: 0o600 });
  return data;
 }
}

// ── Factory ──

export function createFileAuth(filePath: string): AuthStore {
 return new FileAuth(filePath);
}

// ── Loopback detection ──

/**
 * Pure function: is the remote address a loopback address?
 * Checks 127.0.0.1, ::1, and IPv4-mapped IPv6 loopback.
 */
export function isLoopback(remoteAddr: string | undefined): boolean {
 if (!remoteAddr) return false;
 return (
  remoteAddr === '127.0.0.1' ||
  remoteAddr === '::1' ||
  remoteAddr === '::ffff:127.0.0.1'
 );
}
