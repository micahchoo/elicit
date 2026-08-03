/**
 * Pattern registry — loads derivation pattern definitions from disk.
 *
 * Patterns are data, not code: one JSON file per pattern in data/patterns/.
 * Like Protocols, they are an open set — adding a new pattern is adding a
 * file, not editing a switch statement.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Facet } from '../types.js';
import type { Pattern, PatternId, PatternTier, Operator } from './types.js';

/** Cache: load once, hold forever (patterns are data, not mutable state). */
let _cache: Pattern[] | undefined;

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

const VALID_FACETS = new Set<Facet>([
  'episode', 'general-event', 'lifetime-period', 'fact', 'construct',
  'intention', 'value', 'causal-theory', 'know-what', 'know-how',
  'habit', 'know-why', 'momentary-state',
]);

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

function loadFromDisk(dataDir: string): Pattern[] {
  let files: string[];
  try {
    files = readdirSync(dataDir);
  } catch {
    return []; // no directory — empty set
  }

  const patterns: Pattern[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const path = join(dataDir, file);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch {
      console.warn(`Pattern registry: could not read ${file}`);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`Pattern registry: invalid JSON in ${file}`);
      continue;
    }

    try {
      const id = String(parsed.id ?? '');
      if (id.length === 0) {
        console.warn(`Pattern registry: ${file} missing id`);
        continue;
      }

      const df = (parsed.derivesFrom ?? {}) as Record<string, unknown>;

      const pattern: Pattern = {
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

      patterns.push(pattern);
    } catch (err) {
      console.warn(`Pattern registry: ${file} validation failed — ${String(err)}`);
    }
  }

  return patterns;
}

/**
 * Load all pattern definitions from `dataDir` (default: cwd-relative
 * `data/patterns/`). Result is cached; subsequent calls return the same array.
 *
 * A malformed file is skipped with a console.warn; a missing directory
 * returns an empty array. The caller is responsible for deciding whether
 * an empty set is an error.
 */
export function loadPatterns(dataDir?: string): Pattern[] {
  if (_cache) return _cache;
  const dir = dataDir ? resolve(dataDir) : resolve('data', 'patterns');
  _cache = loadFromDisk(dir);
  return _cache;
}

/**
 * Clear the in-memory cache so the next loadPatterns call re-reads disk.
 * Exported for test isolation only.
 */
export function clearPatternCache(): void {
  _cache = undefined;
}

/**
 * Look up a pattern by its stable id. Returns undefined when not found.
 */
export function patternById(id: PatternId, patterns: Pattern[]): Pattern | undefined {
  return patterns.find((p) => p.id === id);
}
