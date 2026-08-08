/**
 * Pattern-aware composed question path (ticket 111).
 *
 * When pattern selection is live, `composeWithPattern` selects a derivation
 * pattern, builds a repertoire-shaped prompt, runs the LLM, runs the
 * decomposition guard, and on success returns a QueueDraft with provenance
 * fields naming the pattern and source versions. On rejection at any stage,
 * returns null — the caller falls through to existing quote-back behavior.
 */

import type { Complete, QueueDraft, Snippet } from '../types.js';
import type { SittingContext } from './composed.js';
import { loadPatterns } from '../patterns/registry.js';
import { selectCheapPattern } from '../patterns/select.js';
import { decomposeDerived } from '../patterns/decompose.js';
import type { LicensingContext, Pattern, Operator } from '../patterns/types.js';
import { checkQuestion } from '../language/guards.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strips markdown code fences, keeping the inner content. The regex form
 * handles single-line fenced JSON (the old slice-based copy mangled
 * ```json {...}``` with no newline — the fence check passed, then the slice
 * corrupted the line). */
function stripFences(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*\n?/i, '');
  s = s.replace(/\n?```\s*$/, '');
  return s.trim();
}

interface QuotedSpanRef {
  text: string;
  sourceSnippetId: string;
  sourceVersion: number;
}

function buildPatternDraft(
  question: string,
  pattern: Pattern,
  quotedSpans: QuotedSpanRef[],
  operatorsUsed: Operator[],
  sitting?: SittingContext,
): QueueDraft {
  const longest = quotedSpans.reduce((a, b) => (a.text.length >= b.text.length ? a : b));
  const derivedFrom = [...new Set(quotedSpans.map((s) => `${s.sourceSnippetId}@${s.sourceVersion}`))];

  return {
    source: 'composed',
    license: 'CC0',
    question,
    questionForm: pattern.questionForm,
    cites: derivedFrom.map((ref) => {
      const [id, v] = ref.split('@');
      return id && v ? `${id}@${v}` : ref;
    }),
    quotedFragment: longest.text,
    sharpness: 'weak',
    horizon: 'session',
    patternId: pattern.id,
    derivedFrom,
    operatorsUsed,
    ...(sitting?.target ? { target: sitting.target } : {}),
    ...(sitting?.topic ? { topic: sitting.topic } : {}),
  };
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const FRAMING_RULE = `HOW TO USE THEIR WORDS — frame the quote, never splice it:
Put the speaker's exact words inside quotation marks. Then ask your question after them, in your own words.
Shape: You wrote: "<their exact words>." <your question>?
Keep the quoted words exactly as they wrote them, first person and all. Outside the quotation marks, address the speaker as "you".`;

function patternPrompt(pattern: Pattern, sources: { prose: string; captured?: string }[]): string {
  const sourceBlocks = sources
    .map((s, i) => `Source ${i + 1} (${s.captured ?? 'unknown date'}): "${s.prose}"`)
    .join('\n\n');

  const quoteLabels = pattern.requiredQuotes.map((q) => `  - ${q}`).join('\n');

  return `You are a clerk for Elicit — a quiet, reflective interview tool. Compose ONE question using the "${pattern.name}" pattern.

PATTERN: ${pattern.name}
What this pattern does: derives a question from the person's own words by applying operators (${pattern.operators.join(', ')}) to their material.
Contamination risk: ${pattern.contaminationRisk} — keep the person's words intact.

SOURCES (the person's own words, each with its date):
${sourceBlocks}

WHAT YOU MUST QUOTE:
${quoteLabels}

${FRAMING_RULE}

Your question must:
- Quote at least one exact phrase from the sources inside quotation marks.
- Apply the pattern's operators outside the quotes — never paraphrase or interpret.
- Return ONLY the question text. No markdown, no commentary.`;
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

/**
 * A composition source: the prose the question derives from. A Snippet
 * satisfies this shape, and so does a bare rung answer — the deep path no
 * longer needs to fabricate a Snippet (and a fake id) to compose off prose.
 */
export type PatternSource = { prose: string; captured?: string; id: string; version: number };

export async function composeWithPattern(
  snippets: PatternSource[],
  complete: Complete,
  ctx: LicensingContext & {
    log?: (e: { at: string; actor: string; kind: string; detail: string }) => void;
  },
  sitting?: SittingContext,
  /** When provided, skip pattern selection and use this pattern directly. */
  pattern?: Pattern,
): Promise<QueueDraft | null> {
  const patterns = loadPatterns();
  if (patterns.length === 0 && !pattern) return null;

  const selected = pattern ?? selectCheapPattern(patterns, ctx, ctx.log);
  if (!selected) return null;

  const sources = snippets.map((s) => ({
    prose: s.prose,
    ...(s.captured !== undefined ? { captured: s.captured } : {}),
  }));
  const prompt = patternPrompt(selected, sources);

  const raw = await complete('', [{ role: 'user', text: prompt, at: '' }], { temperature: 0.4 });
  const question = stripFences(raw).trim();
  if (!question) return null;

  const sourceRefs = snippets.map((s) => ({ id: s.id, version: s.version, prose: s.prose }));
  const result = decomposeDerived(question, selected, sourceRefs);

  if (!result.ok) {
    if (ctx.log) {
      ctx.log({
        at: new Date().toISOString(),
        actor: 'clerk',
        kind: 'pattern-decompose-rejection',
        detail: `reason=${result.reason} pattern=${selected.id} question-preview=${question.slice(0, 80)}`,
      });
    }
    console.warn(`ComposePattern: rejected (${result.reason}) for ${selected.id}`);
    return null;
  }

  const guardVerdict = checkQuestion(question, { asked: [] });
  if (guardVerdict !== 'ok') {
    console.warn(`ComposePattern: guard rejected (${guardVerdict}) for ${selected.id}`);
    return null;
  }

  return buildPatternDraft(question, selected, result.quotedSpans, result.operatorsUsed, sitting);
}
