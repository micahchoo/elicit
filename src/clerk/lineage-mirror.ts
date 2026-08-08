/**
 * Lineage mirror — the Q-83 question source.
 *
 * Reads neutral usage facts from transcripts, computes a license predicate
 * against a specific Claim, and composes a juxtaposition-style question that
 * presents two lineage facts side by side with zero assertion — the reading
 * is the person's to make.
 *
 * The sealed class — skips, deferrals, refusals, dormancy — is STRUCTURALLY
 * unreachable: `LineageRead` has no fields for any of them. Not filtered;
 * not representable (Q-78 pattern).
 *
 * Shadow-first (Q-35): the sweep always evaluates candidates and logs what
 * it would have minted; the threshold gate controls whether questions are
 * actually written to the queue. The cap is live (Q-56).
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import type { Complete, LineageRead, QueueDraft, QueueStore } from '../types.js';
import { readTranscripts } from '../vault/transcripts.js';
import { isInterrogative, hasFirstPersonOutsideQuote } from '../language/guards.js';
import { THRESHOLDS, shadowDecision } from '../wiki/thresholds.js';
import { composeWithRetry, stripFences, type Rejection } from './compose-gate.js';

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const IMPORT_PROTOCOL = 'import';

/** A sitting record as the mirror reads it — just the timestamp. */
interface SittingStamp {
  started: string;
  isImport: boolean;
}

/** Read every real (non-import) sitting's started timestamp, oldest first. */
function readSittingStamps(root: string): SittingStamp[] {
  return readTranscripts(root).map((t) => ({
    started: t.started,
    isImport: t.protocol === IMPORT_PROTOCOL,
  }));
}

/**
 * Read the lineage facts the mirror is licensed to surface.
 *
 * Returns null when there are no sittings (no lineage to read).
 * Otherwise returns ONLY the neutral, person-visible facts the Q-83
 * constitution permits: timestamps, counts, cadence.
 */
export function readLineage(
  root: string,
  claimId: string,
  claimCreated: string,
  claimUpdated: string,
  now: number = Date.now(),
): LineageRead | null {
  const allStamps = readSittingStamps(root);
  const realStamps = allStamps.filter((s) => !s.isImport);
  if (realStamps.length === 0) return null;

  const totalSittings = realStamps.length;

  // Sittings in the last 30 days
  const thirtyDaysAgo = now - 30 * DAY_MS;
  let inLastMonth = 0;
  for (const s of realStamps) {
    const t = Date.parse(s.started);
    if (!Number.isNaN(t) && t >= thirtyDaysAgo) inLastMonth++;
  }

  // Days since the most recent sitting
  const lastMs = Date.parse(realStamps[realStamps.length - 1]!.started);
  const daysSinceLastSitting = Number.isNaN(lastMs)
    ? 0
    : Math.max(0, Math.floor((now - lastMs) / DAY_MS));

  // Average days between sittings: span from first to last, divided by gaps
  let averageDaysBetween = 0;
  if (realStamps.length >= 2) {
    const firstMs = Date.parse(realStamps[0]!.started);
    const spanMs = lastMs - firstMs;
    if (!Number.isNaN(firstMs) && !Number.isNaN(lastMs) && spanMs > 0) {
      averageDaysBetween = Math.round(spanMs / DAY_MS / (realStamps.length - 1));
    }
  }

  return {
    claimId,
    claimCreated,
    claimUpdated,
    totalSittings,
    sittingsInLastMonth: inLastMonth,
    daysSinceLastSitting,
    averageDaysBetween,
  };
}

// ---------------------------------------------------------------------------
// License predicate
// ---------------------------------------------------------------------------

/**
 * Is this claim licensed for a mirror question?
 *
 * Structural, never model-inferred: the claim must have gone untouched for
 * `lineageMirror.minClaimAgeDays` days — aged by `updated`, not `created`,
 * because the licence is DIVERGENCE between the claim and the lineage
 * (Q-83): a claim edited yesterday has none, however old its birth — and
 * cadence data must exist. Returns the `LineageRead` when licensed, null
 * otherwise.
 */
