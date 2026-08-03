import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lint, type ThresholdRegister } from '../src/wiki/lint.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { Claim, ClaimGraph, LogFn, Referent } from '../src/wiki/contract.js';
import type { Complete, Facet, Snippet } from '../src/types.js';

const root = join(import.meta.dirname, '..');

/**
 * The lint's tests have one job beyond checking seven findings: they must fail
 * if the module ever grows the power to act. Three of them are about absence —
 * no fourth parameter, no mutation of the graph, no memory between calls — and
 * absence is the only part of a module a later reader cannot see by reading it.
 *
 * The god-node and merge-candidate tests each run TWICE over the same graph:
 * once against the shipped register, where the threshold is shadowed and the
 * finding must not come back, and once against a register whose entry is
 * flipped live. Without the second run, "returned nothing" is equally
 * consistent with "the mechanism is broken", and the shadow proves nothing.
 */

type Event = { at: string; actor: 'clerk'; kind: string; detail: string; refs?: string[] };

function collector(): { events: Event[]; log: LogFn } {
  const events: Event[] = [];
  return { events, log: (e) => void events.push(e) };
}

const NOW = '2026-08-02T10:00:00.000Z';

function claim(id: string, over: Partial<Claim> = {}): Claim {
  return {
    id,
    body: `The user does ${id}.`,
    range: 'in the mornings, since 2024',
    status: 'unconfirmed',
    cites: ['snipA@1'],
    facet: 'construct',
    referents: [],
    fromReadings: [`read-${id}`],
    attested: false,
    readLog: [],
    model: 'test-model',
    modelAt: NOW,
    created: NOW,
    updated: NOW,
    ...over,
  };
}

function snippet(id: string, version: number): Snippet {
  return {
    id,
    version,
    captured: NOW,
    provenance: { kind: 'harvest', session: 'sess-1', question: 'Q?', questionForm: 'deliberative' },
    prose: `verbatim words of ${id} at v${version}`,
  };
}

function referent(slug: string, canonical: string): Referent {
  return {
    slug,
    canonical,
    kind: 'person',
    aliases: [],
    model: 'test-model',
    modelAt: NOW,
    created: NOW,
    updated: NOW,
  };
}

function graphOf(over: Partial<ClaimGraph> = {}): ClaimGraph {
  return {
    claims: [],
    snippets: {},
    readings: {},
    contradictions: [],
    referents: [],
    ...over,
  };
}

// The shipped register with one entry graduated. Flipping the boolean is the
// whole of graduation (Q-35), so a test can do it and nothing else changes —
// which is only true because `lint` takes the register by its keys and not as
// `typeof THRESHOLDS`, where `live` is the literal `false` and unflippable.
const GOD_NODE_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'lint.godNodeFanout': { ...THRESHOLDS['lint.godNodeFanout'], live: true },
};
const MERGE_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'registry.mergeCandidateSimilarity': {
    ...THRESHOLDS['registry.mergeCandidateSimilarity'],
    live: true,
  },
};
const DISCRIMINATED_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'lint.undiscriminatedRangeSimilarity': {
    ...THRESHOLDS['lint.undiscriminatedRangeSimilarity'],
    live: true,
  },
};
const OCCASIONLESS_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'lint.occasionlessRange': { ...THRESHOLDS['lint.occasionlessRange'], live: true },
};
const WEAK_LIVE: ThresholdRegister = {
  ...THRESHOLDS,
  'lint.weakEvidenceDangler': { ...THRESHOLDS['lint.weakEvidenceDangler'], live: true },
};

