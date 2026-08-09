/**
 * findGaps — the one model call in the composition slice (the gap sweep's
 * engine), and the boundary it cannot cross.
 *
 * The model's real competence over a sequence is noticing that a seam does
 * not hold — never permuting it. The ordering machinery this function
 * replaces was convicted on its own archive: six of eight generated
 * candidates were byte-identical to the base under a different principle
 * name (the composition redesign, §1). What survives is the discipline the
 * ordering carried: a gap question must set off an exact phrase of one of
 * the two paragraphs it sits between (Q-12, the guard that used to live at
 * arrangements.ts:365-375). It MOVED with the gap-finding into this
 * function, because it is what keeps a 'leap' from degenerating into a
 * generic writing prompt.
 *
 * One call, one payload — the composition's pinned sequence with its prose
 * and dates, ending on a user-role message (llama.cpp 400s otherwise; the
 * discipline src/clerk/composed.ts already holds). The model returns at
 * most `gapsPerPass` seams of DISTINCT kinds — otherwise the sweep would
 * get twelve 'thin's and the cap would mean nothing — and every invariant
 * is checked in code at one boundary before a gap is returned; a gap that
 * fails is dropped whole rather than repaired (Q-36).
 *
 * This function mints nothing. It cannot reach the Queue: a found gap
 * carries `pending` — its verified question text — and no `question` id;
 * the person's 'ask this' mints (Q-39). A finder that minted would put
 * every composition's worth of questions in the Queue for none the person
 * kept.
 *
 * The whole function is try/catch-isolated: a failure — including malformed
 * JSON from the model — returns `{ gaps: [], dropped: [] }` and never
 * throws into the sweep. Zero gaps is a valid, non-exceptional outcome:
 * the sequence holds together.
 */
import type { Complete, Snippet } from '../types.js';
import type { Entry, GapKind, Pin } from '../piece/contract.js';
import { checkQuotesSource } from './composed.js';
import { stripFences } from './compose-gate.js';

