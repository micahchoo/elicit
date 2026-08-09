// The Clerk's markdown persistence: claims, contradictions, candidates, the
// registry, and the sweep ledger.
//
// Q-3 is the whole design. These files ARE the wiki; every index, cache and
// report is derived from them and rebuildable by re-reading them. Deleting
// `vault/wiki/` costs a re-sweep, never data — so nothing in this module keeps
// state between calls, and every read goes to disk.
//
// Three rules run through all of it:
//
//   - **Validate before write.** `writeClaim` is the last thing between a bad
//     claim and the disk, and the one layer with no model anywhere near it.
//     T9's op validator checks the same invariants earlier; this checks them
//     again because belt-and-braces at a storage boundary is cheap and a claim
//     with no Range is unrecoverable once written (Q-21).
//   - **No method deletes a file.** ARCHIVE sets frontmatter and the file stays
//   - **No method deletes a claim/contradiction/candidate file.** ARCHIVE sets
//     frontmatter and the file stays as evidence (Q-29). The resume marker
//     (ticket 139) is the one exception — it is docket bookkeeping, not wiki
//     content, and `clearResumeMarker` removes it.
//     is the contract.
//   - **Malformed in, skipped out — never repaired.** A hand-edited or
//     half-written file is dropped from the load with a warning and left on
//     disk byte for byte (the Activity Log precedent). One bad file must not
//     take down a docket run, and a store that "fixes" a file is a store that
//     can silently invent a Range.
//
// Optional fields are written with conditional spreads and never as a present
// key holding `undefined`: `matter.stringify` throws on that and the whole
// write is lost. Absent also MEANS something here — a candidate with no
// `remeasureAskedAt` has not been asked yet, which `remeasureAskedAt: null`
// would not say.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { appendLine, jsonCursorFile, readJsonl } from '../jsonl.js';
import type { Facet } from '../types.js';
import type {
  Claim,
  ClaimStatus,
  ClaimStore,
  ClashCandidate,
  ClashChannelName,
  ClashEvidence,
  ClashOutcome,
  Contradiction,
  ReadLogEntry,
  Referent,
  SweepLine,
  WikiSlice,
} from './contract.js';
import { asStringArray, filled } from './ops.js';

export function createClaimStore(root: string): ClaimStore {
  return new ClaimStoreImpl(root);
}

const CLAIMS = 'claims';
const CONTRADICTIONS = 'contradictions';
const CANDIDATES = 'candidates';
const REGISTRY = 'registry';
const SWEEP_LOG = 'sweep-log.jsonl';
const SWEEP_DEFERRAL = 'sweep-deferral.jsonl';
const STILL_TRUE_CURSOR = 'still-true-cursor.json';

// ── Reading frontmatter ──
//
// These helpers answer one question: can this file yield a valid value of the
// type? A required field that is missing or of the wrong type cannot be
// defaulted honestly — a fabricated `model` is a false Q-34 stamp, and a
// required key holding `undefined` propagates into the NEXT write, where
// `matter.stringify` throws and the file is lost. So required scalars are
// strict, and the three container fields fall back to empty, which is what an
// absent key already means.
//
// What these do NOT check is membership in the domain's unions (Facet, status,
// channel, outcome, kind). A second copy of a union in the storage layer drifts
// from the one in `contract.ts`, and every writer of these files is code, not a
// model — T9 validates the vocabulary where the model output actually arrives.

/** Exactly two ids. `Contradiction.claims` and `ClashCandidate.pair` are tuples because "between A and B" is the definition. */
function pair(v: unknown): [string, string] | null {
  const items = asStringArray(v);
  if (!items || items.length !== 2) return null;
  return [items[0]!, items[1]!];
}

function readLog(v: unknown): ReadLogEntry[] {
  if (!Array.isArray(v)) return [];
  const entries: ReadLogEntry[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const e = raw as Record<string, unknown>;
    const at = filled(e.at);
    const surface = filled(e.surface);
    // Q-21's flag is only usable if the entry is dated: an undated read cannot
    // be compared against a snippet's capture time, so it carries no evidence.
    if (at && surface) entries.push({ at, surface });
  }
  return entries;
}