describe('stale-citation (Q-31, Q-5)', () => {
  it('flags a claim citing @1 when the snippet is at @2, naming the claim as subject', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@1'] })],
      snippets: { snipA: snippet('snipA', 2) },
    });
    const { log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('stale-citation');
    // B8: the subject is the claim id and nothing else, because T12's dedupe
    // has no other way to attribute the still-true question it mints.
    expect(findings[0]!.subject).toBe('c1');
    expect(findings[0]!.refs).toContain('snipA@1');
  });

  it('does NOT flag a claim citing the latest version', () => {
    // The guard against the failure mode that makes this finding worthless:
    // `snippets` holds only the latest version of each id, so a key lookup
    // would flag every claim in the vault.
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@2'] })],
      snippets: { snipA: snippet('snipA', 2) },
    });
    const { log } = collector();

    expect(lint(g, THRESHOLDS, log)).toEqual([]);
  });

  it('flags a claim once when several of its cites are stale', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@1', 'snipB@1', 'snipC@3'] })],
      snippets: { snipA: snippet('snipA', 2), snipB: snippet('snipB', 4), snipC: snippet('snipC', 3) },
    });
    const { log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.refs).toEqual(expect.arrayContaining(['snipA@1', 'snipB@1']));
    expect(findings[0]!.refs).not.toContain('snipC@3');
  });

  it('returns the same finding again on an identical second call', () => {
    // `lint` has no memory and no queue: it cannot know a question is already
    // waiting, so it repeats the finding by design and T12 dedupes (B8).
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@1'] })],
      snippets: { snipA: snippet('snipA', 2) },
    });
    const { log } = collector();

    expect(lint(g, THRESHOLDS, log)).toEqual(lint(g, THRESHOLDS, log));
    expect(lint(g, THRESHOLDS, log)).toHaveLength(1);
  });

  it('leaves an archived or superseded claim alone', () => {
    // Both have already been dealt with. A still-true question about a claim
    // the graph has replaced asks the user about a sentence nobody holds.
    const g = graphOf({
      claims: [
        claim('c1', { cites: ['snipA@1'], archived: true, archiveReason: 'wrong' }),
        claim('c2', { cites: ['snipA@1'], supersededBy: 'c3', supersedeReason: 'model-upgrade' }),
      ],
      snippets: { snipA: snippet('snipA', 2) },
    });
    const { log } = collector();

    expect(lint(g, THRESHOLDS, log)).toEqual([]);
  });

  it('reads the grace period from the register and reports one it cannot honor', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@1'] })],
      snippets: { snipA: snippet('snipA', 2) },
    });
    const withGrace = {
      ...THRESHOLDS,
      'lint.staleCitationAgeDays': { ...THRESHOLDS['lint.staleCitationAgeDays'], value: 7 },
    };
    const { events, log } = collector();

    const findings = lint(g, withGrace, log);

    // A pure function has no clock, so a non-zero grace cannot be applied.
    // It is reported rather than rounded to zero in silence.
    expect(findings).toHaveLength(1);
    const unhonored = events.filter((e) => e.kind === 'lint-threshold-unhonored');
    expect(unhonored).toHaveLength(1);
    expect(unhonored[0]!.detail).toContain('lint.staleCitationAgeDays');
    expect(unhonored[0]!.detail).toContain('7');
  });

  it('emits nothing at all if the stale threshold is ever demoted to shadow', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@1'] })],
      snippets: { snipA: snippet('snipA', 2) },
    });
    const demoted = {
      ...THRESHOLDS,
      'lint.staleCitationAgeDays': { ...THRESHOLDS['lint.staleCitationAgeDays'], live: false },
    };
    const { events, log } = collector();

    expect(lint(g, demoted, log)).toEqual([]);
    expect(events.some((e) => e.kind === 'shadow-decision')).toBe(true);
  });
});

