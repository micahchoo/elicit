import { describe, it, expect } from 'vitest';
import { toMarkdown } from '../src/piece/export.js';
import type { Arrangement, ArrangementEntry, Gap, Marginalia, Pin } from '../src/piece/contract.js';

// ── fixtures ──────────────────────────────────────────────────────────────

const S1_V1 = 'the first sentence stands alone.';
const S1_V2 = 'the first sentence, revised by a later sitting.';
const S2 = 'the second sentence follows.';
const S3 = 'the third sentence closes.';

function pin(id: string, snippet: string, version: number): Pin {
  return { id, kind: 'pin', snippet, version };
}

function gap(id: string): Gap {
  return { id, kind: 'gap' };
}

function marginalia(id: string): Marginalia {
  return { id, on: null, note: 'principle', text: 'a marginal note', at: '2026-08-02T00:00:00.000Z' };
}

function arrangement(entries: ArrangementEntry[], marginaliaList: Marginalia[] = []): Arrangement {
  return {
    id: 'a1',
    principle: 'chronology',
    entries,
    marginalia: marginaliaList,
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

// ── toMarkdown ────────────────────────────────────────────────────────────

describe('toMarkdown', () => {
  it('renders three pins as three paragraphs, blank-line separated, in entry order', () => {
    const a = arrangement([pin('e1', 's1', 1), pin('e2', 's2', 1), pin('e3', 's3', 1)]);
    expect(toMarkdown(a, resolver)).toBe(`${S1_V1}\n\n${S2}\n\n${S3}\n`);
  });

  it('a gap between two pins leaves no trace (byte-equal to the gap-less arrangement)', () => {
    const withGap = arrangement([pin('e1', 's1', 1), gap('e2'), pin('e3', 's3', 1)]);
    const withoutGap = arrangement([pin('e1', 's1', 1), pin('e3', 's3', 1)]);
    expect(toMarkdown(withGap, resolver)).toBe(toMarkdown(withoutGap, resolver));
  });

  it('an arrangement carrying three Marginalia exports identically to one carrying none', () => {
    const bare = arrangement([pin('e1', 's1', 1), pin('e2', 's2', 1)]);
    const noted = arrangement(
      [pin('e1', 's1', 1), pin('e2', 's2', 1)],
      [marginalia('m1'), marginalia('m2'), marginalia('m3')],
    );
    expect(toMarkdown(noted, resolver)).toBe(toMarkdown(bare, resolver));
  });

  it('is the person\'s words alone: starts with the first sentence, and has no `---` and no `#` anywhere', () => {
    const out = toMarkdown(arrangement([pin('e1', 's1', 1), pin('e2', 's2', 1)]), resolver);
    expect(out.startsWith(S1_V1[0]!)).toBe(true);
    expect(out).not.toContain('---');
    expect(out).not.toContain('#');
  });

  it('a pin to v1 of a snippet whose v2 exists exports v1\'s prose', () => {
    const out = toMarkdown(arrangement([pin('e1', 's1', 1)]), resolver);
    expect(out).toBe(`${S1_V1}\n`);
    expect(out).not.toContain(S1_V2);
  });

  it('a pin whose version cannot be resolved throws', () => {
    const a = arrangement([pin('e1', 's1', 1), pin('e2', 'missing', 1)]);
    expect(() => toMarkdown(a, resolver)).toThrow();
  });
});
