import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import { createQueueStore } from '../src/queue/queue.js';
import { readEvents } from '../src/log/activity.js';
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
  horizon: 'now',
  ...overrides,
 };
}

function makeMode(overrides?: Partial<Mode>): Mode {
 return {
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

 // ── draw: days-horizon never drawn ──

 it('days-horizon entries are never drawn into exchange', () => {
  store.add(makeDraft({ horizon: 'days' }));
  store.add(makeDraft({ horizon: 'session' }));

  const drawn = store.draw(makeMode());
  expect(drawn).not.toBeNull();
  expect(drawn!.horizon).toBe('session');
 });

 it('draw returns null when all pending entries are days-horizon', () => {
  store.add(makeDraft({ horizon: 'days' }));

  const drawn = store.draw(makeMode());
  expect(drawn).toBeNull();
 });

 // ── draw: markAsked prevents re-draw ──

 it('drawn entry is marked asked and not re-drawn', () => {
  const e1 = store.add(makeDraft({ question: 'Q1' }));
  const e2 = store.add(makeDraft({ question: 'Q2' }));

  const first = store.draw(makeMode());
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

  const first = store.draw(makeMode());
  const second = store.draw(makeMode());

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

  const first = store.draw(makeMode());
  expect(first).not.toBeNull();
  expect(first!.source).toBe('user-declared');
  expect(first!.id).toBe(ud.id);

  randSpy.mockRestore();

  // remaining 3 composed → draw 2 more; 3rd remains pending in top-3 pool
  for (let i = 0; i < 2; i++) {
   const d = store.draw(makeMode());
   expect(d).not.toBeNull();
  }

  const remaining = store.list({ status: 'pending' });
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.source).toBe('composed');
 });

 // ── the gap sources (Q-39): weight, rung 2, expiry, round-trip ──

 it('a gap-declared entry outranks composed, like user-declared (Q-39)', () => {
  // The gap-declared entry is the OLDEST of the four: only weight can put it
  // first, so this fails exactly when the source stops weighing as the
  // person's own declaration.
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
  const declared = store.add(makeDraft({ source: 'gap-declared', question: 'GD' }));
  vi.setSystemTime(new Date('2026-06-01T12:00:01Z'));
  store.add(makeDraft({ source: 'composed', question: 'C1' }));
  vi.setSystemTime(new Date('2026-06-01T12:00:02Z'));
  store.add(makeDraft({ source: 'composed', question: 'C2' }));
  vi.setSystemTime(new Date('2026-06-01T12:00:03Z'));
  store.add(makeDraft({ source: 'composed', question: 'C3' }));
  vi.useRealTimers();

  vi.spyOn(Math, 'random').mockReturnValue(0);
  const first = store.draw(makeMode());
  expect(first).not.toBeNull();
  expect(first!.source).toBe('gap-declared');
  expect(first!.id).toBe(declared.id);
  vi.restoreAllMocks();
 });

 it('a gap-fill entry does not outrank composed — it draws as any mint (Q-39)', () => {
  // The gap-fill entry is the OLDEST: with the correct weight it falls last
  // by recency and never reaches the top-3; with the person's-own weight it
  // would be drawn first.
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
  store.add(makeDraft({ source: 'gap-fill', question: 'GF' }));
  vi.setSystemTime(new Date('2026-06-01T12:00:01Z'));
  store.add(makeDraft({ source: 'composed', question: 'C1' }));
  vi.setSystemTime(new Date('2026-06-01T12:00:02Z'));
  store.add(makeDraft({ source: 'composed', question: 'C2' }));
  vi.setSystemTime(new Date('2026-06-01T12:00:03Z'));
  store.add(makeDraft({ source: 'composed', question: 'C3' }));
  vi.useRealTimers();

  vi.spyOn(Math, 'random').mockReturnValue(0);
  const first = store.draw(makeMode());
  expect(first).not.toBeNull();
  expect(first!.source).toBe('composed');
  expect(first!.question).toBe('C3');
  vi.restoreAllMocks();
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

 it('expires pending entries of either gap source at 30 days, like any agent-minted entry (Q-41)', () => {
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const declared = store.add(makeDraft({ source: 'gap-declared', question: 'GD old' }));
  const fill = store.add(makeDraft({ source: 'gap-fill', question: 'GF old' }));
  const ud = store.add(makeDraft({ source: 'user-declared', question: 'UD old' }));

  // The gap sources expire on the normal rule; only a hand-typed declaration
  // is immune — the asymmetry is the whole point (Q-41).
  vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
  const store2 = createQueueStore(root);
  const count = store2.expire(30);

  vi.useRealTimers();

  expect(count).toBe(2);
  const all = store2.list();
  expect(all.find((e) => e.id === declared.id)!.status).toBe('expired');
  expect(all.find((e) => e.id === fill.id)!.status).toBe('expired');
  expect(all.find((e) => e.id === ud.id)!.status).toBe('pending');
 });

 // ── expireTailBeyond (QR-6): the flood bound's tail expiry ──

/** Write an entry with a chosen creation time directly, like the expire tests above. */
function writeDatedEntry(created: string, overrides: Partial<QueueEntry> = {}) {
 const queueDir = join(root, 'queue');
 mkdirSync(queueDir, { recursive: true });
 const entry: QueueEntry = {
  id: ulid(),
  status: 'pending',
  source: 'composed',
  license: 'test',
  question: 'Q?',
  questionForm: 'deliberative',
  horizon: 'days',
  created,
  ...overrides,
 };
 const { id, status, source, ...rest } = entry;
 const content = matter.stringify('', { id, status, source, ...rest });
 writeFileSync(join(queueDir, `${id}.md`), content, 'utf-8');
 return entry;
}

it('expireTailBeyond keeps the newest keep open entries and expires the tail', () => {
 const oldest = writeDatedEntry('2026-01-01T00:00:00.000Z');
 const older = writeDatedEntry('2026-02-01T00:00:00.000Z');
 const middle = writeDatedEntry('2026-03-01T00:00:00.000Z', { horizon: 'session' });
 const newer = writeDatedEntry('2026-04-01T00:00:00.000Z');
 const newest = writeDatedEntry('2026-05-01T00:00:00.000Z', { horizon: 'session' });

 const count = store.expireTailBeyond(2);

 expect(count).toBe(3);
 const all = store.list();
 expect(all.find((e) => e.id === newest.id)!.status).toBe('pending');
 expect(all.find((e) => e.id === newer.id)!.status).toBe('pending');
 expect(all.find((e) => e.id === middle.id)!.status).toBe('expired');
 expect(all.find((e) => e.id === older.id)!.status).toBe('expired');
 expect(all.find((e) => e.id === oldest.id)!.status).toBe('expired');
});

it('expireTailBeyond never expires a user-declared entry, even beyond keep', () => {
 const ud = writeDatedEntry('2026-01-01T00:00:00.000Z', { source: 'user-declared' });
 const fill = writeDatedEntry('2026-02-01T00:00:00.000Z', { source: 'gap-fill' });
 const composed = writeDatedEntry('2026-03-01T00:00:00.000Z', { source: 'composed' });

 const count = store.expireTailBeyond(1);

 // The default filter is the open pool MINUS user-declared entries, so the
 // user-declared entry is not even a candidate: it survives whatever the
 // cap says. Of the two agent entries, one slot is kept (newest first).
 expect(count).toBe(1);
 const all = store.list();
 expect(all.find((e) => e.id === ud.id)!.status).toBe('pending');
 expect(all.find((e) => e.id === composed.id)!.status).toBe('pending');
 expect(all.find((e) => e.id === fill.id)!.status).toBe('expired');
});

it('expireTailBeyond default filter is the open pool: horizon now entries are not candidates', () => {
 const nowHorizon = writeDatedEntry('2026-01-01T00:00:00.000Z', { horizon: 'now' });
 const dayHorizon = writeDatedEntry('2026-02-01T00:00:00.000Z', { horizon: 'days' });

 const count = store.expireTailBeyond(0);

 expect(count).toBe(1);
 const all = store.list();
 expect(all.find((e) => e.id === nowHorizon.id)!.status).toBe('pending');
 expect(all.find((e) => e.id === dayHorizon.id)!.status).toBe('expired');
});

it('expireTailBeyond honours a custom filter: only matching entries are candidates', () => {
 const gap = writeDatedEntry('2026-01-01T00:00:00.000Z', { source: 'gap-fill' });
 const composed = writeDatedEntry('2026-02-01T00:00:00.000Z', { source: 'composed' });

 const count = store.expireTailBeyond(0, (e) => e.source === 'gap-fill');

 expect(count).toBe(1);
 const all = store.list();
 expect(all.find((e) => e.id === gap.id)!.status).toBe('expired');
 expect(all.find((e) => e.id === composed.id)!.status).toBe('pending');
});

it('expireTailBeyond logs one summary line to the Activity Log and is idempotent', () => {
 writeDatedEntry('2026-01-01T00:00:00.000Z');
 writeDatedEntry('2026-02-01T00:00:00.000Z');

 const first = store.expireTailBeyond(1);
 const second = store.expireTailBeyond(1);

 expect(first).toBe(1);
 // Nothing left pending in the open pool: the second call expires nothing.
 expect(second).toBe(0);

 const events = readEvents(root).filter((e) => e.kind === 'queue-tail-expired');
 expect(events).toHaveLength(1);
 expect(events[0]!.detail).toContain('expired=1');
});

it('markExpired sets one entry to expired and writes it back; unknown id is a no-op', () => {
 const entry = store.add(makeDraft({ horizon: 'days' }));

 store.markExpired(entry.id);
 store.markExpired('no-such-id');

 const reread = store.list().find((e) => e.id === entry.id);
 expect(reread!.status).toBe('expired');
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

  const drawn = store.draw(makeMode());
  expect(drawn).not.toBeNull();
  expect(drawn!.id).toBe(e.id);
 });

 // ── park / unpark (ruled 2026-08-04): the person's own act ──

 it('park transitions pending → parked; only a pending entry parks', () => {
  const e = store.add(makeDraft());
  store.park(e.id);
  expect(store.list().find((x) => x.id === e.id)!.status).toBe('parked');

  const answered = store.add(makeDraft());
  store.markAnswered(answered.id);
  store.park(answered.id); // no-op: not pending
  expect(store.list().find((x) => x.id === answered.id)!.status).toBe('answered');
 });

 it('a parked entry is never drawn and never expired', () => {
  const e = store.add(makeDraft());
  store.park(e.id);

  expect(store.draw(makeMode())).toBeNull();

  // Age it far past any cutoff: the sweep only expires pending entries.
  expect(store.expire(0)).toBe(0);
  expect(store.list().find((x) => x.id === e.id)!.status).toBe('parked');
 });

 it('unpark re-opens with the expiry clock restarted', () => {
  const e = store.add(makeDraft());
  store.park(e.id);
  const before = Date.now();
  store.unpark(e.id);

  const reread = store.list().find((x) => x.id === e.id)!;
  expect(reread.status).toBe('pending');
  // Without the refresh, a long-parked question would re-open already past
  // the sweep's age cutoff and vanish on the next docket run.
  expect(new Date(reread.created).getTime()).toBeGreaterThanOrEqual(before - 1000);

  const pendingOnly = store.add(makeDraft());
  store.unpark(pendingOnly.id); // no-op: not parked
  expect(store.list().find((x) => x.id === pendingOnly.id)!.status).toBe('pending');
 });

 // ── optional fields roundtrip ──

 it('optional fields (cites, quotedFragment, direction) roundtrip', () => {
  const draft: QueueDraft = {
   source: 'composed',
   license: 'test',
   question: 'What about the thing?',
   questionForm: 'why',
   horizon: 'session',
   ...({ cites: ['abc@1', 'def@2'] } as Partial<QueueDraft>),
   ...({ quotedFragment: 'the thing' } as Partial<QueueDraft>),
   ...({ direction: 'forward' } as Partial<QueueDraft>),
  };

  const entry = store.add(draft);
  expect(entry.cites).toEqual(['abc@1', 'def@2']);
  expect(entry.quotedFragment).toBe('the thing');
  expect(entry.direction).toBe('forward');

  // Verify roundtrip through a fresh instance
  const store2 = createQueueStore(root);
  const reloaded = store2.list()[0]!;
  expect(reloaded.cites).toEqual(['abc@1', 'def@2']);
  expect(reloaded.quotedFragment).toBe('the thing');
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

   expect(store.draw(makeMode({ target: 'domain' }))).toBeNull();
  });

  it('a self sitting is never served domain material', () => {
   store.add(makeDraft({ question: 'domain Q', target: 'domain' }));

   expect(store.draw(makeMode({ target: 'self' }))).toBeNull();
  });

  it('filters the other target out of the pool without consuming it', () => {
   const domain = store.add(makeDraft({ question: 'domain Q', target: 'domain' }));
   store.add(makeDraft({ question: 'self Q', target: 'self' }));

   const drawn = store.draw(makeMode({ target: 'domain' }));
   expect(drawn!.id).toBe(domain.id);

   // The self entry was never a candidate, so it is still there to be asked
   // in a self sitting — filtered, not spent.
   expect(store.draw(makeMode({ target: 'domain' }))).toBeNull();
   const pending = store.list({ status: 'pending' });
   expect(pending.map((e) => e.question)).toEqual(['self Q']);
   expect(store.draw(makeMode({ target: 'self' }))!.question).toBe('self Q');
  });

  it('an entry with no target is eligible for either sitting', () => {
   const e = store.add(makeDraft({ question: 'untargeted' }));

   expect(store.draw(makeMode({ target: 'domain' }))!.id).toBe(e.id);
   store.defer(e.id);
   expect(store.draw(makeMode({ target: 'self' }))!.id).toBe(e.id);
  });

  it('a mode declaring no target draws either kind', () => {
   store.add(makeDraft({ question: 'domain Q', target: 'domain' }));

   expect(store.draw(makeMode())!.question).toBe('domain Q');
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
     horizon: 'now',
     created: new Date().toISOString(),
    }),
    'utf-8',
   );

   const store2 = createQueueStore(root);
   expect(store2.list()[0]!.target).toBeUndefined();
   expect(store2.draw(makeMode({ target: 'domain' }))!.id).toBe(id);
  });

  it('the other filters still apply inside the target pool', () => {
   store.add(makeDraft({ question: 'days', target: 'domain', horizon: 'days' }));

   const mode = makeMode({ target: 'domain' });
   expect(store.draw(mode)).toBeNull();

   store.add(makeDraft({ question: 'eligible', target: 'domain' }));
   expect(store.draw(mode)!.question).toBe('eligible');
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
   const first = store.draw(mode)!;
   vi.spyOn(Math, 'random').mockReturnValue(0.99);
   const last = store.draw(mode)!;

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

   const picked = store.draw(makeMode({ target: 'domain' }))!;

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

   const picked = store.draw(makeMode());

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

   const picked = store.draw(makeMode());

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

   const picked = store.draw(makeMode());

   expect(picked).not.toBeNull();
   expect(picked!.question).toBe('untagged');
   const events = readLog().map((l) => JSON.parse(l) as { detail: string });
   expect(events.some((e) => e.detail.includes('applied=false'))).toBe(true);
  });

  it('logs the distribution even when the filter has nothing to say', () => {
   store.add(makeDraft({ question: 'only one' }));
   expect(store.draw(makeMode())).not.toBeNull();
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

  it('gap roundtrips for both gap sources, and answering an entry keeps it', () => {
   const gapId = '01GAP000000000000000000000A';
   const declared = store.add(makeDraft({ source: 'gap-declared', gap: gapId }));
   let reloaded = createQueueStore(root).list().find((x) => x.id === declared.id)!;
   expect(reloaded.source).toBe('gap-declared');
   expect(reloaded.gap).toBe(gapId);
   expect('gap' in rawFrontmatter()).toBe(true);

   const fill = store.add(makeDraft({ source: 'gap-fill', gap: gapId }));
   const reloaded2 = createQueueStore(root).list().find((x) => x.id === fill.id)!;
   expect(reloaded2.source).toBe('gap-fill');
   expect(reloaded2.gap).toBe(gapId);
  });

  it('an entry added without a gap reads back with the key absent', () => {
   store.add(makeDraft());
   expect('gap' in rawFrontmatter()).toBe(false);
   expect('gap' in createQueueStore(root).list()[0]!).toBe(false);
  });

  it('soundingId roundtrips for a parked-sounding pointer (soundings)', () => {
   const ladder = '01K0000000000000000000000B';
   const e = store.add(makeDraft({ source: 'parked-sounding', soundingId: ladder }));
   expect(createQueueStore(root).list()[0]!.soundingId).toBe(ladder);
   expect(createQueueStore(root).list()[0]!.source).toBe('parked-sounding');

   store.markAnswered(e.id);
   const reloaded = createQueueStore(root).list()[0]!;
   expect(reloaded.soundingId).toBe(ladder);
   expect(reloaded.status).toBe('answered');
  });

  it('an entry added without a soundingId reads back with the key absent', () => {
   store.add(makeDraft());
   expect('soundingId' in rawFrontmatter()).toBe(false);
   expect('soundingId' in createQueueStore(root).list()[0]!).toBe(false);
  });

  it('quest roundtrips for a quest-reflection entry, and answering keeps it', () => {
   const questId = '01Q0000000000000000000000A';
   const e = store.add(makeDraft({ source: 'quest-reflection', quest: questId }));
   expect(createQueueStore(root).list()[0]!.quest).toBe(questId);
   expect('quest' in rawFrontmatter()).toBe(true);

   store.markAnswered(e.id);
   const reloaded = createQueueStore(root).list()[0]!;
   expect(reloaded.quest).toBe(questId);
   expect(reloaded.status).toBe('answered');
  });

  it('an entry added without a quest reads back with the key absent', () => {
   store.add(makeDraft());
   expect('quest' in rawFrontmatter()).toBe(false);
   expect('quest' in createQueueStore(root).list()[0]!).toBe(false);
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

  // ── never relaxed: status, Target, horizon ──

  it('an agent-minted pool draws nothing and the floor names the emptying filter', () => {
   store.add(makeDraft({ source: 'composed', horizon: 'days' }));

   expect(store.draw(makeMode())).toBeNull();

   expect(rungs()).toHaveLength(0);
   expect(floors()).toHaveLength(1);
   expect(floors()[0]!.detail).toContain('emptiedBy=horizon');
  });

  it('a user-declared entry excluded by Target is not re-admitted', () => {
   store.add(makeDraft({ source: 'user-declared', question: 'self Q', target: 'self' }));

   expect(store.draw(makeMode({ target: 'domain' }))).toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()[0]!.detail).toContain('emptiedBy=target');
  });

  it('an answered entry is never drawn at any rung', () => {
   const ud = store.add(
    makeDraft({ source: 'user-declared', question: 'done' }),
   );
   store.markAnswered(ud.id);

   expect(store.draw(makeMode())).toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()[0]!.detail).toContain('emptiedBy=status');
  });

  it('a user-declared days-horizon entry is never drawn', () => {
   store.add(makeDraft({ source: 'user-declared', horizon: 'days' }));

   expect(store.draw(makeMode())).toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()[0]!.detail).toContain('emptiedBy=horizon');
  });

  it('an empty queue reaches the floor without blaming a filter', () => {
   expect(store.draw(makeMode())).toBeNull();

   expect(floors()).toHaveLength(1);
   expect(floors()[0]!.detail).toContain('emptiedBy=none');
   expect(floors()[0]!.detail).toContain('pool=0');
  });

  // ── rung 1: the system drops its own inference first ──

  it('logs rung 1 when facet balance would have emptied the pool', () => {
   writeConstructHeavyVault();
   store.add(makeDraft({ question: 'untagged' }));

   expect(store.draw(makeMode())).not.toBeNull();

   expect(rungs()).toHaveLength(1);
   expect(rungs()[0]!.detail).toContain('rung=1');
   expect(rungs()[0]!.detail).toContain('relaxed=facet-balance');
   expect(rungs()[0]!.detail).toContain('before=0');
   expect(rungs()[0]!.detail).toContain('after=1');
  });

  it('does not log rung 1 when facet balance leaves the pool alone', () => {
   writeConstructHeavyVault();
   store.add(makeDraft({ question: 'an episode', targetFacet: 'episode' }));

   expect(store.draw(makeMode())).not.toBeNull();
   expect(rungs()).toHaveLength(0);
  });

  it('a cold-start corpus is not a rung — the filter never had a claim to drop', () => {
   // No readings at all: every Facet is owed, so facet balance stands down
   // because it has nothing to say, not because it would empty the pool.
   store.add(makeDraft({ question: 'only one' }));

   expect(store.draw(makeMode())).not.toBeNull();
   expect(rungs()).toHaveLength(0);
   expect(floors()).toHaveLength(0);
  });
 });
});

