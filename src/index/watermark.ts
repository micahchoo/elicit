/**
 * The docket's two gates (ticket 076): what changed since the docket last
 * looked, and whether the index has seen the state it is asked to index.
 *
 * Mechanism 1 — the git-diff gate. Q-61 made the vault a git repository and
 * decided the docket commits it, one commit per run, authored as
 * `elicit-clerk <clerk@localhost>`. The diff between that commit and the
 * working tree is a free, exact answer to "which files changed since the
 * docket last looked" — committed or not, hand edit or app write. The wiki
 * jobs that are driven by the QUEUE (presweep-confirmation, remeasure,
 * confirmation) and the sweep gate on it: a job whose inputs show no diff
 * since the last docket commit is skipped and logs `wiki-job-skipped`, which
 * is a different outcome from ran-and-found-nothing (the 034 rule).
 *
 * Mechanism 2 — the index watermark. The graph-derived passes (prime, lint,
 * candidates) rebuild from the whole graph each run. A watermark file records
 * the fingerprint of the vault state the index last completed against; a run
 * whose current fingerprint matches it knows the index is current and skips
 * the passes, one whose fingerprint differs processes only the delta, and a
 * missing or unreadable watermark — the repair path — forces the clean full
 * rebuild that is today's behavior. Ticket 067's caution is law here: the
 * delta narrows the WORK LIST (which claims to embed), never the graph handed
 * to `persist` or `prime`.
 *
 * The watermark lives in `vault/index/`, which Q-61 already gitignores as
 * derived and rebuildable (Q-3). It is written by the wiki layer after the
 * index passes complete, so deleting it is the documented way to force a full
 * rebuild.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Claim, ClaimGraph, ClashCandidate } from '../wiki/contract.js';

// ---------------------------------------------------------------------------
// Mechanism 1 — the git-diff gate
// ---------------------------------------------------------------------------

/**
 * The author Q-61 assigns to the docket's own commits. A hand edit and an app
 * write become distinguishable in `git log` without inspecting content; the
 * gate uses the same marker to find "the last time the docket looked".
 */
const CLERK_AUTHOR = 'elicit-clerk <clerk@localhost>';

/**
 * What changed in the vault since the last docket commit, or why that question
 * has no answer.
 *
 * `available: false` is not an error and not a skip: it means the gate has no
 * signal, and every job runs exactly as it did before this module existed.
 * `reason` names the gap for the log line so a vault that is not (yet) a repo
 * is distinguishable from one whose repo has no docket commit.
 */
export type VaultDiff = {
 available: boolean;
 /** The last docket commit hash, when one exists. */
 since: string | null;
 /** Repository-relative paths changed since `since`, working tree included. */
 changed: Set<string>;
 /** Why the gate is unavailable: `not-a-git-repo` or `no-clerk-commit`. */
 reason?: string;
};

/**
 * Whether any changed path falls under one of a job's input prefixes.
 *
 * `wiki/readings/01X.md` starts with `wiki/readings/`; `log/2026-08-02.jsonl`
 * starts with no job's prefix. The docket's own bookkeeping (the activity
 * log, the sweep ledger, the still-true cursor, the sweep deferral) maps to
 * no input class on purpose: a run that wrote only its own records must not
 * gate itself back into work on the next run.
 */
export function changedIn(diff: VaultDiff, prefixes: readonly string[]): boolean {
 for (const path of diff.changed) {
  for (const prefix of prefixes) {
   if (path.startsWith(prefix)) return true;
  }
 }
 return false;
}

/**
 * Read the git-diff gate. Bounded subprocess calls; the vault repo is a
 * handful of commits, so this is milliseconds.
 *
 * Two lists are unioned, and both matter:
 *
 *   1. `git diff --name-only <commit>` — every TRACKED file whose content
 *      differs from the last docket commit, staged or not, committed by any
 *      author or not.
 *   2. `git ls-files --others --exclude-standard` — every UNTRACKED file.
 *      The docket's commit-per-run hook commits at the END of a run, so the
 *      app's own writes — a freshly harvested snippet, a new reading, a new
 *      queue entry — are untracked until the next commit, and a gate that
 *      missed them would skip exactly the work it exists to schedule.
 *      `--exclude-standard` keeps the vault's .gitignore (Q-61: `/index/`,
 *      the embedding cache, `.auth.json`) out of the answer.
 */
