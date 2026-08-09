import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import type {
  Complete,
  Facet,
  Index,
  LexicalIndex,
  QueueEntry,
  QueueStore,
  Snippet,
  Turn,
  Vault,
} from '../src/types.js';
import { appendEvent, readEvents } from '../src/log/activity.js';
import { startSession } from '../src/elicitor/elicitor.js';
import { loadDecks, loadJsonlDecks, loadVaultDecks } from '../src/randomizer/decks.js';
import {
  RANDOMIZER_THRESHOLDS,
  graduate,
  type RandomizerThresholds,
} from '../src/randomizer/thresholds.js';
import {
  datedSnippets,
  readSittingDates,
  stratify,
  stratumFor,
} from '../src/randomizer/strata.js';
import { licenseForDraw } from '../src/randomizer/license.js';
import {
  createRandomizer,
  resurfaceQuestion,
  type RandomizerDraw,
} from '../src/randomizer/randomizer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-randomizer-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const NOW = new Date('2026-08-02T12:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

/** Writes one snippet the way `Vault.saveSnippet` does, under a named sitting. */
function writeSnippet(
  id: string,
  session: string,
  prose: string,
  provenance?: Record<string, unknown>,
): void {
  const dir = join(root, 'snippets', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'v1.md'),
    matter.stringify(prose, {
      id,
      version: 1,
      captured: NOW.toISOString(),
      provenance: {
        kind: 'unprompted',
        session,
        question: '',
        questionForm: 'deliberative',
        ...provenance,
      },
    }),
    'utf-8',
  );
}

/** Writes one transcript the way `Vault.startTranscript` does. */
function writeSitting(session: string, started: string): void {
  const dir = join(root, 'transcripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${session}.md`),
    matter.stringify('', {
      session,
      mode: {},
      protocol: 'import',
      started,
    }),
    'utf-8',
  );
}

function writeJsonlDeck(dir: string, deck: string, rows: Record<string, unknown>[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${deck}.jsonl`),
    `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
    'utf-8',
  );
}

function deckRow(question: string, blockId: number, deck = 'shipped'): Record<string, unknown> {
  return {
    question,
    channel: 'somewhere',
    channelTitle: 'Somewhere',
    blockId,
    deck,
    targetFacet: 'construct',
    curatedBy: 'test',
  };
}

function entry(o: Partial<QueueEntry>): QueueEntry {
  return {
    id: o.id ?? 'e1',
    status: o.status ?? 'answered',
    source: 'composed',
    license: 'test',
    question: 'q?',
    questionForm: 'deliberative',
    horizon: 'now',
    created: daysAgo(400),
    ...o,
  };
}

// ── Deck storage ──

