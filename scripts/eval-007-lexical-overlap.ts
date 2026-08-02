/**
 * Ticket 007, third pass — is the embedding channel at a HIGH threshold merely
 * a slower copy of the lexical channel?
 *
 * At `clash.embeddingCosine = 0.82` the only pairs measured anywhere in this
 * eval that clear the bar are minimal negations — one sentence and the same
 * sentence with "not" in it. Those share long verbatim runs, which is exactly
 * what `resonate()` already indexes. This script measures that rather than
 * asserting it: it runs the same negation pairs through the real incumbent
 * (`src/index/lexical.ts`, read-only) and reports which ones it already finds.
 *
 * Run: npx tsx scripts/eval-007-lexical-overlap.ts
 */
import { buildIndex, resonate } from '../src/index/lexical.js';
import type { Snippet } from '../src/types.js';

interface Case { label: string; kind: 'minimal' | 'rephrased'; a: string; b: string }

// Same pairs as eval-007-embeddings.ts. Kept literal here so this script runs
// standalone and so a reader can see exactly what was scored.
const CASES: Case[] = [
  { label: 'technology-as-saviour', kind: 'minimal',
    a: 'The saviour idea of technology is looked at quite humbly and seen as a tool that needs to be situated.',
    b: 'The saviour idea of technology is not looked at humbly and is not seen as a tool that needs to be situated.' },
  { label: 'technology-as-saviour', kind: 'rephrased',
    a: 'The saviour idea of technology is looked at quite humbly and seen as a tool that needs to be situated.',
    b: 'Software arrives as the answer on its own terms; where it lands changes nothing about what it can do.' },
  { label: 'care-is-political', kind: 'minimal',
    a: 'Care is a very political act in the sense of what it questions and that has reflected in these collectives.',
    b: 'Care is not a political act in the sense of what it questions and that has not reflected in these collectives.' },
  { label: 'care-is-political', kind: 'rephrased',
    a: 'Care is a very political act in the sense of what it questions and that has reflected in these collectives.',
    b: 'Looking after each other is simply a private kindness between individuals, with no bearing on power or on what a group contests.' },
  { label: 'listen-versus-speak-for', kind: 'minimal',
    a: 'The point was to listen to what people there already wanted, not to speak for them.',
    b: 'The point was not to listen to what people there already wanted, but to speak for them.' },
  { label: 'listen-versus-speak-for', kind: 'rephrased',
    a: 'The point was to listen to what people there already wanted, not to speak for them.',
    b: 'A trained practitioner should set the agenda for a community, because the residents cannot articulate what they need.' },
  { label: 'design-hero-worship', kind: 'minimal',
    a: 'I understand now that the trap lies in the hero-worship that design engages.',
    b: 'I understand now that there is no trap in the hero-worship that design engages.' },
  { label: 'design-hero-worship', kind: 'rephrased',
    a: 'I understand now that the trap lies in the hero-worship that design engages.',
    b: 'Celebrating the individual designer as a visionary is healthy for the field and I see nothing wrong in it.' },
  { label: 'wikipedia-gaps', kind: 'minimal',
    a: "Wikipedia's knowledge gaps are not accidental- they reflect whose histories are considered encyclopaedic.",
    b: "Wikipedia's knowledge gaps are accidental- they do not reflect whose histories are considered encyclopaedic." },
  { label: 'wikipedia-gaps', kind: 'rephrased',
    a: "Wikipedia's knowledge gaps are not accidental- they reflect whose histories are considered encyclopaedic.",
    b: 'What is missing from the open encyclopaedia is just an artefact of who happened to show up to write, and carries no judgement about whose past counts.' },
  { label: 'audio-natural-for-community', kind: 'minimal',
    a: 'Audio was a much more natural way for many in the community to record knowledge and daily practices',
    b: 'Audio was not a natural way for many in the community to record knowledge and daily practices' },
  { label: 'audio-natural-for-community', kind: 'rephrased',
    a: 'Audio was a much more natural way for many in the community to record knowledge and daily practices',
    b: 'Typed text remained the format people reached for first when they wanted to keep what they knew; speaking it aloud never felt like recording.' },
  { label: 'participant-authored-stories', kind: 'minimal',
    a: 'It was about creating space for the participants to tell their own stories using tools they could take apart, understand, and reshape.',
    b: 'It was not about creating space for the participants to tell their own stories, and the tools were not ones they could take apart, understand, or reshape.' },
  { label: 'participant-authored-stories', kind: 'rephrased',
    a: 'It was about creating space for the participants to tell their own stories using tools they could take apart, understand, and reshape.',
    b: 'We produced the narrative on their behalf with equipment that stayed sealed, because opening it up would only have slowed the programme down.' },
  { label: 'fragility-is-honest', kind: 'minimal',
    a: 'Fragility is an honest and important understanding in this sense because it changes the way we look at incentives and penalisations as a motivation.',
    b: 'Fragility is not an honest or important understanding in this sense because it does not change the way we look at incentives and penalisations as a motivation.' },
  { label: 'fragility-is-honest', kind: 'rephrased',
    a: 'Fragility is an honest and important understanding in this sense because it changes the way we look at incentives and penalisations as a motivation.',
    b: 'Treating a group as breakable is a sentimental distraction; rewards and punishments drive behaviour exactly as they always have.' },
];

function snip(id: string, prose: string): Snippet {
  return {
    id, version: 1, captured: '2026-08-02T00:00:00.000Z',
    provenance: { kind: 'harvest', session: 'eval-007', question: '', questionForm: 'deliberative' },
    prose,
  };
}

function main() {
  let minimalHit = 0, minimalTotal = 0, rephrasedHit = 0, rephrasedTotal = 0;
  console.log('Does the INCUMBENT trigram channel already find these pairs?\n');
  console.log(`${'label'.padEnd(30)} ${'kind'.padEnd(10)} lexical  shared phrase`);
  for (const c of CASES) {
    // Index holds pole A alone; query with pole B — the same shape resonate()
    // is used in: one stored snippet, one later restatement.
    const index = buildIndex([snip('a', c.a)]);
    const hits = resonate(index, c.b, 5);
    const hit = hits.length > 0;
    if (c.kind === 'minimal') { minimalTotal++; if (hit) minimalHit++; }
    else { rephrasedTotal++; if (hit) rephrasedHit++; }
    console.log(`${c.label.padEnd(30)} ${c.kind.padEnd(10)} ${hit ? 'HIT ' : 'miss'}     ${hit ? `"${hits[0]!.sharedPhrase}"` : '—'}`);
  }
  console.log(`\nlexical recall on MINIMAL negation:   ${minimalHit}/${minimalTotal}`);
  console.log(`lexical recall on REPHRASED opposition: ${rephrasedHit}/${rephrasedTotal}`);
}

main();
