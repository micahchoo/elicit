import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import { createQueueStore } from '../src/queue/queue.js';
import type { QueueStore, QueueDraft, QueueEntry, Mode } from '../src/types.js';

let root: string;
let store: QueueStore;

beforeEach(() => {
 root = mkdtempSync(join(tmpdir(), 'elicit-queue-test-'));
 store = createQueueStore(root);
});

afterEach(() => {
 rmSync(root, { recursive: true, force: true });
});

function makeDraft(overrides?: Partial<QueueDraft>): QueueDraft {
 return {
  source: 'composed',
  license: 'test-license',
  question: 'What do you think about X?',
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'now',
  ...overrides,
 };
}

function makeMode(overrides?: Partial<Mode>): Mode {
 return {
  minutes: 15,
  energy: 'medium',
  ...overrides,
 };
}

// ── add/list roundtrip ──

describe('QueueStore', () => {
 it('add returns a completed entry and list sees it', () => {
  const draft = makeDraft();
  const entry = store.add(draft);

  expect(entry.id).toBeTypeOf('string');
  expect(entry.id.length).toBeGreaterThan(0);
  expect(entry.status).toBe('pending');
  expect(entry.source).toBe('composed');
  expect(entry.question).toBe(draft.question);
  expect(entry.created).toBeTypeOf('string');
  // created should be a recent ISO string (within 5 seconds)
  const createdMs = new Date(entry.created).getTime();
  expect(Date.now() - createdMs).toBeLessThan(5000);

  const all = store.list();
  expect(all).toHaveLength(1);
  expect(all[0]!.id).toBe(entry.id);
 });

 it('list filters by status', () => {
  const e1 = store.add(makeDraft({ source: 'composed' }));
  const e2 = store.add(makeDraft({ source: 'user-declared' }));
  store.markAsked(e1.id!);

  const pending = store.list({ status: 'pending' });
  expect(pending).toHaveLength(1);
  expect(pending[0]!.id).toBe(e2.id);

  const asked = store.list({ status: 'asked' });
  expect(asked).toHaveLength(1);
  expect(asked[0]!.id).toBe(e1.id);
 });

 it('list filters by source', () => {
  store.add(makeDraft({ source: 'composed' }));
  store.add(makeDraft({ source: 'user-declared' }));
  store.add(makeDraft({ source: 'still-true' }));

  const ud = store.list({ source: 'user-declared' });
  expect(ud).toHaveLength(1);
  expect(ud[0]!.source).toBe('user-declared');
 });

 // ── draw: mode hard-filter ──

 it('draw excludes entries needing more minutes than mode provides', () => {
  store.add(makeDraft({
   modeNeeds: { minMinutes: 20 },
   sharpness: 'weak',
   horizon: 'now',
  }));
  store.add(makeDraft({
   modeNeeds: { minMinutes: 10 },
   sharpness: 'weak',
   horizon: 'now',
  }));

  const mode = makeMode({ minutes: 15 });
  const drawn = store.draw(mode, 'opening');
  expect(drawn).not.toBeNull();
  // The drawn entry should have modeNeeds.minMinutes <= 15
  expect(drawn!.modeNeeds?.minMinutes).toBeLessThanOrEqual(15);
  expect(drawn!.modeNeeds?.minMinutes).toBe(10);
 });

 it('draw respects energy hard-filter (entry needs high, mode is low → excluded)', () => {
  store.add(makeDraft({
   modeNeeds: { energy: 'high' },
   sharpness: 'weak',
   horizon: 'now',
  }));
  store.add(makeDraft({
   modeNeeds: { energy: 'low' },
   sharpness: 'weak',
   horizon: 'now',
  }));

  const mode = makeMode({ energy: 'low' });
  const drawn = store.draw(mode, 'opening');
  expect(drawn).not.toBeNull();
  expect(drawn!.modeNeeds?.energy).toBe('low');
 });

 it('draw with mode energy=high satisfies entry needing medium', () => {
  store.add(makeDraft({
   modeNeeds: { energy: 'medium' },
   sharpness: 'weak',
   horizon: 'now',
  }));

  const mode = makeMode({ energy: 'high' });
  const drawn = store.draw(mode, 'opening');
  expect(drawn).not.toBeNull();
 });

 it('draw returns null when no entry matches mode constraints', () => {
  store.add(makeDraft({
   modeNeeds: { minMinutes: 60 },
   sharpness: 'weak',
   horizon: 'now',
  }));

  const mode = makeMode({ minutes: 5 });
  const drawn = store.draw(mode, 'opening');
  expect(drawn).toBeNull();
 });

 // ── draw: opening/mid never returns sharp ──

 it('opening draw excludes sharp entries', () => {
  store.add(makeDraft({ sharpness: 'sharp', horizon: 'now' }));
  store.add(makeDraft({ sharpness: 'weak', horizon: 'now' }));

  const drawn = store.draw(makeMode(), 'opening');
  expect(drawn).not.toBeNull();
  expect(drawn!.sharpness).toBe('weak');
 });

 it('mid draw excludes sharp entries', () => {
  store.add(makeDraft({ sharpness: 'sharp', horizon: 'now' }));
  store.add(makeDraft({ sharpness: 'weak', horizon: 'now' }));

  const drawn = store.draw(makeMode(), 'mid');
  expect(drawn).not.toBeNull();
  expect(drawn!.sharpness).toBe('weak');
 });

 it('late draw allows sharp entries', () => {
  store.add(makeDraft({ sharpness: 'sharp', horizon: 'now' }));
  store.add(makeDraft({ sharpness: 'weak', horizon: 'now' }));

  const drawn = store.draw(makeMode(), 'late');
  expect(drawn).not.toBeNull();
  // Should return one of the two — both are eligible
  expect(['weak', 'sharp']).toContain(drawn!.sharpness);
 });

 it('opening draw returns null when only sharp entries exist', () => {
  store.add(makeDraft({ sharpness: 'sharp', horizon: 'now' }));

  const drawn = store.draw(makeMode(), 'opening');
  expect(drawn).toBeNull();
 });

 // ── draw: days-horizon never drawn ──

 it('days-horizon entries are never drawn into exchange', () => {
  store.add(makeDraft({ horizon: 'days', sharpness: 'weak' }));
  store.add(makeDraft({ horizon: 'session', sharpness: 'weak' }));

  const drawn = store.draw(makeMode(), 'opening');
  expect(drawn).not.toBeNull();
  expect(drawn!.horizon).toBe('session');
 });

 it('draw returns null when all pending entries are days-horizon', () => {
  store.add(makeDraft({ horizon: 'days', sharpness: 'weak' }));

  const drawn = store.draw(makeMode(), 'opening');
  expect(drawn).toBeNull();
 });

 // ── draw: markAsked prevents re-draw ──

 it('drawn entry is marked asked and not re-drawn', () => {
  const e1 = store.add(makeDraft({ question: 'Q1' }));
  const e2 = store.add(makeDraft({ question: 'Q2' }));

  const first = store.draw(makeMode(), 'opening');
  expect(first).not.toBeNull();

  // Verify status on disk is 'asked'
  const askedId = first!.id;
  const askedEntry = store.list().find(e => e.id === askedId);
  expect(askedEntry!.status).toBe('asked');

  // The other entry should still be pending
  const otherId = askedId === e1.id ? e2.id : e1.id;
  const otherEntry = store.list().find(e => e.id === otherId);
  expect(otherEntry!.status).toBe('pending');
 });

 it('draw never returns same entry twice without defer', () => {
  // Create exactly 2 entries, draw both — should get both unique entries
  const e1 = store.add(makeDraft({ question: 'Q1' }));
  const e2 = store.add(makeDraft({ question: 'Q2' }));

  const first = store.draw(makeMode(), 'opening');
  const second = store.draw(makeMode(), 'opening');

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first!.id).not.toBe(second!.id);
  const ids = [first!.id, second!.id].sort();
  expect(ids).toEqual([e1.id, e2.id].sort());
 });

 // ── user-declared outranks (top-k order) ──

 it('user-declared entries appear in top-k ahead of agent-minted at equal recency', () => {
  // 4 entries with identical timestamps: 1 UD + 3 composed.
  // User-declared sorts first → always in top-3 element 0.
  // Math.random → 0 picks the first element → UD drawn first.
  const now = new Date('2026-06-01T12:00:00Z');
  vi.setSystemTime(now);

  store.add(makeDraft({ source: 'composed', question: 'C1' }));
  store.add(makeDraft({ source: 'composed', question: 'C2' }));
  store.add(makeDraft({ source: 'composed', question: 'C3' }));
  const ud = store.add(makeDraft({ source: 'user-declared', question: 'UD' }));

  vi.useRealTimers();

  // Mock Math.random → 0: always picks top-3[0], which is UD (sorts first)
  const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

  const first = store.draw(makeMode(), 'opening');
  expect(first).not.toBeNull();
  expect(first!.source).toBe('user-declared');
  expect(first!.id).toBe(ud.id);

  randSpy.mockRestore();

  // remaining 3 composed → draw 2 more; 3rd remains pending in top-3 pool
  for (let i = 0; i < 2; i++) {
   const d = store.draw(makeMode(), 'opening');
   expect(d).not.toBeNull();
  }

  const remaining = store.list({ status: 'pending' });
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.source).toBe('composed');
 });

 // ── durability: files survive new instance ──

 it('entries persist across fresh QueueStore instances', () => {
  const e1 = store.add(makeDraft({ question: 'Persisted Q' }));

  // New instance over same root
  const store2 = createQueueStore(root);
  const all = store2.list();
  expect(all).toHaveLength(1);
  expect(all[0]!.id).toBe(e1.id);
  expect(all[0]!.question).toBe('Persisted Q');
 });

 it('status changes persist across fresh instances', () => {
  const e1 = store.add(makeDraft());
  store.markAsked(e1.id);

  const store2 = createQueueStore(root);
  const entry = store2.list().find(e => e.id === e1.id);
  expect(entry!.status).toBe('asked');
 });

 // ── expire: old pending agent-minted entries → expired; user-declared SURVIVES ──

 it('expire moves old pending agent-minted entries to expired', () => {
  // Write entries directly with old created dates
  const oldDate1 = new Date('2026-05-01T00:00:00Z').toISOString();
  const oldDate2 = new Date('2026-05-15T00:00:00Z').toISOString();
  const recentDate = new Date('2026-08-01T00:00:00Z').toISOString();

  const queueDir = join(root, 'queue');
  mkdirSync(queueDir, { recursive: true });

  function writeEntry(overrides: Partial<QueueEntry>) {
   const entry: QueueEntry = {
    id: ulid(),
    status: 'pending',
    source: 'composed',
    license: 'test',
    question: 'Q?',
    questionForm: 'deliberative',
    sharpness: 'weak',
    horizon: 'now',
    created: recentDate,
    ...overrides,
   };
   const { id: eid, created, status, source, ...rest } = entry;
   const body = '';
   const fm: Record<string, unknown> = { id: eid, status, source, created, ...rest };
   const content = matter.stringify(body, fm);
   writeFileSync(join(queueDir, `${eid}.md`), content, 'utf-8');
   return entry;
  }

  const old1 = writeEntry({ created: oldDate1, question: 'Old 1' });
  const old2 = writeEntry({ created: oldDate2, question: 'Old 2' });
  const recent = writeEntry({ created: recentDate, question: 'Recent' });

  // Set "now" to 2026-08-15 so old entries are >30 days old
  vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
  const store2 = createQueueStore(root);

  const count = store2.expire(30);

  vi.useRealTimers();

  expect(count).toBe(2);

  // old entries should be expired
  const all = store2.list();
  const e1 = all.find(e => e.id === old1.id);
  const e2 = all.find(e => e.id === old2.id);
  const e3 = all.find(e => e.id === recent.id);
  expect(e1!.status).toBe('expired');
  expect(e2!.status).toBe('expired');
  expect(e3!.status).toBe('pending');
 });

 it('expire never expires user-declared entries', () => {
  const oldDate = new Date('2026-01-01T00:00:00Z').toISOString();

  const queueDir = join(root, 'queue');
  mkdirSync(queueDir, { recursive: true });

  const id = ulid();
  const entry: QueueEntry = {
   id,
   status: 'pending',
   source: 'user-declared',
   license: 'test',
   question: 'I want to revisit this',
   questionForm: 'deliberative',
   sharpness: 'weak',
   horizon: 'now',
   created: oldDate,
  };
  const { created, status, source, id: eid, ...rest } = entry;
  const fm: Record<string, unknown> = { id: eid, status, source, created, ...rest };
  const content = matter.stringify('', fm);
  writeFileSync(join(queueDir, `${id}.md`), content, 'utf-8');

  vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
  const store2 = createQueueStore(root);

  const count = store2.expire(30);

  vi.useRealTimers();

  expect(count).toBe(0);

  const all = store2.list();
  expect(all[0]!.status).toBe('pending');
  expect(all[0]!.source).toBe('user-declared');
 });

 // ── markAnswered / defer status transitions ──

 it('markAnswered transitions pending → answered', () => {
  const e = store.add(makeDraft());
  store.markAnswered(e.id);

  const entry = store.list().find(x => x.id === e.id);
  expect(entry!.status).toBe('answered');
 });

 it('defer transitions asked → deferred', () => {
  const e = store.add(makeDraft());
  store.markAsked(e.id);
  store.defer(e.id);

  const entry = store.list().find(x => x.id === e.id);
  expect(entry!.status).toBe('deferred');
 });

 it('deferred entries are drawn again (re-enter pending pool)', () => {
  const e = store.add(makeDraft());
  store.markAsked(e.id);
  store.defer(e.id);

  const drawn = store.draw(makeMode(), 'opening');
  expect(drawn).not.toBeNull();
  expect(drawn!.id).toBe(e.id);
 });

 // ── optional fields roundtrip ──

 it('optional fields (cites, quotedFragment, modeNeeds, direction) roundtrip', () => {
  const draft: QueueDraft = {
   source: 'composed',
   license: 'test',
   question: 'What about the thing?',
   questionForm: 'why',
   sharpness: 'weak',
   horizon: 'session',
   ...({ cites: ['abc@1', 'def@2'] } as Partial<QueueDraft>),
   ...({ quotedFragment: 'the thing' } as Partial<QueueDraft>),
   ...({ modeNeeds: { minMinutes: 10, energy: 'medium' } } as Partial<QueueDraft>),
   ...({ direction: 'forward' } as Partial<QueueDraft>),
  };

  const entry = store.add(draft);
  expect(entry.cites).toEqual(['abc@1', 'def@2']);
  expect(entry.quotedFragment).toBe('the thing');
  expect(entry.modeNeeds).toEqual({ minMinutes: 10, energy: 'medium' });
  expect(entry.direction).toBe('forward');

  // Verify roundtrip through a fresh instance
  const store2 = createQueueStore(root);
  const reloaded = store2.list()[0]!;
  expect(reloaded.cites).toEqual(['abc@1', 'def@2']);
  expect(reloaded.quotedFragment).toBe('the thing');
  expect(reloaded.modeNeeds).toEqual({ minMinutes: 10, energy: 'medium' });
  expect(reloaded.direction).toBe('forward');
 });

 it('targetFacet roundtrips through the store', () => {
  store.add(makeDraft({ targetFacet: 'episode' }));
  const reloaded = createQueueStore(root).list()[0]!;
  expect(reloaded.targetFacet).toBe('episode');
 });

 // ── target: the sitting's declared Target is a hard filter (045) ──

 describe('target filter', () => {
  afterEach(() => {
   vi.useRealTimers();
   vi.unstubAllEnvs();
   vi.restoreAllMocks();
  });

  it('a domain sitting is never served self material', () => {
   store.add(makeDraft({ question: 'self Q', target: 'self' }));

   expect(store.draw(makeMode({ target: 'domain' }), 'opening')).toBeNull();
  });

  it('a self sitting is never served domain material', () => {
   store.add(makeDraft({ question: 'domain Q', target: 'domain' }));

   expect(store.draw(makeMode({ target: 'self' }), 'opening')).toBeNull();
  });

  it('filters the other target out of the pool without consuming it', () => {
   const domain = store.add(makeDraft({ question: 'domain Q', target: 'domain' }));
   store.add(makeDraft({ question: 'self Q', target: 'self' }));

   const drawn = store.draw(makeMode({ target: 'domain' }), 'opening');
   expect(drawn!.id).toBe(domain.id);

   // The self entry was never a candidate, so it is still there to be asked
   // in a self sitting — filtered, not spent.
   expect(store.draw(makeMode({ target: 'domain' }), 'opening')).toBeNull();
   const pending = store.list({ status: 'pending' });
   expect(pending.map((e) => e.question)).toEqual(['self Q']);
   expect(store.draw(makeMode({ target: 'self' }), 'opening')!.question).toBe('self Q');
  });

  it('an entry with no target is eligible for either sitting', () => {
   const e = store.add(makeDraft({ question: 'untargeted' }));

   expect(store.draw(makeMode({ target: 'domain' }), 'opening')!.id).toBe(e.id);
   store.defer(e.id);
   expect(store.draw(makeMode({ target: 'self' }), 'opening')!.id).toBe(e.id);
  });

  it('a mode declaring no target draws either kind', () => {
   store.add(makeDraft({ question: 'domain Q', target: 'domain' }));

   expect(store.draw(makeMode(), 'opening')!.question).toBe('domain Q');
  });

  it('target and topic roundtrip through the store', () => {
   store.add(makeDraft({ target: 'domain', topic: 'sourdough bread baking' }));

   const reloaded = createQueueStore(root).list()[0]!;
   expect(reloaded.target).toBe('domain');
   expect(reloaded.topic).toBe('sourdough bread baking');
  });

  it('an entry written before target existed still draws', () => {
   // Backward compatibility, no migration: the old file has no target key,
   // and absent must read as "eligible", not as "self".
   const queueDir = join(root, 'queue');
   mkdirSync(queueDir, { recursive: true });
   const id = ulid();
   writeFileSync(
    join(queueDir, `${id}.md`),
    matter.stringify('', {
     id,
     status: 'pending',
     source: 'composed',
     license: 'test',
     question: 'Older than the field',
     questionForm: 'deliberative',
     sharpness: 'weak',
     horizon: 'now',
     created: new Date().toISOString(),
    }),
    'utf-8',
   );

   const store2 = createQueueStore(root);
   expect(store2.list()[0]!.target).toBeUndefined();
   expect(store2.draw(makeMode({ target: 'domain' }), 'opening')!.id).toBe(id);
  });

  it('the other filters still apply inside the target pool', () => {
   store.add(makeDraft({ question: 'sharp', target: 'domain', sharpness: 'sharp' }));
   store.add(makeDraft({ question: 'days', target: 'domain', horizon: 'days' }));
   store.add(makeDraft({
    question: 'too long',
    target: 'domain',
    modeNeeds: { minMinutes: 60 },
   }));

   const mode = makeMode({ target: 'domain', minutes: 15 });
   expect(store.draw(mode, 'opening')).toBeNull();

   store.add(makeDraft({ question: 'eligible', target: 'domain' }));
   expect(store.draw(mode, 'opening')!.question).toBe('eligible');
  });

  it('chance still runs inside the target pool — the pick is not argmax', () => {
   vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
   store.add(makeDraft({ question: 'D1', target: 'domain' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:01Z'));
   store.add(makeDraft({ question: 'D2', target: 'domain' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:02Z'));
   store.add(makeDraft({ question: 'D3', target: 'domain' }));
   store.add(makeDraft({ question: 'self Q', target: 'self' }));
   vi.useRealTimers();

   const mode = makeMode({ target: 'domain' });

   vi.spyOn(Math, 'random').mockReturnValue(0);
   const first = store.draw(mode, 'opening')!;
   vi.spyOn(Math, 'random').mockReturnValue(0.99);
   const last = store.draw(mode, 'opening')!;

   // Both come from the three-entry domain pool, and a different roll
   // reaches a different entry — the filter constrains, chance chooses.
   expect(first.id).not.toBe(last.id);
   expect([first.question, last.question].sort()).toEqual(['D1', 'D3']);
  });

  it('facet balance narrows what the target filter left, never widens it', () => {
   vi.stubEnv('ELICIT_FACET_BALANCE', 'live');
   const dir = join(root, 'wiki', 'readings');
   mkdirSync(dir, { recursive: true });
   for (let i = 0; i < 25; i++) {
    writeFileSync(
     join(dir, `r${i}.md`),
     '---\nfacet: construct\nstance: avowal\ncites: []\n---\nA reading.\n',
    );
   }

   // Oldest first: the constructs own the top-3 pool by recency, so only
   // the facet filter can reach an episode.
   vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
   const domainEpisode = store.add(
    makeDraft({ question: 'DE', target: 'domain', targetFacet: 'episode' }),
   );
   vi.setSystemTime(new Date('2026-06-01T12:00:01Z'));
   const selfEpisode = store.add(
    makeDraft({ question: 'SE', target: 'self', targetFacet: 'episode' }),
   );
   vi.setSystemTime(new Date('2026-06-01T12:00:02Z'));
   store.add(makeDraft({ question: 'C1', target: 'domain', targetFacet: 'construct' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:03Z'));
   store.add(makeDraft({ question: 'C2', target: 'domain', targetFacet: 'construct' }));
   vi.useRealTimers();
   vi.spyOn(Math, 'random').mockReturnValue(0);

   const picked = store.draw(makeMode({ target: 'domain' }), 'opening')!;

   expect(picked.id).toBe(domainEpisode.id);
   expect(picked.id).not.toBe(selfEpisode.id);
  });
 });

 // ── facet balance: shadow first (Q-35), hard filter before the pick (Q-13) ──

 describe('facet balance', () => {
  /** Give the vault a lopsided corpus: 25 construct readings, nothing else. */
  function writeConstructHeavyVault(): void {
   const dir = join(root, 'wiki', 'readings');
   mkdirSync(dir, { recursive: true });
   for (let i = 0; i < 25; i++) {
    writeFileSync(
     join(dir, `r${i}.md`),
     '---\nfacet: construct\nstance: avowal\ncites: []\n---\nA reading.\n',
    );
   }
  }

  /**
   * Oldest first, so recency ordering is fixed: the three constructs fill
   * the top-3 pool and the episode sits just outside it.
   */
  function seedQueue(): { episodeId: string; newestConstructId: string } {
   vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
   const episode = store.add(makeDraft({ question: 'E', targetFacet: 'episode' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:01Z'));
   store.add(makeDraft({ question: 'C1', targetFacet: 'construct' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:02Z'));
   store.add(makeDraft({ question: 'C2', targetFacet: 'construct' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:03Z'));
   const newest = store.add(makeDraft({ question: 'C3', targetFacet: 'construct' }));
   vi.useRealTimers();
   return { episodeId: episode.id, newestConstructId: newest.id };
  }

  function readLog(): string[] {
   const dir = join(root, 'log');
   return readdirSync(dir).flatMap((f) =>
    readFileSync(join(dir, f), 'utf-8').split('\n').filter((l) => l.trim()),
   );
  }

  afterEach(() => {
   vi.useRealTimers();
   vi.unstubAllEnvs();
   vi.restoreAllMocks();
  });

  it('shadow mode logs the road not taken and changes nothing', () => {
   writeConstructHeavyVault();
   const { episodeId, newestConstructId } = seedQueue();
   vi.spyOn(Math, 'random').mockReturnValue(0);

   const picked = store.draw(makeMode(), 'opening');

   // Behaviour is untouched: the top-3 pool is still the three constructs.
   expect(picked!.id).toBe(newestConstructId);
   expect(picked!.targetFacet).toBe('construct');

   const events = readLog().map((l) => JSON.parse(l) as { kind: string; detail: string });
   const shadow = events.find((e) => e.kind === 'facet-balance-shadow');
   expect(shadow).toBeDefined();
   expect(shadow!.detail).toContain('mode=shadow');
   expect(shadow!.detail).toContain('dist=construct:25');
   expect(shadow!.detail).toContain(`would=${episodeId}`);
   expect(shadow!.detail).toContain('wouldFacet=episode');
   expect(shadow!.detail).toContain(`open=${newestConstructId}`);
   expect(shadow!.detail).toContain('diverged=true');
  });

  it('live mode applies the filter before the pick', () => {
   vi.stubEnv('ELICIT_FACET_BALANCE', 'live');
   writeConstructHeavyVault();
   const { episodeId } = seedQueue();
   vi.spyOn(Math, 'random').mockReturnValue(0);

   const picked = store.draw(makeMode(), 'opening');

   // The episode is last by recency and would never reach the top-3 pool;
   // the filter removes the over-represented constructs first.
   expect(picked!.id).toBe(episodeId);
   const events = readLog().map((l) => JSON.parse(l) as { kind: string; detail: string });
   expect(events.some((e) => e.kind === 'facet-balance-applied')).toBe(true);
  });

  it('never starves the draw: untagged entries still get asked', () => {
   vi.stubEnv('ELICIT_FACET_BALANCE', 'live');
   writeConstructHeavyVault();
   store.add(makeDraft({ question: 'untagged' }));

   const picked = store.draw(makeMode(), 'opening');

   expect(picked).not.toBeNull();
   expect(picked!.question).toBe('untagged');
   const events = readLog().map((l) => JSON.parse(l) as { detail: string });
   expect(events.some((e) => e.detail.includes('applied=false'))).toBe(true);
  });

  it('logs the distribution even when the filter has nothing to say', () => {
   store.add(makeDraft({ question: 'only one' }));
   expect(store.draw(makeMode(), 'opening')).not.toBeNull();
   const events = readLog().map((l) => JSON.parse(l) as { kind: string; detail: string });
   const shadow = events.find((e) => e.kind === 'facet-balance-shadow');
   expect(shadow!.detail).toContain('dist=empty');
   expect(shadow!.detail).toContain('applied=false');
  });
 });

 // ── answeredAt and claim: declared in types, worthless until written (041) ──

 describe('optional fields the frontmatter has to carry', () => {
  /** The frontmatter of the single entry on disk, unmediated by the store. */
  function rawFrontmatter(): Record<string, unknown> {
   const dir = join(root, 'queue');
   const file = readdirSync(dir).find((f) => f.endsWith('.md'))!;
   return matter(readFileSync(join(dir, file), 'utf-8')).data as Record<string, unknown>;
  }

  it('markAnswered records answeredAt and both survive a fresh store', () => {
   const e = store.add(makeDraft());
   const before = Date.now();
   store.markAnswered(e.id);

   const reloaded = createQueueStore(root).list()[0]!;
   expect(reloaded.status).toBe('answered');
   expect(reloaded.answeredAt).toBeTypeOf('string');
   const at = new Date(reloaded.answeredAt!).getTime();
   expect(Number.isNaN(at)).toBe(false);
   expect(at).toBeGreaterThanOrEqual(before - 1000);
  });

  it('an unanswered entry writes no answeredAt key at all', () => {
   store.add(makeDraft());
   store.markAsked(store.list()[0]!.id);

   // A present key holding undefined would lose the whole write, so the
   // absence is asserted in the file, not only in the parsed entry.
   expect('answeredAt' in rawFrontmatter()).toBe(false);
   expect('answeredAt' in createQueueStore(root).list()[0]!).toBe(false);
  });

  it('claim roundtrips, and answering an entry keeps it', () => {
   const claim = '01K0000000000000000000000A';
   const e = store.add(makeDraft({ source: 'lint-still-true', claim }));
   expect(createQueueStore(root).list()[0]!.claim).toBe(claim);

   store.markAnswered(e.id);
   const reloaded = createQueueStore(root).list()[0]!;
   expect(reloaded.claim).toBe(claim);
   expect(reloaded.status).toBe('answered');
  });

  it('an entry added without a claim reads back with the key absent', () => {
   store.add(makeDraft());
   expect('claim' in rawFrontmatter()).toBe(false);
   expect('claim' in createQueueStore(root).list()[0]!).toBe(false);
  });

  it('claims roundtrips, and answering an entry keeps it (ticket 060)', () => {
   const pair = ['01K0000000000000000000000A', '01K0000000000000000000000B'];
   const e = store.add(makeDraft({ source: 'lint-undiscriminated-range', claims: pair }));
   expect(createQueueStore(root).list()[0]!.claims).toEqual(pair);

   store.markAnswered(e.id);
   const reloaded = createQueueStore(root).list()[0]!;
   expect(reloaded.claims).toEqual(pair);
   expect(reloaded.status).toBe('answered');
  });

  it('an entry added without claims reads back with the key absent', () => {
   store.add(makeDraft());
   expect('claims' in rawFrontmatter()).toBe(false);
   expect('claims' in createQueueStore(root).list()[0]!).toBe(false);
  });
 });

 // ── the degradation ladder: two rungs and a composing floor (Q-55) ──

 describe('degradation ladder', () => {
  type Ev = { kind: string; detail: string; refs?: string[] };

  /** Every event the draw wrote, in order. Empty when nothing was logged. */
  function events(): Ev[] {
   const dir = join(root, 'log');
   let files: string[];
   try {
    files = readdirSync(dir);
   } catch {
    return [];
   }
   return files.flatMap((f) =>
    readFileSync(join(dir, f), 'utf-8')
     .split('\n')
     .filter((l) => l.trim())
     .map((l) => JSON.parse(l) as Ev),
   );
  }

  const rungs = (): Ev[] => events().filter((e) => e.kind === 'queue-rung');
  const floors = (): Ev[] => events().filter((e) => e.kind === 'queue-floor');

  /** 25 construct readings: every Facet but construct is owed material. */
  function writeConstructHeavyVault(): void {
   const dir = join(root, 'wiki', 'readings');
   mkdirSync(dir, { recursive: true });
   for (let i = 0; i < 25; i++) {
    writeFileSync(
     join(dir, `r${i}.md`),
     '---\nfacet: construct\nstance: avowal\ncites: []\n---\nA reading.\n',
    );
   }
  }

  afterEach(() => {
   vi.useRealTimers();
   vi.unstubAllEnvs();
   vi.restoreAllMocks();
  });

  // ── rung 2: the person's declaration outranks the system's judgement ──

  it('re-admits a user-declared entry the sharpness filter excluded', () => {
   const ud = store.add(
    makeDraft({ source: 'user-declared', question: 'the bookmark', sharpness: 'sharp' }),
   );

   const drawn = store.draw(makeMode(), 'opening');

   expect(drawn).not.toBeNull();
   expect(drawn!.id).toBe(ud.id);
   // Drawn is drawn: the rung does not skip the normal bookkeeping.
   expect(store.list().find((e) => e.id === ud.id)!.status).toBe('asked');

   expect(rungs()).toHaveLength(1);
   expect(rungs()[0]!.detail).toContain('rung=2');
   expect(rungs()[0]!.detail).toContain('relaxed=sharpness');
   expect(rungs()[0]!.detail).toContain('before=0');
   expect(rungs()[0]!.detail).toContain('after=1');
   expect(floors()).toHaveLength(0);
  });

  it('re-admits a user-declared entry modeNeeds excluded', () => {
   const ud = store.add(
    makeDraft({
     source: 'user-declared',
     question: 'the long one',
     modeNeeds: { minMinutes: 60, energy: 'high' },
    }),
   );

   const drawn = store.draw(makeMode({ minutes: 15, energy: 'low' }), 'opening');

   expect(drawn!.id).toBe(ud.id);
   expect(rungs()).toHaveLength(1);
   expect(rungs()[0]!.detail).toContain('relaxed=modeNeeds');
  });

  it('names both constraints when both had to yield', () => {
   store.add(
    makeDraft({
     source: 'user-declared',
     sharpness: 'sharp',
     modeNeeds: { minMinutes: 60 },
    }),
   );

   expect(store.draw(makeMode({ minutes: 15 }), 'opening')).not.toBeNull();
   const detail = rungs()[0]!.detail;
   expect(detail).toContain('modeNeeds');
   expect(detail).toContain('sharpness');
  });

  it('chance still runs inside the rung-2 pool — the pick is not argmax', () => {
   // Four sharp user-declared entries: the opening pool is empty, rung 2
   // admits all four, and top-k=3 plus a roll decides which one is asked.
   vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
   store.add(makeDraft({ source: 'user-declared', question: 'U1', sharpness: 'sharp' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:01Z'));
   store.add(makeDraft({ source: 'user-declared', question: 'U2', sharpness: 'sharp' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:02Z'));
   store.add(makeDraft({ source: 'user-declared', question: 'U3', sharpness: 'sharp' }));
   vi.setSystemTime(new Date('2026-06-01T12:00:03Z'));
   store.add(makeDraft({ source: 'user-declared', question: 'U4', sharpness: 'sharp' }));
   vi.useRealTimers();

   vi.spyOn(Math, 'random').mockReturnValue(0);
   const first = store.draw(makeMode(), 'opening')!;
   vi.spyOn(Math, 'random').mockReturnValue(0.99);
   const last = store.draw(makeMode(), 'opening')!;

   expect(first.id).not.toBe(last.id);
   // Newest first: the roll of 0 takes U4, and the roll of 0.99 reaches the
   // far end of what is left. The rung constrains, chance chooses.
   expect([first.question, last.question].sort()).toEqual(['U1', 'U4']);
  });

  // ── never relaxed: status, Target, horizon ──

  it('an agent-minted pool draws nothing and the floor names the emptying filter', () => {
   store.add(makeDraft({ source: 'composed', sharpness: 'sharp' }));

   expect(store.draw(makeMode(), 'opening')).toBeNull();

   expect(rungs()).toHaveLength(0);
   expect(floors()).toHaveLength(1);
   expect(floors()[0]!.detail).toContain('emptiedBy=sharpness');
  });

  it('a user-declared entry excluded by Target is not re-admitted', () => {
   store.add(makeDraft({ source: 'user-declared', question: 'self Q', target: 'self' }));

   expect(store.draw(makeMode({ target: 'domain' }), 'opening')).toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()[0]!.detail).toContain('emptiedBy=target');
  });

  it('an answered entry is never drawn at any rung', () => {
   const ud = store.add(
    makeDraft({ source: 'user-declared', question: 'done', sharpness: 'sharp' }),
   );
   store.markAnswered(ud.id);

   expect(store.draw(makeMode(), 'opening')).toBeNull();
   expect(store.draw(makeMode(), 'late')).toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()[0]!.detail).toContain('emptiedBy=status');
  });

  it('a user-declared days-horizon entry is not re-admitted', () => {
   store.add(makeDraft({ source: 'user-declared', horizon: 'days', sharpness: 'sharp' }));

   expect(store.draw(makeMode(), 'opening')).toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()[0]!.detail).toContain('emptiedBy=sharpness');
  });

  it('an empty queue reaches the floor without blaming a filter', () => {
   expect(store.draw(makeMode(), 'opening')).toBeNull();

   expect(floors()).toHaveLength(1);
   expect(floors()[0]!.detail).toContain('emptiedBy=none');
   expect(floors()[0]!.detail).toContain('pool=0');
  });

  // ── rung 1: the system drops its own inference first ──

  it('logs rung 1 when facet balance would have emptied the pool', () => {
   writeConstructHeavyVault();
   store.add(makeDraft({ question: 'untagged' }));

   expect(store.draw(makeMode(), 'opening')).not.toBeNull();

   expect(rungs()).toHaveLength(1);
   expect(rungs()[0]!.detail).toContain('rung=1');
   expect(rungs()[0]!.detail).toContain('relaxed=facet-balance');
   expect(rungs()[0]!.detail).toContain('before=0');
   expect(rungs()[0]!.detail).toContain('after=1');
  });

  it('does not log rung 1 when facet balance leaves the pool alone', () => {
   writeConstructHeavyVault();
   store.add(makeDraft({ question: 'an episode', targetFacet: 'episode' }));

   expect(store.draw(makeMode(), 'opening')).not.toBeNull();
   expect(rungs()).toHaveLength(0);
  });

  it('a cold-start corpus is not a rung — the filter never had a claim to drop', () => {
   // No readings at all: every Facet is owed, so facet balance stands down
   // because it has nothing to say, not because it would empty the pool.
   store.add(makeDraft({ question: 'only one' }));

   expect(store.draw(makeMode(), 'opening')).not.toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()).toHaveLength(0);
  });
 });
});
