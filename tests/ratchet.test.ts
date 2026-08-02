import { describe, it, expect } from 'vitest';
import {
  verdict,
  first3Words,
  contentWords,
  echoRate,
  containsConversationReference,
  isRepeat,
  repeatRate,
  type Metrics,
} from '../scripts/ratchet/compare.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

function harvestMetrics(opts: {
  fabricationRate: number;
  meanProposalCount: number;
  facetDistribution: Record<string, number>;
}): Metrics {
  return {
    mode: 'harvest',
    aggregate: {
      totalCuts: 10,
      fabricationRate: opts.fabricationRate,
      facetDistribution: opts.facetDistribution,
      meanProposalCount: opts.meanProposalCount,
    },
    perExchange: [
      {
        session: 's1',
        totalCuts: 10,
        fabricatedCuts: Math.round(opts.fabricationRate * 10),
        fabricationRate: opts.fabricationRate,
        proposalCount: opts.meanProposalCount,
        facetDistribution: opts.facetDistribution,
      },
    ],
  };
}

function probeMetrics(opts: {
  meanEchoRate: number;
  meanConversationReferenceRate: number;
}): Metrics {
  return {
    mode: 'probe',
    aggregate: {
      distinctFrames: 5,
      meanRepeatRate: 0,
      meanConversationReferenceRate: opts.meanConversationReferenceRate,
      meanEchoRate: opts.meanEchoRate,
    },
    perExchange: [
      {
        session: 's1',
        probeText: 'a probe question?',
        distinctFrameCount: 2,
        frames: ['a probe question'],
        repeatRate: 0,
        conversationReferenceRate: opts.meanConversationReferenceRate,
        echoRate: opts.meanEchoRate,
      },
    ],
  };
}

// ── Frame extraction ────────────────────────────────────────────────────────

describe('frame extraction', () => {
  it('takes the first 3 words, lowercased, punctuation stripped', () => {
    expect(first3Words('go smaller: a general claim')).toBe('go smaller a');
  });

  it('strips trailing punctuation', () => {
    expect(first3Words('Find the edge.')).toBe('find the edge');
  });

  it('single word passes through', () => {
    expect(first3Words('Learning')).toBe('learning');
  });

  it('empty string yields empty frame', () => {
    expect(first3Words('')).toBe('');
  });
});

// ── Content words ───────────────────────────────────────────────────────────

describe('content words', () => {
  it('excludes stop words', () => {
    expect(contentWords('What is the difference between learning and mastering?')).toEqual([
      'difference',
      'learning',
      'mastering',
    ]);
  });

  it('keeps only meaningful words', () => {
    expect(contentWords('I think this matters')).toEqual(['think', 'matters']);
  });
});

// ── Echo rate ───────────────────────────────────────────────────────────────

describe('echo rate', () => {
  it('detects echo when ≥50% of probe content words appear in the answer', () => {
    const rate = echoRate('What specific moment comes to mind?', 'I remember a specific moment when...');
    expect(rate).toBeGreaterThanOrEqual(0.5);
  });

  it('no echo when probe and answer share no content words', () => {
    expect(echoRate('What would you change?', 'The weather was nice today.')).toBe(0);
  });
});

// ── Conversation reference ──────────────────────────────────────────────────

describe('conversation reference', () => {
  it('detects "this conversation"', () => {
    expect(containsConversationReference('What are we discussing in this conversation?')).toBe(true);
  });

  it('detects "this conversation" mid-sentence', () => {
    expect(containsConversationReference('What does this conversation mean to you?')).toBe(true);
  });

  it('rejects generic reference', () => {
    expect(containsConversationReference('What does this mean?')).toBe(false);
  });
});

// ── Repeat rate ─────────────────────────────────────────────────────────────

describe('repeat rate', () => {
  it('marks later duplicates as repeats and computes the run mean', () => {
    const probes = ['probe A', 'probe A', 'probe B'];
    expect(isRepeat(probes, 1)).toBe(true);
    expect(isRepeat(probes, 2)).toBe(false);
    expect(repeatRate(probes)).toBeCloseTo(1 / 3);
  });
});

// ── Verdict ─────────────────────────────────────────────────────────────────

describe('verdict', () => {
  it('keeps when fabrication improved and no facet bias', () => {
    const baseline = harvestMetrics({
      fabricationRate: 0.2,
      meanProposalCount: 4,
      facetDistribution: { episode: 5, fact: 2, construct: 1 },
    });
    const candidate = harvestMetrics({
      fabricationRate: 0.15,
      meanProposalCount: 5,
      facetDistribution: { episode: 6, fact: 2, construct: 1 },
    });

    const result = verdict(baseline, candidate);
    expect(result.verdict).toBe('keep');
    expect(result.regressions).toEqual([]);
  });

  it('reverts on fabrication regression', () => {
    const baseline = harvestMetrics({
      fabricationRate: 0.1,
      meanProposalCount: 4,
      facetDistribution: { episode: 8, fact: 1, construct: 1 },
    });
    const candidate = harvestMetrics({
      fabricationRate: 0.2,
      meanProposalCount: 4,
      facetDistribution: { episode: 8, fact: 1, construct: 1 },
    });

    const result = verdict(baseline, candidate);
    expect(result.verdict).toBe('revert');
    expect(result.reason).toContain('fabrication regression');
  });

  it('reverts on facet-distribution bias with a yield gain', () => {
    const baseline = harvestMetrics({
      fabricationRate: 0.1,
      meanProposalCount: 4,
      facetDistribution: { episode: 8, fact: 1, construct: 1 },
    });
    const candidate = harvestMetrics({
      fabricationRate: 0.1,
      meanProposalCount: 6,
      facetDistribution: { episode: 2, fact: 5, construct: 5 },
    });

    const result = verdict(baseline, candidate);
    expect(result.verdict).toBe('revert');
    expect(result.reason).toContain('facet-distribution');
  });

  it('keeps when facet bias exists without a yield gain', () => {
    const baseline = harvestMetrics({
      fabricationRate: 0.1,
      meanProposalCount: 4,
      facetDistribution: { episode: 8, fact: 1, construct: 1 },
    });
    const candidate = harvestMetrics({
      fabricationRate: 0.1,
      meanProposalCount: 3,
      facetDistribution: { episode: 2, fact: 5, construct: 5 },
    });

    const result = verdict(baseline, candidate);
    expect(result.verdict).toBe('keep');
  });

  it('reverts on echo regression in probe mode', () => {
    const baseline = probeMetrics({ meanEchoRate: 0.1, meanConversationReferenceRate: 0.05 });
    const candidate = probeMetrics({ meanEchoRate: 0.3, meanConversationReferenceRate: 0.05 });

    const result = verdict(baseline, candidate);
    expect(result.verdict).toBe('revert');
    expect(result.reason).toContain('echo regression');
  });

  it('reverts on conversation-reference regression in probe mode', () => {
    const baseline = probeMetrics({ meanEchoRate: 0.1, meanConversationReferenceRate: 0.05 });
    const candidate = probeMetrics({ meanEchoRate: 0.1, meanConversationReferenceRate: 0.2 });

    const result = verdict(baseline, candidate);
    expect(result.verdict).toBe('revert');
    expect(result.reason).toContain('conversation-reference regression');
  });
});
