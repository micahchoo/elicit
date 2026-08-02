// The Clerk's write boundary: validate, apply, recompute (Q-29).
//
// This is the slice. Everything else feeds it or reads what it wrote, and it is
// the ONE place a claim file is written from an op. If a reviewer asks "what
// stops the model from writing a status, minting a claim without a Range, or
// superseding without a reason?", the answer is this file and nothing else —
// the wiki-side mirror of Q-1's verbatim substring check.
//
// Three properties hold across every path here, and each is a test:
//
//   - **Status is never model-writable.** No op carries one, an op that does is
//     rejected by name, and the value written comes from `computeStatus` alone.
//     Arithmetic set it; nobody else did.
//   - **No code path merges two referents** (Q-32). Merging CLAIMS is a verb;
//     merging identities is not one, and the `Registry` interface has no word
//     for it. The model may add structure and link reversibly, never collapse.
//   - **Rejected means skipped, never patched.** A bad op writes nothing, its
//     reading stays out of `applied`, and it lands in `unprocessed` for the
//     next run. Nothing here guesses a missing field.
//
// `ops` arrives as `unknown[]` on purpose. It started life as model output and
// reached here through JSON, where the compiler is not watching — so every
// field is shape-checked at runtime even though `ClerkOp` already forbids it.

import { ulid } from 'ulid';
import { computeStatus } from './status.js';
import type {
  Claim,
  ClaimGraph,
  ClaimStore,
  ClerkOp,
  LogFn,
  OpResult,
  Referent,
  ReferentRef,
  Registry,
} from './contract.js';

/** The six, and nothing else (Q-29). */
const OPS = ['MINT', 'UPDATE', 'MERGE', 'SUPERSEDE', 'ARCHIVE', 'KEEP'] as const;

/** The kinds a `ReferentRef` may name. Kept in step with `Referent['kind']`. */
const REFERENT_KINDS: Referent['kind'][] = [
  'person',
  'project',
  'place',
  'pole',
  'construct',
  'other',
];

/**
 * A claim body is ONE sentence of agent prose (Q-21). 300 is the ceiling the
 * op contract names; a body at or over it is a paragraph wearing a claim's
 * clothes.
 */
const BODY_MAX_CHARS = 300;

/**
 * The status transition event's kind, fixed here because T12 writes the
 * plain-English sentence for exactly this string and greps for it (S17). An
 * emitter free to pick its own name passes that grep and still renders as
 * machine noise.
 */
const STATUS_CHANGED = 'claim-status-changed';

export type ApplyDeps = {
  store: ClaimStore;
  registry: Registry;
  graph: ClaimGraph;
  /**
   * The Q-34 stamp for everything this pass writes. Taken from the CALLER, not
   * from the environment: the executor must stamp what actually produced the
   * ops, and a module that reads `process.env` stamps whatever the process was
   * configured with, which is a different fact.
   */
  model: string;
  log: LogFn;
};

// ── Runtime shape checks ──

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

