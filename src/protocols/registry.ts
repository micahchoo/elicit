import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { Target, QuestionForm } from '../types.js';

// ── Types ──

export interface ProtocolDef {
 name: string;
 targets: Target[];
 prerequisites: string[];
 questionForm: QuestionForm;
 prompt: string;
 /**
  * The fixed probe served when the elicitor's guard rejects twice and every
  * fallback draw is empty (ticket 079). Deterministic and zero-LLM — drawn
  * from the protocol's own material, so the failure path needs nothing that
  * can itself fail. Carried as data, never composed.
  */
 floorProbe: string;
 /**
  * Whether this protocol participates in the target-based rotation.
  * Defaults to true; set false for user-declared-only instruments (Q-85).
  */
 rotation?: boolean;
}

/**
 * The floor probe served when a def carries none: a universal follow-up, one
 * sentence, no conversation reference. The four built-in defs each carry their
 * own; this is the never-fail net for a malformed def.
 */
export const DEFAULT_FLOOR_PROBE = 'What makes you say that?';

// ── Lazy singleton ──

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFS_DIR = join(__dirname, 'defs');

let _defs: Map<string, ProtocolDef> | undefined;

/** Parse frontmatter targets field — handles YAML array or single string. */
function parseTargets(raw: unknown): Target[] {
 if (Array.isArray(raw)) return raw.filter((t): t is Target => t === 'self' || t === 'domain');
 if (typeof raw === 'string' && (raw === 'self' || raw === 'domain')) return [raw];
 return [];
}

/** Parse frontmatter prerequisites field. */
function parsePrerequisites(raw: unknown): string[] {
 if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === 'string');
 return [];
}

function parseQuestionForm(raw: unknown): QuestionForm {
 if (typeof raw === 'string' && (raw === 'deliberative' || raw === 'theoretical' || raw === 'why')) {
  return raw;
 }
 return 'deliberative';
}

function loadFromDisk(): Map<string, ProtocolDef> {
 const defs = new Map<string, ProtocolDef>();
 let files: string[];
 try {
  files = readdirSync(DEFS_DIR);
 } catch {
  return defs; // no defs directory — empty
 }

 for (const file of files) {
  if (!file.endsWith('.md')) continue;
  const path = join(DEFS_DIR, file);
  const raw = readFileSync(path, 'utf-8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  const name = typeof data.name === 'string' ? data.name : file.replace(/\.md$/, '');
  const floorProbe =
   typeof data.floorProbe === 'string' && data.floorProbe.trim().length > 0
    ? data.floorProbe.trim()
    : DEFAULT_FLOOR_PROBE;
  const def: ProtocolDef = {
   name,
   targets: parseTargets(data.targets),
   prerequisites: parsePrerequisites(data.prerequisites),
   questionForm: parseQuestionForm(data.questionForm),
   prompt: (parsed.content ?? '').trim(),
   floorProbe,
   // rotation defaults to true; false for user-declared-only instruments (Q-85)
   rotation: data.rotation !== false,
  };

  if (def.name.length > 0) {
   defs.set(def.name, def);
  }
 }

 return defs;
}

/**
 * Load all protocol definitions from `defs/*.md`.
 * Result is cached; subsequent calls return the same map.
 */
export function loadProtocolDefinitions(): Map<string, ProtocolDef> {
 if (_defs) return _defs;
 _defs = loadFromDisk();
 return _defs;
}

/**
 * Select a protocol for the given target using deterministic rotation.
 * `sessionIndex` is the count of prior sessions (0-based for the first).
 */
export function selectProtocolForTarget(
 target: Target,
 sessionIndex: number,
 defs: Map<string, ProtocolDef>,
): ProtocolDef {
 const candidates = [...defs.values()].filter((d) => d.targets.includes(target) && d.rotation !== false);
 if (candidates.length === 0) {
  // No protocol for this target — fall back to reflective
  return defs.get('reflective') ?? [...defs.values()][0]!;
 }
 return candidates[sessionIndex % candidates.length]!;
}

/**
 * Get a protocol definition by name.  Returns undefined if not found.
 */
export function getProtocol(name: string): ProtocolDef | undefined {
 return loadProtocolDefinitions().get(name);
}
