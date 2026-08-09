/**
 * The KTG coverage store — Phase 2 of the KTG readout.
 *
 * One NodeReading per KTG node, persisted as a gray-matter markdown file
 * under `vault/ktg/coverage/<nodeId>.md`, read back on every call (Q-3: a
 * restart resumes, nothing is cached). The read/write idiom mirrors
 * src/coach/store.ts: every optional frontmatter key goes under a presence
 * guard, because `matter.stringify` throws on a present-but-undefined key.
 *
 * A NodeReading is Marginalia-class (Two Planes rule): it lives outside any
 * Snippet text and only cites what it read — the snippet ids themselves are
 * the cites, so the knowledge plane never carries coverage claims. Status is
 * explicit at write time, and `coverageForNode` can also DERIVE it from the
 * cites: one sitting touched the node, two or more sittings evidenced it
 * (cross-sitting, Q-50 logic). The sitting resolver is injected, same shape
 * as docket's `sittingOf` — the store never reads transcripts itself.
 *
 * Cite attribution policy: a cite whose sitting the resolver cannot identify
 * (null) does not count toward the distinct-sitting set, so unattributed
 * cites can never inflate 'unprobed' into 'evidenced'. A reading whose cites
 * all resolve to null is still 'touched' — the reading exists and cites
 * content, which is more than 'unprobed' claims.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

/** How much live elicitation a node has received. */
export type NodeCoverageStatus = 'unprobed' | 'touched' | 'evidenced';

/**
 * One reading of one KTG node: which snippets were read, in which sitting
 * context, by which model, and what coverage that earned.
 */
export type NodeReading = {
  /** KTG node id (domain.cluster.node) */
  nodeId: string;
  /** Snippet ids the reading drew from — the cites, one per line on disk */
  cites: string[];
  /** Explicit status as written; derivable from cites too (Q-50) */
  status: NodeCoverageStatus;
  /** Model that produced the reading */
  model: string;
  /** ISO-8601 timestamp of the reading */
  at: string;
};

/** Maps a snippet id to the sitting it came from; null = unknown. */
export type SittingResolver = (snippetId: string) => string | null;

export type CoverageStore = {
  /**
   * Persist (or overwrite) the reading for its node.
   *
   * WRITE-SIDE ASYMMETRY (Wave D F2/F12 — documented, deliberately not
   * fixed): this method has NO production caller, so the store is always
   * empty in a real run and every node reads back 'unprobed'. That one
   * empty store feeds two gap-fill jobs in the same docket run: the
   * territory sweep (ktg/gap-fill.ts territoryCandidates) needs at least
   * one 'evidenced' node to fire any of its three passes and is therefore
   * INERT, while the atlas sweep (ktg/atlas-gap-fill.ts) mints on
   * 'unprobed' directly — one run runs one inert job and one minting job
   * off the same always-empty store. Pinned by
   * tests/coverage-asymmetry.test.ts; wiring a writer flips that test
   * and the registry reason (createCoverageStore) together.
   */
  writeReading(reading: NodeReading): void;
  /** The stored reading for a node, or null when none exists. */
  readReading(nodeId: string): NodeReading | null;
  /** Every reading on disk, newest file first. */
  listReadings(): NodeReading[];
  /**
   * Live coverage for a node: 'unprobed' when no reading file exists or it
   * cites nothing; 'evidenced' when its cites come from 2+ sittings;
   * otherwise 'touched' (cites from at most one identifiable sitting).
   */
  coverageForNode(nodeId: string, sittingOf: SittingResolver): NodeCoverageStatus;
};

export function createCoverageStore(
 vaultRoot: string,
 subdir: string = join('ktg', 'coverage'),
): CoverageStore {
 return new CoverageStoreImpl(vaultRoot, subdir);
}

/**
 * The atlas coverage store — same store, different vault subdirectory.
 * Ticket 110 shipped a byte-copy (atlas-coverage.ts); Phase 8 collapses it
 * onto the one implementation behind the one interface.
 */
export function createAtlasCoverageStore(vaultRoot: string): CoverageStore {
 return createCoverageStore(vaultRoot, join('atlases', 'coverage'));
}

class CoverageStoreImpl implements CoverageStore {
 #root: string;
 #subdir: string;

 constructor(root: string, subdir: string) {
  this.#root = root;
  this.#subdir = subdir;
 }

 #dir(): string {
  const d = join(this.#root, this.#subdir);
  mkdirSync(d, { recursive: true });
  return d;
 }

 #parseReading(data: Record<string, unknown>, body: string): NodeReading {
  const cites: string[] = [];
  for (const raw of body.split('\n')) {
   const line = raw.trim();
   if (line.length === 0) continue;
   // `- [snippetId](snippets/snippetId.md)` — the label is the snippet id.
   const link = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)$/);
   cites.push(link ? link[1]! : line);
  }
  return {
   nodeId: data.nodeId as string,
   cites,
   status: data.status as NodeCoverageStatus,
   model: data.model as string,
   at: data.at as string,
  };
 }

 #readReading(nodeId: string): NodeReading | null {
  try {
   const parsed = matter.read(join(this.#dir(), `${nodeId}.md`));
   return this.#parseReading(parsed.data as Record<string, unknown>, parsed.content);
  } catch {
   return null;
  }
 }

 writeReading(reading: NodeReading): void {
  const fm: Record<string, unknown> = {
   nodeId: reading.nodeId,
   status: reading.status,
   model: reading.model,
   at: reading.at,
  };
  const body = reading.cites.map((cite) => `- [${cite}](snippets/${cite}.md)`).join('\n');
  writeFileSync(join(this.#dir(), `${reading.nodeId}.md`), matter.stringify(body, fm), 'utf-8');
 }

 readReading(nodeId: string): NodeReading | null {
  return this.#readReading(nodeId);
 }

 listReadings(): NodeReading[] {
  const dir = this.#dir();
  let files: string[];
  try {
   files = readdirSync(dir);
  } catch {
   return [];
  }
  const out: NodeReading[] = [];
  for (const f of files) {
   if (!f.endsWith('.md')) continue;
   const parsed = matter.read(join(dir, f));
   out.push(this.#parseReading(parsed.data as Record<string, unknown>, parsed.content));
  }
  return out;
 }

 coverageForNode(nodeId: string, sittingOf: SittingResolver): NodeCoverageStatus {
  const reading = this.#readReading(nodeId);
  if (!reading || reading.cites.length === 0) return 'unprobed';
  const sittings = new Set<string>();
  for (const cite of reading.cites) {
   const sitting = sittingOf(cite);
   if (sitting !== null) sittings.add(sitting);
  }
  return sittings.size >= 2 ? 'evidenced' : 'touched';
 }
}
