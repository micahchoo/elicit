import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { createCoachStore, readSittingTags } from '../src/coach/store.js';
import type { CoachStore, SittingTag } from '../src/coach/store.js';
import type { AdviceNote } from '../src/coach/contract.js';
import { createVault } from '../src/vault/vault.js';

let root: string;
let store: CoachStore;

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'elicit-coach-test-'));
 store = createCoachStore(root);
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

function makeNote(overrides?: Partial<AdviceNote>): AdviceNote {
 return {
  direction: 'cooking',
  mintedAt: '2026-08-03T09:00:00.000Z',
  license: 'page-opened',
  options: [
   { id: 'opt-1', text: 'Do A', cites: ['c1'] },
   { id: 'opt-2', text: 'Do B', cites: ['c2'] },
  ],
  ...overrides,
 };
}

describe('coach store — directions', () => {
 it('declare → get → uncoach round-trips with files still on disk; re-coaching flips coached back on', () => {
  const declared = store.declareCoached('Cooking');
  expect(declared.slug).toBe('cooking');
  expect(declared.name).toBe('Cooking');
  expect(declared.coached).toBe(true);
  expect(declared.coachedAt).toBeTypeOf('string');
  expect(declared.declinedOptions).toEqual([]);

  const got = store.getDirection('cooking');
  expect(got).not.toBeNull();
  expect(got!.name).toBe('Cooking');
  expect(got!.coached).toBe(true);
  expect(got!.coachedAt).toBe(declared.coachedAt);

  expect(store.getDirection('nope')).toBeNull();

  // uncoach flips the boolean, deletes nothing (Q-73)
  const uncoached = store.uncoach('cooking');
  expect(uncoached).not.toBeNull();
  expect(uncoached!.coached).toBe(false);
  expect(uncoached!.uncoachedAt).toBeTypeOf('string');
  expect(store.uncoach('nope')).toBeNull();

  const onDisk = readFileSync(join(root, 'coach', 'directions', 'cooking.md'), 'utf-8');
  expect(onDisk).toContain('coached: false');
  expect(onDisk).toContain('uncoachedAt:');

  // re-coaching the same slug flips coached back on — idempotent on slug
  const re = store.declareCoached('Cooking');
  expect(re.slug).toBe('cooking');
  expect(store.getDirection('cooking')!.coached).toBe(true);
  // still one file, still the original coachedAt
  expect(readdirSync(join(root, 'coach', 'directions'))).toEqual(['cooking.md']);
  expect(store.getDirection('cooking')!.coachedAt).toBe(declared.coachedAt);
 });

 it('listDirections returns coached and un-coached both', () => {
  store.declareCoached('Cooking');
  store.recordOfferDeclined('gardening');
  const slugs = store.listDirections().map((d) => d.slug).sort();
  expect(slugs).toEqual(['cooking', 'gardening']);
 });

 it('recordVisit stamps lastVisit', () => {
  store.declareCoached('Cooking');
  store.recordVisit('cooking', '2026-08-03T10:00:00.000Z');
  expect(store.getDirection('cooking')!.lastVisit).toBe('2026-08-03T10:00:00.000Z');
 });

 it('declined options accumulate normalized, and identical normalized texts are not duplicated', () => {
  store.declareCoached('Cooking');
  store.addDeclinedOption('cooking', '  Take Up  X ');
  expect(store.getDirection('cooking')!.declinedOptions).toEqual(['take up x']);
  store.addDeclinedOption('cooking', 'Take Up X'); // same normalized form
  store.addDeclinedOption('cooking', '  another   option  here ');
  expect(store.getDirection('cooking')!.declinedOptions).toEqual(['take up x', 'another option here']);
 });

 it('recordOfferDeclined creates a stub on a never-declared name', () => {
  store.recordOfferDeclined('cooking');
  const rec = store.getDirection('cooking');
  expect(rec).not.toBeNull();
  expect(rec!.coached).toBe(false);
  expect(rec!.name).toBe('cooking');
  expect(rec!.offerDeclinedAt).toBeTypeOf('string');
  expect(rec!.declinedOptions).toEqual([]);
  expect(rec!.coachedAt).toBeUndefined();

  // a later self-declaration is the only way back; the decline stays recorded
  store.declareCoached('Cooking');
  const after = store.getDirection('cooking')!;
  expect(after.coached).toBe(true);
  expect(after.offerDeclinedAt).toBeTypeOf('string');
 });
});