describe('deck storage', () => {
  it('reads the shipped JSONL decks that ticket 004 produced', () => {
    const dir = join(root, 'decks');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 1), deckRow('Who knew?', 2)]);

    const entries = loadJsonlDecks(dir);

    expect(entries.map((e) => e.question)).toEqual(['What did you avoid?', 'Who knew?']);
    expect(entries[0]!.deck).toBe('shipped');
    expect(entries[0]!.targetFacet).toBe('construct');
  });

  it('skips malformed JSONL lines rather than losing the deck', () => {
    const dir = join(root, 'decks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'shipped.jsonl'),
      `${JSON.stringify(deckRow('Kept.', 1))}\n{not json\n\n${JSON.stringify(deckRow('Also kept.', 2))}\n`,
      'utf-8',
    );

    expect(loadJsonlDecks(dir).map((e) => e.question)).toEqual(['Kept.', 'Also kept.']);
  });

  it('leaves an unclassified JSONL row without a targetFacet key at all', () => {
    const dir = join(root, 'decks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'shipped.jsonl'),
      `${JSON.stringify({ question: 'No facet?', channel: 'c', blockId: 5, deck: 'shipped', curatedBy: 't' })}\n`,
      'utf-8',
    );

    const e = loadJsonlDecks(dir)[0]!;

    expect('targetFacet' in e).toBe(false);
    expect('channelTitle' in e).toBe(false);
    // A present key holding undefined throws here and loses the whole write.
    expect(() => matter.stringify('', { ...e })).not.toThrow();
  });

  it('reads a hand-written vault deck as markdown (Q-3)', () => {
    const dir = join(root, 'decks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'mornings.md'),
      matter.stringify(
        '# notes to self\n\n- What did you notice first today?\n- Which room did you avoid?\n',
        { deck: 'mornings', curatedBy: 'hand', targetFacet: 'episode' },
      ),
      'utf-8',
    );

    const entries = loadVaultDecks(root);

    expect(entries.map((e) => e.question)).toEqual([
      'What did you notice first today?',
      'Which room did you avoid?',
    ]);
    expect(entries[0]!.deck).toBe('mornings');
    expect(entries[0]!.curatedBy).toBe('hand');
    expect(entries[0]!.targetFacet).toBe('episode');
    // Each entry needs a stable key for the cooldown; position in the file is it.
    expect(entries.map((e) => e.blockId)).toEqual([1, 2]);
  });

  it('leaves channelTitle absent rather than present-and-undefined', () => {
    const dir = join(root, 'decks');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'mornings.md'),
      matter.stringify('- One question?\n', { deck: 'mornings', curatedBy: 'hand' }),
      'utf-8',
    );

    const e = loadVaultDecks(root)[0]!;

    expect('channelTitle' in e).toBe(false);
    expect('targetFacet' in e).toBe(false);
    // The proof that matters: it round-trips through matter.stringify, which
    // throws on a present key holding undefined.
    expect(() => matter.stringify('', { ...e })).not.toThrow();
  });

  it('lets a vault deck replace a shipped deck of the same name — the person prunes', () => {
    const shippedDir = join(root, 'shipped-decks');
    writeJsonlDeck(shippedDir, 'mornings', [deckRow('Agent picked this.', 1, 'mornings')]);
    const vaultDeckDir = join(root, 'decks');
    mkdirSync(vaultDeckDir, { recursive: true });
    writeFileSync(
      join(vaultDeckDir, 'mornings.md'),
      matter.stringify('- I picked this.\n', { deck: 'mornings', curatedBy: 'hand' }),
      'utf-8',
    );

    const entries = loadDecks({ deckDir: shippedDir, vaultRoot: root });

    expect(entries.map((e) => e.question)).toEqual(['I picked this.']);
  });

  it('returns an empty deck list when neither source exists', () => {
    expect(loadDecks({ deckDir: join(root, 'nope'), vaultRoot: root })).toEqual([]);
  });
});

// ── Depth strata ──

describe('depth strata', () => {
  const t = RANDOMIZER_THRESHOLDS;

  it('names four strata by how far the writing is from the person who is here now', () => {
    expect(stratumFor(daysAgo(1), NOW, t)).toBe('recent');
    expect(stratumFor(daysAgo(89), NOW, t)).toBe('recent');
    expect(stratumFor(daysAgo(90), NOW, t)).toBe('season');
    expect(stratumFor(daysAgo(364), NOW, t)).toBe('season');
    expect(stratumFor(daysAgo(365), NOW, t)).toBe('years');
    expect(stratumFor(daysAgo(1824), NOW, t)).toBe('years');
    expect(stratumFor(daysAgo(1825), NOW, t)).toBe('deep');
  });

  it('dates a snippet by its sitting, not by when it was imported', () => {
    writeSitting('post-2020', '2020-03-14T00:00:00.000Z');
    writeSnippet('s1', 'post-2020', 'Old words.');

    const dates = readSittingDates(root);
    const snips = datedSnippets(indexOf(root), dates, NOW, t);

    expect(snips).toHaveLength(1);
    // `captured` is today — the import. `wroteAt` is 2020, which is the point.
    expect(snips[0]!.wroteAt).toBe('2020-03-14T00:00:00.000Z');
    expect(snips[0]!.stratum).toBe('deep');
  });

  it('falls back to captured when the sitting has no transcript', () => {
    writeSnippet('s1', 'ghost-sitting', 'Orphan words.');

    const snips = datedSnippets(indexOf(root), readSittingDates(root), NOW, t);

    expect(snips[0]!.wroteAt).toBe(NOW.toISOString());
    expect(snips[0]!.stratum).toBe('recent');
  });

  it('groups by stratum and drops the empty ones', () => {
    writeSitting('old', '2020-03-14T00:00:00.000Z');
    writeSitting('new', daysAgo(2));
    writeSnippet('a', 'old', 'A.');
    writeSnippet('b', 'old', 'B.');
    writeSnippet('c', 'new', 'C.');

    const strata = stratify(datedSnippets(indexOf(root), readSittingDates(root), NOW, t));

    expect([...strata.keys()].sort()).toEqual(['deep', 'recent']);
    expect(strata.get('deep')).toHaveLength(2);
  });
});

