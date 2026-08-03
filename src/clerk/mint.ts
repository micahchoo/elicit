// Minting: ONE reading becomes proposed ops, and nothing else.
//
// This module writes nothing. It composes a payload, makes at most one model
// call, and turns the answer into `ClerkOp[]`. T9 decides what any of it means
// against the wiki on disk; T12 owns the loop, the run quota and the try/catch.
//
// Two boundaries, deliberately not the same boundary (Q-36 — freedom in
// generation, rigidity in validation):
//
//   HERE:  is this a well-formed op? The compiler checks `ClerkOp` at build
//          time; JSON arrives at run time with no compiler watching, so every
//          field the type requires is checked before an object is called one.
//          Plus the one fact this module holds and T9 would have to re-derive:
//          the cited snippet versions that were actually supplied.
//   T9:    is this op admissible against the world? Reading ids in the sweep,
//          claims that exist, bodies of one sentence, cites on disk, totality.
//
// Anything softer here would return a `ClerkOp[]` that is not one, which is a
// lie the compiler cannot catch. Anything harder here would put the same policy
// in two files and let the two drift.
//
// Status never appears: not in the prompt the model reads, and not in the ops
// this module builds (Q-29). An op is reconstructed field by field from the
// contract's shape, so `status`, `attested` and every other invented key are
// structurally incapable of surviving — a blacklist would only stop the keys
// somebody thought of.

import type { Complete, Facet, Reading, Snippet, Turn } from '../types.js';
import {
  assertUserTurn,
  capPrompt,
  fitPayload,
  type Claim,
  type ClerkOp,
  type MintDiagnostics,
  type PayloadPart,
  type Referent,
  type ReferentRef,
} from '../wiki/contract.js';

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * The payload budget, in characters of the ONE user turn. The system prompt is
 * a constant and sits outside it, exactly as the harvester's does.
 *
 * A capacity constant, not a threshold: nothing is selected or suppressed by
 * it, so it belongs here rather than in the shadow register (ADR-0001 makes the
 * small context permanent; this is that context, spent).
 */
export const MINT_PAYLOAD_BUDGET = 2400;

/**
 * Floors, and the one part that has none.
 *
 * A snippet can lose its tail and still carry evidence, so it truncates. The
 * reading is one sentence of agent prose saying what the material MEANS; half
 * of that sentence asks the model to mint a claim from a fragment, which is the
 * silently-wrong-prompt failure `capPrompt` exists to prevent. So the reading
 * part carries no floor, and a reading that will not fit whole is the oversized
 * case — the only one, and the one that keeps `OVERSIZED` reachable at all.
 *
 * (The plan gave the reading a 300-char floor. With floors on every required
 * part their sum is 1506 against a 2400 budget, so `fitPayload` could never
 * return null and the whole OVERSIZED ledger would be dead code. The floor and
 * the plan's own oversized test contradict each other; the test is the one
 * worth keeping.)
 */
export const SNIPPET_FLOOR = 400;
const CLAIM_FLOOR = 200;

/** Shown at most: three of each. More is budget spent on diminishing context. */
const MAX_SNIPPETS = 3;
const MAX_RELATED_CLAIMS = 3;

/** Extraction, not composition. */
const MINT_TEMPERATURE = 0.2;

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The op vocabulary, stated once, to a model that has read a lot of wikis.
 *
 * It gives context and asks for judgment; it does not police. Every rule it
 * states is checked in code — here or at T9 — because an invariant enforced by
 * asking nicely is an invariant that holds until the model has a bad night.
 *
 * It never names Status. That is layer one of Q-29; the parser is layer two.
 */