function evidence(v: unknown): ClashEvidence | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  const snippetRef = filled(e.snippetRef);
  const quote = filled(e.quote);
  const side = filled(e.side);
  if (!snippetRef || !quote || !side) return null;
  return { snippetRef, quote, side: side as ClashEvidence['side'] };
}

/**
 * A file name this store may write, or null.
 *
 * Ids reach `writeClaim` from op payloads, and an op payload started life as
 * model output. `../../etc/passwd` as a claim id would write outside the four
 * directories this store owns — which is the one boundary the ownership rule
 * cannot restate as a comment.
 */
function safeName(v: string): string | null {
  if (v.trim() === '') return null;
  if (v.includes('/') || v.includes('\\') || v.includes('\0') || v === '.' || v === '..') {
    return null;
  }
  return v;
}

function warnSkip(path: string, why: string): void {
  console.warn(`ClaimStore: skipping malformed file ${path} — ${why}`);
}

/**
 * The validate-and-skip skeleton every frontmatter reader shares: every
 * required scalar must be a non-empty string (`filled`), and a file that
 * fails one is dropped with the standard warning. Returns the validated,
 * already-trimmed scalars by key, or null. What each type requires BEYOND
 * these — its tuples, evidence, cites and defaults — stays in the tail
 * each reader keeps after this returns.
 */
function requireScalars<K extends string>(
  d: Record<string, unknown>,
  path: string,
  keys: readonly K[],
): { [P in K]: string } | null {
  const out = {} as { [P in K]: string };
  for (const key of keys) {
    const value = filled(d[key]);
    if (!value) {
      warnSkip(path, 'a required field is missing');
      return null;
    }
    out[key] = value;
  }
  return out;
}

/** A sweep-log line, or null — the ledger's own grammar, where `readJsonl` is only the skip mechanic. */
function sweepLineOf(value: unknown): SweepLine | null {
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  const readingId = filled(rec.readingId);
  const op = filled(rec.op);
  if (!readingId || !op) return null;
  return value as SweepLine;
}

/** A deferral line, or null. */
function deferralOf(value: unknown): { at: string; remaining: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  const at = filled(rec.at);
  const remaining = rec.remaining;
  if (!at || typeof remaining !== 'number') return null;
  return { at, remaining };
}

/** A cursor file's offset, or null — the parse both offset cursors share. */
function cursorOffset(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const offset = (value as Record<string, unknown>).offset;
  return typeof offset === 'number' ? offset : null;
}

/** A resume marker, or null when the file does not hold one. */
function resumeMarkerOf(value: unknown): ResumeMarker | null {
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.at !== 'string' || typeof rec.pendingReadings !== 'number') return null;
  return { at: rec.at, pendingReadings: rec.pendingReadings };
}

/**
 * The claim's frontmatter fields, in write order — the ONE enumeration both
 * directions share (the queue store's OPTIONAL_ENTRY_FIELDS pattern): a field
 * added here is written by `writeClaim` and read back by `#toClaim`; a field
 * left out vanishes from both. `body` is the file's content, not frontmatter,
 * and never appears.
 */
const CLAIM_FIELDS = [
  'id',
  'range',
  'status',
  'cites',
  'facet',
  'referents',
  'fromReadings',
  'attested',
  'readLog',
  'model',
  'modelAt',
  'created',
  'updated',
  'supersededBy',
  'supersedeReason',
  'archived',
  'archiveReason',
  'fusion',
] as const satisfies readonly (keyof Claim)[];

/**
 * The optional frontmatter tail, read back through the same CLAIM_FIELDS the
 * writer iterates. Each optional key's rule is the reader's own lenient one —
 * a hand-edited `archived: false` must not manufacture an `archived` key, and
 * an empty fusion list reads back absent.
 */
function optionalClaimTail(d: Record<string, unknown>): Partial<Claim> {
  const out: Partial<Claim> = {};
  for (const key of CLAIM_FIELDS) {
    switch (key) {
      case 'supersededBy':
        if (filled(d.supersededBy)) out.supersededBy = d.supersededBy as string;
        break;
      case 'supersedeReason':
        if (filled(d.supersedeReason)) out.supersedeReason = d.supersedeReason as string;
        break;
      case 'archived':
        if (d.archived === true) out.archived = true;
        break;
      case 'archiveReason':
        if (filled(d.archiveReason)) out.archiveReason = d.archiveReason as string;
        break;
      case 'fusion':
        if (asStringArray(d.fusion)) out.fusion = d.fusion as string[];
        break;
      default:
        break;
    }
  }
  return out;
}