// ── The license (Q-16) ──

describe('license', () => {
  const t = RANDOMIZER_THRESHOLDS;

  it('licenses nothing in an empty world — a vault with no history owes no coverage', () => {
    const v = licenseForDraw({ entries: [], events: [], now: NOW, thresholds: t });

    expect(v.licensed).toBe(false);
    expect(v.grounds).toBe('none');
  });

  it('calls it a dry spell when nothing has been answered since the drought began', () => {
    const events = [
      { at: daysAgo(30), actor: 'elicitor' as const, kind: 'session-started' as const, detail: '' },
    ];

    const v = licenseForDraw({ entries: [], events, now: NOW, thresholds: t });

    expect(v.licensed).toBe(true);
    expect(v.grounds).toBe('dry-spell');
    expect(v.detail).toContain('days=30');
  });

  it('does not call a fresh answer a dry spell', () => {
    const events = [
      { at: daysAgo(30), actor: 'elicitor' as const, kind: 'session-started' as const, detail: '' },
    ];
    const entries = [entry({ answeredAt: daysAgo(1), targetFacet: 'episode' })];

    const v = licenseForDraw({ entries, events, now: NOW, thresholds: t });

    expect(v.grounds).not.toBe('dry-spell');
  });

  it('calls it a stale region when one answered Facet has gone untouched', () => {
    const events = [
      { at: daysAgo(400), actor: 'elicitor' as const, kind: 'session-started' as const, detail: '' },
    ];
    const entries = [
      entry({ id: 'a', answeredAt: daysAgo(1), targetFacet: 'episode' }),
      entry({ id: 'b', answeredAt: daysAgo(200), targetFacet: 'value' }),
    ];

    const v = licenseForDraw({ entries, events, now: NOW, thresholds: t });

    expect(v.licensed).toBe(true);
    expect(v.grounds).toBe('stale-region');
    expect(v.detail).toContain('region=value');
  });

  it('claims no stale region when every answered Facet is fresh', () => {
    const events = [
      { at: daysAgo(400), actor: 'elicitor' as const, kind: 'session-started' as const, detail: '' },
    ];
    const entries = [
      entry({ id: 'a', answeredAt: daysAgo(1), targetFacet: 'episode' }),
      entry({ id: 'b', answeredAt: daysAgo(2), targetFacet: 'value' }),
    ];

    const v = licenseForDraw({ entries, events, now: NOW, thresholds: t });

    expect(v.licensed).toBe(false);
    expect(v.grounds).toBe('none');
  });

  it('reads coverage, never mood: an unanswered pending entry is not evidence of an answer', () => {
    const events = [
      { at: daysAgo(30), actor: 'elicitor' as const, kind: 'session-started' as const, detail: '' },
    ];
    const entries = [entry({ status: 'pending', created: daysAgo(1) })];

    const v = licenseForDraw({ entries, events, now: NOW, thresholds: t });

    expect(v.grounds).toBe('dry-spell');
  });
});

// ── The draw ──

