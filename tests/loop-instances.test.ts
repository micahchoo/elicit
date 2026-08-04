import type { ChildProcess } from 'node:child_process';
import {
 existsSync,
 lstatSync,
 mkdirSync,
 mkdtempSync,
 readFileSync,
 readdirSync,
 rmSync,
 writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

import {
 DEFAULT_INSTRUMENT_DIRS,
 INSTANCE_PORT_BASE,
 OWNER_PORT,
 allocatePort,
 awaitHealthy,
 createVariantWorktree,
 instanceEnv,
 materializeInstanceDir,
 provisionInstance,
 serverArgs,
 setupAuth,
 teardownInstance,
 variantWorktreeArgs,
 type Instance,
} from '../src/loop/instances.js';
import { PERSONA_KICKOFF, personaCommand, personaRunPrompt } from '../src/loop/persona.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A handle whose process is never reached — for the paths that refuse first. */
function stubInstance(instanceDir: string): Instance {
 return {
  child: {} as ChildProcess,
  baseUrl: 'http://127.0.0.1:4699',
  cookie: '',
  password: '',
  instanceDir,
  port: 4699,
  restarted: false,
 };
}

/** The first bindable instance port, so parallel work does not collide. */
async function freeInstancePort(): Promise<number> {
 for (let slot = 80; slot < 100; slot++) {
  const port = allocatePort(slot);
  const free = await new Promise<boolean>((res) => {
   const probe = createServer();
   probe.once('error', () => res(false));
   probe.listen(port, '127.0.0.1', () => probe.close(() => res(true)));
  });
  if (free) return port;
 }
 throw new Error('no free instance port in 4680-4699');
}

const tmpRoots: string[] = [];
const spawned: Instance[] = [];

function scratch(prefix: string): string {
 const dir = mkdtempSync(join(tmpdir(), prefix));
 tmpRoots.push(dir);
 return dir;
}

afterEach(() => {
 // Kill first, delete second: a live server writing into a directory being
 // removed is how a test leaks a process onto the machine.
 for (const instance of spawned.splice(0)) {
  try {
   instance.child.kill('SIGKILL');
  } catch {
   // already gone
  }
 }
 for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Ports — the owner's boundary
// ---------------------------------------------------------------------------

describe('allocatePort', () => {
 test('slot n is 4600 + n', () => {
  expect(allocatePort(0)).toBe(4600);
  expect(allocatePort(7)).toBe(4607);
 });

 test("refuses the owner's 4517", () => {
  // The slot that would land on 4517 if the base ever moved down.
  expect(() => allocatePort(OWNER_PORT - INSTANCE_PORT_BASE)).toThrow(/4517 is the owner's port/);
 });

 test('no slot in a wide sweep yields the owner port', () => {
  const ports: number[] = [];
  for (let slot = 0; slot < 500; slot++) ports.push(allocatePort(slot));
  expect(ports).not.toContain(OWNER_PORT);
 });

 test('refuses a port below the instance base', () => {
  expect(() => allocatePort(-1)).toThrow(/outside the 4600\+ range/);
  expect(() => allocatePort(1.5)).toThrow(/must be an integer/);
 });
});

// ---------------------------------------------------------------------------
// Variants — never the live checkout
// ---------------------------------------------------------------------------

describe('createVariantWorktree', () => {
 test('builds the git argv against the repo, not the cwd', () => {
  expect(variantWorktreeArgs({ repoRoot: '/r', ref: 'abc123', dir: '/tmp/v' })).toEqual([
   '-C',
   '/r',
   'worktree',
   'add',
   '/tmp/v',
   'abc123',
  ]);
 });

 test('refuses the live checkout as a variant', () => {
  expect(() => createVariantWorktree({ repoRoot: REPO_ROOT, ref: 'HEAD', dir: REPO_ROOT })).toThrow(
   /is the live checkout/,
  );
 });

 test('refuses a directory that already exists', () => {
  const dir = scratch('variant-');
  expect(() => createVariantWorktree({ repoRoot: REPO_ROOT, ref: 'HEAD', dir })).toThrow(
   /already exists/,
  );
 });
});

// ---------------------------------------------------------------------------
// Provisioning — cwd, env, and the instrument plane
// ---------------------------------------------------------------------------

describe('serverArgs', () => {
 test("runs the variant's server as one process, argv[1] ending in server.ts", () => {
  const args = serverArgs('/v');
  expect(args[0]).toBe('--import');
  expect(args[1]).toBe('file:///v/node_modules/tsx/dist/loader.mjs');
  // src/server.ts:3783 gates the standalone entry on this suffix.
  expect(args[2]).toBe('/v/src/server.ts');
  expect(args[2]!.endsWith('/server.ts')).toBe(true);
 });
});

describe('instanceEnv', () => {
 test("strips the owner's ELICIT_* keys and keeps the rest", () => {
  const env = instanceEnv({
   ambient: { PATH: '/usr/bin', ELICIT_VAULT_ROOT: '/home/owner/vault', ELICIT_PORT: '4517' },
   vaultRoot: '/i/vault',
   port: 4601,
   host: '127.0.0.1',
  });
  expect(env.PATH).toBe('/usr/bin');
  expect(env.ELICIT_VAULT_ROOT).toBe('/i/vault');
  expect(env.ELICIT_PORT).toBe('4601');
  expect(env.ELICIT_HOST).toBe('127.0.0.1');
  expect(env.ELICIT_LLM).toBe('fake');
 });

 test('the caller names the model plane; the vault root is never negotiable', () => {
  const env = instanceEnv({
   ambient: {},
   vaultRoot: '/i/vault',
   port: 4601,
   host: '127.0.0.1',
   env: { ELICIT_LLM: 'local', ELICIT_LLM_MODEL: 'qwen', ELICIT_VAULT_ROOT: '/home/owner/vault' },
  });
  expect(env.ELICIT_LLM).toBe('local');
  expect(env.ELICIT_LLM_MODEL).toBe('qwen');
  expect(env.ELICIT_VAULT_ROOT).toBe('/i/vault');
 });
});

describe('materializeInstanceDir', () => {
 /** A variant tree with an instrument dir, an instrument file, and no server. */
 function fakeVariant(): string {
  const dir = scratch('variant-tree-');
  mkdirSync(join(dir, 'data', 'decks'), { recursive: true });
  writeFileSync(join(dir, 'data', 'decks', 'deck.jsonl'), '{"q":"?"}\n');
  writeFileSync(join(dir, 'data', 'question-bank.jsonl'), '{"q":"?"}\n');
  return dir;
 }

 test('symlinks the instrument plane and leaves the vault empty', () => {
  const variantDir = fakeVariant();
  const instanceDir = join(scratch('instances-'), 'c1', 't1');
  const vaultRoot = materializeInstanceDir({
   variantDir,
   instanceDir,
   instrumentDirs: DEFAULT_INSTRUMENT_DIRS,
  });

  expect(lstatSync(join(instanceDir, 'data', 'decks')).isSymbolicLink()).toBe(true);
  expect(lstatSync(join(instanceDir, 'data', 'question-bank.jsonl')).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(instanceDir, 'data', 'decks', 'deck.jsonl'), 'utf8')).toBe('{"q":"?"}\n');
  // Instruments the variant does not carry are simply not linked.
  expect(existsSync(join(instanceDir, 'data', 'patterns'))).toBe(false);
  // Q-87: the vault fills through the app's own doors, never by seeding.
  expect(vaultRoot).toBe(join(instanceDir, 'vault'));
  expect(readdirSync(vaultRoot)).toEqual([]);
 });

 test("refuses the variant's own tree as an instance dir", () => {
  const variantDir = fakeVariant();
  expect(() => materializeInstanceDir({ variantDir, instanceDir: variantDir })).toThrow(
   /is the variant's own tree/,
  );
 });
});

// ---------------------------------------------------------------------------
// Teardown — the archive is written once
// ---------------------------------------------------------------------------

describe('teardownInstance', () => {
 test('refuses a destination that already exists', async () => {
  const root = scratch('teardown-');
  const archivesRoot = join(root, 'archives');
  mkdirSync(join(archivesRoot, 'eval', 'cycle-1', 'trial-a'), { recursive: true });
  await expect(
   teardownInstance(stubInstance(join(root, 'instance')), {
    archivesRoot,
    cycle: 'cycle-1',
    trial: 'trial-a',
   }),
  ).rejects.toThrow(/teardown refused: archive already exists/);
 });
});

// ---------------------------------------------------------------------------
// The real thing — a whole server, spawned, served, and filed
// ---------------------------------------------------------------------------

describe('a real instance', () => {
 test(
  'boots from a variant, authenticates, serves, and archives on teardown',
  async () => {
   const root = scratch('instance-plane-');
   const instanceDir = join(root, 'eval', 'instances', 'cycle-1', 'trial-a');
   const archivesRoot = join(root, 'archives');
   const port = await freeInstancePort();

   // The live checkout stands in for a variant worktree here — the harness
   // refuses this in production, which the guard test above pins. No
   // instruments are linked, so nothing in the repo's data/ is reachable
   // from this instance at all.
   const instance = provisionInstance({
    variantDir: REPO_ROOT,
    instanceDir,
    port,
    env: { ELICIT_LLM: 'fake' },
    instrumentDirs: [],
   });
   spawned.push(instance);

   await awaitHealthy(instance.baseUrl, 45_000);

   const creds = await setupAuth(instance.baseUrl);
   instance.cookie = creds.cookie;
   instance.password = creds.password;
   expect(creds.cookie).toMatch(/^elicit_session=[0-9a-f]{64}$/);

   const queue = await fetch(`${instance.baseUrl}/api/queue`, {
    headers: { cookie: instance.cookie },
   });
   expect(queue.status).toBe(200);
   expect(await queue.json()).toMatchObject({ pending: [] });

   // The vault is the instance's own, and the owner's is untouched.
   expect(existsSync(join(instanceDir, 'vault', '.auth.json'))).toBe(true);

   const report = await teardownInstance(instance, {
    archivesRoot,
    cycle: 'cycle-1',
    trial: 'trial-a',
    drainTimeoutMs: 10_000,
   });

   expect(report.drained).toBe(true);
   expect(report.archiveDir).toBe(join(archivesRoot, 'eval', 'cycle-1', 'trial-a'));
   expect(existsSync(join(report.archiveDir, 'vault', '.auth.json'))).toBe(true);
   expect(existsSync(join(report.archiveDir, 'server.log'))).toBe(true);
   // Moved, not copied: nothing is left where the life was lived.
   expect(existsSync(instanceDir)).toBe(false);
   // The process is gone.
   expect(instance.child.exitCode !== null || instance.child.signalCode !== null).toBe(true);
   await expect(fetch(`${instance.baseUrl}/api/auth/status`)).rejects.toThrow();
  },
  90_000,
 );
});

// ---------------------------------------------------------------------------
// The persona dispatch — text, never invoked here
// ---------------------------------------------------------------------------

describe('personaRunPrompt', () => {
 const run = {
  dossierText: '---\nid: dossier-001\n---\n\n## Identity\nMarit, 41, a hydrologist.',
  baseUrl: 'http://127.0.0.1:4601',
  cookie: 'elicit_session=deadbeef',
  revisionSitting: 4,
 };

 test('carries the address, the cookie, and the whole dossier', () => {
  const prompt = personaRunPrompt(run);
  expect(prompt).toContain('http://127.0.0.1:4601');
  expect(prompt).toContain('elicit_session=deadbeef');
  expect(prompt).toContain('Marit, 41, a hydrologist.');
  expect(prompt).toContain('id: dossier-001');
 });

 test('scripts at least revision-sitting + 1 sittings', () => {
  expect(personaRunPrompt(run)).toContain('Live at least 5 sittings');
  expect(personaRunPrompt({ ...run, revisionSitting: 2 })).toContain('Live at least 3 sittings');
 });

 test('binds the persona to /v2 and off the filesystem', () => {
  const prompt = personaRunPrompt(run);
  expect(prompt).toContain('POST /v2/open');
  expect(prompt).toContain('POST /v2/say');
  expect(prompt).toContain('POST /v2/act');
  expect(prompt).toContain('GET  /v2/view');
  expect(prompt).toContain('Never call any route outside /v2');
  expect(prompt).toContain('Never read, list, or open files');
 });
});

describe('personaCommand', () => {
 test('is one non-interactive omp run in the instance dir', () => {
  const argv = personaCommand({
   dossierText: 'dossier',
   baseUrl: 'http://127.0.0.1:4601',
   cookie: 'elicit_session=abc',
   revisionSitting: 3,
   dir: '/i/cycle-1/trial-a',
  });
  expect(argv.slice(0, 6)).toEqual([
   'omp',
   '-p',
   '--cwd',
   '/i/cycle-1/trial-a',
   '--tools=bash',
   '--append-system-prompt',
  ]);
  expect(argv[6]).toContain('elicit_session=abc');
  expect(argv[7]).toBe(PERSONA_KICKOFF);
 });
});