describe('coach store — quests', () => {
 it('adoptQuest → getQuest round-trips the act as the body; retireQuest sets retiredAt', () => {
  const q = store.adoptQuest({ direction: 'cooking', act: 'Try one new recipe this week', cites: ['claim-1'] });
  expect(q.id).toBeTypeOf('string');
  expect(q.adoptedAt).toBeTypeOf('string');

  const got = store.getQuest(q.id)!;
  expect(got.direction).toBe('cooking');
  expect(got.act).toBe('Try one new recipe this week');
  expect(got.cites).toEqual(['claim-1']);
  expect(got.retiredAt).toBeUndefined();

  // the act text lives in the body, the rest in frontmatter
  const onDisk = matter(readFileSync(join(root, 'coach', 'quests', `${q.id}.md`), 'utf-8'));
  expect(onDisk.content.trim()).toBe('Try one new recipe this week');
  expect(onDisk.data.id).toBe(q.id);
  expect(onDisk.data.cites).toEqual(['claim-1']);

  expect(store.getQuest('no-such')).toBeNull();

  const retired = store.retireQuest(q.id)!;
  expect(retired.retiredAt).toBeTypeOf('string');
  expect(store.getQuest(q.id)!.retiredAt).toBeTypeOf('string');
  expect(store.retireQuest('no-such')).toBeNull();
 });

 it('listQuests filters by direction', () => {
  const q1 = store.adoptQuest({ direction: 'cooking', act: 'A', cites: [] });
  const q2 = store.adoptQuest({ direction: 'gardening', act: 'B', cites: [] });
  expect(store.listQuests().map((q) => q.id).sort()).toEqual([q1.id, q2.id].sort());
  expect(store.listQuests('cooking').map((q) => q.id)).toEqual([q1.id]);
  expect(store.listQuests('gardening').map((q) => q.id)).toEqual([q2.id]);
  expect(store.listQuests('sewing')).toEqual([]);
 });

 it('questStatus derives adopted / returned / retired', () => {
  const q = store.adoptQuest({ direction: 'cooking', act: 'A', cites: [] });
  const tag: SittingTag = { session: 'sit-1', started: '2026-08-03T08:00:00.000Z', quest: q.id };
  const otherTag: SittingTag = { session: 'sit-2', started: '2026-08-03T09:00:00.000Z', quest: 'some-other-quest' };

  expect(store.questStatus(q, [])).toBe('adopted');
  expect(store.questStatus(q, [otherTag])).toBe('adopted');
  expect(store.questStatus(q, [tag])).toBe('returned');

  const retired = store.retireQuest(q.id)!;
  // retired wins even over a matching return tag
  expect(store.questStatus(retired, [tag])).toBe('retired');
  expect(store.questStatus(retired, [])).toBe('retired');
 });
});

describe('coach store — artifacts', () => {
 it('declareArtifact → listArtifacts, with and without quest', () => {
  const a1 = store.declareArtifact({
   direction: 'cooking',
   pointer: 'vault/snippets/abc.md',
   name: 'My recipe box',
   sentenceSession: 'sess-1',
  });
  const a2 = store.declareArtifact({
   direction: 'cooking',
   quest: 'q-1',
   pointer: 'vault/snippets/def.md',
   name: 'The notes',
   sentenceSession: 'sess-2',
  });

  expect(a1.id).toBeTypeOf('string');
  expect(a1.declaredAt).toBeTypeOf('string');
  expect(a1.quest).toBeUndefined();

  expect(store.listArtifacts().map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort());
  expect(store.listArtifacts('cooking').map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort());
  expect(store.listArtifacts('gardening')).toEqual([]);

  const got1 = store.listArtifacts('cooking').find((a) => a.id === a1.id)!;
  expect(got1.name).toBe('My recipe box');
  expect(got1.pointer).toBe('vault/snippets/abc.md');
  expect(got1.sentenceSession).toBe('sess-1');
  expect(got1.quest).toBeUndefined();

  const got2 = store.listArtifacts('cooking').find((a) => a.id === a2.id)!;
  expect(got2.quest).toBe('q-1');
 });
});