function filled(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Why a body is not one claim, or null when it is.
 *
 * The sentence test is: strip one trailing terminator, and any terminator left
 * that is followed by whitespace opens a second sentence. This over-rejects an
 * abbreviation ("e.g. ", "Dr. Smith") and that is the safe direction — a
 * rejected op writes nothing and the reading is retried, while a body that is
 * really a paragraph is unrecoverable once it is the wiki's unit.
 */
function bodyProblem(v: unknown): string | null {
  const text = typeof v === 'string' ? v.trim() : '';
  if (text === '') return 'body-missing';
  if (text.length >= BODY_MAX_CHARS) return `body-too-long:${text.length}`;
  if (/[.!?]\s/.test(text.replace(/[.!?]+$/, ''))) return 'body-not-one-sentence';
  return null;
}

/**
 * Does this cite name a snippet version that exists on disk?
 *
 * `ClaimGraph.snippets` holds the LATEST version of each, so the comparison is
 * `version <= latest` and not a key lookup — `@1` when the latest is `@2` is a
 * STALE citation (T8's lint finding) and still real evidence, while `@3`
 * against a latest of `@2` names a version that never existed. The second is
 * the fabrication case, and it is dropped the way a fabricated harvest cut is.
 */
function citeResolves(cite: string, graph: ClaimGraph): boolean {
  const at = cite.lastIndexOf('@');
  if (at <= 0) return false;
  const snippet = graph.snippets[cite.slice(0, at)];
  if (!snippet) return false;
  const version = Number(cite.slice(at + 1));
  return Number.isInteger(version) && version >= 1 && version <= snippet.version;
}

function unresolvedCite(cites: string[], graph: ClaimGraph): string | null {
  for (const cite of cites) if (!citeResolves(cite, graph)) return cite;
  return null;
}

function referentProblem(v: unknown): string | null {
  if (v === undefined) return null;
  if (!Array.isArray(v)) return 'referents-malformed';
  for (const raw of v) {
    const ref = asRecord(raw);
    if (!ref || !filled(ref['name'])) return 'referents-malformed';
    const kind = ref['kind'];
    if (typeof kind !== 'string' || !REFERENT_KINDS.includes(kind as Referent['kind'])) {
      return `referent-kind-unknown:${String(kind)}`;
    }
    if (ref['aliasOf'] !== undefined && typeof ref['aliasOf'] !== 'string') {
      return 'referents-malformed';
    }
  }
  return null;
}

function refsOf(v: unknown): ReferentRef[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const ref = raw as Record<string, unknown>;
    const aliasOf = ref['aliasOf'];
    return {
      name: (ref['name'] as string).trim(),
      kind: ref['kind'] as Referent['kind'],
      ...(typeof aliasOf === 'string' && aliasOf.trim() !== '' ? { aliasOf: aliasOf.trim() } : {}),
    };
  });
}

/** Append what is not already there. Order is insertion order, so a diff is readable. */
function union(...lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const item of list) if (!out.includes(item)) out.push(item);
  return out;
}

// ── Validation (rules 1–11) ──

type Verdict =
  | { ok: true; op: ClerkOp }
  | { ok: false; reason: string; reading?: string };

function reject(reason: string, reading?: string): Verdict {
  return reading === undefined ? { ok: false, reason } : { ok: false, reason, reading };
}

/**
 * Is this claim writable by an op right now?
 *
 * Archived and superseded claims are both terminal states with a recorded
 * reason. Writing through one would overwrite that reason with a newer act,
 * which is the one thing ARCHIVE's "the file stays" was for.
 */
function liveClaim(
  id: unknown,
  store: ClaimStore,
): { ok: true; claim: Claim } | { ok: false; reason: string } {
  const name = filled(id);
  if (!name) return { ok: false, reason: 'claim-missing' };
  const claim = store.readClaim(name);
  if (!claim) return { ok: false, reason: `claim-not-found:${name}` };
  if (claim.archived === true) return { ok: false, reason: `claim-archived:${name}` };
  if (claim.supersededBy !== undefined) return { ok: false, reason: `claim-superseded:${name}` };
  return { ok: true, claim };
}

/**
 * One op, checked against every rule that applies to it.
 *
 * `claimed` is rule 3's memory. A reading is claimed by the FIRST op that names
 * it and passes rules 1 and 2, whether or not that op survives the later rules:
 * one reading gets one attempt per run, or a model could smuggle a second try
 * in behind a deliberately malformed first.
 */
