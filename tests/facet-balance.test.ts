import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyFacetIntent,
  facetIntentForRedLight,
} from '../src/elicitor/facet-intent.js';
import {
  BLUEPRINT,
  applyFacetBalance,
  facetBalanceIsLive,
  facetDeficits,
  facetDistribution,
  formatDistribution,
  readVaultFacetDistribution,
  sessionBlueprint,
  underRepresented,
} from '../src/queue/facet-balance.js';
import {
  suggestTarget,
  recentSittingTargets,
  suggestTargetForVault,
} from '../src/elicitor/target-default.js';
import { deckQualityFailure, roundRobinByFacet } from '../scripts/curate-deck.js';
import type { Facet } from '../src/types.js';

// ── The deck classifier ───────────────────────────────────────────────────
//
// Every example below is a verbatim line from data/question-bank.curated.jsonl.

describe('classifyFacetIntent', () => {
  const cases: [string, Facet | null][] = [
    // Episode — a past particular, whatever grammar it arrives in
    ['what is the most hurtful insult you’ve been given?', 'episode'],
    ['how did you meet your best friend?', 'episode'],
    ['what was the last thing you lied about?', 'episode'],
    ['when have you lied to protect someone’s feelings?', 'episode'],
    ['what has been the best day of your life?', 'episode'],
    ['When was the last time you felt out of place?', 'episode'],

    // Lifetime period — an era beats a scene
    ['what do you remember about your childhood home?', 'lifetime-period'],
    ['What did you want to be as a kid?', 'lifetime-period'],
    ['what phase of your life taught you the most about yourself?', 'lifetime-period'],

    // General event — a habit beats a scene
    ['how often do you lie?', 'general-event'],
    ['Where do you typically go when you want to feel far away?', 'general-event'],

    // Causal theory — a why-question is the person's theory of themselves
    ['Why are we always so busy?', 'causal-theory'],
    ['What makes you the happiest?', 'causal-theory'],

    // Intention, value, fact, construct
    ['who do you want to reconnect with?', 'intention'],
    ['who’s opinion matters most to you?', 'value'],
    ['how do you prepare for guests?', 'fact'],
    ['how would you describe your personality?', 'construct'],
    ['What is the difference between the person you truly are and the person you tell yourself you are?', 'construct'],
  ];

  for (const [question, expected] of cases) {
    it(`reads "${question.slice(0, 52)}" as ${expected}`, () => {
      expect(classifyFacetIntent(question)).toBe(expected);
    });
  }

  it('returns null rather than guessing when no rule matches', () => {
    expect(classifyFacetIntent('If you were a potato, how would you be prepared?')).toBeNull();
    expect(classifyFacetIntent('')).toBeNull();
    expect(classifyFacetIntent('   ')).toBeNull();
  });

  // The bug this module exists to kill: the old curation required the literal
  // word "you", which is a second-person-grammar filter wearing a quality
  // filter's clothes (ticket 042).
  it('classifies questions that never say "you"', () => {
    expect(classifyFacetIntent('Why are we always so busy?')).toBe('causal-theory');
    expect(classifyFacetIntent('what happened when the money ran out?')).toBe('episode');
    expect(classifyFacetIntent('What makes a building come to be loved?')).toBe('construct');
  });

  it('reads typographic and straight apostrophes alike', () => {
    expect(classifyFacetIntent('what is the worst advice you’ve been given?')).toBe('episode');
    expect(classifyFacetIntent("what is the worst advice you've been given?")).toBe('episode');
  });

  it('does not read a second-person construct question as an episode', () => {
    expect(classifyFacetIntent('what does home mean to you?')).toBe('construct');
    expect(classifyFacetIntent('how would you define success?')).toBe('construct');
  });
});

