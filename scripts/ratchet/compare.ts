// Protocol ratchet comparator.
//
// Given the metrics JSON emitted by run.ts for a baseline and a candidate
// pipeline run, decide whether to keep the candidate or revert to baseline.
// All decision logic lives in pure exported functions so tests can exercise
// it without touching the model, the network, or the filesystem. The CLI
// wrapper only runs when this file is executed directly.
//
// Metric shapes are inlined here (not imported from run.ts) per the ratchet
// contract: the three scripts share the shapes by convention, not by module.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── Metric shapes (mirror of run.ts output) ────────────────────────────────

export interface HarvestExchangeMetrics {
  session: string;
  totalCuts: number;
  fabricatedCuts: number;
  fabricationRate: number;
  proposalCount: number;
  facetDistribution: Record<string, number>;
}

export interface HarvestAggregate {
  totalCuts: number;
  fabricationRate: number;
  facetDistribution: Record<string, number>;
  meanProposalCount: number;
}

export interface ProbeExchangeMetrics {
  session: string;
  probeText: string;
  distinctFrameCount: number;
  frames: string[];
  repeatRate: number;
  conversationReferenceRate: number;
  echoRate: number;
}

export interface ProbeAggregate {
  distinctFrames: number;
  meanRepeatRate: number;
  meanConversationReferenceRate: number;
  meanEchoRate: number;
}

// `prompt` and `erroredExchanges` are emitted by run.ts as informational extras;
// verdict logic only reads mode/aggregate/perExchange.
export type Metrics =
  | {
      mode: 'harvest';
      aggregate: HarvestAggregate;
      perExchange: HarvestExchangeMetrics[];
      prompt?: string;
      erroredExchanges?: number;
    }
  | {
      mode: 'probe';
      aggregate: ProbeAggregate;
      perExchange: ProbeExchangeMetrics[];
      prompt?: string;
      erroredExchanges?: number;
    };

export interface CompareVerdict {
  verdict: 'keep' | 'revert';
  reason: string;
  regressions: string[];
  changes: Record<string, { baseline: number; candidate: number }>;
}

// ── Probe text helpers (pure) ───────────────────────────────────────────────

const STOP_WORDS: Record<string, true> = {
  a: true, an: true, the: true, and: true, but: true, or: true, nor: true,
  for: true, yet: true, so: true, of: true, to: true, in: true, on: true,
  at: true, by: true, with: true, from: true, into: true, onto: true,
  upon: true, over: true, under: true, through: true, between: true,
  among: true, within: true, without: true, after: true, before: true,
  during: true, about: true, against: true,
  i: true, you: true, he: true, she: true, it: true, we: true, they: true,
  me: true, him: true, her: true, us: true, them: true, my: true, your: true,
  his: true, its: true, our: true, their: true, mine: true, yours: true,
  hers: true, ours: true, theirs: true,
  this: true, that: true, these: true, those: true,
  what: true, which: true, who: true, whom: true, whose: true, when: true,
  where: true, why: true, how: true,
  is: true, am: true, are: true, was: true, were: true, be: true, been: true,
  being: true, have: true, has: true, had: true, having: true, do: true,
  does: true, did: true, doing: true,
  will: true, would: true, shall: true, should: true, can: true, could: true,
  may: true, might: true, must: true,
  not: true, no: true, none: true, never: true,
  as: true, than: true, then: true, there: true, here: true,
  if: true, else: true, whether: true, although: true, though: true,
  while: true, since: true, until: true, unless: true,
  very: true, just: true, too: true, also: true, only: true, even: true,
  still: true, already: true, again: true, once: true, now: true,
  all: true, any: true, both: true, each: true, few: true, more: true,
  most: true, other: true, some: true, such: true, own: true, same: true,
  every: true, either: true, neither: true, many: true, much: true,
  s: true, t: true,
};

// Frames = first 3 words of a probe, lowercased, punctuation stripped.
export function first3Words(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');
  return words.slice(0, 3).join(' ');
}

// Content words = words minus stop words (used for echo-overlap detection).
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !STOP_WORDS[w]);
}

const CONVERSATION_PHRASES = [
  'this conversation',
  'this exchange',
  'our conversation',
  'this interview',
  "what we're doing",
];

// True when the probe explicitly references the ongoing conversation.
export function containsConversationReference(text: string): boolean {
  const lowered = text.toLowerCase();
  return CONVERSATION_PHRASES.some((p) => lowered.includes(p));
}

// Fraction of the probe's content words that appear in the user's last
// answer. ≥0.5 counts as an echo.
export function echoRate(probe: string, answer: string): number {
  const probeWords = contentWords(probe);
  if (probeWords.length === 0) return 0;
  const answerWords = new Set(contentWords(answer));
  const hits = probeWords.filter((w) => answerWords.has(w)).length;
  return hits / probeWords.length;
}

// True when the probe at `index` duplicates an earlier probe in the run.
export function isRepeat(probes: string[], index: number): boolean {
  const text = probes[index];
  if (text === undefined) return false;
  return probes.slice(0, index).includes(text);
}

