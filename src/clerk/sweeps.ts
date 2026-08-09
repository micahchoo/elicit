/**
 * The docket's sweep jobs (Wave B2): the four self-contained jobs split
 * out of src/clerk/docket.ts — referent annotations, intention-horizon
 * annotations, outcome questions and the one-time template sweep — plus
 * the rotation-cursor primitive the still-true (docket.ts) and outcome
 * (this file) sweeps share. docket.ts re-exports the four jobs so the
 * boot wiring (docket-init.ts) and the test suite keep their './docket.js'
 * imports unchanged.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Vault, QueueStore, Snippet, Complete } from '../types.js';
import type { SittingContext } from './composed.js';
import { composeOutcomeQuestion } from './composed.js';
import { readSitting, sittingCache } from './sitting.js';
import { citeSnippetId } from '../wiki/status.js';
import { annotateReferent, annotateIntentionHorizon } from './annotate.js';
import type { AnnotationStore, AnnotationRecord } from './annotation-store.js';
import type { PieceLog } from './docket.js';

// ── The referent annotation job (ticket 074) ──
// At most one model call per candidate snippet: annotateReferent names what
// a dangling referent points at, or stays silent. Annotations are derived
// agent prose — re-annotation overwrites, never appends — and a new snippet
// version is new text, so a version-stale record is re-asked. Silence IS
// persisted — a snippet the model already judged is never re-asked — but
// the rendering shows nothing for it. The cap bounds model calls per run,
// not successes.

/** The most snippets one run may ask the model about (ticket 074). */
const ANNOTATION_RUN_CAP = 5;

/**
 * The referent annotation job (ticket 074): at most `cap` candidates,
 * newest captured first, each missing a record or carrying a version-stale
 * one. The stamp (model + modelAt) comes FROM annotateReferent's result —
 * the annotation is composed and stamped at the moment the answer is
 * accepted (Q-34); this job persists it as-is and never re-stamps. A model
 * failure is a counted failure, never a silence (the annotation module
 * throws rather than confusing the two, and this job records the throw).
 */
export async function runReferentAnnotations(deps: {
 snippets: () => Record<string, Snippet>;
 annotations: AnnotationStore;
 complete: Complete;
 modelName: string;
 log: PieceLog;
 cap?: number;
}): Promise<{ annotated: number; silent: number; failed: number }> {
 const cap = deps.cap ?? ANNOTATION_RUN_CAP;
 const candidates = Object.values(deps.snippets())
  .sort((a, b) => b.captured.localeCompare(a.captured))
  .filter((s) => {
   const rec = deps.annotations.get(s.id);
   return rec === null || rec.version !== s.version;
  });
 let annotated = 0;
 let silent = 0;
 let failed = 0;
 for (const snippet of candidates.slice(0, cap)) {
  try {
   const result = await annotateReferent({ snippet, model: deps.modelName }, deps.complete);
   if (result.kind === 'annotation') {
    deps.annotations.put({
     kind: 'annotation',
     snippetId: result.annotation.snippetId,
     version: result.annotation.version,
     expression: result.annotation.expression,
     referent: result.annotation.referent,
     model: result.annotation.model,
     modelAt: result.annotation.modelAt,
    });
    annotated++;
   } else {
    deps.annotations.put({
     kind: 'silence',
     snippetId: snippet.id,
     version: snippet.version,
     model: deps.modelName,
     modelAt: new Date().toISOString(),
    });
    silent++;
   }
  } catch (err) {
   failed++;
   deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'referent-annotation-failed', detail: `annotateReferent for snippet ${snippet.id} failed: ${String(err)}` });
  }
 }
 deps.log({ at: new Date().toISOString(), actor: 'clerk', kind: 'referent-annotated', detail: `annotated=${annotated} silent=${silent} failed=${failed}` });
 return { annotated, silent, failed };
}

// ── The intention-horizon annotation job (ticket 106) ──
// At most one model call per intention-facet snippet: the model reads the
// prose and extracts the horizon — when the person expected the intention
// to materialize. An ambiguous timeline becomes a dating question (the
// Anchor rule), never a guess. The cap bounds model calls per run, not
// successes. Silence IS persisted: a snippet the model already read is
// never re-asked, unless the snippet version has changed.

const HORIZON_RUN_CAP = 3;

