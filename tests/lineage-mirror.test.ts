import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { describe, expect, test } from 'vitest';

import { readLineage, licenseMirror, composeLineageMirror, runLineageMirrorSweep } from '../src/clerk/lineage-mirror.js';
import type { MirrorClaim, MirrorLogFn } from '../src/clerk/lineage-mirror.js';
import { makeScriptedComplete } from './fakes.js';
import type { Complete, QueueDraft, QueueEntry, QueueStore, LineageRead, Mode } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeTranscript(
  root: string,
  session: string,
  started: string,
  opts: { protocol?: string } = {},
): void {
  const dir = join(root, 'transcripts');
  mkdirSync(dir, { recursive: true });
  const fm: Record<string, unknown> = { started };
  if (opts.protocol) fm.protocol = opts.protocol;
  writeFileSync(join(dir, `${session}.md`), matter.stringify('', fm), 'utf-8');
}

/** Collect logs into an array for assertions. */
function collectorLog(): { log: MirrorLogFn; events: Array<{ kind: string; detail: string }> } {
  const events: Array<{ kind: string; detail: string }> = [];
  return {
    events,
    log: (e) => events.push({ kind: e.kind, detail: e.detail }),
  };
}

function fakeQueue(entries: QueueEntry[] = []): QueueStore & { added: QueueDraft[] } {
  const added: QueueDraft[] = [];
  return {
    added,
    add(e: QueueDraft): QueueEntry {
      added.push(e);
      return { ...e, id: `qe-${added.length}`, created: new Date().toISOString(), status: 'pending' };
    },
    list(): QueueEntry[] {
      return [
        ...entries,
        ...added.map((e, i) => ({
          ...e,
          id: `qe-${i + 1}`,
          created: new Date().toISOString(),
          status: 'pending' as const,
        })),
      ];
    },
    draw(_mode: Mode, _phase: string): QueueEntry | null { return null; },
    markAsked(_id: string): void {},
    markAnswered(_id: string): void {},
    markPending() { },
    defer(_id: string): void {},
    park(_id: string): void {},
    unpark(_id: string): void {},
    expire(_days: number): number { return 0; },
    expireTailBeyond(_keep: number, _filter?: (e: QueueEntry) => boolean): number { return 0; },
    markExpired(_id: string): void {},
      recordReplyDisengagement() { return false; },
    noteSittingStarted() {},
  };
}

// ---------------------------------------------------------------------------
// readLineage
// ---------------------------------------------------------------------------

