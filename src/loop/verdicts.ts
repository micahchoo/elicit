/**
 * Verdict objects and the keep rule (Q-88, Q-98; ticket 122's record plane).
 *
 * A verdict is a file beside the life it cites:
 * `archives/eval/<cycle>/<trial>/verdicts/<dossier-id>.json`, written once
 * at trial end and read-only from then on. The judge is a persona, not the
 * loop — it judges lives, never mechanisms — so everything in a verdict is
 * prose plus pointers back into the archived transcript.
 *
 * ## Why validation is mechanical, and only mechanical
 *
 * A tireless reader that wants to be helpful will write a beautiful
 * paragraph about a moment that never happened, and no amount of reading
 * the paragraph tells you it did not. So this file never reads the prose.
 * It asks two questions a machine can answer: does the cited FILE exist in
 * the archived life, and is the cited QUOTE a byte-exact substring of it.
 * A citation that answers both RESOLVES; nothing else counts as evidence.
 *
 * The rule that follows is the one that makes citation cheap to demand:
 * a dimension that claims a difference and cites nothing that resolves
 * makes the whole verdict malformed. Not that dimension — the verdict.
 * A judge that can lose one claim by inventing a quote will invent quotes.
 *
 * ## Why the keep rule is a conjunction
 *
 * Across 5 personas x 5 dimensions: keep iff at least one resolving-cited
 * win exists AND zero resolving-cited regressions exist (Q-98, Q-94). Ties
 * are silence, not evidence. The eager pleaser's enthusiasm never outvotes
 * the guarded speaker's regression, because a candidate that helps four
 * people and hurts one is not an improvement to a single-user instrument.
 *
 * Voiding on an invariant breach (Q-87) happens BEFORE this — the caller
 * owns that gate, because an invariant violation voids the trial outright
 * and there is then nothing here to weigh.
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

/** The rubric's five lived surfaces, in the order the rubric names them. */
export const DIMENSIONS = ['questioning', 'harvest', 'wiki', 'descents', 'returns'] as const;

export type Dimension = (typeof DIMENSIONS)[number];

/** Which arm a verdict prefers, under the blinding the harness applies. */
export type Arm = 'first' | 'second' | 'neither';

/** The name the harness uses for the arm under test, once `order` is unblinded. */
export const CANDIDATE_ARM = 'candidate';

/**
 * A pointer back into one archived life. `ref` is a path relative to the
 * trial archive, optionally carrying a line span (`…/2026-08-01.md#L12-L18`);
 * `quote` is the text as it stands in that file, character for character.
 */
export type Citation = {
  life: 'first' | 'second';
  ref: string;
  quote: string;
};

export type DimensionVerdict = {
  better: Arm;
  because: string;
  citations: Citation[];
};

export type DisconfirmingAnswer = {
  answer: string;
  citations: Citation[];
};

export type Verdict = {
  dossier: string;
  cycle: string;
  trial: string;
  /**
   * The arms in presentation order, recorded blind and unblinded by the
   * harness after validation. `order[0]` is the arm shown as *first life*.
   * One entry must name the candidate (`CANDIDATE_ARM`) or the verdict
   * cannot be attributed to anything.
   */
  order: string[];
  dimensions: Record<Dimension, DimensionVerdict>;
  /** The rubric's cross-dimension probes, keyed by question id. */
  disconfirming?: Record<string, DisconfirmingAnswer>;
  /** Harness-computed behavioral traces, attached — never persona-authored. */
  traces?: Record<string, unknown>;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; malformed: string[] };

/**
 * Whether every dimension that claims a difference is backed by at least
 * one resolving citation.
 *
 * `trialArchiveDir` is the root of the archived trial. A ref that escapes
 * it does not resolve, whatever is at the other end: the judge may cite the
 * life it read and nothing else, and a `../../` that happens to land on a
 * real file would otherwise pass this check while citing a life nobody
 * lived in this trial.
 */
export function validateVerdict(verdict: Verdict, trialArchiveDir: string): ValidationResult {
  const root = resolve(trialArchiveDir);
  const malformed: string[] = [];

  for (const dimension of DIMENSIONS) {
    const d = verdict.dimensions?.[dimension];
    if (d === undefined) {
      malformed.push(`${dimension}: the dimension is missing`);
      continue;
    }
    if (d.better === 'neither') continue;

    const citations = Array.isArray(d.citations) ? d.citations : [];
    if (citations.length === 0) {
      malformed.push(`${dimension}: better=${d.better} with no citation`);
      continue;
    }

    const failures: string[] = [];
    let resolved = false;
    for (const citation of citations) {
      const why = whyUnresolved(citation, root);
      if (why === null) {
        resolved = true;
        break;
      }
      failures.push(why);
    }
    if (!resolved) {
      malformed.push(`${dimension}: better=${d.better}, no citation resolves — ${failures.join('; ')}`);
    }
  }

  return malformed.length === 0 ? { ok: true } : { ok: false, malformed };
}