describe('facetIntentForRedLight', () => {
  it('asks for the thing the light says is missing', () => {
    expect(facetIntentForRedLight('abstraction-no-episode')).toBe('episode');
    expect(facetIntentForRedLight('cause-no-event')).toBe('episode');
    expect(facetIntentForRedLight('pole-no-contrast')).toBe('construct');
    expect(facetIntentForRedLight('odd-term')).toBe('construct');
    expect(facetIntentForRedLight('unexplored-referent')).toBe('fact');
  });
});

// ── Deck curation helpers ─────────────────────────────────────────────────

describe('deckQualityFailure', () => {
  it('accepts a single well-formed question', () => {
    expect(deckQualityFailure('what was the last thing you lied about?')).toBeNull();
  });

  it('rejects yes/no openers, multi-questions, junk, and length outliers', () => {
    expect(deckQualityFailure('Do you like coffee in the morning?')).toContain('weak form');
    expect(deckQualityFailure('what happened then? and after that?')).toBe('multiple questions');
    expect(deckQualityFailure('3. what happened when you left home?')).toContain('weak form');
    expect(deckQualityFailure('what now?')).toBe('too short');
    expect(deckQualityFailure('a statement with no question mark')).toBe('not a question');
    expect(deckQualityFailure(`what ${'word '.repeat(30)}happened?`)).toBe('too long');
  });
});

describe('roundRobinByFacet', () => {
  const entry = (targetFacet: Facet) => ({ targetFacet });

  it('gives scarce facets their turn before the largest one fills the deck', () => {
    const entries = [
      ...Array.from({ length: 10 }, () => entry('construct')),
      entry('fact'),
      entry('value'),
    ];
    const picked = roundRobinByFacet(entries, 4).map((i) => entries[i]!.targetFacet);
    expect(picked.filter((f) => f === 'construct')).toHaveLength(2);
    expect(picked).toContain('fact');
    expect(picked).toContain('value');
  });

  it('takes everything when the cap exceeds the pool', () => {
    const entries = [entry('episode'), entry('fact')];
    expect(roundRobinByFacet(entries, 99)).toEqual([0, 1]);
  });

  it('returns input-order indices', () => {
    const entries = [entry('construct'), entry('fact'), entry('construct')];
    expect(roundRobinByFacet(entries, 3)).toEqual([0, 1, 2]);
  });
});

// ── Distribution and blueprint ────────────────────────────────────────────

describe('facetDistribution', () => {
  it('counts readings by facet and zero-fills the rest', () => {
    const dist = facetDistribution([
      { facet: 'construct' },
      { facet: 'construct' },
      { facet: 'value' },
    ]);
    expect(dist.construct).toBe(2);
    expect(dist.value).toBe(1);
    expect(dist.episode).toBe(0);
  });
});

describe('underRepresented', () => {
  // The real vault, measured 2026-08-02.
  const measured = facetDistribution([
    ...Array.from({ length: 25 }, () => ({ facet: 'construct' as Facet })),
    { facet: 'lifetime-period' },
    { facet: 'lifetime-period' },
    { facet: 'value' },
    { facet: 'intention' },
  ]);

  it('names episode and fact as owed, and construct as not', () => {
    const owed = underRepresented(measured);
    expect(owed.has('episode')).toBe(true);
    expect(owed.has('fact')).toBe(true);
    expect(owed.has('general-event')).toBe(true);
    expect(owed.has('causal-theory')).toBe(true);
    expect(owed.has('construct')).toBe(false);
    expect(owed.has('lifetime-period')).toBe(false);
  });

  it('owes every facet on an empty corpus, so a new vault is unconstrained', () => {
    const owed = underRepresented(facetDistribution([]));
    expect(owed.size).toBe(Object.keys(BLUEPRINT).length);
  });

  it('ranks the largest deficit first', () => {
    expect(facetDeficits(measured)[0]!.facet).toBe('episode');
  });
});

