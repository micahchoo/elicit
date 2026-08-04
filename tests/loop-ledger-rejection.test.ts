/**
 * The ledger's rejection event (added cycle-1, c01) — a candidate that ran
 * the full battery and did not clear the keep rule (Q-98: at least one
 * resolving-cited regression). Companion to tests/loop-ledger.test.ts,
 * which predates this event and is never modified to add it — this file
 * only asserts what that one didn't: that a rejection round-trips and
 * survives read the same way graduation/demotion/re-graduation do.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendLedger, readLedger } from '../src/loop/ledger.js';
import type { RejectionLine, GraduationLine } from '../src/loop/ledger.js';

let root: string;
let ledger: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-loop-ledger-rejection-'));
  ledger = join(root, 'data', 'graduation-ledger.jsonl');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const rejection: RejectionLine = {
  at: '2026-08-04T13:37:00.000Z',
  event: 'rejection',
  mechanism: 'clerk/composed.ts:composeFollowUp',
  cycle: 'c01',
  variant: 'b1d81824a1053be40d597bb6598a1559da7974e8',
  trials: ['archives/eval/c01/t1-attempt3/a', 'archives/eval/c01/t1-attempt3/b'],
  verdicts: ['archives/eval/c01/t1-attempt3/verdicts/dossier-001.json'],
  rejected:
    'dossier-001/questioning: candidate regressed — the reworded directive produced the same echo-recursion the shakedown wording did, until the persona objected ("hall of mirrors").',
};

describe('ledger — rejection event', () => {
  it('round-trips a rejection line', () => {
    appendLedger(ledger, rejection);
    expect(readLedger(ledger)).toEqual([rejection]);
  });

  it('interleaves with a graduation, in write order', () => {
    const graduation: GraduationLine = {
      at: '2026-08-04T14:00:00.000Z',
      event: 'graduation',
      mechanism: 'otherMechanism',
      cycle: 'c02',
      variant: 'deadbeef',
      trials: ['archives/eval/c02/t1'],
      verdicts: ['archives/eval/c02/t1/verdicts/dossier-001.json'],
      kept: 'Some other win.',
    };
    appendLedger(ledger, rejection);
    appendLedger(ledger, graduation);
    expect(readLedger(ledger)).toEqual([rejection, graduation]);
  });

  it('is a known event, not skipped as unrecognized JSON', () => {
    // Guards against isLedgerLine's allowlist regressing to three events —
    // a rejection that silently fails this check is invisible to every
    // future cycle's read of its own memory.
    appendLedger(ledger, rejection);
    const read = readLedger(ledger);
    expect(read).toHaveLength(1);
    expect(read[0]?.event).toBe('rejection');
  });
});
