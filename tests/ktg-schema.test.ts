/**
 * KTG schema tests — ticket 094 Phase 1.
 *
 * Tests the validator and loader against the synthetic fixture and
 * against deliberately broken skeletons.
 */

import { describe, it, expect } from 'vitest';
import { validateKtgSkeleton } from '../src/ktg/validator.js';
import { loadKtgSkeleton, loadKtgSkeletonOrThrow } from '../src/ktg/loader.js';

describe('KTG validator', () => {
  // ── valid skeleton ──

  const validSkeleton = {
    domain: 'test',
    level: 'amateur',
    provenance: {
      generator: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
      domain: 'test',
      targetLevel: 'amateur',
    },
    schools: [
      { id: 'school-a', name: 'A', optimisesFor: 'x', givesUp: 'y', quarrelsWith: [] },
      { id: 'school-b', name: 'B', optimisesFor: 'z', givesUp: 'w', quarrelsWith: [] },
    ],
    clusters: [
      { id: 'basics', icon: 'X', name: 'Basics', gist: 'the basics' },
    ],
    spine: ['test.basics.one'],
    nodes: [
      {
        id: 'test.basics.one',
        label: 'One',
        tier: 1,
        cluster: 'basics',
        prereqs: [],
        oneLine: 'do the first thing',
        hours: 5,
      },
      {
        id: 'test.basics.two',
        label: 'Two',
        tier: 2,
        cluster: 'basics',
        prereqs: ['test.basics.one'],
        oneLine: 'do the second thing',
        hours: 10,
      },
      {
        id: 'test.basics.three',
        label: 'Three',
        tier: 3,
        cluster: 'basics',
        prereqs: ['test.basics.two'],
        oneLine: 'do the third thing',
        hours: 15,
      },
    ],
  };

  it('accepts a valid skeleton', () => {
    const result = validateKtgSkeleton(validSkeleton);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nodes).toHaveLength(3);
    }
  });

  // ── structural refusals ──

  it('rejects a non-object', () => {
    const result = validateKtgSkeleton(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('skeleton must be an object');
    }
  });

  it('rejects missing domain', () => {
    const result = validateKtgSkeleton({ level: 'x', provenance: validSkeleton.provenance, nodes: [], schools: [], clusters: [], spine: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('domain must be a non-empty string');
    }
  });

  it('rejects missing level', () => {
    const result = validateKtgSkeleton({ domain: 'x', provenance: validSkeleton.provenance, nodes: [], schools: [], clusters: [], spine: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('level must be a non-empty string');
    }
  });

  it('rejects empty nodes array', () => {
    const result = validateKtgSkeleton({ ...validSkeleton, nodes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('nodes must not be empty');
    }
  });

  it('rejects missing provenance', () => {
    const result = validateKtgSkeleton({ ...validSkeleton, provenance: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain('provenance must be an object');
    }
  });

  it('rejects incomplete provenance', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      provenance: { generator: '', generatedAt: '', domain: '', targetLevel: '' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    }
  });

  // ── node field refusals ──

  it('rejects node with missing id', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [
        { ...validSkeleton.nodes[0] },
        { label: 'Bad', tier: 1, cluster: 'basics', prereqs: [], oneLine: 'x', hours: 1 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const reason = result.reasons.find((r) => r.includes('must have a non-empty string id'));
      expect(reason).toBeDefined();
    }
  });

  it('rejects duplicate node ids', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [
        ...validSkeleton.nodes,
        { ...validSkeleton.nodes[0] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('duplicate node id'))).toBe(true);
    }
  });

  it('rejects non-slug node id', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], id: 'Bad Id!' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('not a stable slug'))).toBe(true);
    }
  });

  it('rejects node with missing label', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], label: '' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('label must be a non-empty string'))).toBe(true);
    }
  });

  it('rejects node with missing cluster', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], cluster: '' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('cluster must be a non-empty string'))).toBe(true);
    }
  });

  it('rejects node with negative tier', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], tier: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('tier must be a positive integer'))).toBe(true);
    }
  });

  it('rejects node with negative hours', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], hours: -1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('hours must be a non-negative integer'))).toBe(true);
    }
  });

  // ── graph rule refusals ──

  it('rejects tier-1 node with prereqs', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], prereqs: ['test.basics.two'] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('tier 1 but has prereqs'))).toBe(true);
    }
  });

  it('rejects node with nonexistent prereq', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [
        ...validSkeleton.nodes,
        {
          id: 'test.basics.orphan',
          label: 'Orphan',
          tier: 1,
          cluster: 'basics',
          prereqs: ['test.basics.nope'],
          oneLine: 'x',
          hours: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('does not exist'))).toBe(true);
    }
  });

  it('rejects cycle in prereqs', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [
        { id: 'a.b.c', label: 'C', tier: 2, cluster: 'basics', prereqs: ['a.b.d'], oneLine: 'x', hours: 1 },
        { id: 'a.b.d', label: 'D', tier: 2, cluster: 'basics', prereqs: ['a.b.c'], oneLine: 'x', hours: 1 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('cycle detected'))).toBe(true);
    }
  });

  it('rejects wrong tier (not 1 + max prereq tier)', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [
        { ...validSkeleton.nodes[0] },
        { ...validSkeleton.nodes[1], tier: 5 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('expected'))).toBe(true);
    }
  });

  it('rejects spine entry that does not exist', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      spine: ['nope.not.a.node'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('spine') && r.includes('does not exist'))).toBe(true);
    }
  });

  it('rejects node referencing nonexistent cluster', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], cluster: 'nope' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('cluster nope does not exist'))).toBe(true);
    }
  });

  it('rejects schoolWeights referencing unknown school', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      nodes: [{ ...validSkeleton.nodes[0], schoolWeights: { 'nope-school': 'high' } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('unknown school nope-school'))).toBe(true);
    }
  });

  it('rejects school quarrelsWith unknown school', () => {
    const result = validateKtgSkeleton({
      ...validSkeleton,
      schools: [{ ...validSkeleton.schools[0], quarrelsWith: ['nope-school'] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('quarrelsWith references unknown school'))).toBe(true);
    }
  });
});

describe('KTG loader', () => {
  it('loads and validates the synthetic fixture', () => {
    const root = process.cwd();
    const skel = loadKtgSkeletonOrThrow('fake-craft', root);
    expect(skel.domain).toBe('fake-craft');
    expect(skel.nodes).toHaveLength(4);
    expect(skel.schools).toHaveLength(2);
    expect(skel.clusters).toHaveLength(3);
    expect(skel.spine).toHaveLength(4);
  });

  it('rejects a missing domain', () => {
    const root = process.cwd();
    const result = loadKtgSkeleton('nonexistent-domain', root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons[0]).toContain('not found');
    }
  });

  it('validates tier consistency on the fixture', () => {
    const root = process.cwd();
    const result = loadKtgSkeleton('fake-craft', root);
    expect(result.ok).toBe(true);
  });
});
