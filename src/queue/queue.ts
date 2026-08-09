import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ulid } from 'ulid';
import matter from 'gray-matter';
import type { QueueStore, QueueEntry, QueueDraft, Mode, Facet, Target } from '../types.js';
import { appendEvent } from '../log/activity.js';
import type { EventKind } from '../log/kinds.js';
import { elideDisfluencies } from '../language/disfluency.js';
import { EngagementLedger } from './engagement.js';
import { ENERGY_LEVEL } from './mode-needs.js';
import { contentWordsOf } from '../index/lexical.js';
import {
 FACETS,
 facetBalancedPool,
 formatDistribution,
 sessionBlueprint,
 type FacetDistribution,
} from './facet-balance.js';
import { citeParts } from '../wiki/status.js';


/**
 * The distinct values of one QueueEntry field across a set of entries —
 * the shared core of the minters' "one question per X" dedupe.
 *
 * Eight minting sweeps each re-implement "read the queue, collect the keys
 * already asked about, skip a candidate whose key is present" with a private
 * field key (gap-fill: bud+failure, gazetteer-frontier: subjects, ktg:
 * territoryNode, lineage-mirror: claim id, wiki-jobs: claim, docket:
 * source+dedupe, coach/reflection: quest, import/repair: snippet). Those
 * that key on a single field can all be this one call; the two that key on
 * a composite (gap-fill's bud+failure, coach's quest+session) build the
 * join on top of the same single read.
 */
export function distinctFieldKeys<K extends keyof QueueEntry>(
  entries: QueueEntry[],
  field: K,
): Set<NonNullable<QueueEntry[K]> extends string | number ? string : never> {
  const out = new Set<string>();
  for (const e of entries) {
    const v = e[field];
    if (typeof v === 'string' && v.length > 0) out.add(v);
    else if (typeof v === 'number') out.add(String(v));
  }
  return out as Set<NonNullable<QueueEntry[K]> extends string | number ? string : never>;
}
/**
 * The parked-pointer draft shape the park modules mint: a question that
 * POINTS at a parked record rather than asking anything new (Q-45),
 * licensed 'user', deliberately weak and session-horizon so the draw
 * never prefers it, with the record-naming field (`soundingId`,
 * `machineId`, `drmId`) attached. The kinds stay the park modules' own
 * consts (the draw's 'sounding' filter reads them through
 * DEFAULT_PARKED_POINTER_KINDS); this helper only shapes the draft, so a
 * new park source is one kind constant plus one call and the copies
 * cannot drift apart.
 */
export function parkPointer(
 queue: QueueStore,
 p: {
  kind: QueueEntry['source'];
  question: string;
  /** The record-naming field, e.g. `{ soundingId: ladder.id }` — the parked record is the truth (Q-3), the pointer only points. */
  idField: Record<string, string>;
  /** Extra pointer fields beyond the shared shape (e.g. `machineProtocol`, which survives a corrupt record). */
  extraFields?: Record<string, unknown>;
  /** The sitting target, carried only when the park knows it. */
  target?: Target;
 },
): QueueEntry {
 return queue.add({
  source: p.kind,
  license: 'user',
  question: p.question,
  questionForm: 'deliberative',
  sharpness: 'weak',
  horizon: 'session',
  ...p.idField,
  ...(p.extraFields ? p.extraFields : {}),
  ...(p.target ? { target: p.target } : {}),
 });
}

/**
 * The parked-pointer sources the draw never serves, by default. Each park
 * module owns its kind ('parked-sounding' in src/sounding/park.ts,
 * 'parked-machine' in src/protocols/park.ts); 'parked-drm' is the legacy
 * source — slice 6 migrated drm parks to 'parked-machine', but old
 * pointers in the store must stay undrawable too.
 */
const DEFAULT_PARKED_POINTER_KINDS = ['parked-sounding', 'parked-machine', 'parked-drm'] as const;

export function createQueueStore(
 root: string,
 options: { parkedPointerKinds?: readonly string[] } = {},
): QueueStore {
 return new QueueStoreImpl(root, options.parkedPointerKinds ?? DEFAULT_PARKED_POINTER_KINDS);
}

