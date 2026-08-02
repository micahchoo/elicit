import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';

import { readCadence, cadenceSentence } from '../src/log/cadence.js';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

let root: string;

function transcript(name: string, fm: Record<string, unknown>): void {
  writeFileSync(join(root, 'transcripts', `${name}.md`), matter.stringify('', fm), 'utf-8');
}

function daysAgo(n: number): string {
  return new Date(NOW - n * DAY).toISOString();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-cadence-'));
  mkdirSync(join(root, 'transcripts'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('readCadence', () => {
  it('reports nothing when there are no transcripts at all', () => {
    rmSync(join(root, 'transcripts'), { recursive: true });
    expect(readCadence(root, NOW)).toEqual({ inLastMonth: 0, total: 0 });
  });

  it('reports nothing when the only transcripts are imports', () => {
    // Ticket 057 put 19 of these in the vault, dated 2017-2026. Counting them
    // would report a last sitting that never happened.
    transcript('post-archie', { protocol: 'import', started: '2026-07-14T00:00:00.000Z' });
    transcript('post-glitch-art', { protocol: 'import', started: '2017-01-01T00:00:00.000Z' });
    expect(readCadence(root, NOW)).toEqual({ inLastMonth: 0, total: 0 });
  });

  it('counts real sittings and ignores imports mixed in with them', () => {
    transcript('post-archie', { protocol: 'import', started: '2026-07-14T00:00:00.000Z' });
    transcript('s1', { protocol: 'first-contact', started: daysAgo(3) });
    transcript('s2', { protocol: 'first-contact', started: daysAgo(10) });
    transcript('s3', { protocol: 'first-contact', started: daysAgo(200) });

    const c = readCadence(root, NOW);
    expect(c.total).toBe(3);
    expect(c.inLastMonth).toBe(2);
    expect(c.last).toBe(daysAgo(3));
  });

  it('takes the LATEST started, not the last file read', () => {
    // Filenames are ulids and sort by creation, which is not the sitting date
    // for anything backdated. Sorting by `started` is the only correct read.
    transcript('zzz-old', { protocol: 'p', started: daysAgo(90) });
    transcript('aaa-new', { protocol: 'p', started: daysAgo(1) });
    expect(readCadence(root, NOW).last).toBe(daysAgo(1));
  });

  it('skips unparseable and undated transcripts rather than counting them', () => {
    transcript('good', { protocol: 'p', started: daysAgo(2) });
    transcript('nodate', { protocol: 'p' });
    transcript('baddate', { protocol: 'p', started: 'not-a-date' });
    writeFileSync(join(root, 'transcripts', 'broken.md'), '---\n: : :\n---\n', 'utf-8');

    const c = readCadence(root, NOW);
    expect(c.total).toBe(1);
    expect(c.last).toBe(daysAgo(2));
  });

  it('counts a sitting exactly 30 days old as inside the month', () => {
    transcript('edge', { protocol: 'p', started: daysAgo(30) });
    expect(readCadence(root, NOW).inLastMonth).toBe(1);
  });

  it('counts a sitting 31 days old as outside it', () => {
    transcript('edge', { protocol: 'p', started: daysAgo(31) });
    const c = readCadence(root, NOW);
    expect(c.inLastMonth).toBe(0);
    expect(c.total).toBe(1);
  });
});

describe('cadenceSentence', () => {
  it('says so plainly when there is nothing yet', () => {
    expect(cadenceSentence({ inLastMonth: 0, total: 0 }, NOW)).toBe('No sittings yet.');
  });

  it('reads the same shape whether the gap is short or long', () => {
    const near = cadenceSentence({ last: daysAgo(2), inLastMonth: 4, total: 9 }, NOW);
    const far = cadenceSentence({ last: daysAgo(400), inLastMonth: 0, total: 9 }, NOW);
    expect(near).toBe('Last sitting 2 days ago, 4 in the last month.');
    expect(far).toBe('Last sitting about a year ago, none in the last month.');
    // Q-24: dormancy is signal, never debt. Neither sentence may scold, and
    // neither may congratulate — the grammar is identical in both directions.
    for (const s of [near, far]) {
      expect(s).not.toMatch(/only|just|still|haven't|have not|!|keep it up|streak/i);
      expect(s.startsWith('Last sitting ')).toBe(true);
    }
  });

  it('never addresses the reader in the second person', () => {
    // "it has been X since YOU sat" states a gap, and a gap implies something
    // should have filled it. The sentence reports; it does not appraise.
    for (const d of [0, 1, 5, 45, 200, 400, 900]) {
      expect(cadenceSentence({ last: daysAgo(d), inLastMonth: 0, total: 1 }, NOW))
        .not.toMatch(/\byou\b|\byour\b/i);
    }
  });

  it('names today and yesterday rather than counting them', () => {
    expect(cadenceSentence({ last: daysAgo(0), inLastMonth: 1, total: 1 }, NOW))
      .toBe('Last sitting today, one in the last month.');
    expect(cadenceSentence({ last: daysAgo(1), inLastMonth: 2, total: 2 }, NOW))
      .toBe('Last sitting yesterday, 2 in the last month.');
  });

  it('coarsens as the gap grows, because precision stops meaning anything', () => {
    expect(cadenceSentence({ last: daysAgo(45), inLastMonth: 0, total: 1 }, NOW))
      .toContain('about a month ago');
    expect(cadenceSentence({ last: daysAgo(120), inLastMonth: 0, total: 1 }, NOW))
      .toContain('about 4 months ago');
    expect(cadenceSentence({ last: daysAgo(1100), inLastMonth: 0, total: 1 }, NOW))
      .toContain('about 3 years ago');
  });
});
