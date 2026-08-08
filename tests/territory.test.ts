/**
 * Ticket 152 — the territory surface.
 *
 * GET /api/territory joins skeleton/atlas nodes with the NodeReadings the
 * docket sweeps write. The readings in the fixture vault are laid by hand
 * in the exact gray-matter format src/ktg/coverage.ts produces; the
 * assertions check that states and cite counts come OUT of those cites —
 * no new persistence anywhere in the join.
 *
 * Q-79: the state words on the renderer are tested directly — they must
 * read about the archive, never about the person.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Hono } from 'hono';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVault } from '../src/vault/vault.js';
import { createQueueStore } from '../src/queue/queue.js';
import { buildIndex } from '../src/index/lexical.js';
import { createApp } from '../src/server.js';
import { createFileAuth } from '../src/auth/auth.js';
import { makeFakeComplete } from '../src/fake-responder.js';
import type { TerritoryNode, TerritoryResponse } from '../src/territory.js';
import { stateWord, nodeLine, renderTerritory } from '../web/territory.js';

/** One NodeReading file, byte-shaped like src/ktg/coverage.ts writes it. */
function writeReading(
  dir: string,
  nodeId: string,
  status: string,
  cites: string[],
): void {
  mkdirSync(dir, { recursive: true });
  const fm =
    `nodeId: ${nodeId}\n` +
    `status: ${status}\n` +
    'model: mr-ktg-v1\n' +
    'at: 2026-08-03T10:00:00.000Z\n';
  const body = cites.map((c) => `- [${c}](snippets/${c}.md)`).join('\n');
  writeFileSync(join(dir, `${nodeId}.md`), `---\n${fm}---\n${body}\n`, 'utf-8');
}

let root: string;
let app: Hono;
let snipA: string; // cited from sit-1
let snipB: string; // cited from sit-2