/**
 * The two ways a question can be the person's own: typed in by hand, or
 * placed as a gap to fill. Everything else — including a model-marked gap
 * fill — is the system's material and weighs the same as any mint. This is
 * what `draw`'s priority sort and rung 2 test; `expire` deliberately does
 * NOT use it (Q-41, see the guard there).
 */
export function isUserDeclaredWeight(e: QueueEntry): boolean {
 return e.source === 'user-declared' || e.source === 'gap-declared';
}

/**
 * QR-6: the display bound on the open array GET /api/queue returns. A cap
 * that keeps the pile readable (Q-56 — caps ship live): the stale tail
 * beyond it is expired rather than hidden, so the queue on disk and the
 * queue the person sees cannot drift.
 */
export const MAX_OPEN_QUESTIONS = 20;

/**
 * The open pool's order: the person's own questions first, then newest
 * first. Shared by the draw's display order and the QR-6 bound's kept set
 * so the surface and the expiry always agree on which entries stay.
 */
function compareOpenEntries(a: QueueEntry, b: QueueEntry): number {
 const aUd = isUserDeclaredWeight(a) ? 0 : 1;
 const bUd = isUserDeclaredWeight(b) ? 0 : 1;
 if (aUd !== bUd) return aUd - bUd;
 return b.created.localeCompare(a.created);
}

/** How far ahead the shadow blueprint plans. Only its first slot is ever asked. */
const SESSION_BLUEPRINT_SLOTS = 6;

/** Constraints are done; chance takes the last step (Q-13). */
function pickTopK(pool: QueueEntry[], k = 3): QueueEntry {
 const top = pool.slice(0, k);
 return top[Math.floor(Math.random() * top.length)]!;
}
/**
 * The thread a queue entry belongs to: the snippet its FIRST cite names.
 * Ticket 148's per-thread deferral keys on it — the draw's
 * deferred-thread filter and #deferThreadAfterStrikes both need the same
 * `cites[0]` → citeParts → snippetId chain, and they must never drift
 * apart.
 */
function threadKeyOf(entry: QueueEntry): string | undefined {
 const firstCite = entry.cites?.[0];
 if (!firstCite) return undefined;
 return citeParts(firstCite)?.snippetId;
}

/** A hard filter, named as the ladder's log lines say it. */
type FilterName = 'status' | 'sounding' | 'modeNeeds' | 'sharpness' | 'horizon' | 'target';

type DrawFilter = {
 name: FilterName;
 keep: (e: QueueEntry) => boolean;
 /**
  * Rung 2 of the degradation ladder (Q-55) admits `user-declared` entries
  * past exactly these, and past nothing else. `status` is incoherent to
  * relax, `target` is the one thing the person said this sitting is FOR
  * (Q-19/045), and `horizon` protects the sitting's budget.
  */
 relaxable: boolean;
};

/**
 * The draw's hard filters as data rather than control flow, in the order they
 * apply. The order is a values statement (Q-55), so it is written once, read
 * by the normal path, by rung 2, and by the floor's "which filter emptied the
 * pool" — one list, no re-implementation.
 */
function drawFilters(mode: Mode, parkedPointerKinds: readonly string[]): DrawFilter[] {
 const modeEnergy = ENERGY_LEVEL[mode.energy];
 return [
  {
   name: 'status',
   relaxable: false,
   keep: (e) => e.status === 'pending' || e.status === 'deferred',
  },
  // A parked ladder, parked machine or legacy parked DRM is a pointer, not
  // a question. Rung 2 of the degradation ladder (Q-55) exists to admit the
  // person's own declared questions past a preference, never a pointer as if
  // it were a question — relaxable: false is the whole point. The kinds are
  // the park modules' own consts, configured at construction (the default
  // keeps legacy 'parked-drm' undrawable too).
  {
   name: 'sounding',
   relaxable: false,
   keep: (e) => !parkedPointerKinds.includes(e.source),
  },
  {
   name: 'modeNeeds',
   relaxable: true,
   keep: (e) => {
    if (e.modeNeeds?.minMinutes && e.modeNeeds.minMinutes > mode.minutes) return false;
    if (e.modeNeeds?.energy) {
     const needLevel = ENERGY_LEVEL[e.modeNeeds.energy] ?? 0;
     if (needLevel > modeEnergy) return false;
    }
    return true;
   },
  },
  {
   name: 'sharpness',
   relaxable: true,
   keep: (e) => e.sharpness === 'weak',
  },
  // Never drawn into an exchange, at any rung: a days-horizon question is
  // not a question for now.
  { name: 'horizon', relaxable: false, keep: (e) => e.horizon !== 'days' },
  // The sitting's declared Target — a hard filter, not a preference (045).
  // A domain sitting drew self material because nothing here looked at the
  // Target at all; the cost was every declared domain sitting, since one
  // composed self entry is enough to hijack it. An entry with no target
  // claim serves either sitting; an entry with the other target is simply
  // not in the pool, so the caller falls through to its own opener.
  {
   name: 'target',
   relaxable: false,
   keep: (e) =>
    mode.target === undefined || e.target === undefined || e.target === mode.target,
  },
 ];
}