/**
 * Why one citation does not resolve, or `null` when it does. Written as a
 * reason rather than a boolean because "the quote is not in the file" and
 * "the file is not there" send an operator to different places.
 */
function whyUnresolved(citation: Citation, root: string): string | null {
  if (citation === null || typeof citation !== 'object') return 'the citation is not an object';
  const ref = typeof citation.ref === 'string' ? citation.ref : '';
  const quote = typeof citation.quote === 'string' ? citation.quote : '';
  if (ref === '') return 'the citation names no ref';
  if (quote === '') return `${ref}: the citation quotes nothing`;

  const path = resolve(root, stripLineSpan(ref));
  const inside = relative(root, path);
  if (inside.startsWith('..') || inside === '') return `${ref}: the ref is outside the trial archive`;
  if (!existsSync(path)) return `${ref}: no such file in the trial archive`;

  let contents: string;
  try {
    contents = readFileSync(path, 'utf-8');
  } catch {
    return `${ref}: the file could not be read`;
  }
  // Byte-exact. A quote the judge tidied — a smart apostrophe, a collapsed
  // space — is a quote of something the person did not write.
  return contents.includes(quote) ? null : `${ref}: the quote is not in the file`;
}

/**
 * A ref with its line span removed: `notes/day.md#L12-L18` is `notes/day.md`.
 *
 * The span is a reading aid for the operator who opens the file, and it is
 * deliberately NOT part of the check: the substring test is stronger than a
 * line number and a judge that miscounts lines around a real quote has
 * still cited a real moment.
 */
function stripLineSpan(ref: string): string {
  const hash = ref.indexOf('#');
  return hash === -1 ? ref : ref.slice(0, hash);
}

/** One dimension of one dossier's verdict, as the keep rule reports it. */
export type KeepEvidence = {
  dossier: string;
  dimension: Dimension;
  /** The judge's sentence, so a report can quote the reason it kept or refused. */
  because: string;
};

export type KeepResult = {
  keep: boolean;
  wins: KeepEvidence[];
  regressions: KeepEvidence[];
};

/**
 * The keep rule (Q-98): keep the candidate iff at least one resolving-cited
 * win exists and zero resolving-cited regressions exist.
 *
 * Every verdict handed here must have passed `validateVerdict` already —
 * that is what makes "cited" mean "resolving-cited". The citation count is
 * re-checked all the same, so this function alone can never count an
 * uncited win: two cheap checks disagreeing is a bug worth having, and one
 * check that has to be remembered is a bug waiting.
 *
 * A verdict whose `order` names no candidate arm THROWS. It is not a tie
 * and not a regression — it is a verdict about nothing identifiable, and
 * quietly folding it into either pile would put a number in a report that
 * stands for nothing.
 */
export function keepRule(verdicts: Verdict[]): KeepResult {
  const wins: KeepEvidence[] = [];
  const regressions: KeepEvidence[] = [];

  for (const verdict of verdicts) {
    const candidateSide = sideOfCandidate(verdict);

    for (const dimension of DIMENSIONS) {
      const d = verdict.dimensions?.[dimension];
      if (d === undefined || d.better === 'neither') continue;
      // Ties are silence; so is a claim with nothing behind it.
      if (!Array.isArray(d.citations) || d.citations.length === 0) continue;

      const evidence: KeepEvidence = { dossier: verdict.dossier, dimension, because: d.because };
      if (d.better === candidateSide) wins.push(evidence);
      else regressions.push(evidence);
    }
  }

  return { keep: wins.length > 0 && regressions.length === 0, wins, regressions };
}

/** Which blinded label — `first` or `second` — the candidate was shown as. */
function sideOfCandidate(verdict: Verdict): 'first' | 'second' {
  const index = (verdict.order ?? []).indexOf(CANDIDATE_ARM);
  if (index === 0) return 'first';
  if (index === 1) return 'second';
  throw new Error(
    `verdict ${verdict.dossier}: order ${JSON.stringify(verdict.order)} names no "${CANDIDATE_ARM}" arm, ` +
    'so no win or regression in it can be attributed',
  );
}