function indexOf(r: string): Index {
  // A minimal stand-in for `Vault.rebuildIndex`, built the same way the real
  // one is: read every snippet directory's newest version.
  const snippets: Record<string, Snippet> = {};
  let dirs: string[] = [];
  try {
    dirs = readdirSync(join(r, 'snippets'));
  } catch {
    return { snippets, readings: {}, buds: {} };
  }
  for (const d of dirs) {
    const files = readdirSync(join(r, 'snippets', d)).filter((f) => /^v\d+\.md$/.test(f)).sort();
    const newest = files[files.length - 1];
    if (!newest) continue;
    const parsed = matter.read(join(r, 'snippets', d, newest));
    const data = parsed.data as Snippet;
    snippets[data.id] = { ...data, prose: parsed.content.trimEnd() };
  }
  return { snippets, readings: {}, buds: {} };
}

function makeDeps(o?: {
  deckDir?: string;
  entries?: QueueEntry[];
  thresholds?: RandomizerThresholds;
  random?: () => number;
}) {
  return {
    root,
    vault: { rebuildIndex: () => indexOf(root) },
    queue: { list: () => o?.entries ?? [] },
    now: NOW,
    random: o?.random ?? (() => 0),
    ...(o?.deckDir !== undefined ? { deckDir: o.deckDir } : { deckDir: join(root, 'no-decks') }),
    ...(o?.thresholds ? { thresholds: o.thresholds } : {}),
  };
}

describe('randomizer draw', () => {
  it('shuffles a deck and says which deck the question came from', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);

    const draw = createRandomizer(makeDeps({ deckDir: dir }))('user');

    expect(draw).not.toBeNull();
    expect(draw!.question).toBe('What did you avoid?');
    expect(draw!.provenance).toBe('deck');
    expect(draw!.draw).toEqual({
      kind: 'deck',
      deck: 'shipped',
      channel: 'somewhere',
      blockId: 77,
    });
  });

  it('resurfaces the person\'s own words verbatim, with the date they wrote them', () => {
    writeSitting('post-2020', '2020-03-14T00:00:00.000Z');
    writeSnippet('s1', 'post-2020', 'Care as a general inquiry helped me build an inductive experience.');

    const draw = createRandomizer(makeDeps())('user');

    expect(draw).not.toBeNull();
    expect(draw!.provenance).toBe('resurfacing');
    expect(draw!.question).toContain(
      'Care as a general inquiry helped me build an inductive experience.',
    );
    expect(draw!.question).toBe(
      resurfaceQuestion(
        '2020-03-14',
        'Care as a general inquiry helped me build an inductive experience.',
      ),
    );
    expect(draw!.draw).toEqual({
      kind: 'resurfacing',
      snippetId: 's1',
      version: 1,
      stratum: 'deep',
      wroteAt: '2020-03-14T00:00:00.000Z',
    });
  });

  it("carries the resurfaced snippet's lineage verbatim (ticket 073)", () => {
    writeSitting('post-2020', '2020-03-14T00:00:00.000Z');
    writeSnippet(
      's1',
      'post-2020',
      'Care as a general inquiry helped me build an inductive experience.',
      {
        question: 'What were you circling around then?',
        context: 'The sentences that came just before this cut.',
      },
    );

    const draw = createRandomizer(makeDeps())('user');

    expect(draw).not.toBeNull();
    expect(draw!.provenance).toBe('resurfacing');
    expect(draw!.snippetQuestion).toBe('What were you circling around then?');
    expect(draw!.context).toBe('The sentences that came just before this cut.');
  });

  it("omits lineage entirely when the snippet's provenance has none (ticket 073)", () => {
    writeSitting('post-2020', '2020-03-14T00:00:00.000Z');
    writeSnippet('s1', 'post-2020', 'Care as a general inquiry helped me build an inductive experience.');

    const draw = createRandomizer(makeDeps())('user');

    expect(draw).not.toBeNull();
    expect(draw!.provenance).toBe('resurfacing');
    expect(draw!.snippetQuestion).toBeUndefined();
    expect(draw!.context).toBeUndefined();
    expect('snippetQuestion' in draw!).toBe(false);
    expect('context' in draw!).toBe(false);
  });

  it('never frames the antecedent context into the resurfacing question (ticket 073)', () => {
    writeSitting('post-2020', '2020-03-14T00:00:00.000Z');
    writeSnippet(
      's1',
      'post-2020',
      'Care as a general inquiry helped me build an inductive experience.',
      { question: 'What were you circling around then?', context: 'CONTEXT-MUST-NOT-LEAK' },
    );

    const draw = createRandomizer(makeDeps())('user');

    expect(draw).not.toBeNull();
    expect(draw!.provenance).toBe('resurfacing');
    expect(draw!.context).toBe('CONTEXT-MUST-NOT-LEAK');
    expect(draw!.question).not.toContain('CONTEXT-MUST-NOT-LEAK');
  });

  it('never carries lineage on a deck draw (ticket 073)', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);

    const draw = createRandomizer(makeDeps({ deckDir: dir }))('user');

    expect(draw).not.toBeNull();
    expect(draw!.provenance).toBe('deck');
    expect('snippetQuestion' in draw!).toBe(false);
    expect('context' in draw!).toBe(false);
  });

  it('returns null when neither channel has anything to shuffle', () => {
    expect(createRandomizer(makeDeps())('user')).toBeNull();
  });

  it('never vetoes a draw the person asked for, licensed or not (Q-16)', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);

    // No history at all: licenseForDraw says 'none'.
    const draw = createRandomizer(makeDeps({ deckDir: dir }))('user');

    expect(draw).not.toBeNull();
  });

  it('offers nothing unasked while the license is in shadow (demotion path, Q-35)', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);
    const entries = [entry({ answeredAt: daysAgo(400), targetFacet: 'episode' })];

    // The coverage grounds graduated 2026-08-03; this pins the demotion path.
    const shadow: RandomizerThresholds = {
      ...RANDOMIZER_THRESHOLDS,
      'randomizer.drySpellDays': {
        ...RANDOMIZER_THRESHOLDS['randomizer.drySpellDays'],
        live: false,
      },
      'randomizer.staleRegionDays': {
        ...RANDOMIZER_THRESHOLDS['randomizer.staleRegionDays'],
        live: false,
      },
    };
    expect(
      createRandomizer(makeDeps({ deckDir: dir, entries, thresholds: shadow }))('system'),
    ).toBeNull();
  });

  it('offers a draw unasked once the dry-spell threshold graduates', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);
    appendEvent(root, {
      at: daysAgo(40),
      actor: 'elicitor',
      kind: 'session-started',
      detail: '',
    });

    const live = graduate(RANDOMIZER_THRESHOLDS, 'randomizer.drySpellDays');
    const draw = createRandomizer(makeDeps({ deckDir: dir, thresholds: live }))('system');

    expect(draw).not.toBeNull();
  });

  it('will not offer unasked when the license itself says no, however live it is', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);
    const entries = [entry({ answeredAt: daysAgo(1), targetFacet: 'episode' })];
    appendEvent(root, { at: daysAgo(2), actor: 'elicitor', kind: 'session-started', detail: '' });

    const live = graduate(
      RANDOMIZER_THRESHOLDS,
      'randomizer.drySpellDays',
      'randomizer.staleRegionDays',
    );

    expect(
      createRandomizer(makeDeps({ deckDir: dir, entries, thresholds: live }))('system'),
    ).toBeNull();
  });
});

