import { describe, it, expect } from 'vitest';
import { sittingReviewItem, type SittingReviewRecord } from '../web/reviews.js';
import type { CutProposal } from '../src/types.js';
import type { HarvestOrigin } from '../web/provenance.js';

/**
 * Wave 3 S2 — the sitting item the unified review grammar draws (web/
 * reviews.ts sittingReviewItem). Pins the prose split (transcript turns in
 * order, role headings consumed), the source-turn-scoped cut location, the
 * proposals-only fallback, and the save wire mapping (plain verbs →
 * HARVEST_ACTIONS, index → proposal).
 */

const BODY = [
  '## agent',
  '',
  'with friends, courage shows up in small moments.',
  '',
  '## user',
  '',
  'I am not sure',
  '',
  '## agent',
  '',
  'where have you seen this feeling of courage in action?',
  '',
  '## user',
  '',
  'With my friends, they seem to understand what they want.',
  '',
].join('\n');

// The prose the grammar receives: the four turns in order, joined by blank
// lines — the heading lines are consumed by the split.
const PROSE = [
  'with friends, courage shows up in small moments.',
  'I am not sure',
  'where have you seen this feeling of courage in action?',
  'With my friends, they seem to understand what they want.',
].join('\n\n');

const proposal = (text: string, sourceTurn: number): CutProposal => ({
  text,
  sourceTurn,
  facet: 'value',
  stance: 'commitment',
  reading: 'the person states a position they hold',
  question: 'what is on your mind?',
  questionForm: 'deliberative',
});

const record = (over: Partial<SittingReviewRecord> = {}): SittingReviewRecord => ({
  sessionId: 'sess-1',
  started: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  protocol: 'drm',
  origin: 'harvest' as HarvestOrigin,
  proposals: [],
  ...over,
});

/** A minimal api stub: satisfies the generic wire type, resolves with an
 * empty receipt. */
const okApi = async <T>(_path: string, _body?: unknown): Promise<T> => ({ snippets: [] } as T);

describe('sittingReviewItem — the sitting item for the unified grammar', () => {
  it('renders the transcript whole: turns in order as prose, role headings consumed', () => {
    const item = sittingReviewItem(
      record({ transcriptBody: BODY, proposals: [proposal('I am not sure', 0)] }),
      okApi,
    );
    expect(item.prose).toBe(PROSE);
    expect(item.kind).toBe('sitting');
    expect(item.heading).toBe('your sitting from 1h ago');
    expect(item.verbs).toEqual(['keep', 'trim', 'say it again', 'leave out']);
  });

  it('locates each cut inside its source turn, not at the first prose occurrence', () => {
    const item = sittingReviewItem(
      record({
        transcriptBody: BODY,
        proposals: [
          // 'friends' also appears in the agent turn (prose offset 5); the
          // cut must land in its own user turn (prose offset 129).
          proposal('friends', 1),
          proposal('I am not sure', 0),
        ],
      }),
      okApi,
    );
    expect(PROSE.indexOf('friends')).toBe(5); // the trap: the agent turn
    expect(item.cuts[0]).toEqual({ index: 0, text: 'friends', at: 129 });
    expect(item.cuts[1]).toEqual({ index: 1, text: 'I am not sure', at: 50 });
  });

  it('omits at when the source turn does not contain the cut (degraded to the grammar)', () => {
    const item = sittingReviewItem(
      record({
        transcriptBody: BODY,
        proposals: [
          proposal('courage', 1), // in the prose, but in the agent turn
          proposal('never said anywhere', 0),
        ],
      }),
      okApi,
    );
    expect('at' in item.cuts[0]!).toBe(false);
    expect('at' in item.cuts[1]!).toBe(false);
  });

  it('omits at when sourceTurn is out of range', () => {
    const item = sittingReviewItem(
      record({ transcriptBody: BODY, proposals: [proposal('I am not sure', 9)] }),
      okApi,
    );
    expect('at' in item.cuts[0]!).toBe(false);
  });

  it('falls back to the proposals alone when the transcript body is absent or empty', () => {
    const proposals = [proposal('one proposal', 0), proposal('another passage', 1)];
    for (const transcriptBody of [undefined, '']) {
      const item = sittingReviewItem(
        record({ proposals, ...(transcriptBody !== undefined ? { transcriptBody } : {}) }),
        okApi,
      );
      expect(item.prose).toBe('one proposal\n\nanother passage');
      expect(item.cuts[0]).toEqual({ index: 0, text: 'one proposal', at: 0 });
      expect(item.cuts[1]).toEqual({ index: 1, text: 'another passage', at: 14 });
    }
  });

  it('carries the buds through with their reasons, and omits the key when absent', () => {
    const withBuds = sittingReviewItem(
      record({ proposals: [], buds: [{ text: 'a fragment', reason: 'mid-sentence' }] }),
      okApi,
    );
    expect(withBuds.buds).toEqual([{ text: 'a fragment', reason: 'mid-sentence' }]);
    const without = sittingReviewItem(record({ proposals: [] }), okApi);
    expect('buds' in without).toBe(false);
  });

  it('names an unprompted sitting in the heading', () => {
    const item = sittingReviewItem(record({ origin: 'unprompted', proposals: [] }), okApi);
    expect(item.heading).toBe('your free writing from 1h ago');
  });

  it('maps the plain verbs to HARVEST_ACTIONS and index to proposal on save', async () => {
    const sent: { path: string; body: unknown }[] = [];
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      sent.push({ path, body });
      return { snippets: [{ prose: 'kept it' }] } as T;
    };
    const item = sittingReviewItem(record({ proposals: [] }), api);
    const res = await item.save([
      { index: 0, action: 'keep' },
      { index: 1, action: 'trim', text: 'friends' },
      { index: 2, action: 'say it again', text: 'in my own words' },
      { index: 3, action: 'leave out' },
    ]);
    expect(sent).toEqual([
      {
        path: '/api/session/sess-1/harvest',
        body: {
          decisions: [
            { proposal: 0, action: 'approve' },
            { proposal: 1, action: 'trim', text: 'friends' },
            { proposal: 2, action: 'restate', text: 'in my own words' },
            { proposal: 3, action: 'discard' },
          ],
        },
      },
    ]);
    expect(res.snippets).toEqual([{ prose: 'kept it' }]);
  });
});