export function licenseMirror(
  root: string,
  claim: { id: string; created: string; updated: string },
  now?: number,
): LineageRead | null {
  // The bound is the bound whether or not the flag is live (Q-56) — a
  // not-live fallback that LOOSENED it would invert the flag's meaning.
  const minAge = THRESHOLDS['lineageMirror.minClaimAgeDays'].value as number;

  const updatedMs = Date.parse(claim.updated);
  if (Number.isNaN(updatedMs)) return null;

  const ageDays = Math.floor(((now ?? Date.now()) - updatedMs) / DAY_MS);
  if (ageDays < minAge) return null;

  return readLineage(root, claim.id, claim.created, claim.updated, now);
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/**
 * Compose a lineage mirror question from a claim and its lineage read.
 *
 * The model receives two lineage facts and is asked to present them
 * juxtaposition-style — side by side, zero assertion. The question must
 * end with `?` and must not speak in first person outside quoted material.
 *
 * Routes through the shared composeWithRetry skeleton (C10), so mirror
 * questions pass the same emit-form gate (checkEmitForm + checkQuestion)
 * every other composer passes.
 *
 * Returns null when the model cannot produce a valid question after one
 * retry.
 */
export async function composeLineageMirror(
  claim: { body: string; created: string },
  lineage: LineageRead,
  complete: Complete,
): Promise<string | null> {
  const facts = [
    `This claim was written on ${claim.created}.`,
    `There have been ${lineage.totalSittings} sittings, about ${lineage.averageDaysBetween} days apart on average.`,
  ];

  const prompt = `You are a clerk for Elicit. You are given two neutral facts about a person's usage of the app. Compose ONE question that presents these two facts side by side — juxtaposition-style, with zero assertion about what the facts mean. The reading is the person's to make; your job is only to place the facts next to each other.

Claim (for context only — do not quote it): "${claim.body}"
Fact 1: ${facts[0]}
Fact 2: ${facts[1]}

RULES:
- Present the two facts, side by side, as a single question ending in "?"
- Never assert what the facts mean or imply — no "this suggests", "it seems", "perhaps"
- Never use first-person pronouns (I, me, my) outside quotation marks
- Keep the question short: one or two sentences at most

Return only the question text. No markdown, no commentary.`;

  // The loose form: any fence info string is stripped (```ts, ```python, …),
  // where the strict json-only form would leave a foreign fence behind.
  const strip = (raw: string): string => stripFences(raw, { loose: true });

  // composeWithRetry applies the strict json-only strip itself; pre-stripping
  // here keeps the loose any-fence semantics the mirror always shipped.
  const send = (p: string) => complete(p, [], { temperature: 0.4 }).then(strip);

  return composeWithRetry(
    'lineage-mirror',
    send,
    prompt,
    (question) => {
      const rejection = validateMirrorQuestion(question);
      return rejection
        ? { ok: false, rejection }
        : { ok: true, question, value: question };
    },
    () => `${prompt}\n\nYour last attempt was not acceptable. It either did not end with "?", used first-person pronouns outside quotes, or made an assertion about what the facts mean. Present only the facts, side by side, as a short question.`,
    () => {
      // The mirror ships no reject sink — the sweep logs at the minted/failed
      // level only. Rejections stay silent, as they always were.
    },
  );
}

/**
 * Validate a mirror question against the composed-question invariants.
 *
 * Returns the rejection token when a mirror check fails, null when the
 * question passes. The skeleton's emit-form gate (guardComposed) runs after
 * this builder gate; the token only labels the retry.
 */
function validateMirrorQuestion(question: string): Rejection | null {
  if (!isInterrogative(question)) return 'not-interrogative';
  if (hasFirstPersonOutsideQuote(question)) return 'first-person';

  // Q-81: zero assertion — reject presupposition triggers. The question
  // asserts meaning the facts do not support — a degenerate composition.
  const triggers = [
    /\bwhy (have|did|do) you\b/i,
    /\bwhen (will|did|do) you\b/i,
    /\bhow (long|often|much) have you\b/i,
  ];
  for (const t of triggers) {
    if (t.test(question)) return 'degenerate';
  }

  return null;
}

// ---------------------------------------------------------------------------
// The docket sweep thunk
// ---------------------------------------------------------------------------

const LINEAGE_MIRROR_CAP = 1;

/** A claim as the mirror sweep reads it. */
export interface MirrorClaim {
  id: string;
  body: string;
  created: string;
  updated: string;
}

export type MirrorLogFn = (e: {
  at: string;
  actor: string;
  kind: string;
  detail: string;
}) => void;

/**
 * Build and return the sweep thunk for injection into `runDocket`.
 *
 * The thunk evaluates every claim, checks the license predicate, and when
 * the selection threshold is live composes and mints at most
 * `LINEAGE_MIRROR_CAP` questions. In shadow mode, candidates are logged as
 * `lineage-mirror-shadow` events and nothing is minted.
 *
 * Deduplication: one mirror question per claim, ever — any existing
 * `lineage-mirror` queue entry (any status) blocks re-minting for that
 * claim. Same rule as the gap-fill any-status block (Q-24, Q-41).
 */
export function runLineageMirrorSweep(deps: {
  vaultRoot: string;
  listClaims: () => MirrorClaim[];
  complete: Complete;
  queue: QueueStore;
  log: MirrorLogFn;
  /** When true, skip the model call (test mode). */
  dryRun?: boolean;
}): () => Promise<{ evaluated: number; minted: number }> {
  return async () => {
    const ts = () => new Date().toISOString();
    const threshold = THRESHOLDS['lineageMirror.selection'];

    const claims = deps.listClaims();
    let evaluated = 0;
    let minted = 0;

    // Dedupe: one mirror question per claim, ever
    const allEntries = deps.queue.list();
    const mirroredClaimIds = new Set<string>();
    for (const e of allEntries) {
      if (e.source === 'lineage-mirror' && e.lineageMirror) {
        mirroredClaimIds.add(e.lineageMirror.claimId);
      }
    }

    for (const claim of claims) {
      if (minted >= LINEAGE_MIRROR_CAP) break;
      if (mirroredClaimIds.has(claim.id)) continue;

      const lineage = licenseMirror(deps.vaultRoot, claim);
      if (!lineage) continue;

      evaluated++;

      // Shadow decision: log and skip, or act
      if (!shadowDecision(threshold, `would mint mirror question for claim ${claim.id}`, (e) => {
        deps.log({ at: e.at, actor: 'clerk', kind: e.kind, detail: e.detail });
      })) {
        deps.log({
          at: ts(),
          actor: 'clerk',
          kind: 'lineage-mirror-shadow',
          detail: `evaluated claim ${claim.id}: ${lineage.daysSinceLastSitting}d since last sitting, ${lineage.totalSittings} total`,
        });
        continue;
      }

      if (deps.dryRun) continue;

      try {
        const question = await composeLineageMirror(claim, lineage, deps.complete);
        if (!question) continue;

        const draft: QueueDraft = {
          source: 'lineage-mirror',
          license: `lineage mirror: claim ${claim.id} created ${claim.created}`,
          question,
          questionForm: 'deliberative',
          horizon: 'now',
          sharpness: 'weak',
          lineageMirror: lineage,
        };

        deps.queue.add(draft);
        minted++;

        deps.log({
          at: ts(),
          actor: 'clerk',
          kind: 'lineage-mirror-minted',
          detail: `minted mirror for claim ${claim.id}: ${lineage.daysSinceLastSitting}d since last sitting`,
        });
      } catch (err) {
        deps.log({
          at: ts(),
          actor: 'clerk',
          kind: 'lineage-mirror-failed',
          detail: `claim ${claim.id}: ${String(err)}`,
        });
      }
    }

    return { evaluated, minted };
  };
}