type ChainRun = {
 pool: QueueEntry[];
 /**
  * The first filter that took a non-empty pool to empty. Null when the queue
  * was already empty — an empty vault is not a filter's doing, and saying
  * `status` there would be a lie the floor log then repeats.
  */
 emptiedBy: FilterName | null;
};

/**
 * Run the chain, recording where the pool died. `relaxUserDeclared` is rung 2:
 * an entry whose source is `user-declared` passes the relaxable filters
 * regardless of what they think of it. The person asked for that question by
 * name (Q-20), and the system's judgement that it is too sharp for an opening
 * is exactly the judgement that should yield to an explicit request.
 */
function runChain(
 entries: QueueEntry[],
 filters: DrawFilter[],
 relaxUserDeclared: boolean,
): ChainRun {
 let pool = entries;
 let emptiedBy: FilterName | null = null;
 for (const f of filters) {
  if (pool.length === 0) break;
  pool = pool.filter(
   (e) => f.keep(e) || (relaxUserDeclared && f.relaxable && isUserDeclaredWeight(e)),
  );
  if (pool.length === 0) {
   emptiedBy = f.name;
   break;
  }
 }
 return { pool, emptiedBy };
}

/**
 * Which relaxations actually earned their keep: the filters that reject an
 * entry still standing in the pool. Nothing else is named, so `relaxed=` says
 * what happened rather than what was permitted.
 */
function relaxedBy(pool: QueueEntry[], filters: DrawFilter[]): FilterName[] {
 const names = new Set<FilterName>();
 for (const e of pool) {
  for (const f of filters) if (f.relaxable && !f.keep(e)) names.add(f.name);
 }
 return [...names];
}

/**
 * The optional QueueEntry fields, in write order — the single source of
 * truth for serialization. Both #parseEntry (frontmatter → entry) and
 * #write (entry → frontmatter) iterate THIS list, so a new optional field
 * is one line here plus its type in types.ts — the read and write
 * directions cannot drift apart the way two hand-kept enumerations could.
 * Every field is guarded on both sides, never a present key holding
 * `undefined` — `matter.stringify` throws on that and the whole write is
 * lost — and absent stays absent on the read-back.
 */
type OptionalEntryKey = {
 [K in keyof QueueEntry]-?: undefined extends QueueEntry[K] ? K : never;
}[keyof QueueEntry];