const SYSTEM_PROMPT = `You are the Clerk for Elicit. You maintain a wiki of Claims about one person, built only from that person's own words.

You are given ONE reading — an earlier agent's one-line interpretation of the person — the snippets of their prose it rests on, and any existing claims that may already cover the same ground. Each snippet may carry the question that drew it and its antecedent context, wrapped in <question> and <context> blocks, so a bare "it" or "that" in the prose reads clearly.

Decide what the wiki should do about this reading. Return a JSON array of operations covering that one reading, usually one operation.

The vocabulary is six operations and nothing else:
- {"op":"MINT","reading":ID,"body":"...","range":"...","cites":["..."],"facet":"..."} — nothing in the wiki says this yet.
- {"op":"UPDATE","reading":ID,"claim":CLAIM_ID,"body":"...","range":"...","addCites":["..."]} — an existing claim says this, and this reading sharpens it or adds evidence for it.
- {"op":"MERGE","reading":ID,"into":CLAIM_ID,"from":[CLAIM_ID],"body":"...","range":"..."} — two or more existing claims say one thing.
- {"op":"SUPERSEDE","reading":ID,"claim":CLAIM_ID,"body":"...","range":"...","cites":["..."],"reason":"..."} — the person has changed, and an existing claim now describes a past self. The old claim is kept as evidence of who they were.
- {"op":"ARCHIVE","reading":ID,"claim":CLAIM_ID,"reason":"..."} — an existing claim was a misreading. Its file is kept.
- {"op":"KEEP","reading":ID,"note":"..."} — the wiki already says this well enough. KEEP is a real answer and often the right one.

Rules:
- "range" is the context where a claim holds: "at work", "since the move", "when the stakes are low". MINT, UPDATE, MERGE and SUPERSEDE each need one. "This person is X" with no range is not a claim about anybody.
- "body" is ONE sentence, in your own words, about the person. Never a quotation of them. The wiki is about ONE person, and every body names them the same way: "The user". Never "The person", never "The author", never a bare "They" where the subject can be named.
- SUPERSEDE and ARCHIVE each need a "reason", in your own words.
- Cite only the snippet versions listed below, copied exactly as they are written there.
- <question> and <context> blocks are lineage, never evidence: they explain what the prose points at, but they are not the person's approved words. Never quote them, never cite them, never echo them into a body or a range.
- "facet" is one of: episode, general-event, lifetime-period, fact, construct, intention, value, causal-theory.
- Match the prose's modality. If the prose says they did it, the claim says they did it; if it says they intend to or want to, the claim says they intend to or want to. Completed work is never filed as facet "intention".
- Keep the prose's hedges. "As far as I saw it" stays an observer's view; a decision the prose describes as shared stays shared. Never promote the person to sole author of something the prose hedges.
- MINT and UPDATE may carry "referents": [{"name":"...","kind":"person|project|place|pole|construct|other"}] — the people, projects, places and constructs the claim is about, named the way this person names them.
- Name referents exactly as the prose names them; never resolve a word to a relation or object the prose does not state. "ma'am" stays "ma'am", never "their mother"; a named work stays named — "Anse Brek's Ledger", never "a ledger". If the prose does not say who or what something is, the claim does not invent it.

Return ONLY the JSON array. No markdown fences. No commentary.`;

// ---------------------------------------------------------------------------
// Payload composition
// ---------------------------------------------------------------------------

/** The reading, framed so a floor-truncation would cut the prose and not the header. */
function readingPart(r: Reading): string {
  return [
    `READING ${r.id}`,
    `facet: ${r.facet} | stance: ${r.stance}`,
    `cites: ${r.cites.join(', ')}`,
    r.reading,
  ].join('\n');
}

/**
 * One cited snippet, labelled with the version whose PROSE is shown, wrapped
 * so the citable text is the <snippet> block and nothing else.
 *
 * The label and the text have to agree, or the model cites a version it never
 * read. `snippets` holds the latest version of each id (that is what
 * `vault.rebuildIndex()` returns), so an older cite on the reading resolves to
 * newer prose here, and the label says so.
 *
 * Ticket 091: the snippet's stored lineage — the question that drew it and
 * the antecedent-context window (ticket 073) — rides along, typed-marked.
 * LINEAGE, never corpus: the model may read it to name a referent a bare
 * "it" points at, but only the <snippet> block is citable or quotable. The
 * system prompt says so, `citeResolves` refuses a cite of anything that is
 * not a written snippet version, and the payload's own labels keep the
 * boundary textual and greppable (074's discipline).
 *
 * The lineage blocks sit BEFORE the prose because a part can be sliced to
 * its floor under budget pressure — the slice keeps the head of the part, so
 * lineage and the snippet's opener survive and only the prose tail is lost,
 * which is the degradation `SNIPPET_FLOOR` already accepts.
 */
