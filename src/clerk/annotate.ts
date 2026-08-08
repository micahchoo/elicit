// Annotating: ONE snippet becomes a resolved-referent annotation, or a
// silence, and nothing else.
//
// This module writes nothing and gates nothing. It composes a payload from
// the snippet and its stored lineage, makes at most one model call, and
// turns the answer into an `AnnotateResult`. The measurement script owns
// the run, the quota and the try/catch; whether annotation ever wires into
// the Clerk is a shipping decision that waits on that measurement (ticket
// 074).
//
// The model is an agent here, never a gate: it reads prose and names what
// a dangling referent points at, and the answer is evidence for the
// measurement, never a decision. The only authority this module holds is
// over the SHAPE of the answer — the JSON contract is checked field by
// field, and the snippet id and version are DERIVED from the item, never
// read off the model's reply, exactly as mint.ts derives the reading id.
//
// A model failure is NOT silence. A run that cannot parse an answer must
// be able to count that failure, so malformed output THROWS and the
// caller's run records it; `silence` is the model's own `{"annotate":
// false}`, a decision this module reports but never confuses with a dead
// endpoint.
//
// Lineage, never corpus: the question that drew the snippet and its
// antecedent context ride along, typed-marked (ticket 091's discipline),
// so the model can name the referent a bare "it" points at — and the
// referent must be identifiable from those blocks ALONE, which is why the
// invariant test pins the lineage reads to the marker lines.
//
// Q-34: every annotation is model-stamped. The model id and the instant
// the stamp was composed travel with the annotation, so a later wiring
// decision can tell which model resolved which referent when.

import type { Complete, Snippet, Turn } from '../types.js';
import { assertUserTurn } from '../wiki/contract.js';
import { stripFences } from './compose-gate.js';

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/** Extraction, not composition — the same temperature minting runs at. */
const ANNOTATE_TEMPERATURE = 0.2;

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The annotation contract, stated once, to a model that has read a lot of
 * wikis.
 *
 * It gives context and asks for judgment; it does not police. Every rule it
 * states is checked in code — the shape and the throw below — because an
 * invariant enforced by asking nicely is an invariant that holds until the
 * model has a bad night.
 */
const SYSTEM_PROMPT = `You are the Clerk for Elicit. You maintain a wiki of Claims about one person, built only from that person's own words.

You are shown ONE snippet of the person's prose, with the question that drew it and its antecedent-context window when they exist, wrapped in <question> and <context> blocks.

A DANGLING REFERENT is a pronoun, demonstrative, or definite description whose referent is NOT identifiable from the snippet's own text alone.

Decide whether the snippet contains a dangling referent and, if it does, name the entity it points at. The referent must be identifiable from the <question> and <context> blocks ALONE — those blocks are the sanctioned resolution; the snippet's own text is the problem, never the solution.

Do NOT annotate:
- first-person "I" or "we" — the speaker is always self-evident;
- generic "you" — addressed to no one in particular;
- expletive "it" — "it rained", "it is time";
- a "this" or "that" the snippet itself resolves;
- proper nouns — a name needs no resolution;
- relative pronouns the snippet resolves on its own.

If the referent is not identifiable from the <question> and <context> blocks, stay silent — never guess, even when the topic feels obvious. A wrong resolution becomes a fabricated wiki claim.

Return ONLY the JSON object, no commentary, no fences:
- {"annotate": false} when there is nothing to resolve;
- {"annotate": true, "expression": "...", "referent": "..."} otherwise — the expression is the dangling span in the snippet, quoted verbatim; the referent is what it points at, in your own words.`;

// ---------------------------------------------------------------------------
// Payload composition
// ---------------------------------------------------------------------------

/**
 * The snippet, labelled with the version whose PROSE is shown, with the
 * lineage that explains what a bare "it" points at.
 *
 * The lineage reads are folded onto the marker lines on purpose: the
 * invariant test requires every provenance lineage access in this file to
 * sit on a typed-marker line, so the read and the marker cannot drift.
 * The <snippet> block is the only citable text; the question and context
 * are interpretation, never evidence.
 */
