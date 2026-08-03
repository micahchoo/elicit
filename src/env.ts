import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Load a `.env` file from a directory (default: the current working
 * directory), so machine-specific settings can live next to the server
 * instead of in the shell. Real environment variables always win over
 * this file. Rules:
 *
 * - Blank lines and lines starting with `#` are ignored.
 * - The first `=` splits key from value; the key must look like an
 *   environment variable name.
 * - Surrounding single or double quotes are stripped from the value.
 * - A value starting with `~/` expands to the home directory.
 *
 * Idempotent per key: a key already present in the environment is never
 * overwritten, so `ELICIT_*` exported in the shell beats the file.
 */
export function loadEnvFile(dir: string = process.cwd()): void {
 const path = join(dir, '.env');
 if (!existsSync(path)) return;
 const home = homedir();
 for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (line === '' || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  if (!KEY_RE.test(key)) continue;
  if (process.env[key] !== undefined) continue;
  let value = line.slice(eq + 1).trim();
  if (value.length >= 2) {
   const q = value[0];
   if ((q === '"' || q === "'") && value.endsWith(q)) {
    value = value.slice(1, -1);
   }
  }
  if (value.startsWith('~/')) value = join(home, value.slice(2));
  process.env[key] = value;
 }
}
