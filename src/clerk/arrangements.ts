/**
 * proposeArrangements — the one model call in the composition slice, and the
 * boundary it cannot cross (ticket 010, Task 11).
 *
 * The chronology candidate is never model-generated: the base Arrangement IS
 * the chronology and counts as already taken. The model is asked for at most
 * two orderings — argument and contrast — of the SAME pins, and every
 * invariant is checked in code at one boundary before a candidate is
 * returned; a candidate that fails is dropped whole rather than repaired
 * (Q-36). Freedom in generation, rigidity in validation.
 *
 * This function mints nothing. It cannot reach the Queue: a model-marked Gap
 * carries `pending` — its verified question text — and no `question` id;
 * T12's /choose route mints the question if and when the person takes that
 * candidate (Q-39). A proposer that minted would put three candidates' worth
 * of questions in the Queue for one the person kept.
 *
 * The whole function is try/catch-isolated: a failure — including malformed
 * JSON from the model — returns `{ candidates: [], dropped: [] }` and never
 * throws into the route. Zero candidates is a valid, non-exceptional
 * outcome: the person keeps the chronology they already had.
 */
import { ulid } from 'ulid';
import type { Complete, Snippet } from '../types.js';
import {
  distinctPrinciples,
  noProse,
  noTitle,
  pinsResolve,
  samePinSet,
} from '../piece/contract.js';
import type {
  Arrangement,
  ArrangementEntry,
  Gap,
  Marginalia,
  Pin,
  Principle,
} from '../piece/contract.js';
import { checkQuotesSource, findQuotedFragment } from './composed.js';
import { stripFences } from './compose-gate.js';

