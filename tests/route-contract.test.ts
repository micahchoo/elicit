/**
 * Ticket 151, step 5 — the class guard: every fetch path the web/ tree
 * calls must resolve against the routes src/server.ts registers, method
 * included. The HTTP read-side mirror of the exposure registry (077):
 * a phantom route — client calls a path or method the server never
 * registers — can never ship again.
 *
 * The client's method is computed exactly as web/main.ts isReadPath does:
 * the GET prefix list is read OUT of the source (one source of truth), and
 * the exact-match rules are mirrored here. If isReadPath changes, this
 * mirror must change with it; the test's failures are loud.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// ── Server side: the registered route table ──

type ServerRoute = { method: string; pattern: string; regex: RegExp };

const ROUTE_RE = /app\.(get|post|put|delete|patch)\s*\(\s*(['"`])(\/[^'"`]*)\2/g;

/** Every route src/server.ts registers whose path starts with /api.
 * Middleware (app.use) is not a route, and the static catch-all ('/*')
 * 404s /api paths — neither can satisfy a client call. */
function serverRoutes(): ServerRoute[] {
 const text = readFileSync(join(ROOT, 'src', 'server.ts'), 'utf-8');
 const routes: ServerRoute[] = [];
 for (const m of text.matchAll(ROUTE_RE)) {
  const method = m[1]!.toUpperCase();
  const pattern = m[3]!;
  if (!pattern.startsWith('/api')) continue;
  routes.push({ method, pattern, regex: routeToRegex(pattern) });
 }
 return routes;
}

function routeToRegex(pattern: string): RegExp {
 const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
 // `:` is not in the escape class above, so the param segments survive as
 // plain `:name` — turn each into one path segment.
 const withParams = escaped.replace(/:[A-Za-z0-9_]+/g, '[^/]+');
 return new RegExp(`^${withParams}$`);
}

// ── Client side: every path the web/ tree calls ──

type ClientCall = {
 path: string;
 method: 'GET' | 'POST';
 file: string;
 line: number;
};

/** The read-route prefixes, extracted from web/main.ts itself — the client
 * and this test can never drift apart on the prefix list. */
function getPrefixes(): string[] {
 const text = readFileSync(join(ROOT, 'web', 'main.ts'), 'utf-8');
 const m = text.match(/const GET_PREFIXES = \[([^\]]*)\]/);
 if (!m) throw new Error('could not find GET_PREFIXES in web/main.ts');
 return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

/**
 * The exact-match rules from web/main.ts isReadPath, mirrored. Each is
 * deliberate there (a comment explains why prefix matching would misroute
 * a POST under the same path); the mirror keeps the test computing the
 * same method the client does.
 */
const EXACT_GET_RULES: ((p: string) => boolean)[] = [
 (p) => p === '/api/queue' || p.startsWith('/api/queue?'),
 (p) => p === '/api/wiki' || p.startsWith('/api/wiki?'),
 (p) => p === '/api/reach' || p.startsWith('/api/reach?'),
 (p) => /^\/api\/piece\/[^/]+$/.test(p),
 (p) => /^\/api\/piece\/[^/]+\/export$/.test(p),
 (p) => p === '/api/coach/waiting',
 (p) => /^\/api\/coach\/(?!direction$|quest$|waiting$)[^/]+$/.test(p),
];

function isReadPath(path: string, prefixes: string[]): boolean {
 if (prefixes.some((p) => path.startsWith(p))) return true;
 return EXACT_GET_RULES.some((rule) => rule(path));
}

/** Collapse `${...}` template segments to a single placeholder segment. */
function normalizeClientPath(raw: string): string {
 let p = raw.split('?')[0]!;
 while (p.includes('${')) {
  const start = p.indexOf('${');
  const end = p.indexOf('}', start);
  if (end === -1) break;
  p = p.slice(0, start) + 'X' + p.slice(end + 1);
 }
 return p;
}

/** A call's HTTP method: `api(path, body)` sends POST for a bodyless write,
 * GET for a read; `apiRaw` is always GET; a raw fetch defaults to GET and
 * names a method only in its init. */
function methodOf(call: string, path: string, prefixes: string[]): 'GET' | 'POST' {
 if (/\.apiRaw\s*</.test(call) || /\.apiRaw\s*\(/.test(call)) return 'GET';
 const methodMatch = call.match(/method:\s*['"](\w+)['"]/);
 if (methodMatch) return methodMatch[1] === 'GET' ? 'GET' : 'POST';
 if (/\bfetch\s*\(/.test(call)) return 'GET';
 if (isReadPath(path, prefixes)) return 'GET';
 return 'POST';
}

/** Every client call site in web/*.ts: the call text, its path, and the
 * line. Skips the api()/apiRaw() definitions themselves — their first
 * argument is the parameter name, not a path literal. */
function clientCalls(prefixes: string[]): ClientCall[] {
 const calls: ClientCall[] = [];
 for (const file of readdirSync(join(ROOT, 'web')).filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(join(ROOT, 'web', file), 'utf-8');
  const callRe = /(?:deps\.)?api(?:Raw)?(?:<[^>]*>)?\s*\(|fetch\s*\(/g;
  for (const m of text.matchAll(callRe)) {
   const after = text.slice(m.index! + m[0].length);
   const arg = after.match(/^\s*(['"`])(\/[^'"`]*)\1/);
   if (!arg) continue; // e.g. the api(path, …) definition itself
   const path = normalizeClientPath(arg[2]!);
   if (!path.startsWith('/api')) continue;
   // The slice covers the call through the path literal and 120 chars past
   // it, so a raw fetch's init ({ method: 'POST', … }) is inside it too.
   const pathEnd = m[0].length + after.indexOf(arg[0]!) + arg[0]!.length;
   const call = text.slice(m.index!, m.index! + pathEnd + 120);
   const line = text.slice(0, m.index!).split('\n').length;
   calls.push({ path, method: methodOf(call, path, prefixes), file, line });
  }
 }
 return calls;
}

const PREFIXES = getPrefixes();
const ROUTES = serverRoutes();
const CALLS = clientCalls(PREFIXES);

describe('every client fetch path resolves against the route table (ticket 151)', () => {
 it('the client calls at least one route (the extraction sees the tree)', () => {
  expect(CALLS.length).toBeGreaterThan(20);
 });

 it('each call site resolves to a registered route of the same method', () => {
  const missing = CALLS.filter((c) => !ROUTES.some((r) => r.method === c.method && r.regex.test(c.path)));
  expect(
   missing.map((c) => `${c.file}:${c.line} ${c.method} ${c.path}`),
  ).toEqual([]);
 });

 it('every distinct path is registered under some method (catches method drift)', () => {
  const distinct = [...new Set(CALLS.map((c) => c.path))];
  const unregistered = distinct.filter((p) => !ROUTES.some((r) => r.regex.test(p)));
  expect(unregistered).toEqual([]);
 });

 it('the route table has no phantom GET/POST twins (a route exists once per method)', () => {
  const dupes = ROUTES.filter(
   (r, i) => ROUTES.findIndex((x) => x.method === r.method && x.pattern === r.pattern) !== i,
  );
  expect(dupes).toEqual([]);
 });
});
