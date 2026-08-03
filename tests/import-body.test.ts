import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import { dropCitedParagraphs, toTurns } from '../src/import/body.js';

/**
 * Characterization test (`.claude/rules/characterization-testing.md`): the
 * body pipeline moved out of `scripts/ingest-posts.ts` unchanged, so this
 * pins the CURRENT behaviour by output rather than by intent. The fixture is
 * `tests/fixtures/import-folder/quoted.md`, whose body is specified in full
 * in the bulk-import plan and is never edited by a later task.
 */
const body = matter(
  readFileSync(join(import.meta.dirname, 'fixtures', 'import-folder', 'quoted.md'), 'utf-8'),
).content;

describe('body pipeline (moved from scripts/ingest-posts.ts)', () => {
  it('drops a paragraph carrying an inline citation, keeps the author around it', () => {
    const { kept, dropped } = dropCitedParagraphs(body);
    expect(dropped).toBe(1);
    expect(kept).toContain('I believe a good ladder can play a big role');
    expect(kept).not.toContain('(Ryde 2008)');
  });

  it('splits only on paragraph boundaries', () => {
    const turns = toTurns(body, '2020-03-01T00:00:00.000Z', 40);
    for (const t of turns) expect(body).toContain(t.text.split('\n\n')[0]!);
    expect(turns.every((t) => /[.!?"”]$/.test(t.text.trim()))).toBe(true);
  });
});