function snippetPart(s: Snippet): string {
  // The lineage reads are folded onto the marker lines on purpose: the
  // invariant test requires every provenance lineage access in this file to
  // sit on a typed-marker line, so the read and the marker cannot drift.
  return [
    `SNIPPET ${s.id}@${s.version}`,
    ...(s.provenance.question === '' ? [] : [`<question>${s.provenance.question}</question>`]),
    ...(s.provenance.context === undefined || s.provenance.context === '' ? [] : [`<context>${s.provenance.context}</context>`]),
    `<snippet>${s.prose}</snippet>`,
  ].join('\n');
}

/**
 * The snippet part's floor: `SNIPPET_FLOOR` prose characters plus the fixed
 * overhead that keeps the part's typed markers intact. `fitPayload` slices a
 * part to its floor from the START, so a truncated snippet keeps its header,
 * its lineage blocks, its <snippet> opener, `SNIPPET_FLOOR` chars of prose
 * and its closer — a closed block, never a cut mid-marker.
 */
function snippetFloor(s: Snippet): number {
  return snippetPart(s).length - s.prose.length + SNIPPET_FLOOR;
}

/** An existing claim, WITHOUT its status — the model is not shown a field it must not write. */
function claimPart(c: Claim): string {
  return `EXISTING CLAIM ${c.id}\nfacet: ${c.facet} | range: ${c.range}\n${c.body}`;
}

