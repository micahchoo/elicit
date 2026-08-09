import { describe, it, expect } from 'vitest';
import { toCleanMarkdown, toQuestionsMarkdown } from '../src/piece/export.js';
import type { Entry, Gap, GapKind, Offer, Piece, Pin } from '../src/piece/contract.js';
import type { QueueEntry } from '../src/types.js';

// ── fixtures ──────────────────────────────────────────────────────────────

const S1_V1 = 'the first sentence stands alone.';
const S1_V2 = 'the first sentence, revised by a later sitting.';
const S2 = 'the second sentence follows.';
const S3 = 'the third sentence closes.';

function pin(id: string, snippet: string, version: number): Pin {
  return { id, kind: 'pin', snippet, version };
}

/**
 * A person's gap: placed by hand, minted at once (Q-39). `question` is the
 * minted QueueEntry's id — the join key, never the question text.
 */
function personGap(id: string, entryId: string): Gap {
  return { id, placedBy: 'person', question: entryId };
}

/** A model-placed gap: verified question text, awaiting the person's `ask this`. */
function modelGap(id: string, kind: GapKind, pending: string): Gap {
  return { id, placedBy: 'model', kind, pending };
}

/** A questionless gap — inserted under a set-down piece (Q-41). */
function questionlessGap(id: string): Gap {
  return { id, placedBy: 'person' };
}

function offer(id: string, snippet: string): Offer {
  return { id, snippet, version: 1, sourceSitting: 'sess-1' };
}

function piece(entries: Entry[], offers: Offer[] = []): Piece {
  return {
    id: 'p1',
    created: '2026-08-02T00:00:00.000Z',
    subject: 'the gathering criterion, which must never export',
    entries,
    offers,
    declined: [],
    dismissedGaps: [],
    marginalia: [],
  };
}

function queueEntry(id: string, question: string): QueueEntry {
  return {
    id,
    status: 'pending',
    source: 'gap-declared',
    license: 'arrangement-gap',
    question,
    questionForm: 'deliberative',
    horizon: 'session',
    created: '2026-08-02T00:00:00.000Z',
  };
}

/** A resolver over the fixture corpus; s1 has a v2 so the pinned-version test bites. */
function resolver(snippet: string, version: number): string | null {
  if (snippet === 's1') return version === 1 ? S1_V1 : S1_V2;
  if (snippet === 's2') return version === 1 ? S2 : null;
  if (snippet === 's3') return version === 1 ? S3 : null;
  return null;
}

// ── toCleanMarkdown — what ships ──────────────────────────────────────────

describe('toCleanMarkdown', () => {
  it('renders three pins as three paragraphs, blank-line separated, in entry order', () => {
    const p = piece([pin('e1', 's1', 1), pin('e2', 's2', 1), pin('e3', 's3', 1)]);
    expect(toCleanMarkdown(p.entries, resolver)).toBe(`${S1_V1}\n\n${S2}\n\n${S3}\n`);
  });

  it('a gap between two pins leaves no trace (byte-equal to the gap-less piece)', () => {
    const withGap = piece([pin('e1', 's1', 1), personGap('e2', 'q1'), pin('e3', 's3', 1)]);
    const withoutGap = piece([pin('e1', 's1', 1), pin('e3', 's3', 1)]);
    expect(toCleanMarkdown(withGap.entries, resolver)).toBe(toCleanMarkdown(withoutGap.entries, resolver));
  });

  it('never exports the subject (Q-1), and carries no heading or separator anywhere', () => {
    const out = toCleanMarkdown(piece([pin('e1', 's1', 1), pin('e2', 's2', 1)]).entries, resolver);
    expect(out).not.toContain('gathering criterion');
    expect(out.startsWith(S1_V1[0]!)).toBe(true);
    expect(out).not.toContain('---');
    expect(out).not.toContain('#');
  });

  it('a pin to v1 of a snippet whose v2 exists exports v1\'s prose (Q-5)', () => {
    const out = toCleanMarkdown(piece([pin('e1', 's1', 1)]).entries, resolver);
    expect(out).toBe(`${S1_V1}\n`);
    expect(out).not.toContain(S1_V2);
  });

  it('a pin whose version cannot be resolved throws', () => {
    const p = piece([pin('e1', 's1', 1), pin('e2', 'missing', 1)]);
    expect(() => toCleanMarkdown(p.entries, resolver)).toThrow();
  });
});