export function vaultDiff(root: string): VaultDiff {
 try {
  execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], {
   stdio: ['ignore', 'ignore', 'ignore'],
  });
 } catch {
  return { available: false, since: null, changed: new Set(), reason: 'not-a-git-repo' };
 }

 let since: string;
 try {
  since = execFileSync('git', ['-C', root, 'log', '-1', '--format=%H', `--author=${CLERK_AUTHOR}`], {
   encoding: 'utf8',
   stdio: ['ignore', 'pipe', 'ignore'],
   maxBuffer: 1 << 20,
  }).trim();
 } catch {
  return { available: false, since: null, changed: new Set(), reason: 'no-clerk-commit' };
 }
 if (since === '') {
  return { available: false, since: null, changed: new Set(), reason: 'no-clerk-commit' };
 }

 const changed = new Set<string>();
 try {
  const tracked = execFileSync('git', ['-C', root, 'diff', '--name-only', '-z', since], {
   encoding: 'utf8',
   stdio: ['ignore', 'pipe', 'ignore'],
   maxBuffer: 8 << 20,
  });
  for (const path of tracked.split('\0')) {
   if (path !== '') changed.add(path);
  }
  const untracked = execFileSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', '-z'], {
   encoding: 'utf8',
   stdio: ['ignore', 'pipe', 'ignore'],
   maxBuffer: 8 << 20,
  });
  for (const path of untracked.split('\0')) {
   if (path !== '') changed.add(path);
  }
 } catch {
  return { available: false, since: null, changed: new Set(), reason: 'diff-failed' };
 }

 return { available: true, since, changed };
}

// ---------------------------------------------------------------------------
// Mechanism 2 — the index watermark
// ---------------------------------------------------------------------------

/**
 * Bump on any change to the fingerprint's shape. A watermark written by an
 * older schema is an inconsistency, and the repair path — full rebuild — is
 * the correct response to one.
 */
export const WATERMARK_SCHEMA = 1;

/** `vault/index/watermark.json` — derived, gitignored (Q-61, Q-3). */
function watermarkPath(root: string): string {
 return join(root, 'index', 'watermark.json');
}

/**
 * The fingerprint of the vault state the index passes saw, and the currency
 * the next run compares against.
 *
 * Every map keys by id; the value is a content hash of everything about the
 * artifact that the index passes read. High-noise fields are deliberately
 * excluded: a claim's `readLog` appends on every wiki read and must not
 * invalidate the index, and timestamps and model stamps carry no index
 * meaning of their own — their consequences (a status change, a supersede)
 * are themselves hashed.
 */
export type IndexFingerprint = {
 schema: typeof WATERMARK_SCHEMA;
 /** When the watermark was written. Carried for the log line, never compared. */
 at: string;
 snippets: Record<string, string>;
 readings: Record<string, string>;
 claims: Record<string, string>;
 referents: Record<string, string>;
 contradictions: Record<string, string>;
 /** Candidates shape the pool's anti-repetition filter (T11), so they count. */
 candidates: Record<string, string>;
};