describe('readLineage', () => {
  test('returns null for empty vault', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    expect(readLineage(root, 'claim-1', '2026-01-01', '2026-01-01')).toBeNull();
  });

  test('returns null when only imports exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-01-01T12:00:00Z', { protocol: 'import' });
    expect(readLineage(root, 'claim-1', '2026-01-01', '2026-01-01')).toBeNull();
  });

  test('returns LineageRead with correct counts for real sittings', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-06-01T12:00:00Z');
    writeTranscript(root, 'sess-2', '2026-06-15T12:00:00Z');
    writeTranscript(root, 'sess-3', '2026-07-01T12:00:00Z');
    // One import — should be excluded
    writeTranscript(root, 'import-1', '2026-05-01T12:00:00Z', { protocol: 'import' });

    const now = Date.parse('2026-08-01T12:00:00Z');
    const lineage = readLineage(root, 'claim-1', '2026-06-01', '2026-06-01', now);

    expect(lineage).not.toBeNull();
    expect(lineage!.claimId).toBe('claim-1');
    expect(lineage!.totalSittings).toBe(3);
    // Span: 2026-06-01 to 2026-07-01 = 30 days, 2 gaps → 15 days
    expect(lineage!.averageDaysBetween).toBe(15);
    // Most recent sitting: 2026-07-01, now: 2026-08-01 → 31 days
    expect(lineage!.daysSinceLastSitting).toBe(31);
    // 30 days before Aug 1 is Jul 2 — sess-3 on Jul 1 is outside
    expect(lineage!.sittingsInLastMonth).toBe(0);
  });

  test('averageDaysBetween is 0 with single sitting', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-06-01T12:00:00Z');

    const lineage = readLineage(root, 'claim-1', '2026-06-01', '2026-06-01',
      Date.parse('2026-08-01T12:00:00Z'));
    expect(lineage).not.toBeNull();
    expect(lineage!.totalSittings).toBe(1);
    expect(lineage!.averageDaysBetween).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// licenseMirror
// ---------------------------------------------------------------------------

describe('licenseMirror', () => {
  test('returns null for claim younger than threshold', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-07-20T12:00:00Z');
    writeTranscript(root, 'sess-2', '2026-07-25T12:00:00Z');

    const now = Date.now();
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(licenseMirror(root, { id: 'claim-1', created: threeDaysAgo, updated: threeDaysAgo }, now))
      .toBeNull();
  });

  test('returns LineageRead for claim older than threshold', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-06-01T12:00:00Z');
    writeTranscript(root, 'sess-2', '2026-07-01T12:00:00Z');

    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = licenseMirror(root, { id: 'claim-1', created: thirtyDaysAgo, updated: thirtyDaysAgo }, now);
    expect(result).not.toBeNull();
    expect(result!.claimId).toBe('claim-1');
  });

  test('returns null when no sittings exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(licenseMirror(root, { id: 'claim-1', created: thirtyDaysAgo, updated: thirtyDaysAgo }, now))
      .toBeNull();
  });

  test('returns null for an old claim edited recently — the licence is divergence, aged by updated', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-06-01T12:00:00Z');
    writeTranscript(root, 'sess-2', '2026-07-01T12:00:00Z');

    const now = Date.now();
    const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
    const yesterday = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
    // A claim touched yesterday has not diverged from the lineage (Q-83),
    // however old its birth.
    expect(licenseMirror(root, { id: 'claim-1', created: sixtyDaysAgo, updated: yesterday }, now))
      .toBeNull();
  });

  test('returns null for unparseable claim date', () => {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-06-01T12:00:00Z');
    expect(licenseMirror(root, { id: 'claim-1', created: 'not-a-date', updated: 'not-a-date' }))
      .toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composeLineageMirror
// ---------------------------------------------------------------------------

describe('composeLineageMirror', () => {
  const lineage: LineageRead = {
    claimId: 'claim-1',
    claimCreated: '2026-06-01T12:00:00Z',
    claimUpdated: '2026-06-01T12:00:00Z',
    totalSittings: 12,
    sittingsInLastMonth: 3,
    daysSinceLastSitting: 5,
    averageDaysBetween: 7,
  };

  const claim = {
    body: 'I write every morning without fail.',
    created: '2026-06-01T12:00:00Z',
  };

  test('returns question on valid model output', async () => {
    const complete = makeScriptedComplete([
      'You wrote this claim on June 1, 2026. You have had 12 sittings since, about one week apart. Same thing?',
    ]);

    const result = await composeLineageMirror(claim, lineage, complete);
    expect(result).toBe('You wrote this claim on June 1, 2026. You have had 12 sittings since, about one week apart. Same thing?');
  });

  test('retries when model returns non-interrogative', async () => {
    const complete = makeScriptedComplete([
      'This claim was made in June. There were twelve sittings since then.',
      'Your claim is from June 1, 2026. Since then, twelve sittings have passed. Does that match?',
    ]);

    const result = await composeLineageMirror(claim, lineage, complete);
    expect(result).toContain('?');
  });

  test('returns null after both attempts fail', async () => {
    const complete = makeScriptedComplete([
      'This claim was written in June.',
      'Twelve sittings since the claim.',
    ]);

    const result = await composeLineageMirror(claim, lineage, complete);
    expect(result).toBeNull();
  });

  test('rejects first-person pronoun outside quotes', async () => {
    const complete = makeScriptedComplete([
      'You wrote this claim on June 1. I see you have had twelve sittings since then. What changed?',
      'Your claim is from June 1, 2026. Twelve sittings have followed, about a week apart. Same pattern?',
    ]);

    const result = await composeLineageMirror(claim, lineage, complete);
    expect(result).not.toBeNull();
    expect(result).not.toContain('I see');
  });
});

// ---------------------------------------------------------------------------
// runLineageMirrorSweep
// ---------------------------------------------------------------------------

describe('runLineageMirrorSweep', () => {
  function makeDeps(opts: {
    claims: MirrorClaim[];
    queueEntries?: QueueEntry[];
    dryRun?: boolean;
    script?: string[];
  }) {
    const root = mkdtempSync(join(tmpdir(), 'elicit-lm-'));
    writeTranscript(root, 'sess-1', '2026-06-01T12:00:00Z');
    writeTranscript(root, 'sess-2', '2026-06-15T12:00:00Z');

    const { log, events } = collectorLog();
    const queue = fakeQueue(opts.queueEntries ?? []);
    const complete: Complete = makeScriptedComplete(opts.script ?? []);

    return {
      root,
      log,
      events,
      queue,
      complete,
      sweep: runLineageMirrorSweep({
        vaultRoot: root,
        listClaims: () => opts.claims,
        complete,
        queue,
        log,
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      }),
    };
  }

  test('skips claim when already mirrored (dedupe)', async () => {
    const now = Date.now();
    const fortyDaysAgo = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString();

    const existingEntry: QueueEntry = {
      id: 'qe-existing',
      status: 'expired',
      source: 'lineage-mirror',
      license: 'lineage mirror: claim claim-1',
      question: 'old mirror question?',
      questionForm: 'deliberative',
      horizon: 'now',
      sharpness: 'weak',
      created: fortyDaysAgo,
      lineageMirror: {
        claimId: 'claim-1',
        claimCreated: fortyDaysAgo,
        claimUpdated: fortyDaysAgo,
        totalSittings: 5,
        sittingsInLastMonth: 2,
        daysSinceLastSitting: 3,
        averageDaysBetween: 7,
      },
    };

    const { sweep } = makeDeps({
      claims: [
        { id: 'claim-1', body: 'I write every day.', created: fortyDaysAgo, updated: fortyDaysAgo },
      ],
      queueEntries: [existingEntry],
    });

    const result = await sweep();
    expect(result.evaluated).toBe(0);
    expect(result.minted).toBe(0);
  });

  test('skips young claims', async () => {
    const now = Date.now();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { sweep } = makeDeps({
      claims: [{ id: 'claim-1', body: 'Fresh claim.', created: twoDaysAgo, updated: twoDaysAgo }],
    });

    const result = await sweep();
    expect(result.evaluated).toBe(0);
  });

  test('live mode (graduated 2026-08-03): evaluates, mints, writes no shadow record', async () => {
    const now = Date.now();
    const fortyDaysAgo = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString();

    const { sweep, events } = makeDeps({
      claims: [
        { id: 'claim-1', body: 'I write every day.', created: fortyDaysAgo, updated: fortyDaysAgo },
      ],
      script: [
        'You wrote this claim on June 1, 2026. You have had 12 sittings since, about one week apart. Same thing?',
      ],
    });

    // Live by graduation: lineageMirror.selection.live === true
    const result = await sweep();

    expect(result.evaluated).toBe(1);
    expect(result.minted).toBe(1);
    expect(events.some((e) => e.kind === 'lineage-mirror-shadow')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateMirrorQuestion (via composeLineageMirror rejections)
// ---------------------------------------------------------------------------

describe('validateMirrorQuestion', () => {
  const lineage: LineageRead = {
    claimId: 'claim-1',
    claimCreated: '2026-06-01T12:00:00Z',
    claimUpdated: '2026-06-01T12:00:00Z',
    totalSittings: 12,
    sittingsInLastMonth: 3,
    daysSinceLastSitting: 5,
    averageDaysBetween: 7,
  };

  const claim = { body: 'I write every morning.', created: '2026-06-01T12:00:00Z' };

  test('rejects presupposition-triggering questions', async () => {
    // "why have you" is a presupposition trigger — first response rejected
    const complete = makeScriptedComplete([
      'Your claim is from June. Why have you had only twelve sittings since?',
      'Your claim is from June 1, 2026. Twelve sittings have followed. Does the pattern still hold?',
    ]);

    const result = await composeLineageMirror(claim, lineage, complete);
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/why have you/i);
  });
});
