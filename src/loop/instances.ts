import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The instance plane (ticket 130, Q-93): spawn and destroy whole Elicit
 * servers, one per persona life. The paired trial measures the shipping
 * artifact, so an instance is a REAL server process — own port, own vault,
 * own cwd — never an embedded approximation.
 *
 * Three boundaries make the owner's plane unreachable structurally, not by
 * prompt:
 *
 * - **cwd** is the instance dir, so every cwd-derived path isolates for
 *   free: `data/annotations`, `data/gazetteer` (src/server.ts:3875-3879),
 *   `archives/`, and the `data/decks` default. The instrument plane is
 *   symlinked back in; person-derived dirs start empty.
 * - **env** is the owner's environment with every `ELICIT_*` key stripped,
 *   then the harness's own keys written. The owner's shell cannot leak a
 *   vault root into a persona's life.
 * - **port** is 4600 + slot, and 4517 — the owner's — is refused.
 *
 * Teardown is fresh-start's semantics (src/reset/fresh-start.ts): the
 * instance dir is RENAMED into `archives/eval/<cycle>/<trial>/`, never
 * copied and never deleted, so a verdict's citations stay checkable
 * against the archived life forever.
 */

/** The owner's own server port. An instance never gets it. */
export const OWNER_PORT = 4517;

/** Instance ports start here; slot n gets `INSTANCE_PORT_BASE + n`. */
export const INSTANCE_PORT_BASE = 4600;

/**
 * Instrument-plane paths, relative to a variant worktree, symlinked into
 * every instance dir. These are curation records — decks, patterns,
 * skeletons, atlases, the question bank — the same split fresh-start
 * draws: instruments stay, person-derived records move. A path the variant
 * does not carry is simply not linked.
 */
export const DEFAULT_INSTRUMENT_DIRS: readonly string[] = [
 'data/decks',
 'data/patterns',
 'data/ktg',
 'data/atlases',
 'data/question-bank.jsonl',
 'data/decisions.jsonl',
];

/** A live instance: the process, where to reach it, and where it lives. */
export type Instance = {
 child: ChildProcess;
 /** `http://127.0.0.1:<port>` — no trailing slash. */
 baseUrl: string;
 /**
  * `elicit_session=<token>`, ready to send as a `cookie` header. Empty
  * until `setupAuth` runs; sessions are in-memory (src/server.ts:251), so
  * a restart voids it and `relogin` mints the next one.
  */
 cookie: string;
 /** The instance's password, kept for `relogin`. Empty until `setupAuth`. */
 password: string;
 instanceDir: string;
 port: number;
 /** True once the process was restarted mid-trial; the record notes it. */
 restarted: boolean;
};

/** What `setupAuth` and `relogin` hand back. */
export type Credentials = { cookie: string; password: string };

/** A git worktree checked out at a candidate commit. */
export type Variant = {
 dir: string;
 /** `git worktree remove --force` — the worktree is scratch, never a branch. */
 remove(): void;
};

// ── Ports ──

/**
 * The port for instance slot `n`. The owner's 4517 is refused by value, not
 * by arithmetic: the guard survives a change to `INSTANCE_PORT_BASE`, which
 * is exactly when it would otherwise stop being true.
 */
export function allocatePort(slot: number): number {
 if (!Number.isInteger(slot)) {
  throw new Error(`instance slot must be an integer, got ${slot}`);
 }
 const port = INSTANCE_PORT_BASE + slot;
 if (port === OWNER_PORT) {
  throw new Error(`instance port refused: ${OWNER_PORT} is the owner's port`);
 }
 if (port < INSTANCE_PORT_BASE || port > 65535) {
  throw new Error(`instance port ${port} is outside the ${INSTANCE_PORT_BASE}+ range`);
 }
 return port;
}

// ── Variants ──

/** The `git` argv for adding a variant worktree — the seam a test can read. */
export function variantWorktreeArgs(opts: { repoRoot: string; ref: string; dir: string }): string[] {
 return ['-C', opts.repoRoot, 'worktree', 'add', opts.dir, opts.ref];
}

