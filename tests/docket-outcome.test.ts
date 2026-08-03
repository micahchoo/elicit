import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVault } from '../src/vault/vault.js';
import { createAnnotationStore } from '../src/clerk/annotation-store.js';
import type { AnnotationStore } from '../src/clerk/annotation-store.js';
import type { SittingContext } from '../src/clerk/composed.js';
import { makeScriptedComplete } from './fakes.js';
import type {
  Vault,
  QueueStore,
  QueueEntry,
  QueueDraft,
  Snippet,
  Complete,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// The two ticket-106 jobs, imported fresh per test so module-level state
// (the in-memory outcome cursor default) never leaks between tests. This is
// the same dynamic-import-under-resetModules pattern tests/docket.test.ts
// uses for runDocket — a static import would bind the jobs once at load.
// ---------------------------------------------------------------------------

let runIntentionHorizonAnnotations: (
  deps: {
    vault: Vault;
    annotations: AnnotationStore;
    complete: Complete;
    modelName: string;
    queue: QueueStore;
    log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
  },
) => Promise<{ annotated: number; silent: number; ambiguous: number; failed: number }>;

let runOutcomeQuestions: (
  deps: {
    annotations: AnnotationStore;
    queue: QueueStore;
    complete: Complete;
    vault: Vault;
    log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
    sittingOf?: (root: string, session: string) => SittingContext;
    vaultRoot: string;
    outcomeCursor?: { read: () => number; write: (offset: number) => void };
  },
) => Promise<{ minted: number }>;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../src/clerk/docket.js');
  runIntentionHorizonAnnotations = mod.runIntentionHorizonAnnotations;
  runOutcomeQuestions = mod.runOutcomeQuestions;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MODEL = 'test-model';
const HORIZON_JSON = JSON.stringify({ horizon: 'days' });

/** A queue that records everything added and never expires anything. */
function makeFakeQueue(entries?: QueueEntry[]): QueueStore & { _entries: QueueEntry[] } {
  const _entries: QueueEntry[] = entries ? [...entries] : [];
  return {
    _entries,
    add(e: QueueDraft): QueueEntry {
      const entry: QueueEntry = {
        ...e,
        id: `q-${_entries.length}`,
        status: 'pending',
        created: new Date().toISOString(),
      } as QueueEntry;
      _entries.push(entry);
      return entry;
    },
    list(filter?) {
      if (!filter) return [..._entries];
      return _entries.filter((e) => {
        if (filter.status !== undefined && e.status !== filter.status) return false;
        if (filter.source !== undefined && e.source !== filter.source) return false;
        return true;
      });
    },
    draw() { return null; },
    markAsked() { },
    markAnswered() { },
    defer() { },
    expire() { return 0; },
    expireTailBeyond() { return 0; },
    markExpired() { },
  };
}

/** An intention snippet with its intention-facet reading, saved on disk. */
function saveIntention(vault: Vault, prose: string, session: string): Snippet {
  const s = vault.saveSnippet(prose, {
    kind: 'harvest',
    session,
    question: 'What are you planning to do?',
    questionForm: 'deliberative',
  });
  vault.saveReading({
    facet: 'intention',
    stance: 'commitment',
    reading: 'an intention to act',
    cites: [`${s.id}@${s.version}`],
  });
  return s;
}

/** An ISO timestamp `daysBack` days in the past (the horizon-elapsed window). */
function pastIso(daysBack: number): string {
  return new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
}

/** A canned outcome-question answer that quotes the intention and passes the gates. */
function outcomeAnswer(prose: string): string {
  return `You wrote "${prose}" Did it come to pass?`;
}

/**
 * The order the job reads candidates: the annotation store lists records
 * sorted by snippet id, so scripts must be keyed to id order, never seed
 * order — ULIDs generated in the same millisecond sort nondeterministically.
 */
function byId(snippets: Snippet[]): Snippet[] {
  return [...snippets].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// runIntentionHorizonAnnotations (ticket 106)
// ---------------------------------------------------------------------------

describe('runIntentionHorizonAnnotations', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'docket-horizon-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stores intention-horizon annotations for intention-facet snippets', async () => {
    const vault = createVault(root);
    const a = saveIntention(vault, 'I will finish the quarterly review by Friday.', 's-a');
    const b = saveIntention(vault, 'I will plant the garden beds by next month.', 's-b');
    const annotations = createAnnotationStore(join(root, 'annotations'));

    const complete = vi.fn(makeScriptedComplete([HORIZON_JSON, HORIZON_JSON]));
    const res = await runIntentionHorizonAnnotations({
      vault,
      annotations,
      complete,
      modelName: MODEL,
      queue: makeFakeQueue(),
      log: vi.fn(),
    });

    expect(res).toEqual({ annotated: 2, silent: 0, ambiguous: 0, failed: 0 });
    expect(complete).toHaveBeenCalledTimes(2);
    for (const s of [a, b]) {
      const rec = annotations.get(s.id, 'intention-horizon');
      expect(rec).not.toBeNull();
      if (rec !== null && rec.kind === 'intention-horizon') {
        expect(rec.snippetId).toBe(s.id);
        expect(rec.version).toBe(s.version);
        expect(rec.horizon).toBe('days');
        expect(rec.model).toBe(MODEL);
        expect(typeof rec.modelAt).toBe('string');
      } else {
        throw new Error('expected an intention-horizon record');
      }
    }
  });

  it('ignores snippets without an intention-facet reading', async () => {
    const vault = createVault(root);
    const other = vault.saveSnippet('The bakery opens at six.', {
      kind: 'harvest',
      session: 's-other',
      question: 'What matters?',
      questionForm: 'deliberative',
    });
    vault.saveReading({
      facet: 'fact',
      stance: 'report-of-fact',
      reading: 'a fact, not an intention',
      cites: [`${other.id}@1`],
    });
    const annotations = createAnnotationStore(join(root, 'annotations'));

    const complete = vi.fn(makeScriptedComplete([]));
    const res = await runIntentionHorizonAnnotations({
      vault,
      annotations,
      complete,
      modelName: MODEL,
      queue: makeFakeQueue(),
      log: vi.fn(),
    });

    expect(res).toEqual({ annotated: 0, silent: 0, ambiguous: 0, failed: 0 });
    expect(complete).not.toHaveBeenCalled();
    expect(annotations.list('intention-horizon')).toHaveLength(0);
  });

  it('enforces the HORIZON_RUN_CAP of 3 candidates per run', async () => {
    const vault = createVault(root);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(saveIntention(vault, `Intention number ${i + 1} to complete on time.`, `s-${i}`).id);
    }
    const annotations = createAnnotationStore(join(root, 'annotations'));

    const complete = vi.fn(makeScriptedComplete([HORIZON_JSON, HORIZON_JSON, HORIZON_JSON]));
    const res = await runIntentionHorizonAnnotations({
      vault,
      annotations,
      complete,
      modelName: MODEL,
      queue: makeFakeQueue(),
      log: vi.fn(),
    });

    expect(res).toEqual({ annotated: 3, silent: 0, ambiguous: 0, failed: 0 });
    expect(complete).toHaveBeenCalledTimes(3);
    // Only the three asked snippets carry a record; the other two are untouched.
    expect(annotations.list('intention-horizon')).toHaveLength(3);
    const unannotated = ids.filter(
      (id) => annotations.get(id, 'intention-horizon') === null,
    );
    expect(unannotated).toHaveLength(2);
  });

  it('re-annotates only when the snippet version has changed', async () => {
    const vault = createVault(root);
    const s = saveIntention(vault, 'I plan to move out by spring.', 's-move');
    const annotations = createAnnotationStore(join(root, 'annotations'));
    annotations.put({
      kind: 'intention-horizon',
      snippetId: s.id,
      version: 1,
      horizon: 'days',
      model: 'old-model',
      modelAt: new Date().toISOString(),
    });

    // Current version — already read, never re-asked.
    const complete1 = vi.fn(makeScriptedComplete([]));
    const res1 = await runIntentionHorizonAnnotations({
      vault,
      annotations,
      complete: complete1,
      modelName: MODEL,
      queue: makeFakeQueue(),
      log: vi.fn(),
    });
    expect(res1).toEqual({ annotated: 0, silent: 1, ambiguous: 0, failed: 0 });
    expect(complete1).not.toHaveBeenCalled();

    // New version is new text — re-annotated, and the record is overwritten.
    const v2 = vault.saveVersion(s.id, 'I plan to move out by summer.');
    const complete2 = vi.fn(makeScriptedComplete([JSON.stringify({ horizon: 'session' })]));
    const res2 = await runIntentionHorizonAnnotations({
      vault,
      annotations,
      complete: complete2,
      modelName: MODEL,
      queue: makeFakeQueue(),
      log: vi.fn(),
    });
    expect(res2).toEqual({ annotated: 1, silent: 0, ambiguous: 0, failed: 0 });
    expect(complete2).toHaveBeenCalledTimes(1);
    const rec = annotations.get(s.id, 'intention-horizon');
    expect(rec).not.toBeNull();
    if (rec !== null && rec.kind === 'intention-horizon') {
      expect(rec.version).toBe(v2.version);
      expect(rec.horizon).toBe('session');
      expect(rec.model).toBe(MODEL);
    } else {
      throw new Error('expected a fresh intention-horizon record');
    }
  });

  it('mints a dating question in the queue when the horizon is ambiguous', async () => {
    const vault = createVault(root);
    const s = saveIntention(vault, 'I plan to finish the migration at some point.', 's-mig');
    const annotations = createAnnotationStore(join(root, 'annotations'));
    const q = makeFakeQueue();
    const log = vi.fn();

    const complete = vi.fn(makeScriptedComplete([
      JSON.stringify({ ambiguous: true, datingQuestion: 'When did you expect to finish the migration?' }),
    ]));
    const res = await runIntentionHorizonAnnotations({
      vault,
      annotations,
      complete,
      modelName: MODEL,
      queue: q,
      log,
    });

    expect(res).toEqual({ annotated: 0, silent: 0, ambiguous: 1, failed: 0 });
    expect(complete).toHaveBeenCalledTimes(1);
    // No horizon record is written for an ambiguous answer — the person's
    // dating question is the record, and the Anchor rule forbids a guess.
    expect(annotations.get(s.id, 'intention-horizon')).toBeNull();
    expect(q._entries).toHaveLength(1);
    const entry = q._entries[0]!;
    expect(entry.source).toBe('composed');
    expect(entry.question).toBe('When did you expect to finish the migration?');
    expect(entry.questionForm).toBe('deliberative');
    expect(entry.horizon).toBe('session');
    expect(entry.sharpness).toBe('weak');
    expect(entry.cites).toEqual([`${s.id}@1`]);
    // Ticket 114, QR-4: the dating question is model prose, not a user
    // quote — no quotedFragment, so the UI shows no "from your own words"
    // label for it. The cites field already links the snippet.
    expect(entry.quotedFragment).toBeUndefined();
    const events = log.mock.calls.map((call) => call[0] as { kind: string });
    expect(events.some((e) => e.kind === 'intention-horizon-ambiguous')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runOutcomeQuestions (ticket 106)
// ---------------------------------------------------------------------------

describe('runOutcomeQuestions', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'docket-outcome-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  type Fixture = {
    vault: Vault;
    snippets: Snippet[];
    annotations: AnnotationStore;
  };

  /** Past-horizon intentions with real snippets on disk and records in the store. */
  async function seedPastIntentions(
    horizons: Array<{ horizon: 'now' | 'session' | 'days'; daysBack: number; prose: string }>,
  ): Promise<Fixture> {
    const vault = createVault(root);
    const annotations = createAnnotationStore(join(root, 'annotations'));
    const snippets: Snippet[] = [];
    for (const h of horizons) {
      const s = vault.saveSnippet(h.prose, {
        kind: 'harvest',
        session: `s-${snippets.length}`,
        question: 'What are you planning to do?',
        questionForm: 'deliberative',
      });
      snippets.push(s);
      annotations.put({
        kind: 'intention-horizon',
        snippetId: s.id,
        version: s.version,
        horizon: h.horizon,
        model: MODEL,
        modelAt: pastIso(h.daysBack),
      });
    }
    return { vault, snippets, annotations };
  }

  it('mints outcome questions for past-horizon intentions', async () => {
    const { vault, snippets, annotations } = await seedPastIntentions([
      { horizon: 'now', daysBack: 1, prose: 'I will finish the quarterly review by Friday.' },
      { horizon: 'days', daysBack: 10, prose: 'I will plant the garden beds by next month.' },
    ]);
    const complete = vi.fn(makeScriptedComplete(
      byId(snippets).map((s) => outcomeAnswer(s.prose)),
    ));
    const writes: number[] = [];
    const q = makeFakeQueue();

    const res = await runOutcomeQuestions({
      annotations,
      queue: q,
      complete,
      vault,
      log: vi.fn(),
      sittingOf: () => ({}),
      vaultRoot: root,
      outcomeCursor: { read: () => 0, write: (o) => writes.push(o) },
    });

    expect(res).toEqual({ minted: 2 });
    expect(complete).toHaveBeenCalledTimes(2);
    const outcomeEntries = q._entries.filter((e) => e.source === 'outcome');
    expect(outcomeEntries).toHaveLength(2);
    const byCite = new Map(outcomeEntries.map((e) => [e.cites?.[0], e]));
    for (const s of snippets) {
      const entry = byCite.get(`${s.id}@${s.version}`);
      expect(entry).toBeTruthy();
      if (entry) {
        expect(entry.question).toBe(outcomeAnswer(s.prose));
        expect(entry.questionForm).toBe('deliberative');
        expect(entry.sharpness).toBe('weak');
        expect(entry.license).toBe('CC0');
      }
    }
    expect(writes).toEqual([2]);
  });

  it('does not re-mint an outcome question for a snippet already cited by one', async () => {
    const { vault, snippets, annotations } = await seedPastIntentions([
      { horizon: 'days', daysBack: 10, prose: 'I will repaint the hallway before winter.' },
      { horizon: 'days', daysBack: 10, prose: 'I will file the taxes by the deadline.' },
      { horizon: 'days', daysBack: 10, prose: 'I will read the backlog of papers.' },
    ]);
    const alreadyMinted: QueueEntry = {
      id: 'existing-outcome',
      status: 'pending',
      source: 'outcome',
      license: 'CC0',
      question: `You wrote "${snippets[0]!.prose}" Did it get done?`,
      questionForm: 'deliberative',
      sharpness: 'weak',
      horizon: 'session',
      created: new Date().toISOString(),
      cites: [`${snippets[0]!.id}@1`],
    };
    const q = makeFakeQueue([alreadyMinted]);
    const complete = vi.fn(makeScriptedComplete(
      byId(snippets.filter((s) => s.id !== snippets[0]!.id)).map((s) => outcomeAnswer(s.prose)),
    ));

    const res = await runOutcomeQuestions({
      annotations,
      queue: q,
      complete,
      vault,
      log: vi.fn(),
      sittingOf: () => ({}),
      vaultRoot: root,
    });

    expect(res).toEqual({ minted: 2 });
    expect(complete).toHaveBeenCalledTimes(2);
    const outcomeEntries = q._entries.filter((e) => e.source === 'outcome');
    expect(outcomeEntries).toHaveLength(3); // the pre-existing one plus two new
    const cited = outcomeEntries.flatMap((e) => e.cites ?? []);
    expect(cited).toContain(`${snippets[0]!.id}@1`);
    expect(cited.filter((c) => c === `${snippets[0]!.id}@1`)).toHaveLength(1);
    expect(cited).toContain(`${snippets[1]!.id}@1`);
    expect(cited).toContain(`${snippets[2]!.id}@1`);
  });

  it('enforces the OUTCOME_RUN_CAP of 2 per run', async () => {
    const { vault, snippets, annotations } = await seedPastIntentions(
      Array.from({ length: 5 }, (_, i) => ({
        horizon: 'days' as const,
        daysBack: 10,
        prose: `I will complete task number ${i + 1} within the month.`,
      })),
    );
    const complete = vi.fn(makeScriptedComplete(
      byId(snippets).slice(0, 2).map((s) => outcomeAnswer(s.prose)),
    ));
    const writes: number[] = [];
    const q = makeFakeQueue();

    const res = await runOutcomeQuestions({
      annotations,
      queue: q,
      complete,
      vault,
      log: vi.fn(),
      sittingOf: () => ({}),
      vaultRoot: root,
      outcomeCursor: { read: () => 0, write: (o) => writes.push(o) },
    });

    expect(res).toEqual({ minted: 2 });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(q._entries.filter((e) => e.source === 'outcome')).toHaveLength(2);
    expect(writes).toEqual([2]);
  });

  it('advances the rotation cursor across runs so later runs offer different intentions', async () => {
    const { vault, snippets, annotations } = await seedPastIntentions([
      { horizon: 'days', daysBack: 10, prose: 'I will organize the studio shelves.' },
      { horizon: 'days', daysBack: 10, prose: 'I will renew the passport before the trip.' },
      { horizon: 'days', daysBack: 10, prose: 'I will donate the old clothes pile.' },
    ]);
    const ordered = byId(snippets);
    let offset = 1;
    const writes: number[] = [];
    const cursor = {
      read: () => offset,
      write: (o: number) => { offset = o; writes.push(o); },
    };
    const q = makeFakeQueue();
    const complete = vi.fn(makeScriptedComplete([
      outcomeAnswer(ordered[1]!.prose),
      outcomeAnswer(ordered[2]!.prose),
      outcomeAnswer(ordered[0]!.prose),
    ]));

    // First run: the job reads candidates in id order, cursor at 1 rotates
    // past ordered[0] and offers [ordered[1], ordered[2]].
    const res1 = await runOutcomeQuestions({
      annotations,
      queue: q,
      complete,
      vault,
      log: vi.fn(),
      sittingOf: () => ({}),
      vaultRoot: root,
      outcomeCursor: cursor,
    });
    expect(res1).toEqual({ minted: 2 });
    const cited1 = q._entries.filter((e) => e.source === 'outcome').flatMap((e) => e.cites ?? []);
    expect(cited1).not.toContain(`${ordered[0]!.id}@1`);
    expect(cited1).toContain(`${ordered[1]!.id}@1`);
    expect(cited1).toContain(`${ordered[2]!.id}@1`);
    expect(writes).toEqual([3]);

    // Second run: the offered pair is now minted (deduped out), so the
    // advanced cursor lands on the remaining intention.
    const res2 = await runOutcomeQuestions({
      annotations,
      queue: q,
      complete,
      vault,
      log: vi.fn(),
      sittingOf: () => ({}),
      vaultRoot: root,
      outcomeCursor: cursor,
    });
    expect(res2).toEqual({ minted: 1 });
    const cited2 = q._entries.filter((e) => e.source === 'outcome').flatMap((e) => e.cites ?? []);
    expect(cited2).toContain(`${ordered[0]!.id}@1`);
    expect(writes).toEqual([3, 1]);
  });

  it('skips intentions whose horizon has not passed', async () => {
    const { vault, snippets, annotations } = await seedPastIntentions([
      { horizon: 'now', daysBack: 0, prose: 'I will answer this prompt right now.' },
      { horizon: 'session', daysBack: 0, prose: 'I will finish the notes before bed.' },
      { horizon: 'days', daysBack: 0, prose: 'I will try the new recipe soon.' },
    ]);
    const complete = vi.fn(makeScriptedComplete([]));
    const q = makeFakeQueue();

    const res = await runOutcomeQuestions({
      annotations,
      queue: q,
      complete,
      vault,
      log: vi.fn(),
      sittingOf: () => ({}),
      vaultRoot: root,
    });

    expect(res).toEqual({ minted: 0 });
    expect(complete).not.toHaveBeenCalled();
    expect(q._entries).toHaveLength(0);
    expect(snippets).toHaveLength(3);
  });
});