function snippetPart(s: Snippet): string {
  return [
    `SNIPPET ${s.id}@${s.version}`,
    ...(s.provenance.question === '' ? [] : [`<question>${s.provenance.question}</question>`]),
    ...(s.provenance.context === undefined || s.provenance.context === '' ? [] : [`<context>${s.provenance.context}</context>`]),
    `<snippet>${s.prose}</snippet>`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Parsing and shaping
// ---------------------------------------------------------------------------

/** A required string field: present, a string, and not just whitespace. */
function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/**
 * The answer as an `AnnotateResult`, or a THROWN error.
 *
 * `{"annotate": false}` is silence — a legitimate outcome. Everything else
 * is shaped strictly: `annotate` must be exactly true or false, and a true
 * annotation must carry non-empty expression and referent. Any other parse
 * or shape throws, because the caller's run must be able to count a model
 * that answered wrong; a throw is a counted failure, silence is a model
 * decision, and confusing the two is eval finding #1 revisited.
 *
 * The snippet id and version are DERIVED from the item, never read off the
 * model's answer — the model was never the authority on which snippet it
 * was shown. The stamp is composed here, at the moment the answer is
 * accepted (Q-34).
 */
function shapeAnswer(raw: string, item: AnnotateItem): AnnotateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (e) {
    throw new Error(`Annotate: answer is not valid JSON — ${String(e)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Annotate: answer is not a JSON object');
  }
  const rec = parsed as Record<string, unknown>;
  if (rec['annotate'] === false) return { kind: 'silence', raw };
  if (rec['annotate'] === true) {
    const expression = text(rec['expression']);
    const referent = text(rec['referent']);
    if (expression === null) throw new Error('Annotate: annotate:true without a non-empty expression');
    if (referent === null) throw new Error('Annotate: annotate:true without a non-empty referent');
    return {
      kind: 'annotation',
      annotation: {
        snippetId: item.snippet.id,
        version: item.snippet.version,
        expression,
        referent,
        model: item.model,
        modelAt: new Date().toISOString(),
      },
      raw,
    };
  }
  throw new Error(`Annotate: "annotate" is ${String(rec['annotate'])} — expected true or false`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type Annotation = {
  snippetId: string;
  version: number;
  expression: string;
  referent: string;
  model: string;
  modelAt: string;
};

export type AnnotateItem = {
  snippet: Snippet;
  model: string;
};

export type AnnotateResult =
  | { kind: 'annotation'; annotation: Annotation; raw: string }
  | { kind: 'silence'; raw: string };

/**
 * Resolve the dangling referents of ONE snippet. Calls `complete` exactly
 * once. Writes nothing, gates nothing, resolves nothing.
 *
 * The payload carries the snippet and its lineage and nothing else — no
 * corpus, no wiki state, no prior annotations. A model failure is NOT
 * caught here: the throw is the measurement's count, and swallowing it
 * would make a dead endpoint indistinguishable from a snippet with nothing
 * to resolve.
 */
export async function annotateReferent(item: AnnotateItem, complete: Complete): Promise<AnnotateResult> {
  const payload = snippetPart(item.snippet);

  const turns: Turn[] = [{ role: 'user', text: payload, at: new Date().toISOString() }];
  // One user turn, so the list is user-LAST by construction — asserted
  // anyway, because llama.cpp answers a list ending on an assistant turn
  // with nothing at all, and that failure is silent and total (ticket 023).
  assertUserTurn(turns);

  const raw = await complete(SYSTEM_PROMPT, turns, { temperature: ANNOTATE_TEMPERATURE });

  return shapeAnswer(raw, item);
}

// ---------------------------------------------------------------------------
// Intention-horizon annotation (ticket 106)
// ---------------------------------------------------------------------------

/**
 * The horizon an intention reading carries — when the person expected the
 * intention to materialize. Extracted from the snippet's prose by the model,
 * never guessed: an ambiguous timeline becomes a dating question (Anchor rule).
 */
export type IntentionHorizonResult =
  | { kind: 'horizon'; snippetId: string; version: number; horizon: 'now' | 'session' | 'days'; model: string; modelAt: string; raw: string }
  | { kind: 'ambiguous'; snippetId: string; version: number; datingQuestion: string; model: string; modelAt: string; raw: string };
const HORIZON_SYSTEM_PROMPT = `You are the Clerk for Elicit. Given a snippet the user wrote that reads as an intention — something they plan or intend to do — determine the timeline: when they expected this to happen.

Return ONLY valid JSON. No markdown fences. No commentary.

The answer must be ONE of:
- {"horizon": "now"} — the intention is about the present moment or immediate future, likely already done or in progress
- {"horizon": "session"} — the intention is for this session or today, likely done by now
- {"horizon": "days"} — the intention is for the coming days or weeks, likely enough time has passed

If the timeline is truly ambiguous — no horizon can be read from the words — return:
- {"ambiguous": true, "datingQuestion": "..."} — a question asking the user when they expected this to happen, in your own words, quoting the intention verbatim`;

/**
 * Read the horizon from one intention snippet. Calls `complete` exactly once.
 * Writes nothing, gates nothing — the caller owns the run, the quota, and the
 * try/catch. A model failure is NOT caught: the throw is the measurement's count.
 */
export async function annotateIntentionHorizon(
  snippet: Snippet,
  model: string,
  complete: Complete,
): Promise<IntentionHorizonResult> {
  const snippetLine = `Snippet [written ${snippet.captured}]: "${snippet.prose}"`;
  const turns: Turn[] = [{ role: 'user', text: snippetLine, at: new Date().toISOString() }];
  assertUserTurn(turns);

  const raw = await complete(HORIZON_SYSTEM_PROMPT, turns, { temperature: 0.2 });
  const modelAt = new Date().toISOString();
  return shapeHorizon(raw, snippet.id, snippet.version, model, modelAt);
}


/** Parse and validate the model's horizon answer, or throw. */
function shapeHorizon(
  raw: string,
  snippetId: string,
  version: number,
  model: string,
  modelAt: string,
): IntentionHorizonResult {
  const trimmed = stripFences(raw).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`annotateIntentionHorizon: model returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`annotateIntentionHorizon: JSON is not an object: ${trimmed.slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.ambiguous === true) {
    const datingQuestion = typeof obj.datingQuestion === 'string' ? obj.datingQuestion.trim() : '';
    if (datingQuestion.length === 0) {
      throw new Error('annotateIntentionHorizon: ambiguous=true but datingQuestion is empty');
    }
    return { kind: 'ambiguous', snippetId, version, datingQuestion, model, modelAt, raw };
  }

  const horizon = typeof obj.horizon === 'string' ? obj.horizon.trim() : '';
  if (horizon !== 'now' && horizon !== 'session' && horizon !== 'days') {
    throw new Error(`annotateIntentionHorizon: invalid horizon ${JSON.stringify(horizon)} — expected now, session, or days`);
  }
  return { kind: 'horizon', snippetId, version, horizon: horizon as 'now' | 'session' | 'days', model, modelAt, raw };
}