describe('orphan-claim (Q-5: re-versioning orphans nothing)', () => {
  it('does NOT call a claim an orphan because its cites were re-versioned', () => {
    // The whole point of the finding. Reading "all cites superseded" as
    // orphaning would make every long-lived claim an orphan.
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@1', 'snipB@1'] })],
      snippets: { snipA: snippet('snipA', 3), snipB: snippet('snipB', 2) },
    });
    const { log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings.map((f) => f.kind)).toEqual(['stale-citation']);
  });

  it('flags a claim whose every cite names a snippet id that is gone', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['gone@1', 'alsoGone@2'] })],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('orphan-claim');
    expect(findings[0]!.subject).toBe('c1');
  });

  it('does not flag a claim with one dead cite and one that resolves', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['gone@1', 'snipA@1'] })],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { log } = collector();

    expect(lint(g, THRESHOLDS, log)).toEqual([]);
  });

  it('treats a cite to a version that does not exist yet as dead, not stale', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@9'] })],
      snippets: { snipA: snippet('snipA', 2) },
    });
    const { log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings.map((f) => f.kind)).toEqual(['orphan-claim']);
  });

  it('never archives what it flags, and never touches the graph', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['gone@1'] })],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const before = structuredClone(g);
    const { log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings[0]!.kind).toBe('orphan-claim');
    expect(g.claims[0]!.archived).toBeUndefined();
    // Q-31 as an assertion: the lint adds and annotates. Anything it changed
    // about the input would show up here.
    expect(g).toEqual(before);
  });
});