describe('coach store — advice', () => {
 it('write-then-write leaves ONE file whose mintedAt is the second note’s', () => {
  const second = makeNote({ mintedAt: '2026-08-03T10:00:00.000Z', license: 'quest-return' });
  store.writeAdvice(makeNote());
  store.writeAdvice(second);

  const files = readdirSync(join(root, 'coach', 'advice')).filter((f) => f.endsWith('.md'));
  expect(files).toEqual(['cooking.md']);

  const onDisk = readFileSync(join(root, 'coach', 'advice', 'cooking.md'), 'utf-8');
  expect(onDisk).toContain('2026-08-03T10:00:00.000Z');
  expect(onDisk).not.toContain('2026-08-03T09:00:00.000Z');

  const read = store.readAdvice('cooking')!;
  expect(read.mintedAt).toBe('2026-08-03T10:00:00.000Z');
  expect(read.license).toBe('quest-return');
  expect(read.options).toEqual(second.options);
  expect(read.readAt).toBeUndefined();
  expect(store.readAdvice('nonexistent')).toBeNull();
 });

 it('markAdviceRead stamps readAt on the one file', () => {
  store.writeAdvice(makeNote());
  store.markAdviceRead('cooking', '2026-08-03T11:00:00.000Z');
  expect(store.readAdvice('cooking')!.readAt).toBe('2026-08-03T11:00:00.000Z');
 });
});

describe('coach store — absent stays absent', () => {
 it('a direction written without lastVisit parses with no lastVisit key', () => {
  store.declareCoached('Cooking');
  const onDisk = matter(readFileSync(join(root, 'coach', 'directions', 'cooking.md'), 'utf-8'));
  expect('lastVisit' in onDisk.data).toBe(false);
  expect(store.getDirection('cooking')!.lastVisit).toBeUndefined();
 });

 it('a quest without retiredAt parses without it', () => {
  const q = store.adoptQuest({ direction: 'cooking', act: 'A', cites: [] });
  const onDisk = matter(readFileSync(join(root, 'coach', 'quests', `${q.id}.md`), 'utf-8'));
  expect('retiredAt' in onDisk.data).toBe(false);
  expect(store.getQuest(q.id)!.retiredAt).toBeUndefined();
 });
});

describe('readSittingTags', () => {
 it('reads a transcript written by vault.startTranscript and returns no quest key when untagged', () => {
  const vault = createVault(root);
  vault.startTranscript('sit-1', {
   mode: { minutes: 15, energy: 'medium' },
   protocol: 'laddered-grid',
   started: '2026-08-03T08:00:00.000Z',
  });

  const tags = readSittingTags(root);
  expect(tags).toHaveLength(1);
  expect(tags[0]!.session).toBe('sit-1');
  expect(tags[0]!.started).toBe('2026-08-03T08:00:00.000Z');
  expect('quest' in tags[0]!).toBe(false);
  expect('direction' in tags[0]!).toBe(false);
 });

 it('carries quest and direction only when the keys exist (the tags T4 adds)', () => {
  const dir = join(root, 'transcripts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
   join(dir, 'sit-2.md'),
   matter.stringify('', {
    session: 'sit-2',
    mode: { minutes: 15, energy: 'medium' },
    protocol: 'laddered-grid',
    started: '2026-08-03T09:00:00.000Z',
    quest: '01HZ-tagged',
    direction: 'cooking',
   }),
   'utf-8',
  );
  writeFileSync(
   join(dir, 'sit-3.md'),
   matter.stringify('', {
    session: 'sit-3',
    mode: { minutes: 15, energy: 'medium' },
    protocol: 'laddered-grid',
    started: '2026-08-03T10:00:00.000Z',
   }),
   'utf-8',
  );

  const tags = readSittingTags(root);
  const tagged = tags.find((t) => t.session === 'sit-2')!;
  expect(tagged.quest).toBe('01HZ-tagged');
  expect(tagged.direction).toBe('cooking');
  const untagged = tags.find((t) => t.session === 'sit-3')!;
  expect(untagged.quest).toBeUndefined();
  expect(untagged.direction).toBeUndefined();
 });
});
