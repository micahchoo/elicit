import { describe, it, expect } from 'vitest';
import { lint, type ThresholdRegister } from '../src/wiki/lint.js';
import { THRESHOLDS } from '../src/wiki/thresholds.js';
import type { Claim, ClaimGraph, LogFn, Referent } from '../src/wiki/contract.js';
import type { Complete, Facet, Snippet } from '../src/types.js';

/**
 * The lint's tests have one job beyond checking four findings: they must fail
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

describe('god-node-facet (Q-35: shadowed)', () => {
  function fatFacet(facet: Facet, n: number): ClaimGraph {
    return graphOf({
      claims: Array.from({ length: n }, (_, i) => claim(`c${i}`, { facet, cites: ['snipA@1'] })),
      snippets: { snipA: snippet('snipA', 1) },
    });
  }

  const fanout = THRESHOLDS['lint.godNodeFanout'].value;

  it('logs what it would flag and returns nothing while the threshold is shadowed', () => {
    const g = fatFacet('construct', fanout + 1);
    const { events, log } = collector();

    const findings = lint(g, THRESHOLDS, log);

    expect(findings).toEqual([]);
    const shadow = events.filter((e) => e.kind === 'shadow-decision');
    expect(shadow).toHaveLength(1);
    expect(shadow[0]!.detail).toContain('lint.godNodeFanout');
    expect(shadow[0]!.detail).toContain('construct');
    expect(shadow[0]!.actor).toBe('clerk');
  });

  it('returns the finding on the SAME graph once the threshold is live', () => {
    // Half two of the shadow proof: the mechanism does fire, and it is the
    // register alone that withholds it.
    const g = fatFacet('construct', fanout + 1);
    const { log } = collector();

    const findings = lint(g, GOD_NODE_LIVE, log);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('god-node-facet');
    expect(findings[0]!.subject).toBe('construct');
    expect(findings[0]!.refs).toHaveLength(fanout + 1);
  });

  it('says nothing about a facet exactly at the fanout', () => {
    const g = fatFacet('episode', fanout);
    const { events, log } = collector();

    expect(lint(g, GOD_NODE_LIVE, log)).toEqual([]);
    expect(events).toEqual([]);
  });

  it('counts only live claims towards the fanout', () => {
    const g = fatFacet('value', fanout + 2);
    g.claims[0]!.archived = true;
    g.claims[0]!.archiveReason = 'merged-into:c1';
    g.claims[1]!.supersededBy = 'c99';
    g.claims[1]!.supersedeReason = 'model-upgrade';
    const { log } = collector();

    expect(lint(g, GOD_NODE_LIVE, log)).toEqual([]);
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

describe('the shape of the module (Q-31)', () => {
  const mixed = graphOf({
    claims: [
      ...Array.from({ length: 13 }, (_, i) => claim(`g${i}`, { facet: 'construct', cites: ['snipA@1'] })),
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