export const OPTIONAL_ENTRY_FIELDS = [
 // Absent until `markAnswered` writes it. Its absence is the uptake
 // signal's "not yet", never a zero (ticket 041).
 'answeredAt',
 // The Claim a lint-minted still-true question is about. Read back
 // because the still-true dedupe keys on it across restarts (Q-31).
 'claim',
 // The quest a reflection question follows. Read back because the
 // (quest, session) pair is the dedupe key across restarts (Q-75).
 'quest',
 // The Gap this entry was minted to fill. Read back because the gap link
 // has to survive a restart: the mint wrote it, the draw read it (Q-39).
 'gap',
 // The Bud and the recorded failure this gap-fill entry asks about.
 // Read back because the per-failure dedupe keys on the pair across
 // restarts (ticket 027).
 'bud',
 'failure',
 // The snippet a half-Construct question is about. Read back because
 // the construct dedupe keys on it across restarts (ticket 027).
 'snippet',
 // The pair an undiscriminated-range question stands between (ticket
 // 060). Read back because the pair is the dedupe key and the answer's
 // routing address, across restarts.
 'claims',
 'cites',
 'quotedFragment',
 // Absent stays absent — an entry written before `target` existed makes
 // no target claim, and the draw treats that as eligible for either.
 'target',
 'topic',
 'targetFacet',
 'modeNeeds',
 'direction',
 // The other-minds expedition this entry carries (ticket 113): the errand
 // kind and the named person. Draft provenance persisted for restart
 // fidelity — the type declares them, so the serialization list must
 // match the type; without the read-back the errand re-mints after a
 // restart.
 'errandKind',
 'errandPerson',
 // The derivation pattern that composed this question (ticket 111, Q-81):
 // the pattern id, the element refs it recombined, and the operators it
 // applied. Draft provenance persisted for restart fidelity — the type
 // declares them, so the serialization list must match the type.
 'patternId',
 'derivedFrom',
 'operatorsUsed',
 // The lineage evidence that licensed this mirror question (Q-83). Read
 // back because the one-mirror-question-per-claim dedupe keys on it
 // across restarts — without it, the sweep re-mints every run.
 'lineageMirror',
 // The ladder a parked-sounding pointer names. Read back because the
 // resume route keys on it across restarts (Q-3: the ladder file is the
 // truth, the pointer only points).
 'soundingId',
 // The side-record a parked-machine pointer names (ticket 159, slice 5).
 // Read back for the same reason as soundingId: the record file is the
 // truth, the pointer only points — and machineProtocol survives a
 // corrupt record so the restart still runs the parked instrument.
 'machineId',
 'machineProtocol',
 // The legacy DRM file a parked-drm pointer names (ticket 159, slice 6:
 // the drm resume route's compat read keys on it across restarts, Q-3 —
 // the record file is the truth, the pointer only points).
 'drmId',
 // The KTG territory node this entry was minted for. Read back because
 // the dedupe key is the node id across restarts (094).
 'territoryNode',
 // The atlas region this entry was minted for. Read back because the
 // dedupe key is the region id across restarts (110, graduated 2026-08-03).
 'atlasRegion',
 // The gazetteer entities this question targets. Read back because
 // the frontier dedupe keys on entity id across restarts (100).
 'subjects',
] as const satisfies readonly OptionalEntryKey[];

/**
 * The sitting-level engagement state (Q-115, ticket 148 reopened). The
 * strike unit is the SITTING's relationship to the queue: a sitting whose
 * queue-drawn opener gets a pivoted-away reply is one strike, and two
 * consecutive strike-sittings pause queue draws for a cooldown measured in
 * sittings (2, then 4, then 8, capped). After the cooldown the next draw is
 * the probe: an engaged reply resets everything, another pivot doubles the
 * cooldown. Persisted beside the queue so a restart forgets nothing —
 * the measured failure ran one opener per sitting for 20 sittings, and any
 * in-memory counter dies with the process long before that.
 */

class QueueStoreImpl implements QueueStore {
 #root: string;
  /** The parked-pointer sources the draw never serves (set at construction). */
  #parkedPointerKinds: readonly string[];
  #deferredSnippets: Set<string> = new Set();
  #threadStrikes: Map<string, number> = new Map();
  /** The sitting-level engagement ledger (Q-115) — its own module. */
  #engagement: EngagementLedger;

 constructor(root: string, parkedPointerKinds: readonly string[]) {
  this.#root = root;
  this.#parkedPointerKinds = parkedPointerKinds;
  this.#engagement = new EngagementLedger(root);
 }

 noteSittingStarted(): void {
  this.#engagement.noteSittingStarted();
 }

 #dir(): string {
  const d = join(this.#root, 'queue');
  mkdirSync(d, { recursive: true });
  return d;
 }

 #readAll(): QueueEntry[] {
  const dir = this.#dir();
  const entries: QueueEntry[] = [];
  for (const f of readdirSync(dir)) {
   if (!f.endsWith('.md')) continue;
   const parsed = matter.read(join(dir, f));
   const data = parsed.data as Record<string, unknown>;
   entries.push(this.#parseEntry(data));
  }
  return entries;
 }

