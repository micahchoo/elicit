// Auto-gather (redesign-2026-08-09 §5.3): after each harvest, ONE model
// call per open composition asks whether any of that sitting's passages
// belong, judged against the subject line and the existing material.
//
// The licensing differs from Q-37 deliberately (§5): the claim layer is on
// probation leaning cut, so a claim-dependent offer is unbuildable. The
// subject line plus existing material is claim-free and costs one call per
// sitting per open composition — never one per snippet.
//
// Auto-gather never adds. It OFFERS (Q-39 — nothing is placed without the
// person's touch): this module only writes `Offer` records through
// `pieces.addOffer`, and every one of them carries a `put it in` / `not
// this one` pair below the piece. Denial is durable — a declined passage is
// never offered again, stored the way `DirectionRecord.declinedOptions`
// stores a refused quest option.
//
// Probation (§10): the floor is manual gathering only. The fingerprint that
// saves it is compositions that grew by accepted offer, reaching passages
// from sittings the person did not go looking through; the test suite
// models that round trip.
//
// The model proposes passages; it never writes prose. The answer is a JSON
// object naming passage ids from the SHOWN set only — any other string is
// malformed output and fails that composition, never a silent accept
// (the annotate.ts discipline: ids are derived from the input, never read
// off the reply).

import { ulid } from 'ulid';
import { stripFences } from './compose-gate.js';
import type { EventKind } from '../log/kinds.js';
import type { Piece, PieceStore } from '../piece/contract.js';
import type { Complete, Snippet } from '../types.js';

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/** The existing material shown to the model, capped in characters (§5's
 *  "existing material" is the context, not the whole composition). */
const MATERIAL_CHAR_CAP = 6000;
/** Extraction, not composition — the same temperature minting runs at. */
const GATHER_TEMPERATURE = 0.2;

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The gathering contract, stated once, to a model that has read a lot of
 * compositions. It gives context and asks for judgment; it does not police.
 * Every rule it states is checked in code — the shape and the throw below —
 * because an invariant enforced by asking nicely is an invariant that holds
 * until the model has a bad night.
 *
 * The licensing is in the prompt: judged against the subject line and the
 * existing material ONLY. No claims, no citation clusters, no external
 * knowledge — the claim layer is on probation and must not be load-bearing
 * here (§5, Q-37 amended).
 */
const SYSTEM_PROMPT = `You are the Clerk for Elicit. A composition is an organising method for like-minded snippets across sittings, defined by the person's own subject line.

A sitting has just produced passages. Decide which of those passages belong in the composition, judged against ONLY two things:
1. the subject line — the person's words describing what the composition gathers;
2. the material already in it.

Judge nothing else. No claims, no citation clusters, no external knowledge: a passage belongs when the person would want it in the same document — same theme, same thread, same question.

Return ONLY the JSON object, no commentary, no fences:
- {"belong": ["<passage-id>", ...]} — every passage id that belongs;
- {"belong": []} — when none do.

Name ONLY passage ids from the list you were shown. Never write prose.`;

// ---------------------------------------------------------------------------
// Payload composition
// ---------------------------------------------------------------------------

/** One pin's prose as the model sees it, truncated to the material cap. */
function materialPart(piece: Piece, snippets: Record<string, Snippet>): string {
 let out = '';
 for (const e of piece.entries) {
  if (e.kind !== 'pin') continue;
  const s = snippets[e.snippet];
  if (!s) continue;
  if (out.length >= MATERIAL_CHAR_CAP) {
   out += '\n…';
   break;
  }
  out += `\n- ${s.prose}`;
 }
 return out.length === 0 ? ' (none yet)' : out;
}

/**
 * The composition's subject and material, then the sitting's passages with
 * their ids — the only ids the model may echo back.
 */
