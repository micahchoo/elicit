/**
 * Verdict validation and the keep rule — ticket 131.
 *
 * The trial archive here is a real directory with a real transcript in it,
 * because the whole point of Q-88's validation is that it touches the disk:
 * a test that stubbed the filesystem would assert the one thing that cannot
 * go wrong and skip the one that can.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateVerdict, keepRule, DIMENSIONS } from '../src/loop/verdicts.js';
import type { Citation, DimensionVerdict, Verdict } from '../src/loop/verdicts.js';

let archive: string;

/** The one line the fake life contains, quoted exactly where a citation resolves. */
const LIVED = 'I keep saying I want to leave the city and then I renew the lease.';

beforeEach(() => {
  archive = mkdtempSync(join(tmpdir(), 'elicit-loop-verdicts-'));
  mkdirSync(join(archive, 'vault', 'transcripts'), { recursive: true });
  writeFileSync(
    join(archive, 'vault', 'transcripts', '2026-08-01.md'),
    `## agent\n\nWhat did you decide about the lease?\n\n## user\n\n${LIVED}\n`,
    'utf-8',
  );
});

afterEach(() => {
  rmSync(archive, { recursive: true, force: true });
});

const resolving: Citation = {
  life: 'first',
  ref: 'vault/transcripts/2026-08-01.md#L7-L7',
  quote: LIVED,
};

function silent(): DimensionVerdict {
  return { better: 'neither', because: 'Neither life differed here.', citations: [] };
}

/** A verdict whose five dimensions are silent unless overridden. */
function makeVerdict(overrides?: Partial<Verdict>): Verdict {
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, silent()]),
  ) as Verdict['dimensions'];
  return {
    dossier: 'dossier-001',
    cycle: 'c01',
    trial: 't1',
    order: ['candidate', 'baseline'],
    dimensions,
    ...overrides,
  };
}

/** The same verdict with one dimension claiming a difference. */
function claiming(dimension: (typeof DIMENSIONS)[number], better: 'first' | 'second', citations: Citation[]): Verdict {
  const v = makeVerdict();
  v.dimensions[dimension] = { better, because: 'The question tracked what was actually said.', citations };
  return v;
}

describe('validateVerdict — a citation resolves against the archived life', () => {
  it('accepts an exact quote from a file that exists', () => {
    expect(validateVerdict(claiming('questioning', 'first', [resolving]), archive)).toEqual({ ok: true });
  });

  it('accepts a ref with no line span', () => {
    const bare: Citation = { ...resolving, ref: 'vault/transcripts/2026-08-01.md' };
    expect(validateVerdict(claiming('questioning', 'first', [bare]), archive)).toEqual({ ok: true });
  });

  it('accepts a verdict whose every dimension is silent — a tie cites nothing', () => {
    expect(validateVerdict(makeVerdict(), archive)).toEqual({ ok: true });
  });

  it('rejects a quote that is not in the file, character for character', () => {
    const tidied: Citation = { ...resolving, quote: 'I keep saying I want to leave the city, and then I renew the lease.' };
    const result = validateVerdict(claiming('questioning', 'first', [tidied]), archive);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.malformed[0]).toContain('the quote is not in the file');
  });

  it('rejects a ref naming a file the archive does not hold', () => {
    const invented: Citation = { ...resolving, ref: 'vault/transcripts/2026-07-01.md' };
    const result = validateVerdict(claiming('harvest', 'second', [invented]), archive);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.malformed[0]).toContain('no such file in the trial archive');
  });

  it('rejects a ref that climbs out of the trial archive', () => {
    const escaping: Citation = { ...resolving, ref: '../../etc/hosts' };
    const result = validateVerdict(claiming('wiki', 'first', [escaping]), archive);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.malformed[0]).toContain('outside the trial archive');
  });

  it('is malformed when a dimension claims a difference and cites nothing', () => {
    const result = validateVerdict(claiming('descents', 'second', []), archive);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.malformed).toEqual(['descents: better=second with no citation']);
  });

  it('keeps a dimension whose SECOND citation resolves', () => {
    const broken: Citation = { ...resolving, quote: 'a sentence nobody said' };
    expect(validateVerdict(claiming('returns', 'first', [broken, resolving]), archive)).toEqual({ ok: true });
  });

  it('names every failing dimension, not just the first', () => {
    const v = claiming('questioning', 'first', []);
    v.dimensions.returns = { better: 'second', because: 'x', citations: [] };
    const result = validateVerdict(v, archive);
    expect(result.ok === false && result.malformed).toHaveLength(2);
  });
});

describe('keepRule — one-sided by construction (Q-98)', () => {
  it('keeps on one cited win and no regressions', () => {
    const result = keepRule([claiming('questioning', 'first', [resolving])]);
    expect(result.keep).toBe(true);
    expect(result.wins).toHaveLength(1);
    expect(result.regressions).toEqual([]);
  });

  it('refuses on a single regression, however many wins stand against it', () => {
    const win = claiming('questioning', 'first', [resolving]);
    const alsoWin = claiming('harvest', 'first', [resolving]);
    const regression = claiming('descents', 'second', [resolving]);

    const result = keepRule([win, alsoWin, regression]);
    expect(result.keep).toBe(false);
    expect(result.wins).toHaveLength(2);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]?.dimension).toBe('descents');
  });

  it('refuses on ties alone — silence is not evidence', () => {
    expect(keepRule([makeVerdict(), makeVerdict()])).toEqual({ keep: false, wins: [], regressions: [] });
  });

  it('reads the candidate off `order`, so second-shown wins count as wins', () => {
    const v = claiming('wiki', 'second', [resolving]);
    v.order = ['baseline', 'candidate'];
    const result = keepRule([v]);
    expect(result.keep).toBe(true);
    expect(result.wins[0]?.dimension).toBe('wiki');
  });

  it('counts no uncited win, even if validation was skipped', () => {
    expect(keepRule([claiming('questioning', 'first', [])])).toEqual({ keep: false, wins: [], regressions: [] });
  });

  it('throws on a verdict whose order names no candidate — it is about nothing identifiable', () => {
    const v = claiming('questioning', 'first', [resolving]);
    v.order = ['arm-a', 'arm-b'];
    expect(() => keepRule([v])).toThrow(/names no "candidate" arm/);
  });
});
