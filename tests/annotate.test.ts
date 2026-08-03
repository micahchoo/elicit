import { describe, it, expect } from 'vitest';
import { annotateReferent } from '../src/clerk/annotate.js';
import type { AnnotateItem } from '../src/clerk/annotate.js';
import type { Complete, Snippet, Turn } from '../src/types.js';

/**
 * Annotating: one snippet becomes a resolved-referent annotation, or a
 * silence, and nothing else (ticket 074).
 *
 * Every test drives a SCRIPTED completer — the live model is never called
 * from here, and a scripted one is the only way to test the outputs that
 * matter (a fenced answer, a malformed one, an `annotate: true` that
 * forgets its referent). All fixtures are pure; nothing touches disk.
 *
 * The oracle for each rejection is the module's own contract: a model
 * failure THROWS (so the measurement can count it) and is never confused
 * with `{"annotate": false}`, which is the model's legitimate silence.
 */

// ── Fixtures ──

type Call = { system: string; turns: Turn[]; opts: { temperature?: number } | undefined };

/** A completer that records every call and answers from a script, in order. */
function recorder(responses: string[]): { complete: Complete; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const complete: Complete = async (system, turns, opts) => {
    calls.push({ system, turns, opts });
    const next = responses[i++];
    if (next === undefined) throw new Error(`scripted completer exhausted after ${responses.length}`);
    return next;
  };
  return { complete, calls };
}

function makeSnippet(
  prose: string,
  lineage: { question?: string; context?: string } = {},
): Snippet {
  return {
    id: 'snipA',
    version: 1,
    captured: '2026-08-01T12:00:00.000Z',
    provenance: {
      kind: 'harvest',
      session: 'sitting-1',
      question: lineage.question ?? 'What did you choose?',
      questionForm: 'deliberative',
      ...(lineage.context !== undefined ? { context: lineage.context } : {}),
    },
    prose,
  };
}

function item(overrides: Partial<AnnotateItem> = {}): AnnotateItem {
  return {
    snippet: makeSnippet('I would leave a job that took my direction away, even for less money.'),
    model: 'qwen3.6:35b',
    ...overrides,
  };
}

// ===========================================================================

describe('annotateReferent — the call', () => {
  it('sends exactly one user-role turn, at annotation temperature', async () => {
    // Ticket 023: the list must END on a user turn or llama.cpp generates
    // nothing at all.
    const { complete, calls } = recorder([JSON.stringify({ annotate: false })]);
    await annotateReferent(item(), complete);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.turns).toHaveLength(1);
    expect(call.turns[0]!.role).toBe('user');
    expect(call.opts?.temperature).toBe(0.2);
  });
});

describe('annotateReferent — the payload', () => {
  it('carries the SNIPPET header, the <question> marker and the <snippet> block', async () => {
    const { complete, calls } = recorder([JSON.stringify({ annotate: false })]);
    await annotateReferent(item(), complete);

    expect(calls[0]!.turns[0]!.text).toBe(
      'SNIPPET snipA@1\n' +
        '<question>What did you choose?</question>\n' +
        '<snippet>I would leave a job that took my direction away, even for less money.</snippet>',
    );
  });

  it('adds the <context> marker only when the snippet carries antecedent context', async () => {
    const { complete, calls } = recorder([JSON.stringify({ annotate: false })]);
    await annotateReferent(
      item({
        snippet: makeSnippet('It still shapes the work I take on.', {
          context: 'The person was describing a former mentor.',
        }),
      }),
      complete,
    );

    expect(calls[0]!.turns[0]!.text).toBe(
      'SNIPPET snipA@1\n' +
        '<question>What did you choose?</question>\n' +
        '<context>The person was describing a former mentor.</context>\n' +
        '<snippet>It still shapes the work I take on.</snippet>',
    );
  });

  it('omits both lineage markers when question is empty and context is absent', async () => {
    const { complete, calls } = recorder([JSON.stringify({ annotate: false })]);
    await annotateReferent(
      item({ snippet: makeSnippet('I wrote this unprompted.', { question: '' }) }),
      complete,
    );

    expect(calls[0]!.turns[0]!.text).toBe('SNIPPET snipA@1\n<snippet>I wrote this unprompted.</snippet>');
  });
});

describe('annotateReferent — the shape', () => {
  it('parses an annotation, stamps the model, and keeps the raw answer', async () => {
    const raw = JSON.stringify({ annotate: true, expression: 'It', referent: 'the former mentor' });
    const { complete } = recorder([raw]);
    const result = await annotateReferent(item(), complete);

    expect(result.kind).toBe('annotation');
    if (result.kind !== 'annotation') return;
    expect(result.annotation.snippetId).toBe('snipA');
    expect(result.annotation.version).toBe(1);
    expect(result.annotation.expression).toBe('It');
    expect(result.annotation.referent).toBe('the former mentor');
    expect(result.annotation.model).toBe('qwen3.6:35b');
    expect(result.annotation.modelAt).toEqual(expect.any(String));
    expect(result.raw).toBe(raw);
  });

  it('stamps modelAt as an ISO timestamp (Q-34)', async () => {
    const { complete } = recorder([
      JSON.stringify({ annotate: true, expression: 'It', referent: 'the former mentor' }),
    ]);
    const result = await annotateReferent(item(), complete);

    expect(result.kind).toBe('annotation');
    if (result.kind !== 'annotation') return;
    expect(new Date(result.annotation.modelAt).toISOString()).toBe(result.annotation.modelAt);
  });

  it('returns silence with the raw answer when the model says {"annotate": false}', async () => {
    const raw = JSON.stringify({ annotate: false });
    const { complete } = recorder([raw]);
    const result = await annotateReferent(item(), complete);

    expect(result.kind).toBe('silence');
    if (result.kind !== 'silence') return;
    expect(result.raw).toBe(raw);
  });

  it('strips markdown fences before parsing', async () => {
    const { complete } = recorder(['```json\n{"annotate": false}\n```']);
    const result = await annotateReferent(item(), complete);
    expect(result.kind).toBe('silence');
  });

  it('throws when the answer is not valid JSON', async () => {
    const { complete } = recorder(['{"annotate": tru']);
    await expect(annotateReferent(item(), complete)).rejects.toThrow();
  });

  it('throws when annotate:true lacks a referent', async () => {
    const { complete } = recorder([JSON.stringify({ annotate: true, expression: 'It' })]);
    await expect(annotateReferent(item(), complete)).rejects.toThrow();
  });

  it('throws when annotate:true lacks an expression', async () => {
    const { complete } = recorder([JSON.stringify({ annotate: true, referent: 'the mentor' })]);
    await expect(annotateReferent(item(), complete)).rejects.toThrow();
  });

  it('throws when expression is empty whitespace', async () => {
    const { complete } = recorder([JSON.stringify({ annotate: true, expression: '  ', referent: 'x' })]);
    await expect(annotateReferent(item(), complete)).rejects.toThrow();
  });

  it('throws when annotate is neither true nor false', async () => {
    const { complete } = recorder([JSON.stringify({ annotate: 'maybe' })]);
    await expect(annotateReferent(item(), complete)).rejects.toThrow();
  });
});
