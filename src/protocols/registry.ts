import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefRegistry, type DefSource } from '../defs/loader.js';
import type { Target, QuestionForm } from '../types.js';
import type { PhaseDef } from './machine.js';

// ── Types ──

export interface ProtocolDef {
 name: string;
 /**
  * The user-facing title (ticket 157): `name` stays the registry key —
  * session validation, rotation, defs, and tests all key on it — while
  * this is what the surfaces render. Falls back to the name when a def
  * carries none, so a title-less def still renders.
  */
 title: string;
 /**
  * One-line description of what the sitting does, shown dimmed under the
  * title in the mode picker (ticket 157). Optional.
  */
 blurb?: string;
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
 /**
  * Presentation hint for the sitting screen renderer (Q-84): how the
  * protocol's elements should be laid out (e.g. 'triadic').
  */
 presentation?: string;
 /**
  * The protocol's phase machine schema (ticket 159): when present, the
  * sitting's elicitation is driven by the phase machine instead of the
  * one-question loop. Absent on non-machine defs — `phases` stays undefined
  * (never an empty array: a declared-but-empty list is a load error).
  */
 phases?: PhaseDef[];
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

/**
 * Parse the frontmatter `phases:` list (ticket 159). Returns undefined when
 * the def carries no `phases` key — that def is a non-machine and stays
 * valid. Throws on a declared-but-malformed list: a def that declares
 * phases it cannot be parsed into is a programming error and must fail loud
 * at load, never silently decay.
 */
function parsePhases(raw: unknown): PhaseDef[] | undefined {
 if (raw === undefined || raw === null) return undefined;
 const entries = Array.isArray(raw) ? raw : [raw];
 const phases: PhaseDef[] = [];
 const seen = new Set<string>();
 for (const entry of entries) {
  if (typeof entry !== 'object' || entry === null) {
   throw new Error('phases: each phase must be an object');
  }
  const e = entry as Record<string, unknown>;
  const id = typeof e.id === 'string' ? e.id.trim() : '';
  if (id.length === 0) throw new Error('phases: phase id is required');
  if (seen.has(id)) throw new Error(`phases: duplicate phase id "${id}"`);
  seen.add(id);
  const label = typeof e.label === 'string' ? e.label.trim() : '';
  if (label.length === 0) throw new Error(`phases: phase "${id}" label is required`);
  const minExchanges = e.minExchanges;
  if (
   typeof minExchanges !== 'number' ||
   !Number.isInteger(minExchanges) ||
   minExchanges < 0
  ) {
   throw new Error(`phases: phase "${id}" minExchanges must be a non-negative integer`);
  }
  const prompt = typeof e.prompt === 'string' ? e.prompt.trim() : '';
  if (prompt.length === 0) {
   throw new Error(`phases: phase "${id}" prompt must be a non-empty string`);
  }
  // The UI-phase contract placeholder (slice 6): typed and parsed, wired
  // later. A declared-but-non-string renderer is a load error.
  const renderer = typeof e.renderer === 'string' ? e.renderer : undefined;
  if (e.renderer !== undefined && renderer === undefined) {
   throw new Error(`phases: phase "${id}" renderer must be a string`);
  }
  phases.push({
   id,
   label,
   minExchanges,
   prompt,
   ...(renderer !== undefined ? { renderer } : {}),
  });
 }
 if (phases.length === 0) throw new Error('phases: at least one phase is required');
 return phases;
}

function parseProtocolFile(file: string, source: DefSource): ProtocolDef | null {
 const data = source.frontmatter ?? {};
 const name = typeof data.name === 'string' ? data.name : file.replace(/\.md$/, '');
 // A declared-but-malformed phases list is a programming error: fail the
 // load, naming the def, instead of silently serving a broken machine.
 let phases: PhaseDef[] | undefined;
 try {
  phases = parsePhases(data.phases);
 } catch (err) {
  throw new Error(`def "${name}" (${file}): ${(err as Error).message}`);
 }
 const floorProbe =
  typeof data.floorProbe === 'string' && data.floorProbe.trim().length > 0
   ? data.floorProbe.trim()
   : DEFAULT_FLOOR_PROBE;
 const presentation =
  typeof data.presentation === 'string' ? data.presentation : undefined;
 // The title is the surface word; a def without one renders under its
 // registry key (ticket 157).
 const title =
  typeof data.title === 'string' && data.title.trim().length > 0
   ? data.title.trim()
   : name;
 const blurb =
  typeof data.blurb === 'string' && data.blurb.trim().length > 0
   ? data.blurb.trim()
   : undefined;
 const def: ProtocolDef = {
  name,
  title,
  targets: parseTargets(data.targets),
  prerequisites: parsePrerequisites(data.prerequisites),
  questionForm: parseQuestionForm(data.questionForm),
  prompt: (source.body ?? '').trim(),
  floorProbe,
  // rotation defaults to true; false for user-declared-only instruments (Q-85)
  rotation: data.rotation !== false,
  ...(blurb !== undefined ? { blurb } : {}),
  ...(presentation !== undefined ? { presentation } : {}),
  ...(phases !== undefined ? { phases } : {}),
 };
 return def.name.length > 0 ? def : null;
}

/** The shared def loader: enumerate defs/*.md, parse, cache forever. */
const registry = createDefRegistry<ProtocolDef, Map<string, ProtocolDef>>({
 name: 'Protocol registry',
 dir: () => DEFS_DIR,
 match: (file) => file.endsWith('.md'),
 markdown: true,
 strict: true,
 empty: () => new Map(),
 parse: parseProtocolFile,
 add: (result, def) => {
  result.set(def.name, def);
 },
});

/**
 * Load all protocol definitions from `defs/*.md`.
 * Result is cached; subsequent calls return the same map.
 */
export function loadProtocolDefinitions(): Map<string, ProtocolDef> {
 return registry.load();
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