/** The Activity-Log-shaped sink this module emits through (the docket's deps.log shape). */
export type ArrangementLog = (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;

/** One refused ordering — or one refused piece of an ordering that survived. */
export type ArrangementDrop = { principle: string; reason: string };

/** The boundary's refusal vocabulary — the plan's table, closed. */
type DropReason =
  | 'pin-set'
  | 'unresolved-pin'
  | 'prose-in-body'
  | 'title'
  | 'duplicate-principle'
  | 'orphan-note'
  | 'unquoted-gap'
  | 'gap-cap';

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

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

function buildPrompt(base: Arrangement, snippets: Record<string, Snippet>): string {
  const pins = base.entries.filter((e): e is Pin => e.kind === 'pin');
  return `You are a clerk for Elicit — a quiet, reflective writing tool. The person is reading a piece made of pinned paragraphs from their own writing. Reorder the SAME paragraphs under two organizing principles — "argument" and "contrast" — never adding, dropping, or rewriting a paragraph.

The pinned paragraphs, each with its id, its version, and the date it was written:

${pinsPayload(pins, snippets)}

Return ONE JSON object with an "orderings" array holding EXACTLY two entries, one per principle. Each ordering:
- "principle": "argument" or "contrast"
- "sentence": one sentence naming the organizing principle of this ordering
- "order": the paragraph ids in the order they should read — a permutation of the ids above
- "roles": an object mapping each paragraph id to a short phrase naming that paragraph's role in this ordering
- "gaps": an optional array of places the piece asks a question only the person can answer. Each gap is {"after": <a paragraph id from "order">, "question": <one question>}. A gap's question MUST set off, inside quotation marks, an exact phrase of one of the two paragraphs adjacent to the gap — the one it follows or the one it precedes — verbatim as the person wrote it.

Return ONLY valid JSON. No markdown fences. No commentary.`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function asRecord(x: unknown): Record<string, unknown> | null {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function asString(x: unknown): string | null {
  return typeof x === 'string' ? x : null;
}

/**
 * The first `title` anywhere in the response — top level, on an ordering, or
 * on an entry. A title is body text (Q-1), wherever it sits, so it is hoisted
 * onto the candidate and noTitle refuses it with the 'title' reason rather
 * than letting noProse misreport an entry-level one as prose-in-body.
 */
function findTitle(root: Record<string, unknown>): string | null {
  const own = asString(root.title);
  if (own !== null) return own;
  const orderings = root.orderings;
  if (!Array.isArray(orderings)) return null;
  for (const raw of orderings) {
    const ordering = asRecord(raw);
    if (ordering === null) continue;
    const t = asString(ordering.title);
    if (t !== null) return t;
    const order = ordering.order;
    if (!Array.isArray(order)) continue;
    for (const element of order) {
      const obj = asRecord(element);
      const t2 = obj === null ? null : asString(obj.title);
      if (t2 !== null) return t2;
    }
  }
  return null;
}

/**
 * One order element into an entry. Strings and { snippet, version } objects
 * are pin references (a bare string keeps the base pin's version — a
 * reordering never changes one, Q-5); anything with a `text` field is a
 * transition sentence the model wanted in the body, carried onto the entry so
 * a guard refuses it; anything else is carried whole for the same reason.
 * Guarding never repairs: the response is preserved so the boundary can see
 * what the model actually wrote.
 */
function buildEntry(element: unknown, basePinBySnippet: Map<string, Pin>): ArrangementEntry {
  if (typeof element === 'string') {
    const basePin = basePinBySnippet.get(element);
    return { id: ulid(), kind: 'pin', snippet: element, version: basePin?.version ?? 1 };
  }
  const obj = asRecord(element);
  if (obj === null) {
    // Not a string and not an object: carry it so a guard refuses it.
    return { id: ulid(), kind: 'gap', text: String(element) } as unknown as Gap;
  }
  if (asString(obj.text) !== null) {
    // Deliberately carries a key outside the Gap shape: noProse refuses it.
    return { id: ulid(), kind: 'gap', text: String(obj.text) } as unknown as Gap;
  }
  const snippet = asString(obj.snippet);
  if (snippet !== null) {
    const basePin = basePinBySnippet.get(snippet);
    const version = typeof obj.version === 'number' ? obj.version : basePin?.version ?? 1;
    const extras: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (key !== 'snippet' && key !== 'version' && key !== 'title') extras[key] = obj[key];
    }
    // Extra keys survive onto the pin so noProse sees them; `title` was
    // already hoisted onto the Arrangement (see findTitle).
    return { id: ulid(), kind: 'pin', snippet, version, ...extras } as unknown as Pin;
  }
  return { id: ulid(), kind: 'gap', text: JSON.stringify(obj) } as unknown as Gap;
}

function buildEntries(
  rawOrder: unknown,
  basePinBySnippet: Map<string, Pin>,
): ArrangementEntry[] {
  if (!Array.isArray(rawOrder)) return [];
  const entries: ArrangementEntry[] = [];
  for (const element of rawOrder) {
    entries.push(buildEntry(element, basePinBySnippet));
  }
  return entries;
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/**
 * proposeArrangements.
 *
 * One call, one payload — the pins with their prose and dates, nothing else —
 * ending on a user-role message (llama.cpp 400s otherwise; the discipline
 * src/clerk/composed.ts already holds). The model's JSON is parsed and every
 * check in the plan's boundary table runs in code before anything is
 * accepted.
 *
 * `thresholds.gapsPerCandidate` is the Q-56 bound. The register value
 * (`piece.gapsPerCandidate`, 010 T10) arrives through this parameter;
 * T12's route passes THRESHOLDS['piece.gapsPerCandidate'].value.
 *
 * `modelName` (Q-34) is the model's NAME, which `complete` does not carry;
 * T12's route passes its clerk model name. Absent, the stamp is omitted —
 * the route always passes it.
 */
export async function proposeArrangements(
  base: Arrangement,
  snippets: Record<string, Snippet>,
  complete: Complete,
  thresholds: { gapsPerCandidate: number },
  log?: ArrangementLog,
  modelName?: string,
): Promise<{ candidates: Arrangement[]; dropped: ArrangementDrop[] }> {
  const dropped: ArrangementDrop[] = [];
  const reject = (principle: string, reason: DropReason): void => {
    dropped.push({ principle, reason });
    log?.({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'arrangement-rejected',
      detail: `reason=${reason} principle=${principle}`,
    });
  };
  const proposed = (count: number): void => {
    log?.({
      at: new Date().toISOString(),
      actor: 'clerk',
      kind: 'arrangements-proposed',
      detail: `count=${count}`,
    });
  };

  try {
    const raw = await complete(
      '',
      [{ role: 'user', text: buildPrompt(base, snippets), at: '' }],
      { temperature: 0.4 },
    );

    const parsed: unknown = JSON.parse(stripFences(raw));
    const root = asRecord(parsed);
    const orderings = root?.orderings;
    if (root === null || !Array.isArray(orderings)) {
      // Not the contract's shape — a failed run, not a refusal.
      proposed(0);
      return { candidates: [], dropped: [] };
    }

    const basePins = base.entries.filter((e): e is Pin => e.kind === 'pin');
    const basePinBySnippet = new Map(basePins.map((p) => [p.snippet, p]));
    const hoistedTitle = findTitle(root);

    // Q-38: the survivor set is closed — the base's chronology is seated,
    // and argument and contrast may each appear once. `seen` is the gate;
    // distinctPrinciples below is the belt over the whole set.
    const seen = new Set<Principle>([base.principle]);
    const built: Arrangement[] = [];

    for (const rawOrdering of orderings) {
      const ordering = asRecord(rawOrdering);
      const principle = ordering === null ? null : asString(ordering.principle);
      if (ordering === null || (principle !== 'argument' && principle !== 'contrast')) {
        // The model was asked for argument and contrast; the base holds
        // chronology. Anything else cannot join the survivor set, and the
        // distinctness gate is the one that admits — so the refusal carries
        // the closed-set reason, and the detail names the principle the model
        // actually wrote so T14 can see it was not a true duplicate.
        reject(principle ?? 'unknown', 'duplicate-principle');
        continue;
      }

      const entries = buildEntries(ordering.order, basePinBySnippet);
      const now = new Date().toISOString();
      const candidate: Arrangement = {
        id: ulid(),
        principle,
        entries,
        marginalia: [],
        created: now,
        ...(modelName === undefined ? {} : { model: modelName }),
        ...(hoistedTitle === null ? {} : { title: hoistedTitle }),
      };

      // ── The boundary — every check in code, before anything is accepted ──
      // A candidate failing any of the four whole-candidate guards is dropped
      // whole, in the plan's order, before its Marginalia or gaps are even
      // examined.
      let reason: DropReason | null = null;
      if (samePinSet(base.entries, candidate.entries) !== null) {
        reason = 'pin-set';
      } else if (pinsResolve(candidate, snippets) !== null) {
        reason = 'unresolved-pin';
      } else if (noProse(candidate) !== null) {
        reason = 'prose-in-body';
      } else if (noTitle(candidate) !== null) {
        reason = 'title';
      }
      if (reason !== null) {
        reject(principle, reason);
        continue;
      }

      // Q-38's distinctness, applied as each candidate arrives: a duplicate
      // principle is refused before its Marginalia or gaps are processed.
      if (seen.has(principle)) {
        reject(principle, 'duplicate-principle');
        continue;
      }
      seen.add(principle);

      // ── Marginalia: one principle note, one role note per pin ──
      const pinEntries = entries.filter((e): e is Pin => e.kind === 'pin');
      const pinned = new Set(pinEntries.map((p) => p.snippet));
      const marginalia: Marginalia[] = [];
      const sentence = asString(ordering.sentence);
      if (sentence !== null) {
        marginalia.push({
          id: ulid(),
          on: null,
          note: 'principle',
          text: sentence,
          at: now,
          ...(modelName === undefined ? {} : { model: modelName }),
        });
      }
      const roles = asRecord(ordering.roles);
      for (const pin of pinEntries) {
        const role = roles === null ? undefined : (asString(roles[pin.snippet]) ?? undefined);
        if (role === undefined) continue; // no note for a roleless pin
        marginalia.push({
          id: ulid(),
          on: pin.id,
          note: 'role',
          text: role,
          at: now,
          ...(modelName === undefined ? {} : { model: modelName }),
        });
      }
      // A role naming a snippet that is not pinned in this candidate would
      // aim at an entry that does not exist — drop the note, keep the
      // candidate, record the orphan.
      if (roles !== null) {
        for (const key of Object.keys(roles)) {
          if (!pinned.has(key)) reject(principle, 'orphan-note');
        }
      }

      // ── Model-marked gaps: verified here, minted by T12's /choose route ──
      const rawGaps = ordering.gaps;
      const gapList = Array.isArray(rawGaps) ? rawGaps : [];
      const pinIds = pinEntries.map((p) => p.snippet);
      const surviving: { anchor: string; entry: Gap }[] = [];
      for (const rawGap of gapList) {
        const gap = asRecord(rawGap);
        const after = gap === null ? null : asString(gap.after);
        const question = gap === null ? null : asString(gap.question);
        if (after === null || question === null || !pinned.has(after)) {
          // No verifiable question, or no adjacent pins to quote: the Q-12
          // rule cannot be satisfied, so the gap cannot be verified.
          reject(principle, 'unquoted-gap');
          continue;
        }
        // The two pins adjacent to the gap's position: the one it follows
        // and the one it precedes in the ordering. A question about the
        // leap between two paragraphs must quote one of them (Q-12).
        const at = pinIds.indexOf(after);
        const neighbors = [pinIds[at], pinIds[at + 1] ?? pinIds[at - 1]].filter(
          (id): id is string => id !== undefined,
        );
        const quotesAdjacent = neighbors.some((id) => {
          const s = snippets[id];
          return s !== undefined && checkQuotesSource(question, s.prose).ok;
        });
        if (!quotesAdjacent) {
          reject(principle, 'unquoted-gap');
          continue;
        }
        surviving.push({ anchor: after, entry: { id: ulid(), kind: 'gap', pending: question } });
      }
      // Q-56: gaps per candidate is a bound and ships live. The excess is
      // dropped, not repaired — the first `cap` survivors stand in response
      // order.
      const cap = thresholds.gapsPerCandidate;
      for (let i = cap; i < surviving.length; i++) {
        reject(principle, 'gap-cap');
      }
      const kept = surviving.slice(0, cap);
      const byAnchor = new Map<string, Gap[]>();
      for (const g of kept) {
        const list = byAnchor.get(g.anchor) ?? [];
        list.push(g.entry);
        byAnchor.set(g.anchor, list);
      }
      const finalEntries: ArrangementEntry[] = [];
      for (const pin of pinEntries) {
        finalEntries.push(pin);
        const anchored = byAnchor.get(pin.snippet);
        if (anchored !== undefined) finalEntries.push(...anchored);
      }

      built.push({ ...candidate, entries: finalEntries, marginalia });
    }

    // The belt: the closed-set guard over the whole survivor set, the base
    // seated first. By construction the loop above already enforces it; the
    // guard's verdict is the proof that the set is closed (Q-38).
    let candidates = built;
    for (
      let verdict = distinctPrinciples([base, ...candidates]);
      verdict !== null && candidates.length > 0;
      verdict = distinctPrinciples([base, ...candidates])
    ) {
      const last = candidates.pop()!;
      reject(last.principle, 'duplicate-principle');
    }

    proposed(candidates.length);
    return { candidates, dropped };
  } catch {
    // The model call failed, or its JSON did not parse. Never throws into
    // the route; the person keeps the chronology they already had.
    proposed(0);
    return { candidates: [], dropped: [] };
  }
}
