import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, readEvents, type ActivityEvent } from '../src/log/activity.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'elicit-activity-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Activity Log', () => {
  it('two appends preserved in order', () => {
    const e1: ActivityEvent = { at: '2026-08-01T10:00:00Z', actor: 'system', kind: 'session-started', detail: 'start' };
    const e2: ActivityEvent = { at: '2026-08-01T10:05:00Z', actor: 'elicitor', kind: 'question-asked', detail: 'q1' };

    appendEvent(root, e1);
    appendEvent(root, e2);

    const events = readEvents(root);
    expect(events).toHaveLength(2);
    expect(events[0]!.detail).toBe('start');
    expect(events[1]!.detail).toBe('q1');
  });

  it('read with since filters correctly', () => {
    const early: ActivityEvent = { at: '2026-08-01T09:00:00Z', actor: 'system', kind: 'boot', detail: 'boot' };
    const threshold: ActivityEvent = { at: '2026-08-01T10:00:00Z', actor: 'elicitor', kind: 'question-asked', detail: 'on-threshold' };
    const later: ActivityEvent = { at: '2026-08-01T11:00:00Z', actor: 'harvester', kind: 'harvest', detail: 'post' };

    appendEvent(root, early);
    appendEvent(root, threshold);
    appendEvent(root, later);

    const events = readEvents(root, '2026-08-01T10:00:00Z');
    expect(events).toHaveLength(2);
    expect(events[0]!.detail).toBe('on-threshold');
    expect(events[1]!.detail).toBe('post');
  });

  it('events span day files and read chronologically', () => {
    const d1: ActivityEvent = { at: '2026-08-01T23:00:00Z', actor: 'system', kind: 'late-night', detail: 'd1' };
    const d2: ActivityEvent = { at: '2026-08-02T01:00:00Z', actor: 'system', kind: 'early-morning', detail: 'd2' };

    appendEvent(root, d1);
    appendEvent(root, d2);

    const events = readEvents(root);
    expect(events).toHaveLength(2);
    expect(events[0]!.detail).toBe('d1');
    expect(events[1]!.detail).toBe('d2');
  });

  it('new instance over same root sees all events', () => {
    const e: ActivityEvent = { at: '2026-08-01T10:00:00Z', actor: 'clerk', kind: 'docket-run', detail: 'minted 3' };

    appendEvent(root, e);

    // readEvents is a pure function over the root — reading twice yields the same result
    const first = readEvents(root);
    const second = readEvents(root);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.detail).toBe('minted 3');
    expect(second[0]!.detail).toBe('minted 3');
  });

  it('malformed line skipped without error', () => {
    const e1: ActivityEvent = { at: '2026-08-01T10:00:00Z', actor: 'system', kind: 'good', detail: 'keep-me' };

    appendEvent(root, e1);

    // Manually append a malformed line to the same day file
    const day = '2026-08-01';
    const logDir = join(root, 'log');
    const dayFile = join(logDir, `${day}.jsonl`);
    appendFileSync(dayFile, 'this is not valid json\n', 'utf-8');

    const events = readEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toBe('keep-me');
  });
});
