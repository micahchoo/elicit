/**
 * The region record — the one noun Seeding adds: a folder subtree with a
 * declared dating rule and a declared authorship, recorded on disk.
 *
 * Every later stage — the scanner's date rule (Anchor), the store's queue
 * bound (Cut), extraction's stance guard, the committer's provenance stamp —
 * needs to know which region a file belongs to, and a process restart between
 * the declaration and the review must lose nothing, so the declaration is a
 * file and every reader recomputes from it (Q-3). Nothing holds a region in
 * memory; `list()` re-reads the directory on every call.
 *
 * On disk: `vault/imports/regions/<slug>.md`, gray-matter, frontmatter = the
 * `RegionRecord`, body empty — the same shape the import store uses, for the
 * same reason: markdown is truth, and a declaration about the corpus is a
 * decision record, not a derived artifact (Q-61).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import matter from 'gray-matter';

import type { Authorship, DatingRule, RegionRecord } from './contract.js';

export type RegionStore = {
  declare(input: { root: string; dating: DatingRule; authorship: Authorship }): RegionRecord;
  get(slug: string): RegionRecord | null;
  list(): RegionRecord[];
  /** The DEEPEST declared region containing this path, or null. */
  regionFor(sourcePath: string): RegionRecord | null;
};

/**
 * A stable slug from a root path: the path's last two segments, lowercased
 * and reduced to `[a-z0-9-]`, then `-` and the first 6 hex of sha256(root).
 * The hash suffix is not decoration: two subtrees named `2019` under
 * different parents sanitize to the same string, and a collision would
 * silently hand one region's authorship declaration to another's files.
 */
export function slugFor(root: string): string {
  const segments = root.split('/').filter(Boolean).slice(-2);
  const named = segments
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 6);
  return `${named}-${hash}`;
}

export function createRegionStore(vaultRoot: string): RegionStore {
  const regionsDir = join(vaultRoot, 'imports', 'regions');

  const fileFor = (slug: string): string => join(regionsDir, `${slug}.md`);

  const readRecord = (slug: string): RegionRecord | null => {
    const path = fileFor(slug);
    if (!existsSync(path)) return null;
    return matter(readFileSync(path, 'utf-8')).data as RegionRecord;
  };

  const writeRecord = (record: RegionRecord): void => {
    mkdirSync(regionsDir, { recursive: true });
    // 048 hazard: a PRESENT key holding `undefined` throws in matter.stringify.
    // Every field here is required, so the frontmatter object is a plain
    // spread — but the rule is inherited for the day a field becomes optional.
    writeFileSync(fileFor(record.slug), matter.stringify('', record), 'utf-8');
  };

  const list = (): RegionRecord[] => {
    if (!existsSync(regionsDir)) return [];
    return readdirSync(regionsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => readRecord(f.slice(0, -3)))
      .filter((r): r is RegionRecord => r !== null);
  };

  const declare = (input: { root: string; dating: DatingRule; authorship: Authorship }): RegionRecord => {
    // `slugFor` is live at birth: this line is its caller (registry 077).
    const record: RegionRecord = {
      slug: slugFor(input.root),
      root: input.root,
      dating: input.dating,
      authorship: input.authorship,
      declared: new Date().toISOString(),
    };
    writeRecord(record);
    return record;
  };

  const get = (slug: string): RegionRecord | null => readRecord(slug);

  const regionFor = (sourcePath: string): RegionRecord | null => {
    const target = resolve(sourcePath);
    let deepest: RegionRecord | null = null;
    for (const r of list()) {
      const resolvedRoot = resolve(r.root);
      // A trailing separator makes the prefix a path boundary, so
      // `/vault/journals-old` never matches region `/vault/journals`.
      const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
      if (target === resolvedRoot || target.startsWith(prefix)) {
        if (deepest === null || resolvedRoot.length > resolve(deepest.root).length) {
          deepest = r;
        }
      }
    }
    return deepest;
  };

  return { declare, get, list, regionFor };
}
