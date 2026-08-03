import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import { compilePattern, dateFor } from '../src/import/dating.js';
import { scanFolder, walkMarkdown } from '../src/import/scan.js';
import { FIXTURE_ADMITTED, FIXTURE_DATES, FIXTURE_REFUSED } from './fixtures/seeding-vault/manifest.js';

/** The committed fixture. These tests never mutate it — a scan must be re-runnable. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'seeding-vault');

describe('dating (one declared rule dates a region, and every miss is refused by name)', () => {
  it('compiles a template into a regex over the basename', () => {
    expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, '2021-03-04', {})).toEqual({ date: '2021-03-04' });
    expect(dateFor({ kind: 'filename', pattern: 'YYYYMMDD' }, '20210304', {})).toEqual({ date: '2021-03-04' });
  });

  it('finds the date inside a longer name', () => {
    expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, '2021-03-04 Monday standup', {}))
      .toEqual({ date: '2021-03-04' });
  });

  it('refuses a name that does not match, by its own reason', () => {
    expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, 'ideas', {}))
      .toEqual({ reason: 'no-date-in-name' });
  });

  it('refuses an impossible day rather than rolling it forward', () => {
    expect(dateFor({ kind: 'filename', pattern: 'YYYY-MM-DD' }, '2021-02-31', {}))
      .toEqual({ reason: 'unparsable-date' });
  });

  it('reads a declared frontmatter key that is not "date"', () => {
    expect(dateFor({ kind: 'frontmatter', key: 'created' }, 'x', { created: '2019-05-02' }))
      .toEqual({ date: '2019-05-02' });
  });

  it('rejects a pattern that cannot produce a day', () => {
    expect(compilePattern('YYYY-MM')).toBeNull();
    expect(compilePattern('journal')).toBeNull();
  });

  it('walks the same files scanFolder scans', () => {
    expect(walkMarkdown(FIXTURE)).toEqual(scanFolder(FIXTURE).items.map((i) => i.sourcePath).concat(
      scanFolder(FIXTURE).refused.map((r) => r.sourcePath)).sort());
  });

  it('scans an undated vault by filename and names every refusal', () => {
    const r = scanFolder(FIXTURE, { kind: 'filename', pattern: 'YYYY-MM-DD' });
    expect(r.items).toHaveLength(FIXTURE_ADMITTED);
    expect(r.items.map((i) => i.date).sort()).toEqual(FIXTURE_DATES);
    expect(r.refused).toHaveLength(FIXTURE_REFUSED);
    expect(r.refused).toContainEqual({ sourcePath: join(FIXTURE, 'journal/ideas.md'), reason: 'no-date-in-name' });
    expect(r.refused).toContainEqual({ sourcePath: join(FIXTURE, 'journal/2021-02-31.md'), reason: 'unparsable-date' });
  });
});