export async function runIntentionHorizonAnnotations(deps: {
  vault: Vault;
  annotations: AnnotationStore;
  complete: Complete;
  modelName: string;
  queue: QueueStore;
  log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
}): Promise<{ annotated: number; silent: number; ambiguous: number; failed: number }> {
  const cap = HORIZON_RUN_CAP;
  const ts = () => new Date().toISOString();
  const { snippets, readings } = deps.vault.rebuildIndex();
  const allSnippets = Object.values(snippets);

  // Find snippets that carry an intention-facet reading
  const intentionIds = new Set<string>();
  for (const r of Object.values(readings)) {
    if (r.facet === 'intention' && r.cites.length > 0) {
      for (const cite of r.cites) {
        intentionIds.add(citeSnippetId(cite));
      }
    }
  }

  const candidates = allSnippets
    .filter((s) => intentionIds.has(s.id))
    .sort((a, b) => b.captured.localeCompare(a.captured));

  let annotated = 0;
  let silent = 0;
  let ambiguous = 0;
  let failed = 0;

  for (const snippet of candidates.slice(0, cap)) {
    try {
      // Check for existing annotation — version-gated, re-ask on new
      // version. The ambiguous verdict (a dating question was minted) counts
      // as annotated: re-asking the same snippet every run is the bug the
      // stored verdict fixes.
      const existing = deps.annotations.get(snippet.id, 'intention-horizon')
        ?? deps.annotations.get(snippet.id, 'intention-horizon-ambiguous');
      if (existing && existing.version === snippet.version) {
        silent++;
        continue;
      }

      const result = await annotateIntentionHorizon(snippet, deps.modelName, deps.complete);

      if (result.kind === 'horizon') {
        deps.annotations.put({
          kind: 'intention-horizon',
          snippetId: result.snippetId,
          version: result.version,
          horizon: result.horizon,
          model: result.model,
          modelAt: result.modelAt,
        });
        annotated++;
      } else {
        // Ambiguous horizon — mint a dating question. The verdict is ALSO
        // stored (kind 'intention-horizon-ambiguous') so the version-gated
        // check above sees this snippet next run — without the record, the
        // same snippet is re-annotated and re-asked every docket run.
        deps.queue.add({
          source: 'composed',
          license: 'CC0',
          question: result.datingQuestion,
          questionForm: 'deliberative',
          cites: [`${result.snippetId}@${result.version}`],
          sharpness: 'weak',
          horizon: 'session',
        });
        deps.annotations.put({
          kind: 'intention-horizon-ambiguous',
          snippetId: result.snippetId,
          version: result.version,
          datingQuestion: result.datingQuestion,
          model: result.model,
          modelAt: result.modelAt,
        });
        ambiguous++;
        deps.log({
          at: ts(), actor: 'clerk', kind: 'intention-horizon-ambiguous',
          detail: `ambiguous=1 snippet=${result.snippetId}`,
          refs: [`${result.snippetId}@${result.version}`],
        });
      }
    } catch (err) {
      failed++;
      deps.log({ at: ts(), actor: 'clerk', kind: 'intention-horizon-failed', detail: String(err) });
    }
  }

  deps.log({
    at: ts(), actor: 'clerk', kind: 'intention-horizon-annotated',
    detail: `annotated=${annotated} silent=${silent} failed=${failed}`,
  });
  return { annotated, silent, ambiguous, failed };
}

// ── Outcome question job (ticket 106) ──
// Scans intention-horizon annotations for past-horizon intentions and mints
// outcome questions. Caps at 2 per run with a rotation cursor; ever-minted
// dedupe through the queue so an expired outcome never re-offers (dormancy is
// signal). The horizon-past check compares the annotation's modelAt to the
// horizon's expected elapsed time.

const OUTCOME_RUN_CAP = 2;

/** Milliseconds after which a horizon is considered past (annotation time → now). */
function isHorizonPast(horizon: 'now' | 'session' | 'days', modelAt: string): boolean {
  const annotated = Date.parse(modelAt);
  if (Number.isNaN(annotated)) return false;
  const elapsed = Date.now() - annotated;
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  switch (horizon) {
    case 'now': return elapsed > HOUR;       // the present moment has passed
    case 'session': return elapsed > DAY;    // the session is over
    case 'days': return elapsed > 7 * DAY;   // the coming days have passed
  }
}