class ClaimStoreImpl implements ClaimStore {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #dir(name: string): string {
    const d = join(this.#root, 'wiki', name);
    mkdirSync(d, { recursive: true });
    return d;
  }

  /** Sorted, so `loadSlice` is deterministic given the same files — `readdirSync` order is not. */
  #files(name: string): string[] {
    const dir = join(this.#root, 'wiki', name);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  }

  #parse(dir: string, file: string): Record<string, unknown> | null {
    try {
      const parsed = matter.read(join(dir, file));
      // `__content` last: the body is what the file says below the fence, and a
      // frontmatter key of the same name must not be able to replace it.
      return { ...(parsed.data as Record<string, unknown>), __content: parsed.content.trimEnd() };
    } catch (err) {
      warnSkip(join(dir, file), String(err));
      return null;
    }
  }

  // ── Claims ──

  writeClaim(c: Claim): void {
    // Q-21 and Q-29, checked here because this is the last layer before disk.
    const name = safeName(c.id);
    if (!name) throw new Error(`Claim id is empty or not a file name: "${c.id}"`);
    if (c.range.trim() === '') {
      throw new Error(`Claim ${c.id} has an empty range — a claim without a Range is malformed (Q-21)`);
    }
    if (c.cites.length === 0) {
      throw new Error(`Claim ${c.id} has no cites — a claim with no evidence is an opinion (Q-21)`);
    }
    if (c.archived === true && !c.archiveReason?.trim()) {
      throw new Error(`Claim ${c.id} is archived without an archiveReason (Q-29)`);
    }
    if (c.supersededBy !== undefined && !c.supersedeReason?.trim()) {
      throw new Error(`Claim ${c.id} is superseded without a supersedeReason (Q-29)`);
    }

    // The frontmatter is ONE pass over CLAIM_FIELDS: presence decides what is
    // written, fusion carries its own rule (an empty list writes no key), and
    // the iteration order is CLAIM_FIELDS order — so the YAML stays byte-for-byte
    // what the spelled-out literal produced.
    const fm: Record<string, unknown> = {};
    for (const key of CLAIM_FIELDS) {
      const v = c[key];
      if (key === 'fusion') {
        if (v !== undefined && (v as string[]).length > 0) fm[key] = v;
      } else if (v !== undefined) {
        fm[key] = v;
      }
    }
    writeFileSync(join(this.#dir(CLAIMS), `${name}.md`), matter.stringify(c.body, fm), 'utf-8');
  }

  readClaim(id: string): Claim | null {
    const name = safeName(id);
    if (!name) return null;
    const dir = join(this.#root, 'wiki', CLAIMS);
    if (!existsSync(join(dir, `${name}.md`))) return null;
    const data = this.#parse(dir, `${name}.md`);
    return data ? this.#toClaim(data, join(dir, `${name}.md`)) : null;
  }

  #toClaim(d: Record<string, unknown>, path: string): Claim | null {
    const s = requireScalars(d, path, ['id', 'range', 'facet', 'status', 'model', 'modelAt', 'created', 'updated']);
    if (!s) return null;
    const cites = asStringArray(d.cites);
    if (!cites || cites.length === 0) {
      warnSkip(path, 'cites is missing or empty (Q-21)');
      return null;
    }
    return {
      id: s.id,
      body: typeof d.__content === 'string' ? d.__content : '',
      range: s.range,
      status: s.status as ClaimStatus,
      cites,
      facet: s.facet as Facet,
      referents: asStringArray(d.referents) ?? [],
      fromReadings: asStringArray(d.fromReadings) ?? [],
      attested: d.attested === true,
      readLog: readLog(d.readLog),
      model: s.model,
      modelAt: s.modelAt,
      created: s.created,
      updated: s.updated,
      // The optional tail — read back through the same CLAIM_FIELDS the writer
      // iterates, with the reader's own lenient rules (a hand-edited
      // `archived: false` must not manufacture an `archived` key).
      ...optionalClaimTail(d),
    };
  }

  #listClaims(): Claim[] {
    const dir = join(this.#root, 'wiki', CLAIMS);
    const claims: Claim[] = [];
    for (const file of this.#files(CLAIMS)) {
      const data = this.#parse(dir, file);
      if (!data) continue;
      const claim = this.#toClaim(data, join(dir, file));
      if (claim) claims.push(claim);
    }
    return claims;
  }

  /**
   * Claims, contradictions and referents — and NOT snippets or readings, which
   * live in the Vault and arrive through `vault.rebuildIndex()`. T12 joins the
   * two into a `ClaimGraph`. Candidates are absent by the same honesty: they are
   * Clerk-internal working state, not part of the graph the pure modules read,
   * and they come through `listCandidates()`.
   */
  loadSlice(): WikiSlice {
    return {
      claims: this.#listClaims(),
      contradictions: this.listContradictions(),
      referents: this.listReferents(),
    };
  }

  // ── Contradictions ──

  writeContradiction(c: Contradiction): void {
    const name = safeName(c.id);
    if (!name) throw new Error(`Contradiction id is empty or not a file name: "${c.id}"`);
    const fm = {
      id: c.id,
      type: c.type,
      claims: c.claims,
      candidate: c.candidate,
      remeasureQueueId: c.remeasureQueueId,
      evidence: c.evidence,
      status: c.status,
      ...(c.dissolveReason !== undefined ? { dissolveReason: c.dissolveReason } : {}),
      model: c.model,
      modelAt: c.modelAt,
      opened: c.opened,
      updated: c.updated,
    };
    writeFileSync(
      join(this.#dir(CONTRADICTIONS), `${name}.md`),
      matter.stringify(c.body, fm),
      'utf-8'
    );
  }

  listContradictions(): Contradiction[] {
    const dir = join(this.#root, 'wiki', CONTRADICTIONS);
    const out: Contradiction[] = [];
    for (const file of this.#files(CONTRADICTIONS)) {
      const d = this.#parse(dir, file);
      if (!d) continue;
      const path = join(dir, file);
      const s = requireScalars(d, path, ['id', 'type', 'candidate', 'remeasureQueueId', 'status', 'model', 'modelAt', 'opened', 'updated']);
      if (!s) continue;
      const claims = pair(d.claims);
      const ev = evidence(d.evidence);
      // The tuple narrowing is where a hand-edited file most plausibly goes
      // wrong, and a one-sided Contradiction is not a Contradiction.
      if (!claims) {
        warnSkip(path, 'claims is not a pair of ids');
        continue;
      }
      if (!ev) {
        warnSkip(path, 'evidence is missing its snippetRef, quote or side (Q-46)');
        continue;
      }
      out.push({
        id: s.id,
        type: s.type as Contradiction['type'],
        claims,
        candidate: s.candidate,
        remeasureQueueId: s.remeasureQueueId,
        evidence: ev,
        status: s.status as Contradiction['status'],
        ...(filled(d.dissolveReason) ? { dissolveReason: d.dissolveReason as string } : {}),
        model: s.model,
        modelAt: s.modelAt,
        opened: s.opened,
        updated: s.updated,
        body: typeof d.__content === 'string' ? d.__content : '',
      });
    }
    return out;
  }

  // ── Clash candidates ──

  writeCandidate(c: ClashCandidate): void {
    const name = safeName(c.id);
    if (!name) throw new Error(`ClashCandidate id is empty or not a file name: "${c.id}"`);
    const fm = {
      id: c.id,
      pair: c.pair,
      channel: c.channel,
      status: c.status,
      ...(c.outcome !== undefined ? { outcome: c.outcome } : {}),
      ...(c.remeasureQueueId !== undefined ? { remeasureQueueId: c.remeasureQueueId } : {}),
      ...(c.remeasureAskedAt !== undefined ? { remeasureAskedAt: c.remeasureAskedAt } : {}),
      // UNCONDITIONAL, unlike the three above. `attempts` is required on the
      // type, and omitting it here is not a smaller file — it is Q-53's cap
      // silently not existing: `listCandidates` defaults an absent key to 1,
      // so a candidate written with `attempts: 2` reads back as 1 and an
      // expired pair re-proposes forever. Found by T11, 2026-08-02.
      attempts: c.attempts,
      ...(c.joinsTwoSittings !== undefined ? { joinsTwoSittings: c.joinsTwoSittings } : {}),
      model: c.model,
      modelAt: c.modelAt,
      created: c.created,
    };
    // No body: a candidate is a suspicion, never rendered and never read by a
    // person (Q-30 stage 1). There is nothing to say in prose.
    writeFileSync(join(this.#dir(CANDIDATES), `${name}.md`), matter.stringify('', fm), 'utf-8');
  }

  listCandidates(): ClashCandidate[] {
    const dir = join(this.#root, 'wiki', CANDIDATES);
    const out: ClashCandidate[] = [];
    for (const file of this.#files(CANDIDATES)) {
      const d = this.#parse(dir, file);
      if (!d) continue;
      const path = join(dir, file);
      const s = requireScalars(d, path, ['id', 'channel', 'status', 'model', 'modelAt', 'created']);
      if (!s) continue;
      const claimPair = pair(d.pair);
      if (!claimPair) {
        warnSkip(path, 'pair is not a pair of claim ids');
        continue;
      }
      out.push({
        id: s.id,
        pair: claimPair,
        channel: s.channel as ClashChannelName,
        status: s.status as ClashCandidate['status'],
        ...(filled(d.outcome) ? { outcome: d.outcome as ClashOutcome } : {}),
        ...(filled(d.remeasureQueueId) ? { remeasureQueueId: d.remeasureQueueId as string } : {}),
        ...(filled(d.remeasureAskedAt) ? { remeasureAskedAt: d.remeasureAskedAt as string } : {}),
        // Defaulted rather than required, unlike every other scalar here: a
        // candidate file written before Q-53 has had exactly one re-measure,
        // so 1 is what an absent key already means. Nothing is fabricated.
        attempts: typeof d.attempts === 'number' && d.attempts > 0 ? d.attempts : 1,
        ...(typeof d.joinsTwoSittings === 'boolean' ? { joinsTwoSittings: d.joinsTwoSittings as boolean } : {}),
        model: s.model,
        modelAt: s.modelAt,
        created: s.created,
      });
    }
    return out;
  }

  // ── Registry ──

  writeReferent(r: Referent): void {
    const name = safeName(r.slug);
    if (!name) throw new Error(`Referent slug is empty or not a file name: "${r.slug}"`);
    const fm = {
      slug: r.slug,
      canonical: r.canonical,
      kind: r.kind,
      aliases: r.aliases,
      model: r.model,
      modelAt: r.modelAt,
      created: r.created,
      updated: r.updated,
    };
    // The note is the file body, like every other agent prose in the vault.
    writeFileSync(
      join(this.#dir(REGISTRY), `${name}.md`),
      matter.stringify(r.note ?? '', fm),
      'utf-8'
    );
  }

  listReferents(): Referent[] {
    const dir = join(this.#root, 'wiki', REGISTRY);
    const out: Referent[] = [];
    for (const file of this.#files(REGISTRY)) {
      const d = this.#parse(dir, file);
      if (!d) continue;
      const path = join(dir, file);
      const s = requireScalars(d, path, ['slug', 'canonical', 'kind', 'model', 'modelAt', 'created', 'updated']);
      if (!s) continue;
      const note = typeof d.__content === 'string' ? d.__content.trim() : '';
      out.push({
        slug: s.slug,
        canonical: s.canonical,
        kind: s.kind as Referent['kind'],
        aliases: asStringArray(d.aliases) ?? [],
        model: s.model,
        modelAt: s.modelAt,
        created: s.created,
        updated: s.updated,
        ...(note !== '' ? { note } : {}),
      });
    }
    return out;
  }

  // ── The sweep ledger ──

  appendSweep(e: SweepLine): void {
    appendLine(this.#root, join('wiki', SWEEP_LOG), JSON.stringify(e));
  }

  /**
   * Every ledger line, oldest first. A missing file is no lines, never an
   * error: the ledger is derived and a deleted one costs a re-sweep (Q-3).
   * A corrupt line is skipped, on the Activity Log's precedent — a half-written
   * final line must not hide the hundred good ones above it.
   */
  #sweepLines(): SweepLine[] {
    return readJsonl(this.#root, join('wiki', SWEEP_LOG), sweepLineOf);
  }

  /**
   * Readings with a TERMINAL line: any of the six ops, or OVERSIZED.
   *
   * REJECTED is deliberately excluded. Q-29 keeps a rejected reading
   * unprocessed for the next run, so counting it as swept would silently drop
   * material the model failed on once — the exact failure mode KEEP exists to
   * make visible.
   */
  sweptReadingIds(): Set<string> {
    const ids = new Set<string>();
    for (const line of this.#sweepLines()) {
      if (line.op !== 'REJECTED') ids.add(line.readingId);
    }
    return ids;
  }

  /** The re-sweepable subset: skipped for budget, so a budget change undoes the skip. */
  oversizedReadingIds(): Set<string> {
    const ids = new Set<string>();
    for (const line of this.#sweepLines()) {
      if (line.op === 'OVERSIZED') ids.add(line.readingId);
    }
    return ids;
  }

  /** REJECTED lines per reading — the back-off rule's input. */
  attemptCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const line of this.#sweepLines()) {
      if (line.op !== 'REJECTED') continue;
      counts.set(line.readingId, (counts.get(line.readingId) ?? 0) + 1);
    }
    return counts;
  }

  // ── The read-log (Q-21) ──

  /**
   * Append one read to a claim's read-log.
   *
   * Read-modify-write on one file, and SYNCHRONOUS on purpose. The plan asked
   * for an in-process promise chain; a promise chain cannot serialize anything
   * behind a `void` return — the caller cannot await it, so the write would
   * land after the caller's next read and a test could not see it at all. The
   * synchronous `readFileSync`/`writeFileSync` pair holds the event loop for
   * its whole duration, so no docket write can interleave with it. That is the
   * stronger guarantee, and it is the one the interface's return type allows.
   *
   * It goes through `readClaim`/`writeClaim`, so a claim that has gone
   * malformed on disk is never silently rewritten from a partial parse, and the
   * validations run again on the way out.
   */
  recordRead(claimId: string, at: string, surface: string): void {
    const claim = this.readClaim(claimId);
    // Losing a read would flatten Q-21's looping-effect flag, and the caller
    // has just rendered this claim to a person — a missing file is a bug in the
    // surface, not a condition to swallow.
    if (!claim) throw new Error(`Cannot record a read: claim ${claimId} is missing or malformed`);
    this.writeClaim({ ...claim, readLog: [...claim.readLog, { at, surface }] });
  }

  /**
   * The one user verb the store executes (Q-33): mark a claim as attested by
   * the person it is about. `status` is NOT touched here — it is recomputed
   * mechanically from the graph (Q-29), and the recompute maps this flag on
   * its next pass.
   *
   * Read-modify-write through `readClaim`/`writeClaim`, the `recordRead`
   * idiom: a claim gone malformed on disk is never silently rewritten from a
   * partial parse, and the validations run again on the way out. An unknown
   * id returns null, the same not-found answer the by-id reads give.
   */
  attest(id: string): Claim | null {
    const claim = this.readClaim(id);
    if (!claim) return null;
    const updated = { ...claim, attested: true, updated: new Date().toISOString() };
    this.writeClaim(updated);
    return updated;
  }

  /**
   * The user's correcting verb (Q-33's family): the person's own words
   * replace the claim's body, the claim is marked attested, and the cite to
   * the Snippet holding those words verbatim is appended (CONTEXT —
   * Propagation). `status` is NOT touched — recomputed mechanically (Q-29),
   * exactly as `attest`. Read-modify-write through `readClaim`/`writeClaim`,
   * the `attest` idiom. An unknown id returns null.
   */
  edit(id: string, body: string, cite: string): Claim | null {
    const claim = this.readClaim(id);
    if (!claim) return null;
    const updated = {
      ...claim,
      body,
      attested: true,
      cites: [...claim.cites, cite],
      updated: new Date().toISOString(),
    };
    this.writeClaim(updated);
    return updated;
  }
}

// ── The sweep deferral and still-true cursor (075) ──
//
// Two pieces of derived state the docket needs across runs, kept outside the
// ClaimStore interface on purpose: they are the docket's own ledger, not the
// clerk's claims. The deferral records how many readings the sweep clipped
// "for the next run" — durable so the drain chain survives a restart
// (record-don't-gate, the sweep ledger's own idiom) — and the cursor rotates
// the still-true channel so it does not propose the same two snippets every
// run. Both are derived like the rest of `vault/wiki/`: a missing or
// malformed file costs a re-drain or a re-rotation, never data, and nothing
// here deletes (Q-3, Q-29).

export function appendSweepDeferral(root: string, remaining: number): void {
  appendLine(root, join('wiki', SWEEP_DEFERRAL), JSON.stringify({ at: new Date().toISOString(), remaining }));
}

/**
 * EVERY valid deferral line, oldest first. The ledger is append-only (Q-3,
 * Q-29: nothing here deletes), so the history IS the per-sitting detail —
 * each line is one sitting that left sweep work. A corrupt line is skipped
 * on the Activity Log's precedent, exactly as #sweepLines does for the sweep
 * log — a half-written final line must not hide the real backlog above it.
 */
export function readSweepDeferrals(root: string): { at: string; remaining: number }[] {
  return readJsonl(root, join('wiki', SWEEP_DEFERRAL), deferralOf);
}

/**
 * The LAST valid deferral line, or null when the file is missing, empty, or
 * every line is corrupt — the boot-drain check's single-line probe.
 */
export function readSweepDeferral(root: string): { at: string; remaining: number } | null {
  const lines = readSweepDeferrals(root);
  return lines.length > 0 ? lines[lines.length - 1]! : null;
}

export function writeStillTrueCursor(root: string, offset: number): void {
  jsonCursorFile(root, join('wiki', STILL_TRUE_CURSOR), cursorOffset, (n) => JSON.stringify({ offset: n })).write(offset);
}

/** The persisted still-true offset; 0 when the file is missing or unparseable. */
export function readStillTrueCursor(root: string): number {
  return jsonCursorFile(root, join('wiki', STILL_TRUE_CURSOR), cursorOffset).read() ?? 0;
}

// ── Outcome question cursor (ticket 106) ──

const OUTCOME_CURSOR = 'outcome-cursor.json';

export function writeOutcomeCursor(root: string, offset: number): void {
  jsonCursorFile(root, join('wiki', OUTCOME_CURSOR), cursorOffset, (n) => JSON.stringify({ offset: n })).write(offset);
}

/** The persisted outcome-question offset; 0 when the file is missing or unparseable. */
export function readOutcomeCursor(root: string): number {
  return jsonCursorFile(root, join('wiki', OUTCOME_CURSOR), cursorOffset).read() ?? 0;
}
// ── The docket resume marker (ticket 139) ──
//
// When a docket run is cut short by the stop switch, the `docket-cut-short`
// log line says "the remaining jobs wait for resume." This marker makes that
// promise real: the next run finds it and schedules a drain to finish the
// skipped work. A missing or malformed file costs one unnecessary drain, never
// data — a re-drain that finds nothing is a no-op (record-don't-gate).

const RESUME_MARKER = 'docket-resume.json';

export type ResumeMarker = {
  at: string;
  pendingReadings: number;
};

export function writeResumeMarker(root: string, marker: ResumeMarker): void {
  jsonCursorFile(root, join('wiki', RESUME_MARKER), resumeMarkerOf).write(marker);
}

/** The last resume marker, or null when missing or unparseable. */
export function readResumeMarker(root: string): ResumeMarker | null {
  return jsonCursorFile(root, join('wiki', RESUME_MARKER), resumeMarkerOf).read();
}

/** Remove the resume marker after a drain run has picked it up. */
export function clearResumeMarker(root: string): void {
  const path = join(root, 'wiki', RESUME_MARKER);
  try { unlinkSync(path); } catch { /* already gone — fine */ }
}
