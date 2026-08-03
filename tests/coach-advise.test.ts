/**
 * The advise module (090 T7) — the Coach's ONE model call. The prompt input
 * is built from a type with no pointer field (Q-78), the output passes
 * `adviceGuard` or nothing is written (Q-74), and the note replaces its
 * predecessor by store construction (Q-77). Zero relevant claims → no model
 * call at all (090's data note quiet path).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoachStore } from '../src/coach/store.js';
import { buildAdviceInput, runCoachAdvice } from '../src/coach/advise.js';
import { relevantClaims, type CoachFacts } from '../src/coach/license.js';
import type { AdviceNote, ArtifactRecord, DirectionRecord, Quest } from '../src/coach/contract.js';
import type { SittingTag } from '../src/coach/store.js';
import type { Complete, Snippet, Turn } from '../src/types.js';

let root: string;

function recordingComplete(
 responses: string[],
): { complete: Complete; calls: { system: string; turns: Turn[] }[] } {
 const calls: { system: string; turns: Turn[] }[] = [];
 let i = 0;
 const complete: Complete = async (system, turns) => {
  calls.push({ system, turns: [...turns] });
  if (i >= responses.length) throw new Error(`recordingComplete exhausted after ${responses.length} response(s)`);
  return responses[i++]!;
 };
 return { complete, calls };
}

function direction(overrides?: Partial<DirectionRecord>): DirectionRecord {
 return {
  slug: 'cooking',
  name: 'Cooking',
  coached: true,
  coachedAt: '2026-08-03T07:00:00.000Z',
  declinedOptions: [],
  ...overrides,
 };
}

function quest(): Quest {
 return {
  id: 'q1',
  direction: 'cooking',
  act: 'Cook one meal from scratch',
  cites: ['c1'],
  adoptedAt: '2026-08-03T08:00:00.000Z',
 };
}

function tag(session: string, started: string, overrides?: Partial<SittingTag>): SittingTag {
 return { session, started, ...overrides };
}

function snippet(id: string, session: string, prose: string): Snippet {
 return { id, version: 1, captured: '2026-08-03T09:00:00.000Z', provenance: { kind: 'unprompted', session, question: '', questionForm: 'theoretical' }, prose };
}

/** Three claims sharing the 'cooking' name-term — the offer floor's worth. */
function cookingClaims(): { id: string; body: string; range: string; cites: string[] }[] {
 return [
  { id: 'c1', body: 'cooking changed how I plan meals', range: 'the kitchen', cites: ['snip1@1'] },
  { id: 'c2', body: 'cooking is a daily craft', range: 'the kitchen', cites: ['snip1@1'] },
  { id: 'c3', body: 'cooking taught me patience', range: 'the kitchen', cites: ['snip1@1'] },
 ];
}

function facts(overrides?: Partial<CoachFacts>): CoachFacts {
 return {
  directions: [direction()],
  quests: [],
  artifacts: [],
  sittingTags: [],
  queueEntries: [],
  claims: cookingClaims(),
  snippetSessions: new Map(),
  advice: new Map(),
  snippets: [],
  ...overrides,
 };
}

function oldNote(): AdviceNote {
 return {
  direction: 'cooking',
  mintedAt: '2026-08-03T06:00:00.000Z',
  license: 'page-opened',
  options: [{ id: 'opt-1', text: 'An older option', cites: ['c1'] }],
 };
}

const OPTIONS_3 = JSON.stringify({
 options: [
  { text: 'Cook one new recipe', cites: ['c1'] },
  { text: 'Write down your knife setup', cites: ['c2'] },
  { text: 'Plan a week of meals', cites: ['c3'] },
 ],
});

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'elicit-coach-advise-'));
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

