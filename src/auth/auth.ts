import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chmodSync } from 'node:fs';
import type { Context } from 'hono';

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

// ── Route guard factories (Wave C3 F10) ──

/** The remote address the Node adapter injects into the Hono env. */
export function remoteAddrOf(env: unknown): string | undefined {
 if (env && typeof env === 'object' && 'remoteAddr' in env) {
  const v = (env as Record<string, unknown>).remoteAddr;
  return typeof v === 'string' ? v : undefined;
 }
 return undefined;
}

/**
 * The loopback-only guard: whether the caller is on the host machine.
 * Homes the address extraction + isLoopback pair the three loopback-only
 * server sites used to re-implement inline; the failure response stays the
 * site's (the three sites say three different things, and the setup gate
 * answers with a page rather than a 403).
 */
export function requireLoopback(c: Context): boolean {
 return isLoopback(remoteAddrOf(c.env));
}

/**
 * The {ok: true} + session-cookie response both password routes return —
 * one shape instead of the two identical inline Response objects.
 */
export function sessionResponse(cookie: string): Response {
 return new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: {
   'Content-Type': 'application/json',
   'Set-Cookie': cookie,
  },
 });
}

// ── Session tokens (the other half of auth, Wave E S14) ──

export interface SessionAuthConfig {
 /** Cookie name the session rides in; default 'elicit_session'. */
 cookieName?: string;
 /** Session lifetime in ms; default 24 hours. */
 ttlMs?: number;
}

export interface SessionAuth {
 /** Issue a fresh session: a new token plus the full Set-Cookie header value. */
 issue(): { token: string; cookie: string };
 /** Whether the request's cookie names a live, unexpired session token. */
 check(c: { req: { header: (n: string) => string | undefined } }): boolean;
 /**
  * The /api gate: with an auth file present, require a live session (401);
  * without one, require a loopback caller (403). The same 401/403 shapes the
  * inline server middleware produced.
  */
 middleware(gate: {
  authFileExists(): boolean;
  remoteAddr(env: unknown): string | undefined;
 }): (c: Context, next: () => Promise<void>) => Promise<Response | void>;
}

/**
 * The session-token half of password-gated access (S14): the in-memory
 * token→expiry map, the cookie it rides in, and the middleware that checks
 * it — extracted from src/server.ts with cookie format, token generation and
 * error shapes byte-identical. The vault/.auth.json scrypt half lives beside
 * it in this module; together they are the whole gate.
 */
export function createSessionAuth(config?: SessionAuthConfig): SessionAuth {
 const cookieName = config?.cookieName ?? 'elicit_session';
 const ttlMs = config?.ttlMs ?? 24 * 60 * 60 * 1000;
 const loginSessions = new Map<string, number>();
 const cookieRe = new RegExp(`${cookieName}=([^;]+)`);

 const issue = (): { token: string; cookie: string } => {
  const token = randomBytes(32).toString('hex');
  loginSessions.set(token, Date.now() + ttlMs);
  const cookie = `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttlMs / 1000}`;
  return { token, cookie };
 };

 const check = (c: { req: { header: (n: string) => string | undefined } }): boolean => {
  const cookie = c.req.header('cookie') ?? '';
  const match = cookieRe.exec(cookie);
  if (!match) return false;
  const token = match[1]!;
  const expiry = loginSessions.get(token);
  if (!expiry || expiry < Date.now()) {
   loginSessions.delete(token);
   return false;
  }
  return true;
 };

 const middleware = (gate: {
  authFileExists(): boolean;
  remoteAddr(env: unknown): string | undefined;
 }): ((c: Context, next: () => Promise<void>) => Promise<Response | void>) => async (c, next) => {
  if (!gate.authFileExists()) {
   // No auth file — check loopback
   const remoteAddr = gate.remoteAddr(c.env);
   if (isLoopback(remoteAddr)) return next();
   return c.json({ error: 'setup required' }, 403);
  }
  // Auth file exists — require session
  if (!check(c)) {
   return new Response('Unauthorized', { status: 401 });
  }
  return next();
 };

 return { issue, check, middleware };
}