describe('god-node-referent (Q-35: shadowed)', () => {
  function fatReferent(slug: string, n: number): ClaimGraph {
    return graphOf({
      // Distinct per-claim ranges: the claims share a referent, so a shared
      // range would trip the (shadowed) undiscriminated-range mechanism and
      // pollute the event assertions below. 'occasion of c<i>' names an
      // occasion and keeps every pairwise similarity at 0.5 — under the 0.75
      // bar, so it trips neither shadow mechanism.
      claims: Array.from({ length: n }, (_, i) =>
        claim(`c${i}`, { referents: [slug], range: `occasion of c${i}`, cites: ['snipA@1'] }),
      ),
      snippets: { snipA: snippet('snipA', 1) },
    });
  }

  const fanout = THRESHOLDS['lint.godNodeFanout'].value;

  it('logs what it would flag and returns nothing while the threshold is shadowed', () => {
    const g = fatReferent('archie', fanout + 1);
    const { events, log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings).toEqual([]);
    const shadow = events.filter((e) => e.kind === 'shadow-decision');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.detail).toContain('lint.godNodeFanout');
    expect(shadow[0]!.detail).toContain('archie');
    expect(shadow[0]!.actor).toBe('clerk');
  });

  it('returns the finding on the SAME graph once the threshold is live', () => {
    // Half two of the shadow proof: the mechanism does fire, and it is the
    // register alone that withholds it.
    const g = fatReferent('archie', fanout + 1);
    const { log } = collector();

    const findings = lint(g, GOD_NODE_LIVE, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('god-node-referent');
    expect(findings[0]!.subject).toBe('archie');
    expect(findings[0]!.refs).toHaveLength(fanout + 1);
  });

  it('says nothing about a referent exactly at the fanout', () => {
    const g = fatReferent('janastu', fanout);
    const { events, log } = collector();

    expect(lint(g, GOD_NODE_LIVE, log)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('counts only live claims towards the fanout', () => {
    const g = fatReferent('iiif', fanout + 2);
    g.claims[0]!.archived = true;
    g.claims[0]!.archiveReason = 'merged-into:c1';
    g.claims[1]!.supersededBy = 'c99';
    g.claims[1]!.supersedeReason = 'model-upgrade';
    const { log } = collector();

    expect(lint(g, GOD_NODE_LIVE, log)).toEqual([]);
  });

  it('counts a claim naming two referents towards both, and ignores a claim with no referents', () => {
    const g = graphOf({
      claims: [
        ...Array.from({ length: fanout + 1 }, (_, i) =>
          claim(`c${i}`, { referents: ['archie', 'janastu'], cites: ['snipA@1'] }),
        ),
        // Names no node — contributes to no fan-out count.
        claim('c-no-refs', { cites: ['snipA@1'] }),
      ],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { log } = collector();

    const findings = lint(g, GOD_NODE_LIVE, log);

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.subject)).toEqual(['archie', 'janastu']);
    for (const f of findings) expect(f.refs).toHaveLength(fanout + 1);
  });
});

describe('merge-candidate (Q-32, Q-35: shadowed)', () => {
  const reordered = graphOf({
    referents: [referent('sarah-kim', 'Sarah Kim'), referent('kim-sarah', 'kim, SARAH')],
  });

  it('logs a pair naming both slugs and returns nothing while shadowed', () => {
    const { events, log } = collector();

    const findings = lint(reordered, THRESHOLDS, log);

    expect(findings).toEqual([]);
    const shadow = events.filter((e) => e.kind === 'shadow-decision');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.detail).toContain('sarah-kim');
    expect(shadow[0]!.detail).toContain('kim-sarah');
  });

  it('notes BOTH entries once the threshold is live', () => {
    const { log } = collector();

    const findings = lint(reordered, MERGE_LIVE, log);

    // Q-32: a note on each entry, and no merge anywhere. Only user
    // attestation ever executes one, in a later slice and another module.
    expect(findings.map((f) => f.subject)).toEqual(['kim-sarah', 'sarah-kim']);
    expect(findings.every((f) => f.kind === 'merge-candidate')).toBe(true);
    expect(findings[0]!.refs).toEqual(expect.arrayContaining(['sarah-kim', 'kim-sarah']));
  });

  it('leaves unrelated names alone', () => {
    const g = graphOf({
      referents: [referent('sarah-kim', 'Sarah Kim'), referent('dad', 'Dad')],
    });
    const { events, log } = collector();

    expect(lint(g, MERGE_LIVE, log)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('leaves a partial name overlap alone at the shipped similarity', () => {
    // "Sarah" and "Sarah Kim" share one token of two: below 0.85, and
    // deliberately so — deciding they are the same person is inference, and
    // Q-32 keeps inference out of identity.
    const g = graphOf({
      referents: [referent('sarah-kim', 'Sarah Kim'), referent('sarah', 'Sarah')],
    });
    const { log } = collector();

    expect(lint(g, MERGE_LIVE, log)).toEqual([]);
  });

  it('mutates no referent', () => {
    const before = structuredClone(reordered);
    const { log } = collector();

    lint(reordered, MERGE_LIVE, log);

    expect(reordered).toEqual(before);
  });
});

describe('undiscriminated-range (ticket 060, Q-35: shadowed)', () => {
  // Two claims on one referent whose RANGE strings are identical — the
  // default fixture range, so both claims score 1.0 under the normalized
  // token overlap. The snippets entry exists only so no other finding fires.
  const sameRange = graphOf({
    claims: [
      claim('c1', { referents: ['bedtime-work'] }),
      claim('c2', { referents: ['bedtime-work'] }),
    ],
    snippets: { snipA: snippet('snipA', 1) },
  });

  it('logs the pair and returns nothing while the threshold is shadowed', () => {
    const { events, log } = collector();

    const findings = lint(sameRange, THRESHOLDS, log);

    expect(findings).toEqual([]);
    const shadow = events.filter((e) => e.kind === 'shadow-decision');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.detail).toContain('lint.undiscriminatedRangeSimilarity');
    expect(shadow[0]!.detail).toContain('c1');
    expect(shadow[0]!.detail).toContain('c2');
    expect(shadow[0]!.detail).toContain('bedtime-work');
    expect(shadow[0]!.actor).toBe('clerk');
  });

  it('returns exactly one finding on the SAME graph once the threshold is live', () => {
    // Half two of the shadow proof: the mechanism does fire, and it is the
    // register alone that withholds it.
    const { log } = collector();

    const findings = lint(sameRange, DISCRIMINATED_LIVE, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('undiscriminated-range');
    expect(findings[0]!.subject).toBe('bedtime-work');
    expect(findings[0]!.refs).toEqual(['c1', 'c2']);
  });

  it('orders the refs by claim id regardless of graph order', () => {
    // The sorted pair is the caller's dedupe key (Q-31), so it must come
    // out sorted even when the graph hands the claims the other way round.
    const g = graphOf({
      claims: [
        claim('c9', { referents: ['commute'], range: 'at the office' }),
        claim('c2', { referents: ['commute'], range: 'at the office' }),
      ],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { log } = collector();

    const findings = lint(g, DISCRIMINATED_LIVE, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.refs).toEqual(['c2', 'c9']);
  });

  it('leaves clearly different ranges alone, with no shadow record either', () => {
    // 'at work' vs 'with my kids': zero shared tokens. The similarity check
    // runs before shadowDecision, so not even a shadow line is left behind.
    const g = graphOf({
      claims: [
        claim('c1', { referents: ['parenting'], range: 'at work' }),
        claim('c2', { referents: ['parenting'], range: 'with my kids' }),
      ],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { events, log } = collector();

    expect(lint(g, DISCRIMINATED_LIVE, log)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('leaves a below-threshold overlap alone, with no shadow record either', () => {
    // 'at work' vs 'at work mostly' shares two of three tokens (≈0.667) and
    // 'in the mornings' vs 'in the evenings' two of four (0.5): both under
    // the 0.75 bar, so neither pair even reaches the shadow record.
    const partial = graphOf({
      claims: [
        claim('c1', { referents: ['commute'], range: 'at work' }),
        claim('c2', { referents: ['commute'], range: 'at work mostly' }),
      ],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const functionWords = graphOf({
      claims: [
        claim('c1', { referents: ['sleep'], range: 'in the mornings' }),
        claim('c2', { referents: ['sleep'], range: 'in the evenings' }),
      ],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { events: e1, log: l1 } = collector();
    const { events: e2, log: l2 } = collector();

    expect(lint(partial, DISCRIMINATED_LIVE, l1)).toEqual([]);
    expect(lint(functionWords, DISCRIMINATED_LIVE, l2)).toEqual([]);
    expect(e1).toEqual([]);
    expect(e2).toEqual([]);
  });

  it('leaves a pair alone when one claim is archived or superseded', () => {
    // Both have already been dealt with; the range sameness of a claim the
    // graph no longer asserts asks nobody anything.
    const g = graphOf({
      claims: [
        claim('c1', {
          referents: ['bedtime-work'],
          archived: true,
          archiveReason: 'wrong',
        }),
        claim('c2', { referents: ['bedtime-work'], supersededBy: 'c3', supersedeReason: 'model-upgrade' }),
      ],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { events, log } = collector();

    expect(lint(g, DISCRIMINATED_LIVE, log)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('leaves identical ranges alone when the claims share no referent', () => {
    // Sameness of range is only a signal about a boundary nobody drew on a
    // THING both claims name. No shared referent, no finding.
    const g = graphOf({
      claims: [
        claim('c1', { referents: ['work'] }),
        claim('c2', { referents: ['home'] }),
      ],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { events, log } = collector();

    expect(lint(g, DISCRIMINATED_LIVE, log)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('mutates no claim', () => {
    const before = structuredClone(sameRange);
    const { log } = collector();

    lint(sameRange, DISCRIMINATED_LIVE, log);

    expect(sameRange).toEqual(before);
  });
});

describe('occasionless-range (ticket 087, Q-35: shadowed)', () => {
  it('flags a range that names no occasion, naming the claim as subject', () => {
    const g = graphOf({
      claims: [claim('c1', { range: 'generally', cites: ['snipA@1'] })],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { log } = collector();

    const findings = lint(g, OCCASIONLESS_LIVE, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'occasionless-range',
      subject: 'c1',
      refs: ['c1'],
    });
  });

  it('flags the measured classes: the general adverbs and the over-broad lifetime', () => {
    // RESULTS 16.2 counted `generally` x7 and `in general`; the 085 review
    // met `throughout their life` in the wild; `currently` and `previously`
    // are the same class — a time adverb with no occasion attached.
    for (const range of ['in general', 'throughout their life', 'currently', 'previously', 'early on']) {
      const { log } = collector();
      const findings = lint(
        graphOf({ claims: [claim('c1', { range, cites: ['snipA@1'] })], snippets: { snipA: snippet('snipA', 1) } }),
        OCCASIONLESS_LIVE,
        log
      );
      expect(findings.some((f) => f.kind === 'occasionless-range'), range).toBe(true);
    }
  });

  it('leaves a range that names an occasion alone', () => {
    for (const range of [
      'at work',
      'when working with cheap devices',
      'during their capstone project',
      'in 2021',
      "when describing the programme's objective",
      'in the mornings, since 2024',
    ]) {
      const { log } = collector();
      const findings = lint(
        graphOf({ claims: [claim('c1', { range, cites: ['snipA@1'] })], snippets: { snipA: snippet('snipA', 1) } }),
        OCCASIONLESS_LIVE,
        log
      );
      expect(findings.some((f) => f.kind === 'occasionless-range'), range).toBe(false);
    }
  });

  it('is shadowed in the shipped register: computed and logged, never returned', () => {
    const g = graphOf({
      claims: [claim('c1', { range: 'generally', cites: ['snipA@1'] })],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { events, log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings.some((f) => f.kind === 'occasionless-range')).toBe(false);
    expect(
      events.some((e) => e.kind === 'shadow-decision' && e.detail.includes('occasionless-range'))
    ).toBe(true);
  });
});

describe('weak-evidence (ticket 087, Q-35: shadowed)', () => {
  // One of the 96 labelled danglers (docs/dangler-labels-2026-08-02.md).
  const D = '01KZ0WPJ2KYCBVJZRV0CCETZGG';

  it('flags a claim whose only cite is a labelled dangler', () => {
    const g = graphOf({ claims: [claim('c1', { cites: [`${D}@1`] })] });
    const { log } = collector();

    const findings = lint(g, WEAK_LIVE, log);

    const weak = findings.find((f) => f.kind === 'weak-evidence');
    expect(weak).toMatchObject({ subject: 'c1', refs: ['c1', `${D}@1`] });
  });

  it('does not flag a claim with more than one cite, even when one is a dangler', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: [`${D}@1`, 'snipA@1'] })],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { log } = collector();

    expect(lint(g, WEAK_LIVE, log).some((f) => f.kind === 'weak-evidence')).toBe(false);
  });

  it('does not flag a claim whose only cite is not a labelled dangler', () => {
    const g = graphOf({
      claims: [claim('c1', { cites: ['snipA@1'] })],
      snippets: { snipA: snippet('snipA', 1) },
    });
    const { log } = collector();

    expect(lint(g, WEAK_LIVE, log).some((f) => f.kind === 'weak-evidence')).toBe(false);
  });

  it('is shadowed in the shipped register: computed and logged, never returned', () => {
    const g = graphOf({ claims: [claim('c1', { cites: [`${D}@1`] })] });
    const { events, log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings.some((f) => f.kind === 'weak-evidence')).toBe(false);
    expect(
      events.some((e) => e.kind === 'shadow-decision' && e.detail.includes('weak-evidence'))
    ).toBe(true);
  });
});

describe('the 074 dangler set the weak-evidence finding keys on (conformance)', () => {
  // The code-side set is private; the conformance check runs the MECHANISM.
  // A claim whose only cite is a doc-labelled dangler is flagged once the
  // register flips live, and a claim citing a doc-"no" snippet is not. The
  // doc table (docs/dangler-labels-2026-08-02.md) is the labelled ground
  // truth: 96 yes rows, 43 no rows, 139 snippets.
  const doc = readFileSync(join(root, 'docs/dangler-labels-2026-08-02.md'), 'utf-8');
  const rows = doc
    .split('\n')
    .filter((l) => l.trimStart().startsWith('|'))
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter(
      (cells): cells is string[] =>
        cells.length >= 5 && (cells[2] === 'yes' || cells[2] === 'no')
    )
    .map((cells) => ({ id: cells[1] ?? '', dangles: cells[2] as 'yes' | 'no' }));

  it('the doc parses to the labelled population', () => {
    expect(rows).toHaveLength(139);
    expect(rows.filter((r) => r.dangles === 'yes')).toHaveLength(96);
    expect(rows.filter((r) => r.dangles === 'no')).toHaveLength(43);
  });

  it('flags exactly the doc-labelled danglers when the finding is live', () => {
    for (const row of rows) {
      const { log } = collector();
      const findings = lint(
        graphOf({ claims: [claim(`c-${row.id}`, { cites: [`${row.id}@1`] })] }),
        WEAK_LIVE,
        log
      );
      const weak = findings.filter((f) => f.kind === 'weak-evidence');
      expect(weak.length, `${row.id} labelled ${row.dangles}`).toBe(
        row.dangles === 'yes' ? 1 : 0
      );
    }
  });
});

describe('the shape of the module (Q-31)', () => {
  // g0 and g1 share a referent under identical (default) range strings: they
  // trip the fifth finding when its register entry is flipped live, and stay
  // shadowed — computed and logged, not returned — in the shipped register.
  const mixed = graphOf({
    claims: [
      ...Array.from({ length: 13 }, (_, i) =>
        claim(`g${i}`, { facet: 'construct', cites: ['snipA@1'], referents: i < 2 ? ['work-life'] : [] }),
      ),
      claim('stale', { facet: 'fact', cites: ['snipB@1'] }),
      claim('orphan', { facet: 'value', cites: ['gone@1'] }),
    ],
    snippets: { snipA: snippet('snipA', 1), snipB: snippet('snipB', 4) },
    referents: [referent('sarah-kim', 'Sarah Kim'), referent('kim-sarah', 'kim, SARAH')],
  });

  it('is deterministic: two calls on one graph return deeply equal findings in one order', () => {
    const { log } = collector();

    expect(lint(mixed, THRESHOLDS, log)).toEqual(lint(mixed, THRESHOLDS, log));
    expect(lint(mixed, GOD_NODE_LIVE, log)).toEqual(
      lint(mixed, GOD_NODE_LIVE, log),
    );
    expect(lint(mixed, DISCRIMINATED_LIVE, log)).toEqual(
      lint(mixed, DISCRIMINATED_LIVE, log),
    );
  });

  it('keeps undiscriminated-range shadowed on a graph that trips it when live', () => {
    const { log } = collector();

    const shipped = lint(mixed, THRESHOLDS, log);
    const live = lint(mixed, DISCRIMINATED_LIVE, log);

    expect(shipped.some((f) => f.kind === 'undiscriminated-range')).toBe(false);
    expect(live.some((f) => f.kind === 'undiscriminated-range')).toBe(true);
    expect(live.filter((f) => f.kind === 'undiscriminated-range')).toHaveLength(1);
  });

  it('returns only the live findings from a graph that trips all four', () => {
    const { log } = collector();

    const kinds = lint(mixed, THRESHOLDS, log).map((f) => f.kind);

    // Two shadowed mechanisms, two live ones. The shadowed pair is in the log.
    expect(kinds).toEqual(['stale-citation', 'orphan-claim']);
  });

  it('takes no model', () => {
    const noModel: Complete = async () => '';
    const { log } = collector();

    // @ts-expect-error — there is no fourth parameter, and that absence is the
    // contract (Q-31). This line goes red the day someone adds one.
    lint(graphOf(), THRESHOLDS, log, noModel);
  });
});