// ── Q-115: sitting-level engagement pause (ticket 148 reopened) ──

describe('sitting-level queue pause (Q-115)', () => {
 const OPENER = 'What did the harbor teach you about waiting?';
 const PIVOT = 'My mornings belong to the bakery and the bread schedule.';
 const ENGAGED = 'The harbor taught me waiting is its own kind of work.';

 function addOpener(n: number) {
  return store.add(makeDraft({
   question: OPENER,
   cites: [`${'0'.repeat(25)}${n}@1`],
  }));
 }

 it('two consecutive strike-sittings pause the draw; an engaged reply resets', () => {
  const e1 = addOpener(1);
  store.noteSittingStarted();
  expect(store.draw(makeMode())).not.toBeNull();
  store.recordReplyDisengagement(e1.id!, PIVOT);

  const e2 = addOpener(2);
  store.noteSittingStarted();
  expect(store.draw(makeMode())).not.toBeNull();
  store.recordReplyDisengagement(e2.id!, PIVOT);

  // Sitting 3 and 4: the cooldown (2 sittings) holds — nothing drawn.
  addOpener(3);
  store.noteSittingStarted();
  expect(store.draw(makeMode())).toBeNull();
  store.noteSittingStarted();
  expect(store.draw(makeMode())).toBeNull();

  // Sitting 5: the probe. It serves, and an ENGAGED reply resets everything.
  store.noteSittingStarted();
  const probe = store.draw(makeMode());
  expect(probe).not.toBeNull();
  store.recordReplyDisengagement(probe!.id!, ENGAGED);
  addOpener(4); // draw marks served entries asked — the pool needs a fresh one
  store.noteSittingStarted();
  expect(store.draw(makeMode())).not.toBeNull();
 });

 it('a failed probe doubles the cooldown', () => {
  const e1 = addOpener(1);
  store.noteSittingStarted();
  store.draw(makeMode());
  store.recordReplyDisengagement(e1.id!, PIVOT);
  const e2 = addOpener(2);
  store.noteSittingStarted();
  store.draw(makeMode());
  store.recordReplyDisengagement(e2.id!, PIVOT);

  // Cooldown 1: sittings 3-4 quiet, probe at 5 — pivoted again.
  store.noteSittingStarted();
  store.noteSittingStarted();
  addOpener(3);
  store.noteSittingStarted();
  const probe = store.draw(makeMode());
  expect(probe).not.toBeNull();
  store.recordReplyDisengagement(probe!.id!, PIVOT);

  // Cooldown 2 doubles to 4: sittings 6-9 quiet, serving again at 10.
  addOpener(4); // a fresh pending opener, so quiet draws prove the pause, not an empty pool
  for (let i = 0; i < 4; i++) {
   store.noteSittingStarted();
   expect(store.draw(makeMode())).toBeNull();
  }
  store.noteSittingStarted();
  expect(store.draw(makeMode())).not.toBeNull();
 });

 it('one pivot per sitting counts once — two brush-offs in one sitting are one strike', () => {
  const e1 = addOpener(1);
  const e2 = addOpener(2);
  store.noteSittingStarted();
  store.recordReplyDisengagement(e1.id!, PIVOT);
  store.recordReplyDisengagement(e2.id!, PIVOT);
  // Still one strike: the next sitting draws normally.
  store.noteSittingStarted();
  expect(store.draw(makeMode())).not.toBeNull();
 });

 it('the pause survives a restart — the ledger is on disk', () => {
  const e1 = addOpener(1);
  store.noteSittingStarted();
  store.recordReplyDisengagement(e1.id!, PIVOT);
  const e2 = addOpener(2);
  store.noteSittingStarted();
  store.recordReplyDisengagement(e2.id!, PIVOT);

  const reopened = createQueueStore(root);
  reopened.noteSittingStarted();
  expect(reopened.draw(makeMode())).toBeNull();
 });

 it('logs queue-paused with the cooldown length', () => {
  const e1 = addOpener(1);
  store.noteSittingStarted();
  store.recordReplyDisengagement(e1.id!, PIVOT);
  const e2 = addOpener(2);
  store.noteSittingStarted();
  store.recordReplyDisengagement(e2.id!, PIVOT);
  const paused = readEvents(root).filter((e) => e.kind === 'queue-paused');
  expect(paused).toHaveLength(1);
  expect(paused[0]!.detail).toContain('sittings=2');
 });
});
