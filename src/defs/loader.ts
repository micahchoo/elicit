/**
 * The shared def-registry loader — the enumeration/parse/cache machinery
 * behind the pattern and protocol disk registries.
 *
 * Both registries are the same concept: a directory of def files (JSON, or
 * markdown with gray-matter frontmatter), each parsed into a domain def by
 * a per-domain helper, cached on first load, wiped by clear(). Only the
 * per-domain parse grammar and the selection logic differ, and those stay
 * in their own modules. This file owns everything else: directory
 * enumeration, file reading, gray-matter frontmatter extraction, parse
 * invocation, caching, and clear.
 *
 * Error policy is per-registry: `strict: false` (patterns) warns and
 * skips a bad file; `strict: true` (protocols) fails the load loud.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

/**
 * What a def file yields before domain parsing: the raw content plus — for
 * markdown registries — the gray-matter frontmatter and body. Non-markdown
 * registries see `frontmatter` and `body` as undefined.
 */
export interface DefSource {
  content: string;
  frontmatter: Record<string, unknown> | undefined;
  body: string | undefined;
}

export interface DefRegistryOptions<T, TResult> {
  /**
   * Warning prefix for skipped files, e.g. 'Pattern registry'.
   */
  name: string;
  /**
   * Resolve the def directory. Receives the per-call root the load
   * function was given; undefined for fixed-dir registries (protocols).
   */
  dir: (root: string | undefined) => string;
  /**
   * Keep a file by basename (e.g. '.json' / '.md').
   */
  match: (file: string) => boolean;
  /**
   * Whether defs are markdown with gray-matter frontmatter. The loader
   * extracts it; JSON registries receive the raw content untouched.
   */
  markdown: boolean;
  /**
   * false: a file that cannot be read or parsed warns and is skipped;
   * true: the error propagates and fails the whole load.
   */
  strict: boolean;
  /**
   * The result for a missing or empty directory.
   */
  empty: () => TResult;
  /**
   * Build one def. Return null to skip the file (the parse owns any
   * warning for its own skip cases); throw to fail the load (strict) or
   * warn-and-skip (non-strict).
   */
  parse: (file: string, source: DefSource) => T | null;
  /**
   * Assemble one parsed def into the registry result (push / set).
   */
  add: (result: TResult, def: T) => void;
}

export interface DefRegistry<TResult> {
  /**
   * Load the defs, from cache on repeat calls. `root` feeds the `dir`
   * resolver (undefined for fixed-dir registries).
   */
  load(root?: string): TResult;
  /**
   * Drop the cache so the next load re-reads disk. Test seam.
   */
  clear(): void;
}

export function createDefRegistry<T, TResult>(
  options: DefRegistryOptions<T, TResult>,
): DefRegistry<TResult> {
  let cache: TResult | undefined;

  const readSource = (file: string, path: string): DefSource => {
    const content = readFileSync(path, 'utf-8');
    if (!options.markdown) return { content, frontmatter: undefined, body: undefined };
    const parsed = matter(content);
    return {
      content,
      frontmatter: parsed.data as Record<string, unknown>,
      body: parsed.content,
    };
  };

  const loadFromDisk = (root: string | undefined): TResult => {
    const dir = options.dir(root);
    const result = options.empty();
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      return result; // no directory — empty set
    }

    for (const file of files) {
      if (!options.match(file)) continue;
      const path = join(dir, file);
      let source: DefSource;
      try {
        source = readSource(file, path);
      } catch (err) {
        if (options.strict) throw err;
        console.warn(`${options.name}: could not read ${file}`);
        continue;
      }
      let def: T | null;
      try {
        def = options.parse(file, source);
      } catch (err) {
        if (options.strict) throw err;
        console.warn(`${options.name}: ${file} validation failed — ${String(err)}`);
        continue;
      }
      if (def !== null) options.add(result, def);
    }

    return result;
  };

  return {
    load(root?: string): TResult {
      if (cache !== undefined) return cache;
      cache = loadFromDisk(root);
      return cache;
    },
    clear(): void {
      cache = undefined;
    },
  };
}