describe('sessionBlueprint', () => {
  it('plans the slots a starved corpus needs, folding each pick back in', () => {
    const measured = facetDistribution(
      Array.from({ length: 25 }, () => ({ facet: 'construct' as Facet })),
    );
    const plan = sessionBlueprint(measured, 6);
    expect(plan).toHaveLength(6);
    expect(plan[0]).toBe('episode');
    // Folding each pick back in stops one starving facet claiming every slot.
    expect(new Set(plan).size).toBeGreaterThan(1);
  });

  it('spreads across facets when the corpus is already balanced', () => {
    const balanced = facetDistribution([
      ...Array.from({ length: 6 }, () => ({ facet: 'episode' as Facet })),
      ...Array.from({ length: 3 }, () => ({ facet: 'general-event' as Facet })),
      ...Array.from({ length: 3 }, () => ({ facet: 'fact' as Facet })),
      ...Array.from({ length: 3 }, () => ({ facet: 'construct' as Facet })),
      { facet: 'value' },
      { facet: 'value' },
      { facet: 'intention' },
      { facet: 'lifetime-period' },
      { facet: 'causal-theory' },
    ]);
    expect(new Set(sessionBlueprint(balanced, 6)).size).toBeGreaterThan(2);
  });
});

// ── The filter itself ─────────────────────────────────────────────────────

