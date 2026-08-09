/**
 * The survey: a coarse, model-free map of a folder's markdown, with the
 * harvested state of every node computed from the import store — and
 * nothing stored but the map.
 *
 * No model call and no date rule (Q-57, Q-67): a body hash needs no date,
 * so Survey works on a region before its dating rule is declared — which
 * it must, because the map is what the person reads IN ORDER to declare.
 *
 * The walk is scan.ts's own: a second traversal would let the map and the
 * scan disagree about which files exist, and the person would read that as
 * a bug in the import rather than in the map (seeding Task 4).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import matter from 'gray-matter';

import { appendEvent } from '../log/activity.js';
import { bodyHash, walkMarkdown } from './scan.js';
import type { ImportStore } from './store.js';

export type SurveyNode = {
  /** Path relative to the survey root. '' is the root itself. */
  path: string;
  /** Files DIRECTLY in this folder. */
  files: number;
  /** …of which: an accepted import record exists for the body hash. */
  harvested: number;
  /** …of which: an excluded record exists — decided, and deliberately out. */
  refused: number;
  /** files − harvested − refused. What Reach may offer. */
  unread: number;
  /** The same four counts summed over this node and every descendant. */
  total: { files: number; harvested: number; refused: number; unread: number };
};

export type Survey = { at: string; root: string; nodes: SurveyNode[] };

type Counts = { files: number; harvested: number; refused: number; unread: number };

const zero = (): Counts => ({ files: 0, harvested: 0, refused: 0, unread: 0 });

/** Survey one folder: every markdown file under `root`, grouped by DIRECT
 * parent, each file's fate read from the import store. The root itself is
 * `''`; only folders holding markdown directly or transitively appear. */
export function surveyFolder(root: string, store: ImportStore): Survey {
  // The walk the scan uses, exactly — the map must never show a file the
  // scan refuses to admit, and one walk keeps that impossible.
  const files = walkMarkdown(root);

  // DIRECT counts per folder, and the same four counts accumulated over the
  // folder and every descendant. Totals are built bottom-up: each file adds
  // itself to its own folder's total and to every ancestor's.
  const direct = new Map<string, Counts>();
  const total = new Map<string, Counts>();

  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    const dir = dirname(rel) === '.' ? '' : dirname(rel);

    const body = matter(readFileSync(file, 'utf-8')).content;
    const status = store.get(bodyHash(body))?.status;
    // Accepted = harvested. Excluded = refused — decided, and deliberately
    // out. Anything else (pending, failed, stale, or no record at all) is
    // unread: what Reach may still offer.
    const fate: keyof Counts =
      status === 'accepted' ? 'harvested' : status === 'excluded' ? 'refused' : 'unread';

    const d = direct.get(dir) ?? zero();
    d.files += 1;
    d[fate] += 1;
    direct.set(dir, d);

    let ancestor: string = dir;
    for (;;) {
      const t = total.get(ancestor) ?? zero();
      t.files += 1;
      t[fate] += 1;
      total.set(ancestor, t);
      if (ancestor === '') break;
      const slash = ancestor.lastIndexOf('/');
      ancestor = slash === -1 ? '' : ancestor.slice(0, slash);
    }
  }

  const nodes: SurveyNode[] = [...total.keys()]
    .sort()
    .map((path) => ({ path, ...(direct.get(path) ?? zero()), total: total.get(path)! }));

  return { at: new Date().toISOString(), root, nodes };
}

/** Snapshot the survey to `vault/imports/survey.json`: a rebuildable cache
 * with an `at` stamp, computed fresh on every survey (Q-3). Nothing stores a
 * completeness boolean — the state is computable per node, and the map must
 * stay honest when a record changes underneath it. This is the one file in
 * `vault/imports/` that may be deleted without loss. */
export function writeSurvey(vaultRoot: string, survey: Survey): void {
  const dir = join(vaultRoot, 'imports');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'survey.json'),
    JSON.stringify({ at: new Date().toISOString(), root: survey.root, nodes: survey.nodes }, null, 2),
    'utf-8',
  );
  const rootNode = survey.nodes.find((n) => n.path === '');
  // The whole-tree counts, and the root the person typed — never a path
  // from inside the vault beyond that root.
  appendEvent(vaultRoot, {
    at: new Date().toISOString(),
    actor: 'elicitor',
    kind: 'import-surveyed',
    detail:
      `root=${survey.root} files=${rootNode?.total.files ?? 0} ` +
      `harvested=${rootNode?.total.harvested ?? 0} unread=${rootNode?.total.unread ?? 0}`,
  });
}

// readSurvey died with the reach pipeline (canon §10 cut, 2026-08-09): GET
// /api/reach was its only caller, and the reach sweep is gone.
