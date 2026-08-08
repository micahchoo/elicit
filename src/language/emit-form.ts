/**
 * Emit form gate — the mechanical check every composed question passes
 * before it can be asked (ticket 144).
 *
 * Runs AFTER the sourcing gate (checkQuotesSource / checkAroundPhrase):
 * those verify that the question properly quotes its source. This gate
 * verifies the question's form is well-formed prose, not a leaked template
 * token or a mid-phrase cut.
 *
 * Same posture as the harvester's substring gate: failure => console.warn +
 * drop. No retry — a mid-phrase truncation or placeholder token is a clear
 * bug, not a conversational quality adjustment.
 */

import { setOffSpans } from './guards.js';

// ── Mid-phrase detection ─────────────────────────────────────────────────

/**
 * Function words that cannot terminate a complete noun or verb phrase.
 * A quoted span ending on one of these was almost certainly cut mid-thought.
 *
 * A deliberate subset of the lexical STOPWORDS set — words like "now",
 * "there", "again", "still", "not", "nor" can legitimately end a complete
 * phrase.
 */
const MID_PHRASE_ENDERS: Record<string, true> = {
  a: true, an: true, the: true,
  of: true, to: true, for: true, in: true, on: true, at: true, by: true, from: true, with: true, into: true, onto: true,
  and: true, or: true, but: true,
  if: true, as: true, than: true,
  that: true, which: true, who: true, whom: true, whose: true,
};

// ── Placeholder vocabulary ───────────────────────────────────────────────

/** Template variable patterns — leftovers from prompt templating. */
const TEMPLATE_VAR_RE = /\b(?:CLAIM_ID_\w*|PLACEHOLDER|FIXME)\b/i;

/** `something` used as a bare noun-slot. Not "something else" or "do something". */
const BARE_SOMETHING_RE = /(?:^|\s)something(?:\s|$|[.?!,;:])/i;

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeSpan(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function balancedDelimiters(text: string): boolean {
  const straightQuotes = (text.match(/"/g) ?? []).length;
  if (straightQuotes % 2 !== 0) return false;

  let depth = 0;
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** After blanking all quoted spans and stripping surviving quote marks,
 *  does the remaining frame have exactly 1 word? */
function isBareSplice(question: string, spans: { start: number; end: number }[]): boolean {
  let masked = question;
  for (const span of [...spans].reverse()) {
    masked = masked.slice(0, span.start) + ' '.repeat(span.end - span.start) + masked.slice(span.end);
  }
  // Strip surviving quote marks (setOffSpans blanks inner content only)
  masked = masked.replace(/["\u201C\u201D]/g, ' ');
  const words = masked.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length === 1;
}

// ── The gate ─────────────────────────────────────────────────────────────

export type EmitFormResult =
  | { ok: true }
  | { ok: false; failures: string[] };

/**
 * Run every form check on a composed question. Returns `ok: true` only when
 * every check passes — one call, one verdict, so no path can ship a malformed
 * question by forgetting a check.
 *
 * Checks (order mirrors the ticket):
 * 1. No quoted span ends mid-phrase (on a function-word prefix)
 * 2. No placeholder vocabulary (template variables, bare "something")
 * 3. No bare splices (frame text === 1 word after blanking quotes)
 * 4. Balanced quotes and parentheses
 * 5. No duplicated or nested quote spans
 */
export function checkEmitForm(question: string): EmitFormResult {
  const failures: string[] = [];

  // ── 1. Mid-phrase prefix ──
  const spans = setOffSpans(question);
  for (const span of spans) {
    const inner = question.slice(span.start, span.end);
    const tokens = inner.match(/[a-zA-Z]+/g);
    if (tokens && tokens.length > 0 && MID_PHRASE_ENDERS[tokens[tokens.length - 1]!.toLowerCase()]) {
      const excerpt = inner.length > 48
        ? `${inner.slice(0, 44)}…"`
        : `${inner}"`;
      failures.push(`mid-phrase-end: "${excerpt}`);
    }
  }

  // ── 2. Placeholder vocabulary ──
  if (TEMPLATE_VAR_RE.test(question)) {
    const match = question.match(TEMPLATE_VAR_RE)?.[0] ?? '?';
    failures.push(`placeholder-token: ${match}`);
  }
  if (BARE_SOMETHING_RE.test(question)) {
    failures.push('placeholder-token: something');
  }

  // ── 3. Bare splice ──
  if (isBareSplice(question, spans)) {
    failures.push('bare-splice');
  }

  // ── 4. Balanced delimiters ──
  if (!balancedDelimiters(question)) {
    failures.push('unbalanced-delimiters');
  }

  // ── 5. Duplicate quote spans ──
  // Two defect signatures from the eval corpus, nothing broader:
  //  - the same words quoted twice ANYWHERE in one question ("Rest is the
  //    absence of fixing" … "Rest is the absence of fixing");
  //  - a shorter fragment orphaned RIGHT AFTER the quote that contains it
  //    (`"…his old Gretsch in the closet." "his old Gretsch".`).
  // Containment at a distance stays legal — a title or phrase may sit
  // inside one quote and stand alone in another without being a glitch.
  if (spans.length >= 2) {
    spanLoop: for (let i = 0; i < spans.length; i++) {
      const inner = question.slice(spans[i]!.start, spans[i]!.end);
      for (let j = i + 1; j < spans.length; j++) {
        const other = question.slice(spans[j]!.start, spans[j]!.end);
        const ni = normalizeSpan(inner);
        const no = normalizeSpan(other);
        const exact = ni === no;
        const gap = question.slice(spans[j - 1]!.end, spans[j]!.start);
        const adjacent = j === i + 1 && /^[\s."'“”‘’—–\-,;:]*$/.test(gap);
        const contained = ni.includes(no) || no.includes(ni);
        if (exact || (adjacent && contained)) {
          const excerpt = inner.length > 36
            ? `"${inner.slice(0, 32)}…"`
            : `"${inner}"`;
          failures.push(`duplicate-quote-span: ${excerpt}`);
          break spanLoop;
        }
      }
    }
  }

  if (failures.length > 0) return { ok: false, failures };
  return { ok: true };
}