// Fraction of probes in a run whose full text appeared earlier in the run.
export function repeatRate(probes: string[]): number {
  if (probes.length === 0) return 0;
  const repeats = probes.filter((_, i) => isRepeat(probes, i)).length;
  return repeats / probes.length;
}

// ── Verdict ─────────────────────────────────────────────────────────────────

export function verdict(baseline: Metrics, candidate: Metrics): CompareVerdict {
  const regressions: string[] = [];
  const changes: Record<string, { baseline: number; candidate: number }> = {};

  // 1. Fabrication regression (harvest mode only)
  if (baseline.mode === 'harvest' && candidate.mode === 'harvest') {
    if (candidate.aggregate.fabricationRate > baseline.aggregate.fabricationRate) {
      regressions.push('fabrication regression');
    }
    changes.fabricationRate = {
      baseline: baseline.aggregate.fabricationRate,
      candidate: candidate.aggregate.fabricationRate,
    };
    changes.meanProposalCount = {
      baseline: baseline.aggregate.meanProposalCount,
      candidate: candidate.aggregate.meanProposalCount,
    };
  }

  // 2. Empty output
  const isEmptyOutput = candidate.perExchange.every((e) => {
    if ('probeText' in e) return e.probeText.length === 0;
    return e.totalCuts === 0;
  });
  if (isEmptyOutput) {
    regressions.push('empty output');
  }

  // 3. Echo regression (probe mode)
  if (candidate.mode === 'probe' && 'meanEchoRate' in candidate.aggregate) {
    const blEcho: number | undefined = 'meanEchoRate' in baseline.aggregate
      ? baseline.aggregate.meanEchoRate
      : undefined;
    const delta = candidate.aggregate.meanEchoRate - (blEcho ?? NaN);
    if (delta >= 0.15) regressions.push('echo regression');
    changes.meanEchoRate = {
      baseline: blEcho ?? 0,
      candidate: candidate.aggregate.meanEchoRate,
    };
  }

  // 4. Conversation-reference regression (probe mode)
  if (candidate.mode === 'probe' && 'meanConversationReferenceRate' in candidate.aggregate) {
    const blConv: number | undefined = 'meanConversationReferenceRate' in baseline.aggregate
      ? baseline.aggregate.meanConversationReferenceRate
      : undefined;
    const delta = candidate.aggregate.meanConversationReferenceRate - (blConv ?? NaN);
    if (delta >= 0.1) regressions.push('conversation-reference regression');
    changes.meanConversationReferenceRate = {
      baseline: blConv ?? 0,
      candidate: candidate.aggregate.meanConversationReferenceRate,
    };
  }

  // 5. Anti-gaming: facet-distribution proxy regression
  // Skipped in probe mode (no facet data from model output) — the guard
  // below only fires when both runs carry facetDistribution.
  const blFacets = 'facetDistribution' in baseline.aggregate
    ? baseline.aggregate.facetDistribution
    : undefined;
  const cdFacets = 'facetDistribution' in candidate.aggregate
    ? candidate.aggregate.facetDistribution
    : undefined;
  if (blFacets && cdFacets) {
    const easyFacets = ['fact', 'construct'];
    const blTotal = Object.values(blFacets).reduce((a, b) => a + b, 0);
    const blEasy = easyFacets.reduce((s, f) => s + (blFacets[f] ?? 0), 0);
    const blFrac = blTotal > 0 ? blEasy / blTotal : 0;

    const cdTotal = Object.values(cdFacets).reduce((a, b) => a + b, 0);
    const cdEasy = easyFacets.reduce((s, f) => s + (cdFacets[f] ?? 0), 0);
    const cdFrac = cdTotal > 0 ? cdEasy / cdTotal : 0;

    changes.facetEasyFraction = { baseline: blFrac, candidate: cdFrac };

    const blProposals = 'meanProposalCount' in baseline.aggregate
      ? baseline.aggregate.meanProposalCount
      : 0;
    const cdProposals = 'meanProposalCount' in candidate.aggregate
      ? candidate.aggregate.meanProposalCount
      : 0;
    if (cdFrac > blFrac + 0.2 && cdProposals > blProposals) {
      regressions.push('facet-distribution regression — yield gain biased toward easy abstraction');
    }
  }

  // Verdict
  if (regressions.length > 0) {
    return { verdict: 'revert', reason: regressions.join('; '), regressions, changes };
  }

  // No regressions: check for improvement
  const hasChange = Object.keys(changes).length > 0;
  if (!hasChange) return { verdict: 'keep', reason: 'no measurable change', regressions: [], changes: {} };

  return { verdict: 'keep', reason: 'no regressions detected', regressions: [], changes };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function loadMetrics(path: string): Metrics {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Metrics;
  } catch (err) {
    console.error(`failed to read metrics from ${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function main(): void {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    console.error('usage: npx tsx scripts/ratchet/compare.ts <baseline.json> <candidate.json>');
    process.exit(1);
  }
  const baseline = loadMetrics(baselinePath);
  const candidate = loadMetrics(candidatePath);
  const result = verdict(baseline, candidate);
  console.log(JSON.stringify(result, null, 2));
}

const isMain =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) main();