// ── Forgetting ──

describe('forgotten-only resurfacing', () => {
  it('will not resurface a snippet it drew inside the cooldown', () => {
    writeSitting('post-2020', '2020-03-14T00:00:00.000Z');
    writeSnippet('s1', 'post-2020', 'Only words here.');
    appendEvent(root, {
      at: daysAgo(3),
      actor: 'elicitor',
      kind: 'randomizer-drawn',
      detail: 'channel=resurfacing',
      refs: ['s1'],
    });

    expect(createRandomizer(makeDeps())('user')).toBeNull();
  });

  it('resurfaces it again once the cooldown has passed', () => {
    writeSitting('post-2020', '2020-03-14T00:00:00.000Z');
    writeSnippet('s1', 'post-2020', 'Only words here.');
    appendEvent(root, {
      at: daysAgo(200),
      actor: 'elicitor',
      kind: 'randomizer-drawn',
      detail: 'channel=resurfacing',
      refs: ['s1'],
    });

    expect(createRandomizer(makeDeps())('user')).not.toBeNull();
  });

  it('will not deal a deck card it dealt inside the cooldown', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);
    appendEvent(root, {
      at: daysAgo(3),
      actor: 'elicitor',
      kind: 'randomizer-drawn',
      detail: 'channel=deck',
      refs: ['deck:shipped:77'],
    });

    expect(createRandomizer(makeDeps({ deckDir: dir }))('user')).toBeNull();
  });
});