export async function runOutcomeQuestions(deps: {
  annotations: AnnotationStore;
  queue: QueueStore;
  complete: Complete;
  vault: Vault;
  log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
  sittingOf?: (root: string, session: string) => SittingContext;
  vaultRoot: string;
  outcomeCursor?: { read: () => number; write: (offset: number) => void };
}): Promise<{ minted: number }> {
  const cap = OUTCOME_RUN_CAP;
  const ts = () => new Date().toISOString();

  const horizonRecords = deps.annotations.list('intention-horizon')
    .filter((r): r is AnnotationRecord & { kind: 'intention-horizon' } => r.kind === 'intention-horizon');

  if (horizonRecords.length === 0) return { minted: 0 };

  // Filter to past-horizon intentions
  const pastHorizons = horizonRecords.filter((r) => isHorizonPast(r.horizon, r.modelAt));
  if (pastHorizons.length === 0) return { minted: 0 };

  // Ever-minted dedupe: find every snippet already cited by an outcome question
  const allEntries = deps.queue.list();
  const outcomeCited = new Set<string>();
  for (const e of allEntries) {
    if (e.source === 'outcome') {
      for (const cite of e.cites ?? []) {
        outcomeCited.add(citeSnippetId(cite));
      }
    }
  }

  // Filter out already-minted
  const eligible = pastHorizons.filter((r) => !outcomeCited.has(r.snippetId));
  if (eligible.length === 0) return { minted: 0 };

  // Rotation cursor — like still-true, advance past every candidate offered.
  // The cursor is wrapped to mod on read, matching the outcome sweep's own
  // semantics (the raw value may exceed the eligible length); rotate() then
  // offers the cap candidates and advances past every one offered.
  const cursor = deps.outcomeCursor ?? { read: () => 0, write: () => {} };
  const candidates = rotate(
    {
      read: () => cursor.read() % Math.max(1, eligible.length),
      write: (o) => cursor.write(o),
    },
    eligible,
    cap,
  );

  const allSnippets = Object.values(deps.vault.rebuildIndex().snippets);
  const snippetMap = new Map(allSnippets.map((s) => [s.id, s]));
  const sittingFor = sittingCache(deps.vaultRoot, deps.sittingOf ?? readSitting);

  let minted = 0;
  for (const rec of candidates) {
    const snippet = snippetMap.get(rec.snippetId);
    if (!snippet) continue;
    try {
      const draft = await composeOutcomeQuestion(
        snippet, rec.horizon, deps.complete, sittingFor(snippet.provenance.session),
      );
      if (draft) {
        deps.queue.add(draft);
        minted++;
      }
    } catch (err) {
      deps.log({ at: ts(), actor: 'clerk', kind: 'outcome-failed', detail: String(err) });
    }
  }

  const heldBack = eligible.length - candidates.length;
  const logDetail = `${minted}`;
  deps.log({ at: ts(), actor: 'clerk', kind: 'outcome-minted', detail: logDetail });
  if (heldBack > 0) {
    deps.log({
      at: ts(), actor: 'clerk', kind: 'outcome-clipped',
      detail: `cap=${cap} eligible=${eligible.length} clipped=${heldBack}`,
    });
  }
  return { minted };
}

// ── The one-time template sweep (QR-6, ticket 114) ──
// One cleanup, ever: template-generation questions that have outlived their
// template — the half-Construct opposite mints (gap-fill with a snippet),
// the still-true repeats, and composed questions wearing therapy-voice
// assertion smuggling. Each expiry is logged to the Activity Log
// (Q-23), and the sweep never mints anything: an expired entry keeps its
// join keys on disk, and the gap-fill dedupe blocks on ANY status (Q-24,
// Q-41, Q-72), so a re-mint from the same license instances is impossible
// by construction. User-declared entries are never touched (Q-41: only a
// question the person typed in by hand is theirs). The flag file makes the
// whole thing run once, ever.

/** The flag that makes the sweep one-time. Lives in the vault root. */
const TEMPLATE_SWEEP_FLAG = '.template-sweep-done';

/** Therapy-register phrases — the mechanical voice check, kept deliberately short. */
const THERAPY_PHRASES = [
 'hold space',
 'truly welcome',
 'fully welcome',
 'tend to',
 'let yourself',
 'make space for',
 'show up for',
 'new path',
 'aliveness',
 'honor that',
 'sitting with',
] as const;

/**
 * Presupposition-heavy openings that smuggle an assertion into the ask —
 * "when you…", "how long will you let…". One alone is not enough; the
 * conservatism gate below demands a therapy phrase beside it.
 */