describe('buildAdviceInput (090 T7)', () => {
 it('assembles the prompt input from disk facts — claims, quest acts with return prose, artifact NAMES', () => {
  const f = facts({
   quests: [quest()],
   sittingTags: [tag('sess-r', '2026-08-03T09:00:00.000Z', { quest: 'q1', direction: 'cooking' })],
   snippets: [snippet('snip-r', 'sess-r', 'the rice burned because I rushed')],
   artifacts: [
    { id: 'a1', direction: 'cooking', pointer: '/home/me/notes/secret.pdf', name: 'the kitchen log', sentenceSession: 's1', declaredAt: '2026-08-03T09:30:00.000Z' },
   ],
  });
  const input = buildAdviceInput(f, 'cooking')!;
  expect(input.directionName).toBe('Cooking');
  expect(input.claims.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
  expect(input.quests).toEqual([{ act: 'Cook one meal from scratch', returns: ['the rice burned because I rushed'] }]);
  expect(input.artifactNames).toEqual(['the kitchen log']);
  // @ts-expect-error — the prompt-input type has no pointer field (Q-78): the model cannot be handed one.
  void input.pointer;
 });

 it('returns null when the Direction is missing, not coached, or has no relevant claims', () => {
  expect(buildAdviceInput(facts(), 'nope')).toBeNull();
  expect(buildAdviceInput(facts({ directions: [direction({ coached: false })] }), 'cooking')).toBeNull();
  expect(buildAdviceInput(facts({ claims: [] }), 'cooking')).toBeNull();
 });

 it('is the only prompt assembly — its claims are exactly relevantClaims', () => {
  const f = facts();
  expect(buildAdviceInput(f, 'cooking')!.claims.map((c) => c.id)).toEqual(
   relevantClaims(f, { slug: 'cooking', name: 'Cooking' }).map((c) => c.id),
  );
 });
});

describe('runCoachAdvice (090 T7)', () => {
 it('happy path: mints 3 guarded options and replaces a prior note — one file on disk', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  store.writeAdvice(oldNote());
  const { complete, calls } = recordingComplete([OPTIONS_3]);

  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out.outcome).toBe('minted');
  if (out.outcome === 'minted') {
   expect(out.replaced).toBe(true);
   expect(out.note.options).toHaveLength(3);
   expect(out.note.license).toBe('page-opened');
   expect(out.note.mintedAt > oldNote().mintedAt).toBe(true);
  }
  const onDisk = store.readAdvice('cooking')!;
  expect(onDisk.options).toHaveLength(3);
  expect(readdirSync(join(root, 'coach', 'advice'))).toEqual(['cooking.md']);
  expect(calls).toHaveLength(1);
 });

 it('the pointer never reaches the model — the recorded prompt contains names, not paths', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const f = facts({
   artifacts: [
    { id: 'a1', direction: 'cooking', pointer: '/home/me/notes/secret.pdf', name: 'the kitchen log', sentenceSession: 's1', declaredAt: '2026-08-03T09:30:00.000Z' },
   ],
  });
  const { complete, calls } = recordingComplete([OPTIONS_3]);
  await runCoachAdvice({ store, facts: f, complete, slug: 'cooking', license: 'page-opened' });
  const promptText = calls[0]!.turns[0]!.text + calls[0]!.system;
  expect(promptText).toContain('the kitchen log');
  expect(promptText).not.toContain('secret.pdf');
  expect(promptText).not.toContain('/home/me/notes');
 });

 it('a model returning a single option is withheld — a prescription is not an option set (Q-74)', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const { complete } = recordingComplete([
   JSON.stringify({ options: [{ text: 'The only next step', cites: ['c1'] }] }),
  ]);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out).toEqual({ outcome: 'withheld', reason: 'guard:fewer-than-2-options' });
  expect(store.readAdvice('cooking')).toBeNull();
 });

 it('garbage JSON is withheld as parse-failed and nothing is written', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const { complete } = recordingComplete(['this is not json at all']);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out).toEqual({ outcome: 'withheld', reason: 'parse-failed' });
  expect(store.readAdvice('cooking')).toBeNull();
 });

 it('fenced JSON parses — the tolerant posture the harvest path uses', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const { complete } = recordingComplete(['```json\n' + OPTIONS_3 + '\n```']);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out.outcome).toBe('minted');
 });

 it('zero relevant claims withholds with no-claims and the model is NEVER called', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const { complete, calls } = recordingComplete([]);
  const out = await runCoachAdvice({ store, facts: facts({ claims: [] }), complete, slug: 'cooking', license: 'page-opened' });
  expect(out).toEqual({ outcome: 'withheld', reason: 'no-claims' });
  expect(calls).toHaveLength(0);
  expect(store.readAdvice('cooking')).toBeNull();
 });

 it('a declined option text is dropped; with fewer than 2 survivors the whole set is withheld', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  store.addDeclinedOption('cooking', 'Cook one new recipe');
  const { complete } = recordingComplete([
   JSON.stringify({
    options: [
     { text: 'Cook one new recipe', cites: ['c1'] },
     { text: 'Write down your knife setup', cites: ['c2'] },
    ],
   }),
  ]);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out).toEqual({ outcome: 'withheld', reason: 'guard:declined-option' });
  expect(store.readAdvice('cooking')).toBeNull();
 });

 it('a declined option text is dropped from an otherwise healthy set — never re-offered (Q-77)', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  store.addDeclinedOption('cooking', 'Cook one new recipe');
  const { complete } = recordingComplete([OPTIONS_3]);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out.outcome).toBe('minted');
  if (out.outcome === 'minted') {
   expect(out.note.options).toHaveLength(2);
   expect(out.note.options.map((o) => o.text)).not.toContain('Cook one new recipe');
  }
 });

 it('an unresolvable cite in the model output withholds the whole set', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const { complete } = recordingComplete([
   JSON.stringify({
    options: [
     { text: 'Cook one new recipe', cites: ['c1'] },
     { text: 'Do the impossible', cites: ['not-a-claim'] },
    ],
   }),
  ]);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out).toEqual({ outcome: 'withheld', reason: 'guard:unresolvable-cite' });
 });

 it('a throwing model rejects nothing — the route logs the failure, the note stays absent', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const { complete } = recordingComplete([]);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out).toEqual({ outcome: 'withheld', reason: 'call-failed' });
  expect(store.readAdvice('cooking')).toBeNull();
 });

 it('a fresh direction with no prior note reports replaced: false', async () => {
  const store = createCoachStore(root);
  store.declareCoached('Cooking');
  const { complete } = recordingComplete([OPTIONS_3]);
  const out = await runCoachAdvice({ store, facts: facts(), complete, slug: 'cooking', license: 'page-opened' });
  expect(out.outcome).toBe('minted');
  if (out.outcome === 'minted') expect(out.replaced).toBe(false);
 });
});