/** A stable, truncated hash of any JSON-serialisable value. */
function h(value: unknown): string {
 return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

/**
 * What the index passes read about a claim. `readLog` excluded (see the type
 * note); `model`/`modelAt`/`created`/`updated` excluded as stamps, with their
 * effects — `status`, `supersededBy`, `archived`, `cites`, `range`, `body`,
 * `referents` — included.
 */
function claimHash(c: Claim): string {
 return h({
  body: c.body,
  range: c.range,
  status: c.status,
  cites: c.cites,
  facet: c.facet,
  referents: c.referents,
  fromReadings: c.fromReadings,
  attested: c.attested,
  ...(c.supersededBy !== undefined ? { supersededBy: c.supersededBy } : {}),
  ...(c.supersededBy !== undefined ? { supersedeReason: c.supersedeReason } : {}),
  ...(c.archived !== undefined ? { archived: c.archived } : {}),
  ...(c.archived !== undefined ? { archiveReason: c.archiveReason } : {}),
 });
}

/**
 * The fingerprint of a graph as the index passes see it, plus the candidate
 * records that shape the pool's anti-repetition filter (T11). Deterministic:
 * the same state yields the same fingerprint, whatever the read order.
 */
export function fingerprintOf(graph: ClaimGraph, candidates: readonly ClashCandidate[] = []): IndexFingerprint {
 const snippets: Record<string, string> = {};
 for (const [id, s] of Object.entries(graph.snippets)) snippets[id] = h(s);
 const readings: Record<string, string> = {};
 for (const [id, r] of Object.entries(graph.readings)) readings[id] = h(r);
 const claims: Record<string, string> = {};
 for (const c of graph.claims) claims[c.id] = claimHash(c);
 const referents: Record<string, string> = {};
 for (const r of graph.referents) {
  referents[r.slug] = h({
   slug: r.slug,
   canonical: r.canonical,
   kind: r.kind,
   aliases: r.aliases,
   ...(r.note !== undefined ? { note: r.note } : {}),
  });
 }
 const contradictions: Record<string, string> = {};
 for (const c of graph.contradictions) {
  contradictions[c.id] = h({
   type: c.type,
   claims: c.claims,
   candidate: c.candidate,
   remeasureQueueId: c.remeasureQueueId,
   evidence: c.evidence,
   status: c.status,
   ...(c.dissolveReason !== undefined ? { dissolveReason: c.dissolveReason } : {}),
   body: c.body,
  });
 }
 const candidateHashes: Record<string, string> = {};
 for (const c of candidates) {
  candidateHashes[c.id] = h({
   pair: c.pair,
   channel: c.channel,
   status: c.status,
   ...(c.outcome !== undefined ? { outcome: c.outcome } : {}),
   ...(c.remeasureQueueId !== undefined ? { remeasureQueueId: c.remeasureQueueId } : {}),
   ...(c.remeasureAskedAt !== undefined ? { remeasureAskedAt: c.remeasureAskedAt } : {}),
   attempts: c.attempts,
  });
 }
 return {
  schema: WATERMARK_SCHEMA,
  at: new Date().toISOString(),
  snippets,
  readings,
  claims,
  referents,
  contradictions,
  candidates: candidateHashes,
 };
}

/**
 * Whether a watermark describes the same state as a current fingerprint.
 * `at` is a timestamp and never part of the comparison.
 */
export function sameFingerprint(a: IndexFingerprint, b: IndexFingerprint): boolean {
 if (a.schema !== b.schema) return false;
 return (
  sameMap(a.snippets, b.snippets) &&
  sameMap(a.readings, b.readings) &&
  sameMap(a.claims, b.claims) &&
  sameMap(a.referents, b.referents) &&
  sameMap(a.contradictions, b.contradictions) &&
  sameMap(a.candidates, b.candidates)
 );
}

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
 const ak = Object.keys(a);
 const bk = Object.keys(b);
 if (ak.length !== bk.length) return false;
 for (const key of ak) if (a[key] !== b[key]) return false;
 return true;
}

/** The watermark on disk, or null when it is absent or unreadable — the repair trigger. */
export function readWatermark(root: string): IndexFingerprint | null {
 try {
  const parsed: unknown = JSON.parse(readFileSync(watermarkPath(root), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return null;
  const w = parsed as Partial<IndexFingerprint>;
  if (w.schema !== WATERMARK_SCHEMA) return null;
  if (
   typeof w.at !== 'string' ||
   typeof w.snippets !== 'object' || w.snippets === null ||
   typeof w.readings !== 'object' || w.readings === null ||
   typeof w.claims !== 'object' || w.claims === null ||
   typeof w.referents !== 'object' || w.referents === null ||
   typeof w.contradictions !== 'object' || w.contradictions === null ||
   typeof w.candidates !== 'object' || w.candidates === null
  ) {
   return null;
  }
  return {
   schema: WATERMARK_SCHEMA,
   at: w.at,
   snippets: w.snippets as Record<string, string>,
   readings: w.readings as Record<string, string>,
   claims: w.claims as Record<string, string>,
   referents: w.referents as Record<string, string>,
   contradictions: w.contradictions as Record<string, string>,
   candidates: w.candidates as Record<string, string>,
  };
 } catch {
  return null;
 }
}

/** Write the watermark. The `index/` directory is derived, so this never enters the diff. */
export function writeWatermark(root: string, fp: IndexFingerprint): void {
 const path = watermarkPath(root);
 mkdirSync(join(root, 'index'), { recursive: true });
 writeFileSync(path, `${JSON.stringify(fp)}\n`, 'utf8');
}

/**
 * The embedding work list: the claims whose body the index has not seen.
 *
 * Ticket 076's narrowing, and the whole of ticket 067's caution applied: this
 * filters WHICH claims get embedded, and the graph handed to `prime` stays
 * whole, because the channel prunes its cache to the live claims of the graph
 * it is given. A claim absent from the watermark — minted after it was
 * written — is work; a claim whose hash is unchanged is not.
 */
export function claimDelta(w: IndexFingerprint, claims: readonly Claim[]): Set<string> {
 const out = new Set<string>();
 for (const c of claims) {
  if (w.claims[c.id] !== claimHash(c)) out.add(c.id);
 }
 return out;
}