function validate(
  raw: unknown,
  sweep: Set<string>,
  claimed: Set<string>,
  deps: ApplyDeps,
): Verdict {
  const rec = asRecord(raw);
  if (!rec) return reject('op-not-an-object');

  // 1. One of the six.
  const name = rec['op'];
  if (typeof name !== 'string' || !OPS.includes(name as ClerkOp['op'])) {
    return reject(`unknown-op:${String(name)}`);
  }
  const op = name as ClerkOp['op'];

  // 2. The reading is one this sweep actually read.
  const readingId = filled(rec['reading']);
  if (!readingId || !sweep.has(readingId)) return reject(`unknown-reading:${String(rec['reading'])}`);

  // 3. Totality is per reading: the second op naming it is not a second chance.
  if (claimed.has(readingId)) return reject('reading-already-covered', readingId);
  claimed.add(readingId);

  // 4 & 5. Never model-writable, even when the value would have been right.
  if ('status' in rec) return reject('status-not-model-writable', readingId);
  if ('attested' in rec) return reject('attested-not-model-writable', readingId);

  const { store, graph } = deps;

  // 6. Range. Required where the type requires it; non-whitespace wherever it
  //    is present. UPDATE's is optional in the contract, and forcing an update
  //    that only adds a cite to restate a Range is how a Range silently widens.
  const rangeNeeded = op === 'MINT' || op === 'MERGE' || op === 'SUPERSEDE';
  const range = filled(rec['range']);
  if (rangeNeeded && !range) return reject('range-missing', readingId);
  if (op === 'UPDATE' && rec['range'] !== undefined && !range) {
    return reject('range-missing', readingId);
  }

  // 10. Body: one sentence, non-empty, under 300 chars.
  const bodyNeeded = op === 'MINT' || op === 'MERGE' || op === 'SUPERSEDE';
  if (bodyNeeded || (op === 'UPDATE' && rec['body'] !== undefined)) {
    const problem = bodyProblem(rec['body']);
    if (problem) return reject(problem, readingId);
  }

  const referents = referentProblem(rec['referents']);
  if (referents && (op === 'MINT' || op === 'UPDATE')) return reject(referents, readingId);

  switch (op) {
    case 'MINT': {
      // 7. Evidence, and evidence that exists.
      const cites = asStringArray(rec['cites']);
      if (!cites || cites.length === 0) return reject('cites-empty', readingId);
      const bad = unresolvedCite(cites, graph);
      if (bad) return reject(`cite-does-not-resolve:${bad}`, readingId);
      // Q-4: the facet is the READING's, so a MINT needs its reading in the
      // graph. Taking the op's `facet` instead would let the op vocabulary make
      // a reading, which is exactly what it is not for.
      const reading = graph.readings[readingId];
      if (!reading) return reject(`reading-not-in-graph:${readingId}`, readingId);
      return {
        ok: true,
        op: {
          op: 'MINT',
          reading: readingId,
          body: (rec['body'] as string).trim(),
          range: range as string,
          cites,
          facet: reading.facet,
          ...(rec['referents'] !== undefined ? { referents: refsOf(rec['referents']) } : {}),
        },
      };
    }

    case 'UPDATE': {
      const target = liveClaim(rec['claim'], store);
      if (!target.ok) return reject(target.reason, readingId);
      // Not in the plan's rule 7, and here anyway: a fabricated cite entering
      // through `addCites` is the same fabrication rule 7 exists to stop, and
      // validate-before-write is a property of the boundary, not of one op.
      let addCites: string[] | undefined;
      if (rec['addCites'] !== undefined) {
        const parsed = asStringArray(rec['addCites']);
        if (!parsed) return reject('cites-malformed', readingId);
        const bad = unresolvedCite(parsed, graph);
        if (bad) return reject(`cite-does-not-resolve:${bad}`, readingId);
        addCites = parsed;
      }
      return {
        ok: true,
        op: {
          op: 'UPDATE',
          reading: readingId,
          claim: target.claim.id,
          ...(rec['body'] !== undefined ? { body: (rec['body'] as string).trim() } : {}),
          ...(range !== null ? { range } : {}),
          ...(addCites !== undefined ? { addCites } : {}),
          ...(rec['referents'] !== undefined ? { referents: refsOf(rec['referents']) } : {}),
        },
      };
    }

    case 'MERGE': {
      // 9. Every named claim is live and non-archived.
      const into = liveClaim(rec['into'], store);
      if (!into.ok) return reject(into.reason, readingId);
      const from = asStringArray(rec['from']);
      if (!from) return reject('merge-from-malformed', readingId);
      if (from.length === 0) return reject('merge-from-empty', readingId);
      if (from.includes(into.claim.id)) return reject('merge-into-in-from', readingId);
      for (const id of from) {
        const source = liveClaim(id, store);
        if (!source.ok) return reject(source.reason, readingId);
      }
      return {
        ok: true,
        op: {
          op: 'MERGE',
          reading: readingId,
          into: into.claim.id,
          from: union(from),
          body: (rec['body'] as string).trim(),
          range: range as string,
        },
      };
    }

    case 'SUPERSEDE': {
      const target = liveClaim(rec['claim'], store);
      if (!target.ok) return reject(target.reason, readingId);
      const cites = asStringArray(rec['cites']);
      if (!cites || cites.length === 0) return reject('cites-empty', readingId);
      const bad = unresolvedCite(cites, graph);
      if (bad) return reject(`cite-does-not-resolve:${bad}`, readingId);
      // 8. The reason cannot be forgotten, only badly chosen.
      const reason = filled(rec['reason']);
      if (!reason) return reject('reason-missing', readingId);
      return {
        ok: true,
        op: {
          op: 'SUPERSEDE',
          reading: readingId,
          claim: target.claim.id,
          body: (rec['body'] as string).trim(),
          range: range as string,
          cites,
          reason,
        },
      };
    }

    case 'ARCHIVE': {
      const target = liveClaim(rec['claim'], store);
      if (!target.ok) return reject(target.reason, readingId);
      const reason = filled(rec['reason']);
      if (!reason) return reject('reason-missing', readingId);
      return { ok: true, op: { op: 'ARCHIVE', reading: readingId, claim: target.claim.id, reason } };
    }

    default: {
      const note = filled(rec['note']);
      return {
        ok: true,
        op: { op: 'KEEP', reading: readingId, ...(note !== null ? { note } : {}) },
      };
    }
  }
}