// ── toQuestionsMarkdown — the working document ────────────────────────────

describe('toQuestionsMarkdown', () => {
  it('renders every open gap in the margin as a blockquote, between its adjacent paragraphs', () => {
    const q = 'what goes between these?';
    const p = piece([pin('e1', 's1', 1), personGap('g1', 'q1'), pin('e2', 's2', 1)]);
    const out = toQuestionsMarkdown(p, resolver, [queueEntry('q1', q)], []);
    expect(out).toBe(`${S1_V1}\n\n> ${q}\n\n${S2}\n`);
  });

  it('a model-placed gap prints its pending text when no question was minted yet', () => {
    const pending = 'you say this stands alone — what connects it to the next?';
    const p = piece([pin('e1', 's1', 1), modelGap('g1', 'leap', pending), pin('e2', 's2', 1)]);
    const out = toQuestionsMarkdown(p, resolver, [], []);
    expect(out).toContain(`> ${pending}`);
  });

  it('a minted gap prints the queue entry\'s words, not the pending text', () => {
    const minted = 'the minted words, later revised on the queue';
    const pending = 'the model\'s original words';
    const p = piece([pin('e1', 's1', 1), { ...modelGap('g1', 'leap', pending), question: 'q1' }, pin('e2', 's2', 1)]);
    const out = toQuestionsMarkdown(p, resolver, [queueEntry('q1', minted)], []);
    expect(out).toContain(`> ${minted}`);
    expect(out).not.toContain(pending);
  });

  it('a questionless gap (set-down insertion, Q-41) renders nothing', () => {
    const p = piece([pin('e1', 's1', 1), questionlessGap('g1'), pin('e2', 's2', 1)]);
    const out = toQuestionsMarkdown(p, resolver, [], []);
    expect(out).toBe(`${S1_V1}\n\n${S2}\n`);
  });

  it('lists the open offers at the end, and omits the section when none are open', () => {
    const o1 = offer('o1', 's2');
    const o2 = offer('o2', 's3');
    const withOffers = piece([pin('e1', 's1', 1)], [o1, o2]);
    const out = toQuestionsMarkdown(withOffers, resolver, [], [o1, o2]);
    expect(out).toContain('## Open offers');
    expect(out).toContain(`- ${S2}`);
    expect(out).toContain(`- ${S3}`);
    const bare = toQuestionsMarkdown(piece([pin('e1', 's1', 1)]), resolver, [], []);
    expect(bare).not.toContain('Open offers');
    expect(bare).toBe(`${S1_V1}\n`);
  });

  it('never exports the subject (Q-1) — not in the body, not in the offers tail', () => {
    const p = piece([pin('e1', 's1', 1), modelGap('g1', 'thin', 'write more about this?')], [offer('o1', 's2')]);
    const out = toQuestionsMarkdown(p, resolver, [], p.offers);
    expect(out).not.toContain('gathering criterion');
  });

  it('is zero-LLM: the output contains only the person\'s words, the gaps\' questions and the offers\' prose', () => {
    const p = piece([pin('e1', 's1', 1), modelGap('g1', 'leap', 'what goes between these?'), pin('e2', 's2', 1)], [offer('o1', 's3')]);
    const out = toQuestionsMarkdown(p, resolver, [], p.offers);
    // Every token is either pure ink (blockquote, heading, list marks) or
    // belongs verbatim to one of the three licensed sources.
    const licensed = new Set([
      ...S1_V1.split(/\s+/),
      ...S2.split(/\s+/),
      ...S3.split(/\s+/),
      'what', 'goes', 'between', 'these?',
      // The export's own fixed heading — constant text from this module,
      // never model output (zero-LLM).
      'Open', 'offers',
    ]);
    const inkOnly = /^[>#\-,.:;!?()"'—…]+$/;
    for (const word of out.split(/\s+/)) {
      if (word === '' || inkOnly.test(word)) continue; // trailing newline + ink marks
      expect(licensed.has(word), `unlicensed word in export: ${word}`).toBe(true);
    }
  });

  it('a pin whose version cannot be resolved throws, in either ink', () => {
    const p = piece([pin('e1', 's1', 1), pin('e2', 'missing', 1)]);
    expect(() => toQuestionsMarkdown(p, resolver, [], [])).toThrow();
  });
});