function buildPayload(piece: Piece, snippets: Record<string, Snippet>, passages: Snippet[]): string {
 const subject = piece.subject.trim() === '' ? ' (none given)' : piece.subject;
 const lines = [
  `COMPOSITION SUBJECT\n${subject}`,
  `EXISTING MATERIAL${materialPart(piece, snippets)}`,
  `PASSAGES FROM THIS SITTING`,
 ];
 for (const p of passages) {
  lines.push(`- ${p.id}: ${p.prose}`);
 }
 return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parsing and shaping
// ---------------------------------------------------------------------------

/**
 * The answer as a list of passage ids, or a THROWN error. The ids are
 * matched against the SHOWN passage set — an id the model was never shown,
 * or any prose, is malformed output and refuses the whole answer.
 */
function shapeBelong(raw: string, passages: Snippet[]): string[] {
 const known: Record<string, true> = Object.fromEntries(passages.map((p) => [p.id, true]));
 const text = stripFences(raw, { loose: true });
 let parsed: unknown;
 try {
  parsed = JSON.parse(text);
 } catch {
  throw new Error(`auto-gather: model returned non-JSON: ${text.slice(0, 80)}`);
 }
 if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
  throw new Error('auto-gather: answer is not a JSON object');
 }
 if (!('belong' in parsed)) {
  throw new Error('auto-gather: answer has no "belong" field');
 }
 const belong = parsed.belong;
 if (!Array.isArray(belong)) {
  throw new Error('auto-gather: "belong" is not an array');
 }
 const ids: string[] = [];
 for (const v of belong) {
  if (typeof v !== 'string' || !(v in known)) {
   throw new Error(`auto-gather: unknown passage id in answer: ${String(v).slice(0, 80)}`);
  }
  if (!ids.includes(v)) ids.push(v);
 }
 return ids;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The run's outcome, in counts only — never user content. */
export type AutoGatherResult = {
 /** Open compositions asked. */
 compositions: number;
 /** Offers written. */
 offered: number;
 /** Passages the model named but the composition could not take (declined, pinned, already offered). */
 skipped: number;
 /** Compositions whose answer failed to parse or whose write threw. */
 failed: number;
};

/**
 * Ask every OPEN composition whether any of one sitting's kept passages
 * belong — one model call per composition, never per snippet (§5). An open
 * composition is one that is neither discarded (Q-3) nor set down (Q-41:
 * a piece on the shelf should not accrue offers — the same "open" predicate
 * the composition sweep uses).
 *
 * Writes nothing but offers. A passage the model names is skipped, not
 * offered, when it is already declined, already pinned, or already offered.
 * A malformed answer fails that one composition and the run continues.
 */
export async function autoGatherSitting(deps: {
 pieces: PieceStore;
 /** The vault snippet index, resolved live — pins and the material read
  *  the same truth the store's pin validation does (Q-3). */
 snippets: () => Record<string, Snippet>;
 /** The kept snippets of the sitting that just harvested. */
 passages: Snippet[];
 complete: Complete;
 log: (e: { at: string; actor: 'clerk'; kind: EventKind; detail: string }) => void;
 /** The sitting that produced the passages — stamped on every offer. */
 sourceSitting: string;
}): Promise<AutoGatherResult> {
 const { pieces, snippets, passages, complete, log, sourceSitting } = deps;
 if (passages.length === 0) return { compositions: 0, offered: 0, skipped: 0, failed: 0 };

 const open = pieces
  .list()
  .filter((p) => p.discardedAt === undefined && p.setDownAt === undefined);
 if (open.length === 0) return { compositions: 0, offered: 0, skipped: 0, failed: 0 };

 // One index read for the whole run — the material every composition is
 // judged against comes from the same snapshot (Q-3).
 const index = snippets();
 const byId: Record<string, Snippet> = Object.fromEntries(passages.map((p) => [p.id, p]));
 let offered = 0;
 let skipped = 0;
 let failed = 0;
 const at = new Date().toISOString();

 for (const piece of open) {
  const payload = buildPayload(piece, index, passages);
  let belong: string[];
  try {
   const raw = await complete(SYSTEM_PROMPT, [{ role: 'user', text: payload, at }], {
    temperature: GATHER_TEMPERATURE,
   });
   belong = shapeBelong(raw, passages);
  } catch (err) {
   failed++;
   log({ at, actor: 'clerk', kind: 'auto-gather-failed', detail: `piece=${piece.id}: ${String(err)}` });
   continue;
  }
  for (const id of belong) {
   if (piece.declined.includes(id)) {
    // Denial is durable — a declined passage is never offered again.
    skipped++;
    continue;
   }
   if (piece.entries.some((e) => e.kind === 'pin' && e.snippet === id)) {
    skipped++;
    continue;
   }
   if (piece.offers.some((o) => o.snippet === id)) {
    // addOffer dedupes by snippet anyway; counting it keeps the log honest.
    skipped++;
    continue;
   }
   const passage = byId[id];
   if (!passage) continue;
   try {
    pieces.addOffer(piece.id, {
     id: ulid(),
     snippet: passage.id,
     version: passage.version,
     sourceSitting,
    });
    offered++;
   } catch (err) {
    // The store throws on a declined snippet as defense-in-depth — a
    // skipped, never a failed composition (the durable denial won).
    skipped++;
    log({ at, actor: 'clerk', kind: 'auto-gather-skipped', detail: `piece=${piece.id} snippet=${id}: ${String(err)}` });
   }
  }
 }
 log({
  at,
  actor: 'clerk',
  kind: 'auto-gather-offered',
  detail: `compositions=${open.length} offered=${offered} skipped=${skipped} failed=${failed}`,
 });
 return { compositions: open.length, offered, skipped, failed };
}
