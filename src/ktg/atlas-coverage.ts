/**
 * The atlas coverage store — ticket 110.
 *
 * One region reading per atlas region, persisted as a gray-matter markdown
 * file under `vault/atlases/coverage/<regionId>.md`, read back on every call
 * (Q-3: a restart resumes, nothing is cached).
 *
 * Reuses the CoverageStore interface from `src/ktg/coverage.ts` — same shape,
 * different vault subdirectory. The interface is the contract; this
 * implementation stores atlas readings in `vault/atlases/coverage/`.
 *
 * A RegionReading is Marginalia-class (Two Planes rule): it lives outside any
 * Snippet text and only cites what it read. Status is explicit at write time,
 * and `coverageForRegion` can also DERIVE it from the cites: one sitting
 * touched the region, two or more sittings evidenced it (cross-sitting,
 * Q-50 logic).
 *
 * Cite attribution policy: a cite whose sitting the resolver cannot identify
 * (null) does not count toward the distinct-sitting set, so unattributed
 * cites can never inflate 'unprobed' into 'evidenced'.
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import type { CoverageStore, NodeCoverageStatus, NodeReading, SittingResolver } from './coverage.js';

/** The vault subdirectory for atlas coverage files. */
const ATLAS_COVERAGE_DIR = join('atlases', 'coverage');

/**
 * Create a CoverageStore that persists atlas readings under
 * `vault/atlases/coverage/<regionId>.md`.
 *
 * Same interface as `createCoverageStore` — the only difference is the
 * on-disk path. Callers use the same `CoverageStore` type; the region id
 * is the `nodeId` field on the reading.
 */
export function createAtlasCoverageStore(vaultRoot: string): CoverageStore {
  return new AtlasCoverageStoreImpl(vaultRoot);
}

class AtlasCoverageStoreImpl implements CoverageStore {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #dir(): string {
    const d = join(this.#root, ATLAS_COVERAGE_DIR);
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

  #readFile(nodeId: string): NodeReading | null {
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
    return this.#readFile(nodeId);
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
    const reading = this.#readFile(nodeId);
    if (!reading || reading.cites.length === 0) return 'unprobed';
    const sittings = new Set<string>();
    for (const cite of reading.cites) {
      const sitting = sittingOf(cite);
      if (sitting !== null) sittings.add(sitting);
    }
    return sittings.size >= 2 ? 'evidenced' : 'touched';
  }
}