/**
 * Check out `ref` into its own worktree. Both trial arms run from
 * worktrees; the live checkout is never a variant, because a persona life
 * running there would write its `data/` and `archives/` into the owner's
 * tree. `npm ci` in the new worktree is the caller's job — it happens once
 * per worktree, not once per instance.
 */
export function createVariantWorktree(opts: { repoRoot: string; ref: string; dir: string }): Variant {
 const repoRoot = resolve(opts.repoRoot);
 const dir = resolve(opts.dir);
 if (dir === repoRoot) {
  throw new Error(`variant refused: ${dir} is the live checkout, not a worktree`);
 }
 if (existsSync(dir)) {
  throw new Error(`variant refused: ${dir} already exists`);
 }
 execFileSync('git', variantWorktreeArgs({ repoRoot, ref: opts.ref, dir }), { stdio: 'pipe' });
 return {
  dir,
  remove() {
   execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' });
  },
 };
}

// ── Provisioning ──

export type ProvisionOpts = {
 /** The variant worktree the server sources are read from. */
 variantDir: string;
 /** The instance's own directory — the process's cwd, and what teardown archives. */
 instanceDir: string;
 port: number;
 /**
  * Extra environment for the child: `ELICIT_LLM` plus the four endpoint
  * vars for a real trial, nothing for a `fake` smoke run. Whatever is not
  * given here does not exist for the child — the owner's `ELICIT_*` keys
  * are stripped before this is applied.
  */
 env?: Record<string, string>;
 host?: string;
 instrumentDirs?: readonly string[];
};

/**
 * The child's environment: the ambient one with every `ELICIT_*` key
 * removed, then the caller's env, then the four the plane fixes itself.
 * Stripping is the point — the owner runs with `ELICIT_VAULT_ROOT` set, and
 * an inherited copy would put a persona's sitting in the owner's vault.
 */
export function instanceEnv(opts: {
 ambient: Record<string, string | undefined>;
 vaultRoot: string;
 port: number;
 host: string;
 env?: Record<string, string>;
}): Record<string, string> {
 const childEnv: Record<string, string> = {};
 for (const [key, value] of Object.entries(opts.ambient)) {
  if (key.startsWith('ELICIT_')) continue;
  if (value !== undefined) childEnv[key] = value;
 }
 for (const [key, value] of Object.entries(opts.env ?? {})) childEnv[key] = value;
 childEnv.ELICIT_VAULT_ROOT = opts.vaultRoot;
 childEnv.ELICIT_PORT = String(opts.port);
 childEnv.ELICIT_HOST = opts.host;
 childEnv.ELICIT_LLM = opts.env?.ELICIT_LLM ?? 'fake';
 return childEnv;
}

/**
 * The argv that runs a variant's server as ONE process.
 *
 * `npx tsx` is wrong here twice over: it resolves tsx from the cwd (the
 * instance dir, which has no `node_modules`), and it leaves a supervisor
 * process between the harness and the server, so SIGTERM lands on the
 * wrong pid. Node's own `--import` with the variant's tsx loader has
 * neither problem: one process, killable, with `argv[1]` still the
 * absolute `.../src/server.ts` path that src/server.ts:3783's `isDirect`
 * gate tests for. Module resolution follows the script's own directory, so
 * the variant's `node_modules` is what the server imports.
 */