 #parseEntry(data: Record<string, unknown>): QueueEntry {
  const out: Record<string, unknown> = {
   id: data.id as string,
   status: data.status as QueueEntry['status'],
   source: data.source as QueueEntry['source'],
   license: data.license as string,
   question: data.question as string,
   questionForm: data.questionForm as QueueEntry['questionForm'],
   sharpness: data.sharpness as QueueEntry['sharpness'],
   horizon: data.horizon as QueueEntry['horizon'],
   created: data.created as string,
  };
  // The optional fields, driven by the same list #write emits — absent
  // stays absent (a field never written is a field never read back).
  for (const key of OPTIONAL_ENTRY_FIELDS) {
   if (data[key]) out[key] = data[key];
  }
  return out as unknown as QueueEntry;
 }

 #write(entry: QueueEntry): void {
  const fm: Record<string, unknown> = {
   id: entry.id,
   status: entry.status,
   source: entry.source,
   license: entry.license,
   question: entry.question,
   questionForm: entry.questionForm,
   sharpness: entry.sharpness,
   horizon: entry.horizon,
   created: entry.created,
  };
  // Every optional field is written under a guard, never as a present key
  // holding `undefined` — `matter.stringify` throws on that and the whole
  // write is lost. The same list drives #parseEntry's read-back, so the
  // two directions cannot drift apart.
  for (const key of OPTIONAL_ENTRY_FIELDS) {
   const v = entry[key];
   if (v) fm[key] = v;
  }
  const content = matter.stringify('', fm);
  writeFileSync(join(this.#dir(), `${entry.id}.md`), content, 'utf-8');
 }

 #readOne(id: string): QueueEntry | null {
  try {
   const parsed = matter.read(join(this.#dir(), `${id}.md`));
   return this.#parseEntry(parsed.data as Record<string, unknown>);
  } catch {
   return null;
  }
 }

 // ── Public API ──

add(draft: QueueDraft): QueueEntry {
 const entry: QueueEntry = {
  id: ulid(),
  status: 'pending',
  created: new Date().toISOString(),
  ...draft,
 };
 // QR-5: elide STT disfluencies from fragments quoted INTO questions at
 // the one write gate every draft passes through. The kept Snippet stays
 // verbatim (Q-12); only the quotation is elided, by the mechanical marked
 // rule (src/language/disfluency.ts). Absent stays absent, and a fragment
 // that elides to itself is not re-written. The shadow record (Q-35) is
 // what can graduate the selection change.
 if (entry.quotedFragment) {
  const elided = elideDisfluencies(entry.quotedFragment);
  if (elided !== entry.quotedFragment) {
   entry.quotedFragment = elided;
   this.#append({
    kind: 'disfluency-elided',
    detail: `fragment ${entry.id}`,
    refs: [entry.id],
   });
  }
 }
 this.#write(entry);
 return entry;
 }

 list(
  filter?: { status?: QueueEntry['status']; source?: QueueEntry['source'] },
 ): QueueEntry[] {
  let entries = this.#readAll();
  if (filter?.status) {
   entries = entries.filter((e) => e.status === filter.status);
  }
  if (filter?.source) {
   entries = entries.filter((e) => e.source === filter.source);
  }
  return entries;
 }

 get(id: string): QueueEntry | undefined {
  return this.#readOne(id) ?? undefined;
 }

 /**
  * The degradation ladder (Q-55): the system drops its own inferences before
  * it drops the person's declarations, and when it runs out of inferences to
  * drop it composes rather than compromises.
  *
  * Step 1 runs the hard filters. If they leave nothing, rung 2 re-runs them
  * admitting `user-declared` entries past sharpness and modeNeeds. If that
  * leaves nothing too, the floor is `return null` — and the caller composing
  * fresh with full context (Q-36) is the RIGHT outcome, not a failure, so the
  * floor is logged rather than repaired. Rung 1 — dropping facet balance —
  * lives at step 4, because line-order already guarantees the facet filter
  * can never be what emptied the pool.
  */
 draw(mode: Mode): QueueEntry | null {
  // Q-115: while the sitting-level pause holds, the queue offers nothing —
  // the caller's fallback (bank / imported material) carries the sitting.
  const eng = this.#engagement.read();
  if (eng.sittingCounter < eng.pausedUntilSitting) return null;

  const all = this.#readAll();
  // Ticket 148: skip entries from deferred threads
  const drawPool = this.#deferredSnippets.size > 0
    ? all.filter(e => {
        const threadKey = threadKeyOf(e);
        if (!threadKey) return true;
        return !this.#deferredSnippets.has(threadKey);
      })
    : all;

  const filters = drawFilters(mode, this.#parkedPointerKinds);

  // Step 1: the hard filters, in the order Q-55 fixes.
  const normal = runChain(drawPool, filters, false);
  let candidates = normal.pool;

  // Step 2: rung 2, and only when step 1 came back empty.
  if (candidates.length === 0) {
   const relaxed = runChain(drawPool, filters, true);
   if (relaxed.pool.length === 0) {
    this.#logFloor(drawPool.length, normal.emptiedBy, mode);
    return null;
   }
   this.#logRung(
    2,
    relaxedBy(relaxed.pool, filters).join(',') || 'none',
    relaxed.pool.length,
    relaxed.pool.map((e) => e.id),
   );
   candidates = relaxed.pool;
  }

  // Step 3: sort — the person's own questions first, then recency (newest
  // first), through the one comparator the open pool's display and the QR-6
  // bound share (the weak-early invariant lives at one address).
  candidates.sort(compareOpenEntries);

  // Step 4: facet balance — a second hard filter on the pool, applied BEFORE
  // the top-k pick so chance runs inside the constraints (Q-13), and running
  // in shadow until its log earns it the right to act (Q-35). It narrows
  // what the Target filter already left; the two compose, in that order.
  const fb = facetBalancedPool(candidates, { root: this.#root, env: process.env });

  // Rung 1 of the ladder: the facet filter wanted this pool empty and stood
  // down instead. It is the system's inference about corpus shape, so it is
  // the first thing dropped — and `applyFacetBalance` already drops it,
  // which is why this rung is a log line rather than a branch. A corpus that
  // owes every Facet owes none in particular; that stand-down is cold start,
  // not a rung, and the filter had no claim to drop.
  if (!fb.applied && fb.wanted.size < FACETS.length) {
   this.#logRung(1, 'facet-balance', candidates.length, []);
  }

  // Step 5: top-k (k=3), uniform random pick — once for the open pool, once
  // for the balanced pool, so the shadow log can name the road not taken.
  const openPick = pickTopK(candidates);
  const balancedPick = fb.applied ? pickTopK(fb.kept) : null;
  const picked = fb.live && balancedPick ? balancedPick : openPick;

  this.#logFacetBalance({
   live: fb.live,
   dist: fb.dist,
   wanted: fb.wanted,
   poolSize: candidates.length,
   keptSize: fb.applied ? fb.kept.length : candidates.length,
   applied: fb.applied,
   openPick,
   balancedPick,
  });

  // Step 6: markAsked immediately
  this.markAsked(picked.id);

  return picked;
 }

 /**
  * One line per rung actually used. `before` is the pool the constraint left
  * — zero, at every rung, because a rung only fires when a constraint emptied
  * the pool — and `after` is what relaxing it recovered. Without this, "the
  * filters emptied the pool" stays a hypothesis and Q-55's claim that a long
  * cascade is unnecessary has no evidence behind it either way.
  */
 #logRung(rung: 1 | 2, relaxed: string, after: number, refs: string[]): void {
  this.#append({
   kind: 'queue-rung',
   detail: `rung=${rung} relaxed=${relaxed} before=0 after=${after}`,
   refs,
  });
 }

 /**
  * The floor: the caller composes fresh, which Q-55 calls the right outcome.
  * What it names is the filter that got there first — the one rung a longer
  * ladder would have had to relax next, recorded so that the decision to have
  * no such rung can be reviewed against what actually happens.
  */
 #logFloor(
  poolSize: number,
  emptiedBy: FilterName | null,
  mode: Mode,
 ): void {
  this.#append({
   kind: 'queue-floor',
   detail: [
    `emptiedBy=${emptiedBy ?? 'none'}`,
    `pool=${poolSize}`,
    `target=${mode.target ?? 'none'}`,
    `mode=${mode.minutes}m/${mode.energy}`,
   ].join(' '),
   refs: [],
  });
 }

 /** The log is evidence, not a dependency — a draw never fails on it. */
 #append(e: { kind: EventKind; detail: string; refs: string[] }): void {
  try {
   appendEvent(this.#root, {
    at: new Date().toISOString(),
    actor: 'elicitor',
    kind: e.kind,
    detail: e.detail,
    ...(e.refs.length > 0 ? { refs: e.refs } : {}),
   });
  } catch {
   // Deliberately silent, exactly as `#logFacetBalance` is.
  }
 }

 /**
  * One line per draw, whether or not the filter bit. The shadow record is
  * free evidence (Q-23) and the only thing that can graduate the filter.
  */
 #logFacetBalance(o: {
  live: boolean;
  dist: FacetDistribution;
  wanted: Set<Facet>;
  poolSize: number;
  keptSize: number;
  applied: boolean;
  openPick: QueueEntry;
  balancedPick: QueueEntry | null;
 }): void {
  const plan = sessionBlueprint(o.dist, SESSION_BLUEPRINT_SLOTS);
  const diverged = o.balancedPick !== null && o.balancedPick.id !== o.openPick.id;
  const detail = [
   `mode=${o.live ? 'live' : 'shadow'}`,
   `dist=${formatDistribution(o.dist)}`,
   `under=${[...o.wanted].join(',') || 'none'}`,
   `plan=${plan.join(',')}`,
   `pool=${o.poolSize}`,
   `kept=${o.keptSize}`,
   `applied=${o.applied}`,
   `would=${o.balancedPick?.id ?? 'none'}`,
   `wouldFacet=${o.balancedPick?.targetFacet ?? 'none'}`,
   `open=${o.openPick.id}`,
   `openFacet=${o.openPick.targetFacet ?? 'none'}`,
   `diverged=${diverged}`,
  ].join(' ');

  try {
   appendEvent(this.#root, {
    at: new Date().toISOString(),
    actor: 'elicitor',
    kind: o.live ? 'facet-balance-applied' : 'facet-balance-shadow',
    detail,
    refs: o.balancedPick ? [o.openPick.id, o.balancedPick.id] : [o.openPick.id],
   });
  } catch {
   // The log is evidence, not a dependency — a draw never fails on it.
  }
 }

 markAsked(id: string): void {
  const entry = this.#readOne(id);
  if (!entry) return;
  entry.status = 'asked';
  this.#write(entry);
 }

 /**
  * The status and the time it happened are one fact, so they are written
  * together: a downstream horizon that reads `answered` without a date has
  * nothing to measure from (ticket 041).
  */
 markAnswered(id: string): void {
  const entry = this.#readOne(id);
  if (!entry) return;
  entry.status = 'answered';
  entry.answeredAt = new Date().toISOString();
  this.#write(entry);
 }

 defer(id: string): void {
  const entry = this.#readOne(id);
  if (!entry) return;
  entry.status = 'deferred';
  this.#write(entry);
 }

 expire(olderThanDays: number): number {
  const now = Date.now();
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
  const all = this.#readAll();
  let count = 0;

  for (const entry of all) {
   if (entry.status !== 'pending') continue;
   // Q-41: gap questions expire on the normal queue rule — the asymmetry is
   // the whole point. Only a question the person typed in by hand survives
   // the sweep; the literal below is deliberate and must not grow.
   if (entry.source === 'user-declared') continue;
   const createdMs = new Date(entry.created).getTime();
   if (createdMs < cutoff) {
    entry.status = 'expired';
    this.#write(entry);
    count++;
   }
  }

  return count;
 }

 /**
  * QR-6: the flood bound's expiry. Keeps the first `keep` of the pending
  * entries the filter names — user-declared first, then newest first — and
  * expires the tail beyond it, so a display cap and the disk state cannot
  * drift (the queue the person sees IS the queue on disk). The default
  * filter is the open pool: days/session horizons, never a user-declared
  * entry. One summary line per call; per-entry lines are the caller's.
  */
 expireTailBeyond(keep: number, filter?: (e: QueueEntry) => boolean): number {
  const all = this.#readAll();
  const pending = all.filter((e) => e.status === 'pending');
  const match =
   filter ??
   ((e) => (e.horizon === 'days' || e.horizon === 'session') && !isUserDeclaredWeight(e));
  const candidates = pending.filter(match).sort(compareOpenEntries);
  const tail = candidates.slice(keep);
  for (const entry of tail) {
   entry.status = 'expired';
   this.#write(entry);
  }
  if (tail.length > 0) {
   this.#append({
    kind: 'queue-tail-expired',
    detail: `expired=${tail.length} kept=${keep}`,
    refs: tail.map((e) => e.id),
   });
  }
  return tail.length;
 }

 /**
  * QR-6: set ONE entry to 'expired' and write it back. The primitive the
  * one-time template sweep persists through; the caller owns the policy
  * (who is never expired) and the Activity Log line. A no-op when nothing
  * reads back for the id.
  */
 markExpired(id: string): void {
  const entry = this.#readOne(id);
  if (!entry) return;
  entry.status = 'expired';
  this.#write(entry);
 }
 
 markPending(id: string): void {
   const entry = this.#readOne(id);
   if (!entry) return;
   entry.status = 'pending';
   entry.created = new Date().toISOString();
   this.#write(entry);
 }
 
 park(id: string): void {
   const entry = this.#readOne(id);
   if (!entry || entry.status !== 'pending') return;
   entry.status = 'parked';
   this.#write(entry);
 }
 
 unpark(id: string): void {
   const entry = this.#readOne(id);
   if (!entry || entry.status !== 'parked') return;
   entry.status = 'pending';
   entry.created = new Date().toISOString();
   this.#write(entry);
 }
 
 recordReplyDisengagement(openerEntryId: string, replyText: string): boolean {
   const entry = this.#readOne(openerEntryId);
   if (!entry) return false;
   const openerWords = contentWordsOf(entry.question);
   const replyWords = contentWordsOf(replyText);
   const hasOverlap = [...openerWords].some(w => replyWords.has(w));

   // Q-115: the sitting-level ledger, judged on the same overlap. An
   // engaged reply resets everything; a pivot marks THIS sitting as one
   // strike (once — a second pivot in the same sitting adds nothing), and
   // two consecutive strike-sittings pause queue draws for a cooldown of
   // sittings that doubles per pause (2, 4, 8-cap). The draw after the
   // cooldown is the probe; this same method scores it.
   const eng = this.#engagement.read();
   if (hasOverlap) {
     if (eng.consecutiveDisengaged > 0 || eng.pauses > 0 || eng.pausedUntilSitting > 0) {
       this.#engagement.write({
         ...eng,
         consecutiveDisengaged: 0,
         lastStrikeSitting: -1,
         pauses: 0,
         pausedUntilSitting: 0,
       });
     }
   } else if (eng.lastStrikeSitting !== eng.sittingCounter) {
     eng.consecutiveDisengaged += 1;
     eng.lastStrikeSitting = eng.sittingCounter;
     if (eng.consecutiveDisengaged >= 2) {
       eng.pauses += 1;
       const cooldown = Math.min(8, 2 ** eng.pauses);
       eng.pausedUntilSitting = eng.sittingCounter + cooldown + 1;
       this.#append({
         kind: 'queue-paused',
         detail: `sittings=${cooldown} strikes=${eng.consecutiveDisengaged} pause=${eng.pauses}`,
         refs: [],
       });
     }
     this.#engagement.write(eng);
   }

   // Ticket 148's original per-thread deferral — its own method, so the
   // Q-115 sitting ledger above and the per-thread policy below stay
   // separable; both policies are unchanged.
   return this.#deferThreadAfterStrikes(entry, hasOverlap);
 }

 /**
  * Ticket 148's original per-thread deferral, kept as built: it needs a
  * thread served twice, which the measured one-serve-per-snippet queue
  * never does, but a queue that DOES re-serve a thread still deserves it.
  */
 #deferThreadAfterStrikes(entry: QueueEntry, hasOverlap: boolean): boolean {
   const threadKey = threadKeyOf(entry);
   if (!threadKey) return false;
   if (hasOverlap) { this.#threadStrikes.set(threadKey, 0); return false; }
   const strikes = (this.#threadStrikes.get(threadKey) ?? 0) + 1;
   this.#threadStrikes.set(threadKey, strikes);
   if (strikes >= 2) {
     this.#deferredSnippets.add(threadKey);
     const all = this.#readAll();
     for (const e of all) {
       if (e.status !== 'pending') continue;
       if (threadKeyOf(e) === threadKey) { e.status = 'deferred'; this.#write(e); }
     }
     this.#append({ kind: 'thread-deferred', detail: `thread=${threadKey} strikes=${strikes}`, refs: [threadKey] });
     return true;
   }
   return false;
 }
 
 }
