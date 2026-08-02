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
//     as evidence (Q-29). There is no `unlink` in this module, and that absence
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
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
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

export function createClaimStore(root: string): ClaimStore {
  return new ClaimStoreImpl(root);
}

const CLAIMS = 'claims';
const CONTRADICTIONS = 'contradictions';
const CANDIDATES = 'candidates';
const REGISTRY = 'registry';
const SWEEP_LOG = 'sweep-log.jsonl';

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

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

/** Exactly two ids. `Contradiction.claims` and `ClashCandidate.pair` are tuples because "between A and B" is the definition. */
function pair(v: unknown): [string, string] | null {
  const items = strArray(v);
  if (!items || items.length !== 2) return null;
  return [items[0]!, items[1]!];
}

function readLog(v: unknown): ReadLogEntry[] {
  if (!Array.isArray(v)) return [];
  const entries: ReadLogEntry[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const e = raw as Record<string, unknown>;
    const at = str(e.at);
    const surface = str(e.surface);
    // Q-21's flag is only usable if the entry is dated: an undated read cannot
    // be compared against a snippet's capture time, so it carries no evidence.
    if (at && surface) entries.push({ at, surface });
  }
  return entries;
}

function evidence(v: unknown): ClashEvidence | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  const snippetRef = str(e.snippetRef);
  const quote = str(e.quote);
  const side = str(e.side);
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

    const fm = {
      id: c.id,
      range: c.range,
      status: c.status,
      cites: c.cites,
      facet: c.facet,
      referents: c.referents,
      fromReadings: c.fromReadings,
      attested: c.attested,
      readLog: c.readLog,
      model: c.model,
      modelAt: c.modelAt,
      created: c.created,
      updated: c.updated,
      ...(c.supersededBy !== undefined ? { supersededBy: c.supersededBy } : {}),
      ...(c.supersedeReason !== undefined ? { supersedeReason: c.supersedeReason } : {}),
      ...(c.archived !== undefined ? { archived: c.archived } : {}),
      ...(c.archiveReason !== undefined ? { archiveReason: c.archiveReason } : {}),
    };
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
    const id = str(d.id);
    const range = str(d.range);
    const cites = strArray(d.cites);
    const facet = str(d.facet);
    const status = str(d.status);
    const model = str(d.model);
    const modelAt = str(d.modelAt);
    const created = str(d.created);
    const updated = str(d.updated);
    if (!id || !range || !facet || !status || !model || !modelAt || !created || !updated) {
      warnSkip(path, 'a required field is missing');
      return null;
    }
    if (!cites || cites.length === 0) {
      warnSkip(path, 'cites is missing or empty (Q-21)');
      return null;
    }
    return {
      id,
      body: typeof d.__content === 'string' ? d.__content : '',
      range,
      status: status as ClaimStatus,
      cites,
      facet: facet as Facet,
      referents: strArray(d.referents) ?? [],
      fromReadings: strArray(d.fromReadings) ?? [],
      attested: d.attested === true,
      readLog: readLog(d.readLog),
      model,
      modelAt,
      created,
      updated,
      ...(str(d.supersededBy) ? { supersededBy: d.supersededBy as string } : {}),
      ...(str(d.supersedeReason) ? { supersedeReason: d.supersedeReason as string } : {}),
      ...(d.archived === true ? { archived: true } : {}),
      ...(str(d.archiveReason) ? { archiveReason: d.archiveReason as string } : {}),
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
      const id = str(d.id);
      const type = str(d.type);
      const claims = pair(d.claims);
      const candidate = str(d.candidate);
      const remeasureQueueId = str(d.remeasureQueueId);
      const ev = evidence(d.evidence);
      const status = str(d.status);
      const model = str(d.model);
      const modelAt = str(d.modelAt);
      const opened = str(d.opened);
      const updated = str(d.updated);
      if (!id || !type || !candidate || !remeasureQueueId || !status || !model || !modelAt || !opened || !updated) {
        warnSkip(path, 'a required field is missing');
        continue;
      }
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
        id,
        type: type as Contradiction['type'],
        claims,
        candidate,
        remeasureQueueId,
        evidence: ev,
        status: status as Contradiction['status'],
        ...(str(d.dissolveReason) ? { dissolveReason: d.dissolveReason as string } : {}),
        model,
        modelAt,
        opened,
        updated,
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
      const id = str(d.id);
      const claimPair = pair(d.pair);
      const channel = str(d.channel);
      const status = str(d.status);
      const model = str(d.model);
      const modelAt = str(d.modelAt);
      const created = str(d.created);
      if (!id || !channel || !status || !model || !modelAt || !created) {
        warnSkip(path, 'a required field is missing');
        continue;
      }
      if (!claimPair) {
        warnSkip(path, 'pair is not a pair of claim ids');
        continue;
      }
      out.push({
        id,
        pair: claimPair,
        channel: channel as ClashChannelName,
        status: status as ClashCandidate['status'],
        ...(str(d.outcome) ? { outcome: d.outcome as ClashOutcome } : {}),
        ...(str(d.remeasureQueueId) ? { remeasureQueueId: d.remeasureQueueId as string } : {}),
        ...(str(d.remeasureAskedAt) ? { remeasureAskedAt: d.remeasureAskedAt as string } : {}),
        // Defaulted rather than required, unlike every other scalar here: a
        // candidate file written before Q-53 has had exactly one re-measure,
        // so 1 is what an absent key already means. Nothing is fabricated.
        attempts: typeof d.attempts === 'number' && d.attempts > 0 ? d.attempts : 1,
        model,
        modelAt,
        created,
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
      const slug = str(d.slug);
      const canonical = str(d.canonical);
      const kind = str(d.kind);
      const model = str(d.model);
      const modelAt = str(d.modelAt);
      const created = str(d.created);
      const updated = str(d.updated);
      if (!slug || !canonical || !kind || !model || !modelAt || !created || !updated) {
        warnSkip(path, 'a required field is missing');
        continue;
      }
      const note = typeof d.__content === 'string' ? d.__content.trim() : '';
      out.push({
        slug,
        canonical,
        kind: kind as Referent['kind'],
        aliases: strArray(d.aliases) ?? [],
        model,
        modelAt,
        created,
        updated,
        ...(note !== '' ? { note } : {}),
      });
    }
    return out;
  }

  // ── The sweep ledger ──

  appendSweep(e: SweepLine): void {
    const dir = join(this.#root, 'wiki');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, SWEEP_LOG), `${JSON.stringify(e)}\n`, 'utf-8');
  }

  /**
   * Every ledger line, oldest first. A missing file is no lines, never an
   * error: the ledger is derived and a deleted one costs a re-sweep (Q-3).
   * A corrupt line is skipped, on the Activity Log's precedent — a half-written
   * final line must not hide the hundred good ones above it.
   */
  #sweepLines(): SweepLine[] {
    const path = join(this.#root, 'wiki', SWEEP_LOG);
    if (!existsSync(path)) return [];
    const lines: SweepLine[] = [];
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null) continue;
        const rec = parsed as Record<string, unknown>;
        const readingId = str(rec.readingId);
        const op = str(rec.op);
        if (!readingId || !op) continue;
        lines.push(parsed as SweepLine);
      } catch {
        // Malformed line — skip, exactly as the Activity Log does.
      }
    }
    return lines;
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
}