export function serverArgs(variantDir: string): string[] {
 const loader = pathToFileURL(join(variantDir, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
 return ['--import', loader, join(variantDir, 'src', 'server.ts')];
}

/**
 * Build the instance dir: an empty vault, plus the instrument plane
 * symlinked in from the variant. The vault stays empty until the persona
 * fills it through the app's own doors — no dossier is seeded into it
 * (Q-87), so nothing in an eval vault was written by anything but the app.
 *
 * Returns the vault root. Separate from the spawn because the dir is the
 * durable half of an instance: it outlives the process, and teardown
 * archives it whole.
 */
export function materializeInstanceDir(opts: {
 variantDir: string;
 instanceDir: string;
 instrumentDirs?: readonly string[];
}): string {
 const variantDir = resolve(opts.variantDir);
 const instanceDir = resolve(opts.instanceDir);
 if (instanceDir === variantDir) {
  throw new Error(`instance refused: ${instanceDir} is the variant's own tree`);
 }
 const vaultRoot = join(instanceDir, 'vault');
 mkdirSync(vaultRoot, { recursive: true });

 for (const rel of opts.instrumentDirs ?? DEFAULT_INSTRUMENT_DIRS) {
  const src = join(variantDir, rel);
  if (!existsSync(src)) continue;
  const dest = join(instanceDir, rel);
  if (existsSync(dest)) continue;
  mkdirSync(dirname(dest), { recursive: true });
  symlinkSync(src, dest, statSync(src).isDirectory() ? 'dir' : 'file');
 }
 return vaultRoot;
}

/**
 * Build the instance dir and spawn the variant's server into it. Returns
 * before the server is listening; `awaitHealthy` next.
 */
export function provisionInstance(opts: ProvisionOpts): Instance {
 const variantDir = resolve(opts.variantDir);
 const instanceDir = resolve(opts.instanceDir);
 const host = opts.host ?? '127.0.0.1';
 const vaultRoot = materializeInstanceDir({
  variantDir,
  instanceDir,
  ...(opts.instrumentDirs ? { instrumentDirs: opts.instrumentDirs } : {}),
 });

 // The server is a DAEMON: its own process group, its log written straight
 // to a file descriptor it owns. Piped stdio into the provisioning process
 // ties the server's life to its parent's — cycle-1 measured exactly that:
 // when the dispatching agent's process tree was reaped between its turns,
 // every instance server died with it, silently, mid-trial. Detached +
 // direct fd means nothing upstream can take the server down except an
 // explicit kill of its recorded pid (teardown's job).
 const logFd = openSync(join(instanceDir, 'server.log'), 'a');
 const child = spawn(process.execPath, serverArgs(variantDir), {
  cwd: instanceDir,
  env: instanceEnv({ ambient: process.env, vaultRoot, port: opts.port, host, ...(opts.env ? { env: opts.env } : {}) }),
  stdio: ['ignore', logFd, logFd],
  detached: true,
 });
 child.unref();
 // The child holds its own copy of the descriptor; the parent's is done.
 closeSync(logFd);

 return {
  child,
  baseUrl: `http://${host}:${opts.port}`,
  cookie: '',
  password: '',
  instanceDir,
  port: opts.port,
  restarted: false,
 };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `GET /api/auth/status` until it answers. The banner prints before
 * the boot docket runs, so readiness is HTTP up, not docket idle — an
 * instance is usable while the clerk still reads in the background.
 */
export async function awaitHealthy(baseUrl: string, timeoutMs = 60_000): Promise<void> {
 const deadline = Date.now() + timeoutMs;
 let last = '';
 while (Date.now() < deadline) {
  try {
   const res = await fetch(`${baseUrl}/api/auth/status`);
   if (res.ok) return;
   last = `HTTP ${res.status}`;
  } catch (err) {
   last = err instanceof Error ? err.message : String(err);
  }
  await sleep(250);
 }
 throw new Error(`instance at ${baseUrl} never became healthy in ${timeoutMs}ms (last: ${last})`);
}

/** The `set-cookie` value reduced to the `elicit_session=<token>` pair. */
function readSessionCookie(res: Response): string {
 const header = res.headers.get('set-cookie') ?? '';
 const match = /elicit_session=([^;]+)/.exec(header);
 if (!match) throw new Error(`no elicit_session cookie in response (set-cookie: ${header || 'absent'})`);
 return `elicit_session=${match[1]}`;
}

/**
 * First boot: `POST /api/setup` with a password nobody chose, minting the
 * instance's session. Loopback-only as shipped, which the harness satisfies
 * by construction. The password comes back with the cookie because the
 * cookie does not survive a restart and the password does.
 */
export async function setupAuth(baseUrl: string): Promise<Credentials> {
 const password = randomBytes(24).toString('hex');
 const res = await fetch(`${baseUrl}/api/setup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password }),
 });
 if (!res.ok) throw new Error(`setup failed at ${baseUrl}: HTTP ${res.status} ${await res.text()}`);
 return { cookie: readSessionCookie(res), password };
}

/**
 * Log back in after a restart. Sessions are in-memory, so a restarted
 * instance answers 401 with the old cookie; the live sitting is gone too,
 * though its transcript is on disk. Marks the handle, because a trial
 * record must say a restart happened.
 */
export async function relogin(instance: Instance): Promise<Credentials> {
 const res = await fetch(`${instance.baseUrl}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: instance.password }),
 });
 if (!res.ok) throw new Error(`relogin failed at ${instance.baseUrl}: HTTP ${res.status} ${await res.text()}`);
 const cookie = readSessionCookie(res);
 instance.cookie = cookie;
 instance.restarted = true;
 return { cookie, password: instance.password };
}