describe('applyFacetBalance', () => {
  const wanted = new Set<Facet>(['episode', 'fact']);

  it('keeps only what the corpus is owed', () => {
    const candidates = [
      { id: 'a', targetFacet: 'episode' as Facet },
      { id: 'b', targetFacet: 'construct' as Facet },
      { id: 'c', targetFacet: 'fact' as Facet },
    ];
    const result = applyFacetBalance(candidates, wanted);
    expect(result.applied).toBe(true);
    expect(result.kept.map((e) => e.id)).toEqual(['a', 'c']);
    expect(result.dropped.map((e) => e.id)).toEqual(['b']);
  });

  it('drops untagged entries rather than assuming a facet', () => {
    const candidates = [
      { id: 'a', targetFacet: 'episode' as Facet },
      { id: 'b' },
    ];
    expect(applyFacetBalance(candidates, wanted).kept.map((e) => e.id)).toEqual(['a']);
  });

  it('stands down when every facet is owed — a new vault is not unbalanced', () => {
    const candidates = [
      { id: 'a', targetFacet: 'episode' as Facet },
      { id: 'b' },
    ];
    const result = applyFacetBalance(candidates, underRepresented(facetDistribution([])));
    expect(result.applied).toBe(false);
    expect(result.kept).toHaveLength(2);
  });

  it('never empties the pool — an unsatisfiable filter stands down', () => {
    const candidates = [{ id: 'a', targetFacet: 'construct' as Facet }, { id: 'b' }];
    const result = applyFacetBalance(candidates, wanted);
    expect(result.applied).toBe(false);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('preserves candidate order, so the pick stays top-k', () => {
    const candidates = [
      { id: 'a', targetFacet: 'fact' as Facet },
      { id: 'b', targetFacet: 'construct' as Facet },
      { id: 'c', targetFacet: 'episode' as Facet },
    ];
    expect(applyFacetBalance(candidates, wanted).kept.map((e) => e.id)).toEqual(['a', 'c']);
  });
});

describe('facetBalanceIsLive', () => {
  it('is shadow unless the env says otherwise (Q-35)', () => {
    expect(facetBalanceIsLive({})).toBe(false);
    expect(facetBalanceIsLive({ ELICIT_FACET_BALANCE: 'shadow' })).toBe(false);
    expect(facetBalanceIsLive({ ELICIT_FACET_BALANCE: 'live' })).toBe(true);
  });
});

describe('formatDistribution', () => {
  it('renders only the facets the corpus has', () => {
    const dist = facetDistribution([{ facet: 'construct' }, { facet: 'construct' }]);
    expect(formatDistribution(dist)).toBe('construct:2');
    expect(formatDistribution(facetDistribution([]))).toBe('empty');
  });
});

// ── Reading the vault ─────────────────────────────────────────────────────

describe('readVaultFacetDistribution', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elicit-facet-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('is empty for a vault with no readings', () => {
    expect(readVaultFacetDistribution(root)).toEqual(facetDistribution([]));
  });

  it('counts facets from reading frontmatter', () => {
    const dir = join(root, 'wiki', 'readings');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.md'), '---\nfacet: construct\nstance: avowal\n---\nA reading.\n');
    writeFileSync(join(dir, 'b.md'), '---\nfacet: episode\nstance: avowal\n---\nAnother.\n');
    writeFileSync(join(dir, 'c.md'), '---\nfacet: construct\nstance: avowal\n---\nA third.\n');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');

    const dist = readVaultFacetDistribution(root);
    expect(dist.construct).toBe(2);
    expect(dist.episode).toBe(1);
    expect(dist.fact).toBe(0);
  });
});

// ── Corpus-aware target default ───────────────────────────────────────────

describe('suggestTarget', () => {
  it('offers domain after three consecutive inward sittings', () => {
    expect(suggestTarget(['self', 'self', 'self'])).toBe('domain');
    expect(suggestTarget(['self', 'self', 'self', 'domain'])).toBe('domain');
  });

  it('keeps self while the run is unbroken but short', () => {
    expect(suggestTarget([])).toBe('self');
    expect(suggestTarget(['self'])).toBe('self');
    expect(suggestTarget(['self', 'self'])).toBe('self');
  });

  it('resets as soon as a domain sitting appears in the run', () => {
    expect(suggestTarget(['domain', 'self', 'self'])).toBe('self');
    expect(suggestTarget(['self', 'domain', 'self'])).toBe('self');
  });
});

describe('recentSittingTargets', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'elicit-target-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeSitting(id: string, target?: string): void {
    const dir = join(root, 'transcripts');
    mkdirSync(dir, { recursive: true });
    const targetLine = target === undefined ? '' : `\n    target: ${target}`;
    writeFileSync(
      join(dir, `${id}.md`),
      `---\nsession: ${id}\nmode:\n    minutes: 15\n    energy: medium${targetLine}\nprotocol: sounding\n---\n\n## agent\n\nHello?\n`,
    );
  }

  it('is empty for a vault with no transcripts', () => {
    expect(recentSittingTargets(root)).toEqual([]);
    expect(suggestTargetForVault(root)).toEqual({ target: 'self', recent: [] });
  });

  it('returns the newest sittings first — ULID filenames are time order', () => {
    writeSitting('01AAAAAAAAAAAAAAAAAAAAAAAA', 'self');
    writeSitting('01BBBBBBBBBBBBBBBBBBBBBBBB', 'domain');
    writeSitting('01CCCCCCCCCCCCCCCCCCCCCCCC', 'self');
    expect(recentSittingTargets(root)).toEqual(['self', 'domain', 'self']);
  });

  it('counts a transcript with no target as self — that is what it was', () => {
    writeSitting('01AAAAAAAAAAAAAAAAAAAAAAAA');
    writeSitting('01BBBBBBBBBBBBBBBBBBBBBBBB');
    writeSitting('01CCCCCCCCCCCCCCCCCCCCCCCC');
    expect(suggestTargetForVault(root).target).toBe('domain');
  });

  it('looks no further back than the run limit', () => {
    writeSitting('01AAAAAAAAAAAAAAAAAAAAAAAA', 'domain');
    writeSitting('01BBBBBBBBBBBBBBBBBBBBBBBB', 'self');
    writeSitting('01CCCCCCCCCCCCCCCCCCCCCCCC', 'self');
    writeSitting('01DDDDDDDDDDDDDDDDDDDDDDDD', 'self');
    expect(recentSittingTargets(root)).toHaveLength(3);
    expect(suggestTargetForVault(root).target).toBe('domain');
  });
});