/** The cited snippets, in the reading's own citation order, deduplicated, capped. */
function citedSnippets(r: Reading, snippets: Record<string, Snippet>): Snippet[] {
  const out: Snippet[] = [];
  const seen = new Set<string>();
  for (const cite of r.cites) {
    const id = splitCite(cite)?.id;
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const s = snippets[id];
    if (!s) {
      // The caller gathers the snippets a reading cites; a gap here costs this
      // reading its evidence and, through the cite check below, its ops.
      console.warn(`Mint: reading ${r.id} cites ${cite}, which the caller did not supply`);
      continue;
    }
    out.push(s);
    if (out.length === MAX_SNIPPETS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cites
// ---------------------------------------------------------------------------

/** `snippetId@version`. The id may hold anything but the final `@`. */
function splitCite(cite: string): { id: string; version: number } | null {
  const at = cite.lastIndexOf('@');
  if (at <= 0 || at === cite.length - 1) return null;
  const id = cite.slice(0, at);
  const raw = cite.slice(at + 1);
  if (!/^\d+$/.test(raw)) return null;
  return { id, version: Number(raw) };
}

/**
 * Does this cite name a version that was actually written?
 *
 * `@1` when the latest is `@2` RESOLVES: versions are immutable and the old one
 * is still on disk, still evidence of a past self (Q-5). That is a stale
 * citation for lint to find, never a fabrication. `@7` of a snippet with two
 * versions was never written, and a claim resting on it rests on nothing.
 *
 * Checked against the snippets supplied with this reading, which is the only
 * world this module can see. T9 re-checks the survivors against the disk.
 */
function citeResolves(cite: string, snippets: Record<string, Snippet>): boolean {
  const parsed = splitCite(cite);
  if (!parsed) return false;
  const s = snippets[parsed.id];
  if (!s) return false;
  return parsed.version >= 1 && parsed.version <= s.version;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Strips markdown code fences, keeping the inner content. */
function stripFences(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*\n?/i, '');
  s = s.replace(/\n?```\s*$/, '');
  return s.trim();
}

/**
 * The op objects the model produced, or null when nothing parsed.
 *
 * Three wrappings are accepted — a bare array, `{"ops": [...]}`, and a lone
 * object — because how the model packaged its answer is a matter of taste and
 * what the ops contain is not. `null` is a legitimate outcome and returns
 * cleanly; it is not an error and must never look like an empty answer.
 */
function parseOps(raw: string): unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed === null || typeof parsed !== 'object') return null;
  const wrapped = (parsed as { ops?: unknown }).ops;
  if (Array.isArray(wrapped)) return wrapped;
  // A single op object, unwrapped.
  if (typeof (parsed as { op?: unknown }).op === 'string') return [parsed];
  return null;
}

// ---------------------------------------------------------------------------
// Shaping — the contract's types, enforced where the compiler cannot reach
// ---------------------------------------------------------------------------

/**
 * The six verbs and the six referent kinds as runtime data, written as
 * exhaustive records so that widening either union in the contract breaks THIS
 * file until it is updated. A hand-kept array would silently go stale.
 */
const OP_VERBS: Record<ClerkOp['op'], true> = {
  MINT: true,
  UPDATE: true,
  MERGE: true,
  SUPERSEDE: true,
  ARCHIVE: true,
  KEEP: true,
};

const REFERENT_KINDS: Record<Referent['kind'], true> = {
  person: true,
  project: true,
  place: true,
  pole: true,
  construct: true,
  other: true,
};

const FACETS: Record<Facet, true> = {
  episode: true,
  'general-event': true,
  'lifetime-period': true,
  fact: true,
  construct: true,
  intention: true,
  value: true,
  'causal-theory': true,
  'know-what': true,
  'know-how': true,
  habit: true,
  'know-why': true,
};

/** A required string field: present, a string, and not just whitespace. */
function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** A required non-empty array of non-empty strings. */
function textList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = text(item);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

/** Every cite in the list resolves, or the list is refused whole. */
function resolvedCites(v: unknown, snippets: Record<string, Snippet>): string[] | null {
  const list = textList(v);
  if (!list) return null;
  for (const cite of list) {
    if (!citeResolves(cite, snippets)) return null;
  }
  return list;
}

/**
 * Referent proposals, filtered rather than refused: a malformed name should not
 * cost a good claim its existence. `aliasOf` is carried when present and never
 * asked for — proposing an alias needs the existing registry, which this
 * payload does not show.
 */
function referentRefs(v: unknown): ReferentRef[] {
  if (!Array.isArray(v)) return [];
  const out: ReferentRef[] = [];
  for (const item of v) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = text(rec['name']);
    const kind = typeof rec['kind'] === 'string' ? rec['kind'] : null;
    if (name === null || kind === null || !(kind in REFERENT_KINDS)) continue;
    const aliasOf = text(rec['aliasOf']);
    out.push({
      name,
      kind: kind as Referent['kind'],
      // exactOptionalPropertyTypes: a present key holding undefined is a write
      // that throws in matter.stringify, so the key is spread or absent.
      ...(aliasOf !== null ? { aliasOf } : {}),
    });
  }
  return out;
}

type Shaped = { ok: true; op: ClerkOp } | { ok: false; reason: string };

/**
 * Rebuild one op from the contract's shape, field by field.
 *
 * `reading` is DERIVED from the item and never read off the model's answer.
 * With one reading per call the id is a fact the caller holds, exactly as the
 * harvester derives `sourceTurn` from its chunk — and a hallucinated id would
 * otherwise cost the reading a whole run at T9's unknown-reading rejection, for
 * a field the model was never the authority on.
 */
function shapeOp(
  raw: Record<string, unknown>,
  readingId: string,
  snippets: Record<string, Snippet>
): Shaped {
  const verb = typeof raw['op'] === 'string' ? raw['op'] : '';
  if (!(verb in OP_VERBS)) return { ok: false, reason: `unknown op "${verb}"` };

  const body = text(raw['body']);
  const range = text(raw['range']);
  const claim = text(raw['claim']);
  const reason = text(raw['reason']);
  const refs = referentRefs(raw['referents']);

  switch (verb as ClerkOp['op']) {
    case 'MINT': {
      if (body === null) return { ok: false, reason: 'MINT without a body' };
      if (range === null) return { ok: false, reason: 'MINT without a range' };
      const cites = resolvedCites(raw['cites'], snippets);
      if (cites === null) return { ok: false, reason: 'MINT without cites that resolve' };
      const facet = typeof raw['facet'] === 'string' ? raw['facet'] : '';
      if (!(facet in FACETS)) return { ok: false, reason: `MINT with facet "${facet}"` };
      return {
        ok: true,
        op: {
          op: 'MINT',
          reading: readingId,
          body,
          range,
          cites,
          facet: facet as Facet,
          ...(refs.length > 0 ? { referents: refs } : {}),
        },
      };
    }

    case 'UPDATE': {
      if (claim === null) return { ok: false, reason: 'UPDATE without a claim' };
      // body, range and addCites are each optional on the type; an UPDATE that
      // carries none of them is T9's rule to refuse, not this module's.
      let addCites: string[] | null = null;
      if (raw['addCites'] !== undefined) {
        addCites = resolvedCites(raw['addCites'], snippets);
        if (addCites === null) return { ok: false, reason: 'UPDATE with addCites that do not resolve' };
      }
      return {
        ok: true,
        op: {
          op: 'UPDATE',
          reading: readingId,
          claim,
          ...(body !== null ? { body } : {}),
          ...(range !== null ? { range } : {}),
          ...(addCites !== null ? { addCites } : {}),
          ...(refs.length > 0 ? { referents: refs } : {}),
        },
      };
    }

    case 'MERGE': {
      const into = text(raw['into']);
      const from = textList(raw['from']);
      if (into === null) return { ok: false, reason: 'MERGE without an into' };
      if (from === null) return { ok: false, reason: 'MERGE without a from list' };
      if (body === null) return { ok: false, reason: 'MERGE without a body' };
      if (range === null) return { ok: false, reason: 'MERGE without a range' };
      return { ok: true, op: { op: 'MERGE', reading: readingId, into, from, body, range } };
    }

    case 'SUPERSEDE': {
      if (claim === null) return { ok: false, reason: 'SUPERSEDE without a claim' };
      if (body === null) return { ok: false, reason: 'SUPERSEDE without a body' };
      if (range === null) return { ok: false, reason: 'SUPERSEDE without a range' };
      if (reason === null) return { ok: false, reason: 'SUPERSEDE without a reason' };
      const cites = resolvedCites(raw['cites'], snippets);
      if (cites === null) return { ok: false, reason: 'SUPERSEDE without cites that resolve' };
      return {
        ok: true,
        op: { op: 'SUPERSEDE', reading: readingId, claim, body, range, cites, reason },
      };
    }

    case 'ARCHIVE': {
      if (claim === null) return { ok: false, reason: 'ARCHIVE without a claim' };
      if (reason === null) return { ok: false, reason: 'ARCHIVE without a reason' };
      return { ok: true, op: { op: 'ARCHIVE', reading: readingId, claim, reason } };
    }

    case 'KEEP': {
      const note = text(raw['note']);
      return {
        ok: true,
        op: { op: 'KEEP', reading: readingId, ...(note !== null ? { note } : {}) },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type MintItem = {
  reading: Reading;
  /** The reading's cited snippets, keyed by snippet id, LATEST version each. */
  snippets: Record<string, Snippet>;
  /** Possibly-related existing claims, retrieved by the caller. At most 3 are shown. */
  relatedClaims: Claim[];
};

export type MintResult = {
  ops: ClerkOp[];
  /** The model's output verbatim, so a failed parse is inspectable. Empty when no call was made. */
  raw: string;
  diagnostics: MintDiagnostics;
};

/**
 * Propose the wiki ops for ONE reading. Calls `complete` exactly once, or not
 * at all. Writes nothing, resolves nothing, returns no status.
 *
 * A model failure is NOT caught here. `MintDiagnostics` has no field for "the
 * call failed", because that count belongs to the run: T12 wraps each call in
 * its own try/catch and increments `MintRunDiagnostics.callErrors`. Swallowing
 * the error here would make a dead endpoint indistinguishable from a wiki with
 * nothing to say — the exact confusion eval finding #1 was.
 */
export async function proposeOps(item: MintItem, complete: Complete): Promise<MintResult> {
  const shown = citedSnippets(item.reading, item.snippets);

  const parts: PayloadPart[] = [
    { name: 'reading', text: readingPart(item.reading), required: true },
    ...shown.map((s) => ({
      name: `snippet:${s.id}`,
      text: snippetPart(s),
      required: true,
      floor: snippetFloor(s),
    })),
    ...item.relatedClaims.slice(0, MAX_RELATED_CLAIMS).map((c) => ({
      name: `claim:${c.id}`,
      text: claimPart(c),
      required: false,
      floor: CLAIM_FLOOR,
    })),
  ];

  const fitted = fitPayload(parts, MINT_PAYLOAD_BUDGET);
  if (!fitted) {
    // Over budget at the floors. Skipping costs one reading and no model call;
    // T12 records it as an OVERSIZED sweep line, which marks the reading swept
    // so it leaves the head of the queue and lands in `oversizedReadingIds()`.
    // `oversized` is the discriminator a caller reads FIRST — `parseMode` says
    // 'failed' here only because nothing was ever parsed.
    console.warn(`Mint: reading ${item.reading.id} does not fit the payload budget — skipped, no call made`);
    return {
      ops: [],
      raw: '',
      diagnostics: {
        rawChars: 0,
        parsed: false,
        parseMode: 'failed',
        opsSeen: 0,
        statusKeysStripped: 0,
        oversized: true,
      },
    };
  }

  // Belt to `fitPayload`'s braces: a composition bug that outruns the budget
  // throws here instead of sending a silently wrong prompt.
  const payload = capPrompt([fitted.text], MINT_PAYLOAD_BUDGET);

  const turns: Turn[] = [{ role: 'user', text: payload, at: new Date().toISOString() }];
  // One user turn, so the list is user-LAST by construction — asserted anyway,
  // because llama.cpp answers a list ending on an assistant turn with nothing
  // at all, and that failure is silent and total (ticket 023).
  assertUserTurn(turns);

  const raw = await complete(SYSTEM_PROMPT, turns, { temperature: MINT_TEMPERATURE });

  const entries = parseOps(raw);
  if (entries === null) {
    console.warn(`Mint: reading ${item.reading.id} produced no parsable ops (${raw.length} chars)`);
    return {
      ops: [],
      raw,
      diagnostics: {
        rawChars: raw.length,
        parsed: false,
        parseMode: 'failed',
        opsSeen: 0,
        statusKeysStripped: 0,
        oversized: false,
      },
    };
  }

  const ops: ClerkOp[] = [];
  let statusKeysStripped = 0;

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      console.warn(`Mint: dropped a non-object op from reading ${item.reading.id}`);
      continue;
    }
    const rec = entry as Record<string, unknown>;

    // Q-29 / Q-33, counted before anything else so the measurement survives a
    // drop for another reason: what is counted is what the model WROTE. A
    // silently stripped key teaches nothing about whether the contract holds.
    for (const key of ['status', 'attested']) {
      if (key in rec) {
        statusKeysStripped++;
        console.warn(`Mint: dropped a "${key}" key — never model-writable (reading ${item.reading.id})`);
      }
    }

    const shaped = shapeOp(rec, item.reading.id, item.snippets);
    if (!shaped.ok) {
      // Dropped, never patched. The reading then goes uncovered, T9 lands it in
      // `unprocessed`, and the next run tries again (Q-29).
      console.warn(`Mint: dropped an op from reading ${item.reading.id} — ${shaped.reason}`);
      continue;
    }
    if (typeof rec['reading'] === 'string' && rec['reading'] !== item.reading.id) {
      console.warn(
        `Mint: model reading id "${String(rec['reading'])}" corrected to actual=${item.reading.id}`
      );
    }
    ops.push(shaped.op);
  }

  return {
    ops,
    raw,
    diagnostics: {
      rawChars: raw.length,
      parsed: true,
      parseMode: 'json',
      // Every entry the model produced, before any drop — `opsSeen` against
      // `ops.length` is where a caller sees that a drop happened.
      opsSeen: entries.length,
      statusKeysStripped,
      oversized: false,
    },
  };
}