const ASSERTION_SMUGGLING_PREFIXES = ['when you', 'how long will you let'] as const;

/**
 * Conservative therapy-voice check: two distinct therapy phrases, or one
 * phrase PLUS a presupposition-smuggling opening. A bare "when you…"
 * question with no therapy register is a perfectly good composed question
 * and survives — the sweep only expires what CLEARLY matches (QR-6).
 */
function isTherapyVoiced(question: string): boolean {
 const q = question.toLowerCase();
 const hits = THERAPY_PHRASES.filter((p) => q.includes(p));
 if (hits.length >= 2) return true;
 return (
  hits.length === 1 &&
  ASSERTION_SMUGGLING_PREFIXES.some((p) => q.startsWith(p))
 );
}

/** What the one-time sweep expired, by category. */
export type TemplateSweepCounts = {
 expired: number;
 oppositeMints: number;
 stillTrueRepeats: number;
 therapyVoiced: number;
};

/**
 * QR-6: the one-time template sweep. Expires every pending template
 * question the templates no longer deserve to be asked from — opposite
 * mints, still-true repeats and therapy-voiced composed entries — logs
 * each to the Activity Log and returns the counts by category. Never
 * expires a user-declared entry and never mints. A no-op (and a zero
 * report) once the flag file exists.
 */
export async function runOneTimeTemplateSweep(deps: {
 queue: QueueStore;
 vaultRoot: string;
 log: (e: { at: string; actor: string; kind: string; detail: string; refs?: string[] }) => void;
}): Promise<TemplateSweepCounts> {
 const flag = join(deps.vaultRoot, TEMPLATE_SWEEP_FLAG);
 if (existsSync(flag)) {
  return { expired: 0, oppositeMints: 0, stillTrueRepeats: 0, therapyVoiced: 0 };
 }
 const counts: TemplateSweepCounts = { expired: 0, oppositeMints: 0, stillTrueRepeats: 0, therapyVoiced: 0 };
 const at = new Date().toISOString();
 for (const entry of deps.queue.list({ status: 'pending' })) {
  // The person's own questions are theirs, whatever the template said (Q-41).
  if (entry.source === 'user-declared' || entry.source === 'gap-declared') continue;
  let category: 'oppositeMints' | 'stillTrueRepeats' | 'therapyVoiced' | null = null;
  if (entry.source === 'gap-fill' && entry.snippet !== undefined) {
   category = 'oppositeMints';
  } else if (entry.source === 'still-true') {
   category = 'stillTrueRepeats';
  } else if (entry.source === 'composed' && isTherapyVoiced(entry.question)) {
   category = 'therapyVoiced';
  }
  if (category === null) continue;
  deps.queue.markExpired(entry.id);
  counts[category]++;
  counts.expired++;
  const excerpt =
   entry.question.length > 60 ? `${entry.question.slice(0, 60)}…` : entry.question;
  deps.log({
   at,
   actor: 'clerk',
   kind: 'template-sweep-expired',
   detail: `expired ${entry.source} ${entry.id}: ${excerpt}`,
   refs: [entry.id],
  });
 }
 // The flag lands only after the sweep succeeded, so a failed run retries.
 mkdirSync(deps.vaultRoot, { recursive: true });
 writeFileSync(flag, at, 'utf-8');
 return counts;
}

// ── Rotation cursor (ticket 075, ticket 106) ──
// The still-true job (docket.ts) and the outcome sweep (above) both pick
// `cap` candidates starting at a cursor offset, wrapping modulo the
// eligible list, then advance the cursor past every candidate OFFERED —
// whether the caller minted a draft, got null back, or the compose threw.
// The advance-on-null is the whole fix for the still-true wedge: the same
// two snippets were offered forever when the composer refused them. The
// modulo keeps the index inside a non-empty array, so the `!` is the
// narrowing noUncheckedIndexedAccess cannot see.
export function rotate<T>(
 cursor: { read: () => number; write: (offset: number) => void },
 eligible: T[],
 cap: number,
): T[] {
 const offset = cursor.read();
 const n = Math.min(cap, eligible.length);
 const candidates = Array.from(
  { length: n },
  (_, i) => eligible[(offset + i) % eligible.length]!,
 );
 if (n > 0) {
  cursor.write(offset + n);
 }
 return candidates;
}
