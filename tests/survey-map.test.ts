import { describe, it, expect } from 'vitest';
import { mapLines, canSave, AUTHORSHIP_CHOICES, declareFlow } from '../web/survey-map.js';
import { nextPath } from '../web/import-review.js';
import type { SurveyNode } from '../src/import/survey.js';

/**
 * The map and the declaration (plan Task 13), tested at the pure seams:
 * this repo has no DOM test environment (no jsdom, no happy-dom), so the
 * tree text, the enablement rule, the authorship options and the
 * declare→scan request sequence are computed by pure functions and tested
 * here; everything visual is verified by use.
 */

const counts = (files: number, harvested: number, refused: number, unread: number) => ({
  files,
  harvested,
  refused,
  unread,
});

/** A survey node with the given totals; direct counts are not what the map shows. */
const node = (
  path: string,
  total: { files: number; harvested: number; refused: number; unread: number },
): SurveyNode => ({
  path,
  files: 0,
  harvested: 0,
  refused: 0,
  unread: 0,
  total,
});

describe('the map, as text', () => {
  it('renders a node per folder that holds markdown', () => {
    const lines = mapLines({
      root: '/vault',
      nodes: [
        node('journal/2019', counts(94, 38, 0, 56)),
        node('journal', counts(412, 38, 0, 374)),
        node('', counts(412, 38, 0, 374)),
      ],
    });
    // One line per node, indented by depth: the root flush, its children one
    // level in — two spaces per level, in the interface's register.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^<root>/);
    expect(lines[1]).toMatch(/^journal /);
    expect(lines[2]).toMatch(/^  journal\/2019 /);
  });

  it('shows a fully-harvested node dimmed rather than hiding it', () => {
    const lines = mapLines({
      root: '/vault',
      nodes: [node('journal/2019', counts(94, 94, 0, 0))],
    });
    // The pure line carries the `done` marker; the DOM renderer turns it
    // into the node-done class (opacity, never display:none).
    expect(lines[0]).toContain('· done');
  });

  it('renders no per-file list at any depth', () => {
    const lines = mapLines({
      root: '/vault',
      nodes: [
        node('', counts(5000, 3000, 500, 1500)),
        node('clippings', counts(87, 0, 3, 84)),
        node('journal', counts(412, 38, 0, 374)),
        node('journal/2019', counts(94, 38, 3, 53)),
      ],
    });
    // The line format has no file names in it — a file list would end a line
    // with the file's .md, and no line here does.
    for (const line of lines) {
      expect(line).not.toMatch(/\.md$/);
    }
  });
});

describe('the declaration', () => {
  it('keeps save disabled until both declarations are answered', () => {
    expect(canSave({ dating: false, authorship: false })).toBe(false);
    expect(canSave({ dating: true, authorship: false })).toBe(false);
    expect(canSave({ dating: false, authorship: true })).toBe(false);
    expect(canSave({ dating: true, authorship: true })).toBe(true);
  });

  it('offers exactly three authorship choices, none preselected', () => {
    expect(AUTHORSHIP_CHOICES).toEqual(['I did', 'someone else', 'written with a model']);
    // The constant is the whole of the offer — no preselected field, because
    // a default here would be a silent assertion about the person (Q-67).
    expect(AUTHORSHIP_CHOICES).not.toHaveProperty('preselected');
  });

  it('posts the region, then scans it with that slug', async () => {
    const sent: { path: string; body?: unknown }[] = [];
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      sent.push({ path, body });
      if (path === '/api/import/region') return { slug: 'journals-abc123' } as T;
      return {
        pending: 12,
        refused: [{ file: 'ideas.md', reason: 'no-date' }],
        skipped: 1,
        adopted: 0,
      } as T;
    };
    const { slug, scan } = await declareFlow(api, {
      folder: '/vault',
      dating: { kind: 'filename', pattern: 'YYYY-MM-DD' },
      authorship: 'other',
    });
    expect(slug).toBe('journals-abc123');
    // The region is declared first, and the scan that follows carries the
    // slug it returned — the review stays inside the declared region.
    expect(sent.map((s) => s.path)).toEqual(['/api/import/region', '/api/import/scan']);
    expect(sent[1]!.body as object).toMatchObject({ region: 'journals-abc123' });
    expect(scan.refused[0]!.file).toBe('ideas.md');
  });
});

describe('the review stays inside the region', () => {
  it('asks for the next item inside the region it was opened with', () => {
    expect(nextPath('journals-abc123')).toBe('/api/import/next?region=journals-abc123');
  });

  it('omits the parameter when opened without a region', () => {
    expect(nextPath()).toBe('/api/import/next');
  });
});