// ── Stratification actually defeats the corpus skew ──

describe('stratification against the real corpus shape', () => {
  /**
   * Sweep the rng across [0,1) and report where the draws land. The log is
   * cleared between draws on purpose: the cooldown would otherwise shrink the
   * pool from under the sweep and every observation below would be a
   * measurement of the cooldown wearing stratification's clothes.
   */
  function sweep(n: number): { strata: string[]; sittings: string[] } {
    const strata: string[] = [];
    const sittings: string[] = [];
    for (let i = 0; i < n; i++) {
      rmSync(join(root, 'log'), { recursive: true, force: true });
      const r = i / n;
      const draw = createRandomizer(makeDeps({ random: () => r }))('user');
      if (draw && draw.draw.kind === 'resurfacing') {
        strata.push(draw.draw.stratum);
        sittings.push(draw.draw.snippetId.replace(/\d+$/, ''));
      }
    }
    return { strata, sittings };
  }

  it('splits the draw evenly across bands that hold 76 and 3 — a flat draw never reaches the 3', () => {
    writeSitting('longform', '2020-03-14T00:00:00.000Z');
    for (let i = 0; i < 76; i++) writeSnippet(`deep${i}`, 'longform', `Deep ${i}.`);
    writeSitting('recentish', daysAgo(5));
    for (let i = 0; i < 3; i++) writeSnippet(`new${i}`, 'recentish', `New ${i}.`);

    const { strata } = sweep(20);

    // Two bands, so a uniform band pick gives each exactly half the sweep.
    // Flat over the 79 snippets gives the thin band 3/79 of it, and with this
    // rng sequence that rounds to none at all.
    expect(strata.filter((s) => s === 'recent')).toHaveLength(10);
    expect(strata.filter((s) => s === 'deep')).toHaveLength(10);
  });

  it('splits a band evenly across its sittings, so one long document cannot own it', () => {
    // Both sittings are deep, so the band pick cannot be what separates them.
    writeSitting('longform', '2020-03-14T00:00:00.000Z');
    for (let i = 0; i < 76; i++) writeSnippet(`deep${i}`, 'longform', `Deep ${i}.`);
    writeSitting('letter', '2019-06-01T00:00:00.000Z');
    writeSnippet('one0', 'letter', 'The only thing written that year.');

    const { strata, sittings } = sweep(20);

    expect(new Set(strata)).toEqual(new Set(['deep']));
    // One sitting of 76 against one sitting of 1. Uniform over sittings gives
    // the single snippet half the draws; uniform over the band's 77 snippets
    // would give it one in seventy-seven.
    expect(sittings.filter((s) => s === 'one')).toHaveLength(10);
    expect(sittings.filter((s) => s === 'deep')).toHaveLength(10);
  });
});

// ── The log (Q-23) ──

describe('logging', () => {
  it('writes one license line and one draw line per shuffle', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);

    createRandomizer(makeDeps({ deckDir: dir }))('user');

    const kinds = readEvents(root).map((e) => e.kind);
    expect(kinds).toContain('randomizer-license');
    expect(kinds).toContain('randomizer-drawn');

    const drawn = readEvents(root).find((e) => e.kind === 'randomizer-drawn')!;
    expect(drawn.detail).toContain('channel=deck');
    expect(drawn.detail).toContain('deck=shipped');
    expect(drawn.refs).toEqual(['deck:shipped:77']);

    const licensed = readEvents(root).find((e) => e.kind === 'randomizer-license')!;
    expect(licensed.detail).toContain('invokedBy=user');
    expect(licensed.detail).toContain('grounds=none');
    expect(licensed.detail).toContain('live=false');
  });

  it('logs the license even when nothing is drawn — the shadow record is the point', () => {
    createRandomizer(makeDeps())('system');

    expect(readEvents(root).map((e) => e.kind)).toContain('randomizer-license');
  });
});