/** The JSON body of a response, cast at the boundary the route defines. */
async function jsonOf<T>(res: Response): Promise<T> {
 return (await res.json()) as T;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'elicit-territory-'));
  const vault = createVault(root);

  // The two instruments the docket sweeps read: one skeleton, one atlas.
  // Copied from the repo fixtures so they are valid by construction.
  mkdirSync(join(root, 'data', 'ktg'), { recursive: true });
  mkdirSync(join(root, 'data', 'atlases'), { recursive: true });
  copyFileSync(
    join(process.cwd(), 'data', 'ktg', 'fake-craft.json'),
    join(root, 'data', 'ktg', 'fake-craft.json'),
  );
  copyFileSync(
    join(process.cwd(), 'data', 'atlases', 'time-use-grid.json'),
    join(root, 'data', 'atlases', 'time-use-grid.json'),
  );

  // The snippets the readings cite, across two sittings so 'evidenced' is
  // derivable from the cites alone.
  const s1 = vault.saveSnippet('the workbench faces the window now', {
    kind: 'unprompted',
    session: 'sit-1',
    question: '',
    questionForm: 'theoretical',
  });
  const s2 = vault.saveSnippet('the gouge sharpens on the leather strop', {
    kind: 'unprompted',
    session: 'sit-2',
    question: '',
    questionForm: 'theoretical',
  });
  snipA = s1.id;
  snipB = s2.id;

  // Readings by hand: setup touched (one sitting), core evidenced (two
  // sittings), atlas morning touched. materials and everything else stay
  // unprobed — no file at all.
  writeReading(join(root, 'ktg', 'coverage'), 'fake-craft.foundations.setup', 'touched', [snipA]);
  writeReading(join(root, 'ktg', 'coverage'), 'fake-craft.technique.core', 'evidenced', [snipA, snipB]);
  writeReading(join(root, 'atlases', 'coverage'), 'time-use-grid.morning', 'touched', [snipA]);

  app = await createApp({
    vault,
    complete: makeFakeComplete(),
    queue: createQueueStore(root),
    index: buildIndex(Object.values(vault.rebuildIndex().snippets)),
    vaultRoot: root,
    authStore: createFileAuth(join(root, '.auth.json')),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function getTerritory(): Promise<TerritoryResponse> {
  const res = await app.fetch(
    new Request('http://localhost/api/territory'),
    { remoteAddr: '127.0.0.1' },
  );
  expect(res.status).toBe(200);
  return jsonOf<TerritoryResponse>(res);
}

function nodeMap(instrument: TerritoryResponse['instruments'][number]): Map<string, TerritoryNode> {
  return new Map(instrument.nodes.map((n) => [n.id, n]));
}

describe('GET /api/territory (152)', () => {
  it('serves both instruments, ktg first (sorted slugs)', async () => {
    const body = await getTerritory();
    expect(body.instruments.map((i) => i.id)).toEqual([
      'ktg:fake-craft',
      'atlas:time-use-grid',
    ]);
  });

  it('joins skeleton nodes with their readings — states derive from cites', async () => {
    const body = await getTerritory();
    const ktg = body.instruments.find((i) => i.id === 'ktg:fake-craft')!;
    const nodes = nodeMap(ktg);

    // unprobed: no reading file exists (the fixture default)
    expect(nodes.get('fake-craft.foundations.materials')!.state).toBe('unprobed');
    expect(nodes.get('fake-craft.foundations.materials')!.citeCount).toBe(0);
    expect(nodes.get('fake-craft.integration.capstone')!.state).toBe('unprobed');
    expect(nodes.get('fake-craft.integration.capstone')!.citeCount).toBe(0);

    // touched: cites resolve to a single sitting
    expect(nodes.get('fake-craft.foundations.setup')!.state).toBe('touched');
    expect(nodes.get('fake-craft.foundations.setup')!.citeCount).toBe(1);

    // evidenced: cites resolve across two sittings (Q-50)
    expect(nodes.get('fake-craft.technique.core')!.state).toBe('evidenced');
    expect(nodes.get('fake-craft.technique.core')!.citeCount).toBe(2);

    // node rows carry the outline shape for the renderer
    expect(nodes.get('fake-craft.technique.core')!.depth).toBe(2);
    expect(nodes.get('fake-craft.technique.core')!.role).toBe('node');
  });

  it('cluster rows aggregate the strongest child state and the cite sum', async () => {
    const body = await getTerritory();
    const ktg = body.instruments.find((i) => i.id === 'ktg:fake-craft')!;
    const nodes = nodeMap(ktg);

    // foundations: setup touched + materials unprobed → touched
    expect(nodes.get('fake-craft.foundations')!.role).toBe('cluster');
    expect(nodes.get('fake-craft.foundations')!.depth).toBe(1);
    expect(nodes.get('fake-craft.foundations')!.state).toBe('touched');
    expect(nodes.get('fake-craft.foundations')!.citeCount).toBe(1);

    // technique: core evidenced → evidenced
    expect(nodes.get('fake-craft.technique')!.state).toBe('evidenced');
    expect(nodes.get('fake-craft.technique')!.citeCount).toBe(2);

    // integration: capstone unprobed → unprobed
    expect(nodes.get('fake-craft.integration')!.state).toBe('unprobed');
    expect(nodes.get('fake-craft.integration')!.citeCount).toBe(0);
  });

  it('joins atlas regions with their readings', async () => {
    const body = await getTerritory();
    const atlas = body.instruments.find((i) => i.id === 'atlas:time-use-grid')!;
    expect(atlas.name).toBe('Time-Use Grid');
    const regions = nodeMap(atlas);

    expect(regions.get('time-use-grid.morning')!.state).toBe('touched');
    expect(regions.get('time-use-grid.morning')!.citeCount).toBe(1);
    expect(regions.get('time-use-grid.morning')!.depth).toBe(1);
    expect(regions.get('time-use-grid.morning')!.role).toBe('region');

    expect(regions.get('time-use-grid.evening')!.state).toBe('unprobed');
    expect(regions.get('time-use-grid.evening')!.citeCount).toBe(0);
    expect(regions.size).toBe(6); // every region, joined or not
  });

  it('an empty vault yields no instruments, not an error', async () => {
    // A second vault with no data dirs at all: the route still answers 200.
    const empty = mkdtempSync(join(tmpdir(), 'elicit-territory-empty-'));
    try {
      const vault = createVault(empty);
      const emptyApp = await createApp({
        vault,
        complete: makeFakeComplete(),
        queue: createQueueStore(empty),
        index: buildIndex([]),
        vaultRoot: empty,
        authStore: createFileAuth(join(empty, '.auth.json')),
      });
      const res = await emptyApp.fetch(
        new Request('http://localhost/api/territory'),
        { remoteAddr: '127.0.0.1' },
      );
      expect(res.status).toBe(200);
      expect((await jsonOf<TerritoryResponse>(res)).instruments).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('state words read about the archive, never the person (Q-79)', () => {
  it('every state word names the archive and no personal judgement', () => {
    for (const state of ['unprobed', 'touched', 'evidenced'] as const) {
      const word = stateWord(state);
      expect(word).toMatch(/archive/);
      expect(word).not.toMatch(/\byou\b/i);
      expect(word).not.toMatch(/weak|lack|missing|behind|deficit/i);
    }
    expect(stateWord('unprobed')).toMatch(/nothing in the archive touches .* yet/);
    expect(stateWord('touched')).toMatch(/one sitting in the archive/);
    expect(stateWord('evidenced')).toMatch(/two or more sittings/);
  });

  it('node lines carry the state word and the cite count', () => {
    const base = {
      id: 'fake-craft.technique.core',
      name: 'Core Technique',
      depth: 2,
      role: 'node' as const,
    };
    const touched = nodeLine({ ...base, state: 'touched', citeCount: 1 });
    expect(touched).toContain('Core Technique');
    expect(touched).toContain('one sitting in the archive touches this');
    expect(touched).toContain('1 cite');

    const unprobed = nodeLine({ ...base, state: 'unprobed', citeCount: 0 });
    expect(unprobed).toContain('nothing in the archive touches this yet');
    expect(unprobed).toContain('0 cites');

    // depth indents like the survey-map grammar (two spaces per level)
    const cluster = nodeLine({ ...base, name: 'Technique', depth: 1, role: 'cluster', state: 'evidenced', citeCount: 2 });
    const node = nodeLine({ ...base, state: 'evidenced', citeCount: 2 });
    expect(node.startsWith('  ')).toBe(true);
    expect(cluster.startsWith('  ')).toBe(false);
  });
});

describe('renderTerritory (152 prototype)', () => {
  it('draws the outline: instrument headers, indented rows, quiet empty states', () => {
    // vitest runs in node without jsdom — a minimal document stub is enough
    // to prove the renderer walks the response and draws the lines.
    const created: Array<{ tag: string; className: string | null; textContent: string }> = [];
    const stubDocument = {
      createElement: (tag: string) => {
        const node = { tag, className: null as string | null, textContent: '' };
        created.push(node);
        return node;
      },
    };
    vi.stubGlobal('document', stubDocument);
    try {
      const container: {
        children: Array<{ textContent: string }>;
        replaceChildren(): void;
        append(...els: Array<{ textContent: string }>): void;
      } = {
        children: [],
        replaceChildren() {
          this.children = [];
        },
        append(...els) {
          this.children.push(...els);
        },
      };
      // The stub is structurally a DOM surface; the cast is test-only glue.
      const surface = container as unknown as HTMLElement;
      renderTerritory(surface, {
        instruments: [
          {
            id: 'ktg:fake-craft',
            kind: 'ktg',
            name: 'fake-craft',
            nodes: [
              { id: 'fake-craft.foundations', name: 'Foundations', depth: 1, role: 'cluster', state: 'touched', citeCount: 1 },
              { id: 'fake-craft.foundations.setup', name: 'Workspace Setup', depth: 2, role: 'node', state: 'touched', citeCount: 1 },
            ],
          },
          {
            id: 'atlas:time-use-grid',
            kind: 'atlas',
            name: 'Time-Use Grid',
            nodes: [
              { id: 'time-use-grid.evening', name: 'Evening', depth: 1, role: 'region', state: 'unprobed', citeCount: 0 },
            ],
          },
        ],
      });

      const texts = container.children.map((n) => n.textContent);
      expect(texts).toHaveLength(5);
      expect(texts[0]).toBe('fake-craft');
      expect(texts[1]).toContain('Foundations');
      expect(texts[1]).toContain('one sitting in the archive touches this');
      expect(texts[2]).toContain('Workspace Setup');
      expect(texts[2]).toContain('1 cite');
      // an instrument the archive has never touched gets the quiet invitation
      expect(texts[3]).toBe('Time-Use Grid');
      expect(texts[4]).toContain('nothing in the archive touches Time-Use Grid yet');
      expect(texts[4]).toContain('a sitting would start to');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