// ── Application ──

/**
 * Resolve every named referent to a slug.
 *
 * Tiers 1 and 2 of Q-32 and no third: an unknown name is minted, an `aliasOf`
 * proposal is applied, and both are reversible. There is no call here that
 * collapses two identities, because `Registry` has no method that does.
 * The registry logs its own acts — it is constructed with the same sink.
 */
function slugsOf(refs: ReferentRef[] | undefined, registry: Registry): string[] {
  const slugs: string[] = [];
  for (const ref of refs ?? []) {
    const slug = registry.resolve(ref).slug;
    if (!slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/** The claim id a sweep line points at, or none for KEEP. */
function applyOne(op: ClerkOp, deps: ApplyDeps, now: string, touched: string[]): string | undefined {
  const { store, registry, model } = deps;

  const mark = (id: string): void => {
    if (!touched.includes(id)) touched.push(id);
  };

  switch (op.op) {
    case 'MINT': {
      // Born unconfirmed with its cites (Q-28). The status here is the floor,
      // not a judgment: the recompute below is what decides it.
      const claim: Claim = {
        id: ulid(),
        body: op.body,
        range: op.range,
        status: 'unconfirmed',
        cites: union(op.cites),
        facet: op.facet,
        referents: slugsOf(op.referents, registry),
        fromReadings: [op.reading],
        attested: false,
        readLog: [],
        model,
        modelAt: now,
        created: now,
        updated: now,
      };
      store.writeClaim(claim);
      mark(claim.id);
      return claim.id;
    }

    case 'UPDATE': {
      const existing = store.readClaim(op.claim);
      if (!existing) return undefined;
      store.writeClaim({
        ...existing,
        ...(op.body !== undefined ? { body: op.body } : {}),
        ...(op.range !== undefined ? { range: op.range } : {}),
        cites: union(existing.cites, op.addCites ?? []),
        // Q-32's principle applied to a claim's referent list: ADD, never
        // remove. An UPDATE that omits a referent is silent about it, and
        // silence is not a request to unlink.
        referents: union(existing.referents, slugsOf(op.referents, registry)),
        fromReadings: union(existing.fromReadings, [op.reading]),
        model,
        modelAt: now,
        updated: now,
      });
      mark(existing.id);
      return existing.id;
    }

    case 'MERGE': {
      const into = store.readClaim(op.into);
      if (!into) return undefined;
      const sources = op.from
        .map((id) => store.readClaim(id))
        .filter((c): c is Claim => c !== null);

      // Facet and referents are `into`'s, untouched (S6). Cites and readings
      // are the union — the evidence merges, the identity does not.
      store.writeClaim({
        ...into,
        body: op.body,
        range: op.range,
        cites: union(into.cites, ...sources.map((s) => s.cites)),
        fromReadings: union(into.fromReadings, ...sources.map((s) => s.fromReadings), [op.reading]),
        model,
        modelAt: now,
        updated: now,
      });
      mark(into.id);

      for (const source of sources) {
        store.writeClaim({
          ...source,
          archived: true,
          archiveReason: `merged-into:${into.id}`,
          updated: now,
        });
        mark(source.id);
      }
      return into.id;
    }

    case 'SUPERSEDE': {
      const old = store.readClaim(op.claim);
      if (!old) return undefined;
      // The new claim inherits facet and referents from the claim it supersedes
      // (S6): SUPERSEDE carries no facet on purpose, and inventing one would
      // make the op vocabulary a place where readings happen.
      const fresh: Claim = {
        id: ulid(),
        body: op.body,
        range: op.range,
        status: 'unconfirmed',
        cites: union(op.cites),
        facet: old.facet,
        referents: [...old.referents],
        fromReadings: [op.reading],
        attested: false,
        readLog: [],
        model,
        modelAt: now,
        created: now,
        updated: now,
      };
      store.writeClaim(fresh);
      // The old file stays. Its stamp is not refreshed: `model` records who
      // wrote the PROSE, and this act did not rewrite a word of it.
      store.writeClaim({
        ...old,
        supersededBy: fresh.id,
        supersedeReason: op.reason,
        updated: now,
      });
      mark(fresh.id);
      mark(old.id);
      return fresh.id;
    }

    case 'ARCHIVE': {
      const existing = store.readClaim(op.claim);
      if (!existing) return undefined;
      store.writeClaim({
        ...existing,
        archived: true,
        archiveReason: op.reason,
        updated: now,
      });
      mark(existing.id);
      return existing.id;
    }

    default:
      // KEEP writes nothing. The sweep line below is its entire job and its
      // entire point: judged redundant, and therefore not silently omitted.
      return undefined;
  }
}

/**
 * Recompute the status of every touched claim, and of every claim sharing an
 * open Contradiction with one.
 *
 * The graph is rebuilt from the store first, because the snapshot the caller
 * passed predates this batch. Snippets and readings come from the caller's
 * graph — nothing here writes either.
 */
/**
 * Recompute and persist status for the touched claims (Q-29: status is never
 * model-writable; arithmetic decides it).
 *
 * EXPORTED so that this file stays the only place a claim's status reaches
 * disk. T12 opens a Contradiction, which mechanically contests both claims —
 * not an op, so it cannot go through `applyOps`, and it had grown its own
 * `store.writeClaim` call. That made a fourth write site and broke the
 * invariant the plan's grep guards: only `store.ts` and `ops.ts` write claims.
 * A caller outside the op path calls this instead of writing claims itself.
 */
export function recomputeStatus(touched: string[], deps: ApplyDeps, now: string): void {
  const { store, graph, log } = deps;
  const after: ClaimGraph = { ...graph, ...store.loadSlice() };

  const targets: string[] = [...touched];
  const push = (id: string): void => {
    if (!targets.includes(id)) targets.push(id);
  };
  // NOTE, added after T15 measured it: this propagation is currently a NO-OP.
  // The only claims it adds are members of an OPEN Contradiction, and
  // `computeStatus` rule 1 returns `contested` for exactly those — which is
  // already their status — so the `live === claim.status` guard below skips
  // every one. Deleting the two `push` calls leaves the whole suite green.
  //
  // It is kept rather than deleted because it is a correctness guard against a
  // FUTURE status rule, not dead weight today: the moment any rule makes a
  // contradiction member's status depend on something other than membership,
  // the partner must recompute or it goes stale. But nothing may claim it does
  // work now — an earlier commit message of mine said this version "propagates
  // to a contradiction's partner claim, which the local one did not", and that
  // was wrong.
  const isTouched = new Set(touched);
  for (const k of after.contradictions) {
    if (k.status !== 'open') continue;
    if (!isTouched.has(k.claims[0]) && !isTouched.has(k.claims[1])) continue;
    push(k.claims[0]);
    push(k.claims[1]);
  }

  for (const id of targets) {
    const claim = after.claims.find((c) => c.id === id);
    if (!claim) continue;
    const { live, why } = computeStatus(claim, after, log);
    if (live === claim.status) continue;
    store.writeClaim({ ...claim, status: live, updated: now });
    log({
      at: now,
      actor: 'clerk',
      kind: STATUS_CHANGED,
      detail: `claim=${id} from=${claim.status} to=${live} — ${why}`,
      refs: [id],
    });
  }
}

/**
 * Apply a validated op list to the wiki. The single writer.
 *
 * Every op is checked, then applied, then the statuses are recomputed and the
 * transitions logged. A rejected op writes nothing and its reading stays
 * unprocessed for the next run (Q-29) — this function never patches an op and
 * never guesses a field.
 *
 * Rejections do NOT get a sweep line. `REJECTED` counts an attempt, and the
 * caller appends it from `result.rejected[].reading`: the executor sees one
 * batch, and the back-off rule counts across runs.
 */
export function applyOps(
  ops: unknown[],
  sweep: { readingIds: string[] },
  deps: ApplyDeps,
): OpResult {
  const now = new Date().toISOString();
  const readingIds = new Set(sweep.readingIds);
  const claimed = new Set<string>();

  const applied: ClerkOp[] = [];
  const rejected: OpResult['rejected'][number][] = [];
  const covered = new Set<string>();
  const touched: string[] = [];

  for (const raw of ops) {
    const verdict = validate(raw, readingIds, claimed, deps);
    if (!verdict.ok) {
      rejected.push({
        op: raw,
        reason: verdict.reason,
        ...(verdict.reading !== undefined ? { reading: verdict.reading } : {}),
      });
      deps.log({
        at: now,
        actor: 'clerk',
        kind: 'claim-op-rejected',
        detail: `reason=${verdict.reason} reading=${verdict.reading ?? 'unknown'}`,
        ...(verdict.reading !== undefined ? { refs: [verdict.reading] } : {}),
      });
      continue;
    }

    const op = verdict.op;
    const claimId = applyOne(op, deps, now, touched);
    applied.push(op);
    covered.add(op.reading);
    deps.store.appendSweep({
      readingId: op.reading,
      op: op.op,
      ...(claimId !== undefined ? { claimId } : {}),
      ...(op.op === 'KEEP' && op.note !== undefined ? { reason: op.note } : {}),
      ...(op.op === 'SUPERSEDE' || op.op === 'ARCHIVE' ? { reason: op.reason } : {}),
      at: now,
      model: deps.model,
    });
  }

  recomputeStatus(touched, deps, now);

  // 11. Totality. A reading with no ACCEPTED op is unprocessed — which is what
  // makes "the model dropped it" distinguishable from "judged redundant".
  return {
    applied,
    rejected,
    unprocessed: sweep.readingIds.filter((id) => !covered.has(id)),
  };
}