// ── Q-18 as a structural constraint ──

describe('the randomizer cannot invent (Q-18)', () => {
  it('takes no model', () => {
    const noModel: Complete = async () => '';

    // @ts-expect-error — `createRandomizer` has one parameter and its type has
    // no model handle anywhere in it. That absence IS the contract (Q-18).
    createRandomizer(makeDeps(), noModel);
  });

  const MODULE_FILES = [
    'src/randomizer/randomizer.ts',
    'src/randomizer/decks.ts',
    'src/randomizer/strata.ts',
    'src/randomizer/license.ts',
    'src/randomizer/thresholds.ts',
  ];

  it('imports nothing that can reach a model', () => {
    for (const f of MODULE_FILES) {
      const src = readFileSync(f, 'utf-8');
      const imports = [...src.matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(
          /llm|fake-responder|clerk|elicitor|protocols|harvester/.test(spec),
          `${f} imports ${spec}`,
        ).toBe(false);
      }
    }
  });

  it('names no model-calling identifier anywhere in its source', () => {
    // The grep `src/wiki/lint.ts` invites, made a test rather than a habit.
    // `Complete` is the only way to reach a model in this tree; `temperature`
    // and `systemPrompt` are the words that appear where one is being called.
    for (const f of MODULE_FILES) {
      const src = readFileSync(f, 'utf-8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['Complete', 'temperature', 'systemPrompt', 'openai', 'chat(']) {
        expect(code.includes(forbidden), `${f} names ${forbidden}`).toBe(false);
      }
    }
  });

  it('every threshold carries the evidence that would let it act', () => {
    for (const t of Object.values(RANDOMIZER_THRESHOLDS)) {
      expect(t.graduatesWhen.length, t.name).toBeGreaterThan(40);
    }
  });
});

// ── Reaching a sitting ──

describe('the draw reaches a sitting', () => {
  function fakes(queueDraw: QueueEntry | null) {
    const turns: Turn[] = [];
    const drawCalls: string[] = [];
    const vault = {
      saveSnippet: () => { throw new Error('unexpected'); },
      saveVersion: () => { throw new Error('unexpected'); },
      saveReading: () => { throw new Error('unexpected'); },
      saveBud: () => { throw new Error('unexpected'); },
      rebuildIndex: () => ({ snippets: {}, readings: {}, buds: {} }),
      startTranscript: () => {},
      appendTurn: (_s: string, t: Turn) => { turns.push(t); },
    } satisfies Vault;
    const queue: QueueStore = {
      add: () => { throw new Error('unexpected'); },
      list: () => [],
      get: () => undefined,
      draw: () => { drawCalls.push('queue'); return queueDraw; },
      markAsked: () => {},
      markAnswered: () => {},
      markPending: () => { },
      defer: () => {},
      park: () => {},
      unpark: () => {},
      expire: () => 0,
      expireTailBeyond: () => 0,
      markExpired: () => {},
        recordReplyDisengagement: () => false,
    noteSittingStarted: () => {},
    };
    return { turns, drawCalls, vault, queue };
  }

  const deckDraw: RandomizerDraw = {
    question: 'What did you avoid?',
    questionForm: 'deliberative',
    provenance: 'deck',
    draw: { kind: 'deck', deck: 'shipped', channel: 'somewhere', blockId: 77 },
    targetFacet: 'construct',
  };

  const mode = { target: 'self' as const };
  const complete = async () => '';
  const index = {} as LexicalIndex;

  it('opens with the shuffle the person asked for, ahead of the queue (Q-16)', () => {
    const f = fakes(entry({ id: 'queued', status: 'pending', question: 'Queued question?' }));
    const invoked: string[] = [];

    const s = startSession(mode, {
      complete,
      vault: f.vault,
      queue: f.queue,
      index,
      protocolName: 'reflective',
      shuffleRequested: true,
      randomizer: (by) => { invoked.push(by); return deckDraw; },
    });

    expect(s.turns[0]!.text).toBe('What did you avoid?');
    expect(invoked).toEqual(['user']);
    // The person asked for a shuffle. Nothing consulted the queue at all.
    expect(f.drawCalls).toEqual([]);
    // No queue entry is on the table, so nothing gets marked answered later.
    expect('openQueueEntryId' in s).toBe(false);
  });

  it('carries the deck card\'s source onto the opening turn', () => {
    const f = fakes(null);

    startSession(mode, {
      complete, vault: f.vault, queue: f.queue, index, protocolName: 'reflective',
      shuffleRequested: true,
      randomizer: () => deckDraw,
    });

    expect(f.turns[0]!.questionSource).toEqual({ channel: 'somewhere', blockId: 77 });
  });

  it('gives a resurfaced snippet no are.na source, because it has none', () => {
    const f = fakes(null);

    startSession(mode, {
      complete, vault: f.vault, queue: f.queue, index, protocolName: 'reflective',
      shuffleRequested: true,
      randomizer: () => ({
        question: 'You wrote this on 2020-03-14:\n\n"Old words."\n\nWhat do you make of it now?',
        questionForm: 'deliberative',
        provenance: 'resurfacing',
        draw: {
          kind: 'resurfacing', snippetId: 's1', version: 1, stratum: 'deep',
          wroteAt: '2020-03-14T00:00:00.000Z',
        },
      }),
    });

    expect('questionSource' in f.turns[0]!).toBe(false);
  });

  it('lets the queue win when nobody asked to shuffle', () => {
    const f = fakes(entry({ id: 'queued', status: 'pending', question: 'Queued question?' }));
    const invoked: string[] = [];

    const s = startSession(mode, {
      complete, vault: f.vault, queue: f.queue, index, protocolName: 'reflective',
      randomizer: (by) => { invoked.push(by); return deckDraw; },
    });

    expect(s.turns[0]!.text).toBe('Queued question?');
    // Nothing was offered unasked, because the queue had something to say.
    expect(invoked).toEqual([]);
  });

  it('offers a shuffle unasked only where the queue came back empty', () => {
    const f = fakes(null);
    const invoked: string[] = [];

    const s = startSession(mode, {
      complete, vault: f.vault, queue: f.queue, index, protocolName: 'reflective',
      randomizer: (by) => { invoked.push(by); return deckDraw; },
    });

    expect(invoked).toEqual(['system']);
    expect(s.turns[0]!.text).toBe('What did you avoid?');
  });

  it('falls through to the bank when the unasked offer is declined', () => {
    const f = fakes(null);

    const s = startSession(mode, {
      complete, vault: f.vault, queue: f.queue, index, protocolName: 'reflective',
      bank: [{ text: 'A bank opener?', questionForm: 'deliberative' }],
      randomizer: () => null,
    });

    expect(s.turns[0]!.text).toBe('A bank opener?');
  });

  it('still opens normally when no randomizer is wired at all', () => {
    const f = fakes(null);

    const s = startSession(mode, {
      complete, vault: f.vault, queue: f.queue, index, protocolName: 'reflective',
      bank: [{ text: 'A bank opener?', questionForm: 'deliberative' }],
    });

    expect(s.turns[0]!.text).toBe('A bank opener?');
  });
});

// ── Facet type is carried, not guessed ──

describe('provenance', () => {
  it('carries the deck entry\'s curated Facet and never invents one', () => {
    const dir = join(root, 'decks-shipped');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'shipped.jsonl'),
      `${JSON.stringify({ question: 'No facet here?', channel: 'c', blockId: 5, deck: 'shipped', curatedBy: 't' })}\n`,
      'utf-8',
    );

    const draw = createRandomizer(makeDeps({ deckDir: dir }))('user')!;

    expect('targetFacet' in draw).toBe(false);
  });

  it('carries it when the curation assigned one', () => {
    const dir = join(root, 'decks-shipped');
    writeJsonlDeck(dir, 'shipped', [deckRow('What did you avoid?', 77)]);

    const draw = createRandomizer(makeDeps({ deckDir: dir }))('user')!;

    expect(draw.targetFacet).toBe<Facet>('construct');
  });
});
