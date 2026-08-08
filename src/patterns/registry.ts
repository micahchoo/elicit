/**
 * Pattern registry — loads derivation pattern definitions from disk.
 *
 * Patterns are data, not code: one JSON file per pattern in data/patterns/.
 * Like Protocols, they are an open set — adding a new pattern is adding a
 * file, not editing a switch statement.
 */

import { resolve } from 'node:path';
import { createDefRegistry, type DefSource } from '../defs/loader.js';
import { FACETS } from '../queue/facet-balance.js';
import type { Facet } from '../types.js';
import type { Pattern, PatternId, PatternTier, Operator } from './types.js';

function parsePatternTier(raw: unknown): PatternTier {
  if (raw === 'cheap' || raw === 'deep') return raw;
  throw new Error(`invalid tier: ${String(raw)}`);
}

function parseOperators(raw: unknown): Operator[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set<Operator>([
    'suppose', 'time-shift', 'miracle', 'clean-language-frame',
    'sentence-completion', 'reversal', 'externalize', 'instance-of',
    'counterfactual-twist', 'dilemma-construct', 'anniversary-frame',
  ]);
  return raw.filter((o): o is Operator => typeof o === 'string' && valid.has(o as Operator));
}

/**
 * Every facet a pattern file may name — the full canonical set, derived from
 * FACETS (src/queue/facet-balance.ts) so the two lists cannot drift (the
 * filter, never a hand-maintained second enumeration).
 */
const VALID_FACETS = new Set<Facet>(FACETS);

function parseFacets(raw: unknown): Facet[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is Facet => typeof f === 'string' && VALID_FACETS.has(f as Facet));
}

function parseRequiredQuotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((q): q is string => typeof q === 'string' && q.length > 0);
}

function parseRisk(raw: unknown): 'low' | 'moderate' | 'high' {
  if (raw === 'low' || raw === 'moderate' || raw === 'high') return raw;
  return 'low';
}

function parseGraduation(raw: unknown): 'live' | 'shadow' {
  if (raw === 'live' || raw === 'shadow') return raw;
  return 'shadow';
}

/**
 * Parse one pattern file into a Pattern. Returns null — with a warning —
 * when the file is not a pattern (unreadable JSON, missing id); throws
 * when the JSON parses but field validation fails, and the loader's
 * non-strict policy turns that into the same warn-and-skip the registry
 * has always used.
 */
function parsePatternFile(file: string, source: DefSource): Pattern | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source.content) as Record<string, unknown>;
  } catch {
    console.warn(`Pattern registry: invalid JSON in ${file}`);
    return null;
  }

  const id = String(parsed.id ?? '');
  if (id.length === 0) {
    console.warn(`Pattern registry: ${file} missing id`);
    return null;
  }

  const df = (parsed.derivesFrom ?? {}) as Record<string, unknown>;

  return {
    id: id as PatternId,
    name: String(parsed.name ?? id),
    tier: parsePatternTier(parsed.tier),
    operators: parseOperators(parsed.operators),
    derivesFrom: {
      minSnippets: Math.max(1, Number(df['minSnippets'] ?? 1)),
      facets: parseFacets(df['facets']),
      ...(df['alsoNeeds'] ? { alsoNeeds: parseFacets(df['alsoNeeds']) } : {}),
    },
    requiredQuotes: parseRequiredQuotes(parsed.requiredQuotes),
    questionForm: (['deliberative', 'theoretical', 'why'] as const).includes(
      parsed.questionForm as 'deliberative',
    )
      ? (parsed.questionForm as 'deliberative' | 'theoretical' | 'why')
      : 'deliberative',
    contaminationRisk: parseRisk(parsed.contaminationRisk),
    graduation: parseGraduation(parsed.graduation),
  };
}

/** The shared def loader: enumerate data/patterns/, parse, cache, clear. */
const registry = createDefRegistry<Pattern, Pattern[]>({
  name: 'Pattern registry',
  dir: (root) => (root ? resolve(root) : resolve('data', 'patterns')),
  match: (file) => file.endsWith('.json'),
  markdown: false,
  strict: false,
  empty: () => [],
  parse: parsePatternFile,
  add: (result, def) => {
    result.push(def);
  },
});

/**
 * Load all pattern definitions from `dataDir` (default: cwd-relative
 * `data/patterns/`). Result is cached; subsequent calls return the same array.
 *
 * A malformed file is skipped with a console.warn; a missing directory
 * returns an empty array. The caller is responsible for deciding whether
 * an empty set is an error.
 */
export function loadPatterns(dataDir?: string): Pattern[] {
  return registry.load(dataDir);
}

/**
 * Clear the in-memory cache so the next loadPatterns call re-reads disk.
 * Exported for test isolation only.
 */
export function clearPatternCache(): void {
  registry.clear();
}

/**
 * Look up a pattern by its stable id. Returns undefined when not found.
 */
export function patternById(id: PatternId, patterns: Pattern[]): Pattern | undefined {
  return patterns.find((p) => p.id === id);
}