// ── Teardown = archive ──

/** Poll `GET /api/harvest-queue` until nothing is pending. */
async function awaitHarvestDrain(instance: Instance, timeoutMs: number): Promise<boolean> {
 const deadline = Date.now() + timeoutMs;
 while (Date.now() < deadline) {
  try {
   const res = await fetch(`${instance.baseUrl}/api/harvest-queue`, {
    headers: { cookie: instance.cookie },
   });
   if (res.ok) {
    const body = (await res.json()) as { pending?: unknown[] };
    if ((body.pending ?? []).length === 0) return true;
   }
  } catch {
   // The process may already be gone; nothing left to drain.
   return false;
  }
  await sleep(500);
 }
 return false;
}

/** SIGTERM, then SIGKILL if the process does not go. Resolves on exit. */
async function stopChild(child: ChildProcess, timeoutMs: number): Promise<void> {
 if (child.exitCode !== null || child.signalCode !== null) return;
 const exited = new Promise<void>((res) => child.once('exit', () => res()));
 child.kill('SIGTERM');
 let settled = false;
 await Promise.race([
  exited.then(() => {
   settled = true;
  }),
  sleep(timeoutMs),
 ]);
 if (!settled) {
  child.kill('SIGKILL');
  await exited;
 }
}

export type TeardownOpts = {
 /** The `archives/` root the eval tree is appended under. */
 archivesRoot: string;
 cycle: string;
 trial: string;
 drainTimeoutMs?: number;
 exitTimeoutMs?: number;
};

export type TeardownReport = {
 /** Absolute path of the archived life. */
 archiveDir: string;
 /** False when the harvest queue still held work at the drain deadline. */
 drained: boolean;
};

/**
 * End a life and file it. Wait for the harvest queue to drain, stop the
 * process, then MOVE the whole instance dir to
 * `<archivesRoot>/eval/<cycle>/<trial>/`.
 *
 * Rename, never copy and never delete — fresh-start's rule (Q-91): an
 * archive is written once and then read forever, so an existing
 * destination is refused rather than merged into. A cross-device rename
 * fails loudly instead of degrading to a copy, because a copy would leave
 * the original behind and two lives would claim the same trial.
 */
export async function teardownInstance(
 instance: Instance,
 opts: TeardownOpts,
): Promise<TeardownReport> {
 const archiveDir = join(resolve(opts.archivesRoot), 'eval', opts.cycle, opts.trial);
 if (existsSync(archiveDir)) {
  throw new Error(`teardown refused: archive already exists at ${archiveDir}`);
 }
 const drained = await awaitHarvestDrain(instance, opts.drainTimeoutMs ?? 60_000);
 await stopChild(instance.child, opts.exitTimeoutMs ?? 10_000);

 mkdirSync(dirname(archiveDir), { recursive: true });
 try {
  renameSync(instance.instanceDir, archiveDir);
 } catch (err) {
  throw new Error(
   `teardown failed moving ${instance.instanceDir} → ${archiveDir}: ` +
    (err instanceof Error ? err.message : String(err)),
  );
 }
 return { archiveDir, drained };
}