/** The Activity-Log-shaped sink the docket's deps.log shape; the sweep passes its own. */
export type ArrangementLog = (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;

/** One found seam: the kind the model named it, the pin it follows, the question. */
export type FoundGap = {
  kind: GapKind;
  /** The pinned snippet the gap follows; the sweep anchors the entry after it. */
  after: string;
  /** Verified to set off an exact phrase of an adjacent pin (Q-12). */
  question: string;
};

/** One refused finding — the kind it claimed and the boundary that refused it. */
export type GapDrop = { kind: string; reason: DropReason };

/** The boundary's refusal vocabulary — closed. */
type DropReason =
  | 'unknown-kind'
  | 'unknown-anchor'
  | 'unquoted-gap'
  | 'duplicate-kind'
  | 'gap-cap';

const KINDS: readonly GapKind[] = ['leap', 'unsupported', 'thin', 'unclosed'];

/** The pins with their prose and dates — the whole payload, nothing else. */
function pinsPayload(pins: Pin[], snippets: Record<string, Snippet>): string {
  return pins
    .map((p, i) => {
      const s = snippets[p.snippet];
      const date = s === undefined ? 'unknown date' : s.captured;
      const prose = s === undefined ? '(prose unavailable)' : s.prose;
      return `${i + 1}. id: ${p.snippet} (version ${p.version}), written ${date}\n   "${prose}"`;
    })
    .join('\n\n');
}

function buildPrompt(pins: Pin[], snippets: Record<string, Snippet>, cap: number): string {
  return `You are a clerk for Elicit — a quiet, reflective writing tool. The person is reading a piece made of pinned paragraphs from their own writing, in the order below. Do NOT reorder or rewrite anything. Read the sequence and notice where it fails to hold together — the seams. For each seam, ask the ONE question only the person can answer.

The pinned paragraphs, in order:

${pinsPayload(pins, snippets)}

Return ONE JSON object with a "gaps" array. Each gap:
- "kind": one of "leap" (two adjacent passages do not connect — what goes between them), "unsupported" (an assertion stated once, never grounded — the instance behind it), "thin" (the subject is under-covered relative to the rest — write more about it), "unclosed" (something opened early, never returned to — how did it end)
- "after": the id of the paragraph the gap follows
- "question": one question. The question MUST set off, inside quotation marks, an exact phrase of one of the two paragraphs adjacent to the gap — the one it follows or the one it precedes — verbatim as the person wrote it.

Return at most ${cap} gaps, each of a DIFFERENT kind. Return ONLY valid JSON. No markdown fences. No commentary.`;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function asString(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

function isKind(x: string): x is GapKind {
  return (KINDS as readonly string[]).includes(x);
}

/**
 * findGaps.
 *
 * `thresholds.gapsPerPass` is the cap — the register's piece.gapsPerPass,
 * the renamed gapsPerCandidate (§7 of the redesign). The sweep passes the
 * register's value; the number is never invented here.
 *
 * `log` and `modelName` keep the sweep's injectable contract (the docket
 * deps.log shape and Q-34's stamp) — the sweep owns the logging and the
 * stamping of what it stores, so this function stays pure: it never emits
 * and never mints.
 */
export async function findGaps(
  entries: readonly Entry[],
  snippets: Record<string, Snippet>,
  complete: Complete,
  thresholds: { gapsPerPass: number },
  log?: ArrangementLog,
  modelName?: string,
): Promise<{ gaps: FoundGap[]; dropped: GapDrop[] }> {
  const dropped: GapDrop[] = [];
  const reject = (kind: string, reason: DropReason): void => {
    dropped.push({ kind, reason });
  };

  try {
    const pins = entries.filter((e): e is Pin => e.kind === 'pin');
    const raw = await complete(
      '',
      [{ role: 'user', text: buildPrompt(pins, snippets, thresholds.gapsPerPass), at: '' }],
      { temperature: 0.4 },
    );

    const parsed: unknown = JSON.parse(stripFences(raw));
    const root = asRecord(parsed);
    const rawGaps = root?.gaps;
    if (root === null || !Array.isArray(rawGaps)) {
      // Not the contract's shape — a failed run, not a refusal.
      return { gaps: [], dropped: [] };
    }

    // The sequence as the Q-12 guard reads it: pin snippet ids in order.
    const pinIds = pins.map((p) => p.snippet);
    const seen = new Set<GapKind>();
    const gaps: FoundGap[] = [];

    for (const rawGap of rawGaps) {
      const gap = asRecord(rawGap);
      const kind = gap === null ? null : asString(gap.kind);
      const after = gap === null ? null : asString(gap.after);
      const question = gap === null ? null : asString(gap.question);
      if (kind === null || !isKind(kind)) {
        reject(kind ?? 'unknown', 'unknown-kind');
        continue;
      }
      if (after === null || !pinIds.includes(after)) {
        reject(kind, 'unknown-anchor');
        continue;
      }
      if (question === null || question.trim().length === 0) {
        reject(kind, 'unquoted-gap');
        continue;
      }
      // ── The Q-12 guard — the discipline the ordering carried, moved
      // with the gap-finding. The two pins adjacent to the gap's position:
      // the one it follows and the one it precedes. A question about the
      // seam must quote one of them, verbatim (checkQuotesSource) — that is
      // what keeps a 'leap' from degenerating into a generic writing prompt.
      const at = pinIds.indexOf(after);
      const neighbors = [pinIds[at], pinIds[at + 1] ?? pinIds[at - 1]].filter(
        (id): id is string => id !== undefined,
      );
      const quotesAdjacent = neighbors.some((id) => {
        const s = snippets[id];
        return s !== undefined && checkQuotesSource(question, s.prose).ok;
      });
      if (!quotesAdjacent) {
        reject(kind, 'unquoted-gap');
        continue;
      }
      // Distinct kinds: the cap's other half — twelve 'thin's is one
      // finding twelve ways, and the sweep has no room for that.
      if (seen.has(kind)) {
        reject(kind, 'duplicate-kind');
        continue;
      }
      if (gaps.length >= thresholds.gapsPerPass) {
        reject(kind, 'gap-cap');
        continue;
      }
      seen.add(kind);
      gaps.push({ kind, after, question });
    }

    return { gaps, dropped };
  } catch {
    // The model call failed, or its JSON did not parse. Never throws into
    // the sweep; the sequence stands as it is.
    return { gaps: [], dropped: [] };
  }
}
